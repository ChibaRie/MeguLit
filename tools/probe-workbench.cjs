#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 maintainer workbench for the closed-beta full probes (services/probe-full.cjs, relay/src/probe-full.js).

     node tools/probe-workbench.cjs list                      what the relay holds (title, step, size, state, expiry)
     node tools/probe-workbench.cjs get <identity|prefix>     download → <work>/<title>-<id12>/probe.mlfp and unpack it
     node tools/probe-workbench.cjs unpack <file.mlfp> [dir]  unpack a .mlfp you already have
     node tools/probe-workbench.cjs done <identity|prefix>    adapted: delete it on the relay (apps will not resend it)
     node tools/probe-workbench.cjs delete <identity|prefix>  delete it on the relay (apps may send it again)

   Unpacked folder: scripts/<reader>/… (decoded scenes), archives/<archive>/<entry> (raw entries, encrypted ones as
   stored), loose/…, index/<archive>#head|#tail, bin/<exe|dll> (slim PEs: same file offsets, overlay and big .rsrc
   zeroed), manifest.json (every file's size + sha256, items, what was dropped and why), versions.json.

   MEGULIT_ADAPTER_ADMIN_TOKEN  the relay's ADAPTER_ADMIN_TOKEN (same as tools/adapter-pack.cjs)
   MEGULIT_RELAY_BASE           default https://api.megulit.com
   MEGULIT_PROBE_WORK           default H:\MeguLit-Work\probe-full (big files stay off C: and E:) */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const pf=require('../services/probe-full.cjs');
const fail=m=>{console.error(m);process.exit(1);};
const relay=()=>(process.env.MEGULIT_RELAY_BASE&&process.env.MEGULIT_RELAY_BASE!=='off'?process.env.MEGULIT_RELAY_BASE:'https://api.megulit.com').replace(/\/+$/,'');
const work=()=>process.env.MEGULIT_PROBE_WORK||'H:\\MeguLit-Work\\probe-full';
const token=()=>process.env.MEGULIT_ADAPTER_ADMIN_TOKEN||fail('MEGULIT_ADAPTER_ADMIN_TOKEN is not set');
async function call(method,route,body,{raw=false}={}){
 const r=await fetch(relay()+route,{method,headers:{authorization:'Bearer '+token(),'user-agent':'MeguLit-maintainer',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 if(raw){if(!r.ok)fail(r.status+' '+await r.text());return r;}const j=await r.json().catch(()=>({}));if(!r.ok||j.ok===false)fail(r.status+' '+JSON.stringify(j));return j;}
const mb=n=>(n/1048576).toFixed(1)+' MB',day=t=>t?new Date(t*1000).toISOString().slice(0,10):'-';
async function games(){return (await call('GET','/api/probe/full/list')).games||[];}
async function resolve(id){if(/^[a-f0-9]{64}$/.test(id||''))return id;const all=(await games()).filter(g=>g.identity.startsWith(String(id||'').toLowerCase()));
 if(all.length!==1)fail(all.length?'prefix matches '+all.length+' games':'no such game: '+id);return all[0].identity;}
const folderName=(title,id)=>(String(title||'game').replace(/[\\/:*?"<>|\s]+/g,'_').slice(0,60)||'game')+'-'+id.slice(0,12);

async function list(){const j=await call('GET','/api/probe/full/list');
 console.log(`stored ${mb(j.stored)} of ${mb(j.limit)}`);
 for(const g of j.games)console.log([g.identity.slice(0,12),g.state.padEnd(9),mb(g.size).padStart(9),String(g.step).padEnd(14),('×'+g.reporters).padEnd(4),'until '+day(g.expiresAt),g.vndb||'-',g.title].join('  '));
 if(!j.games.length)console.log('(nothing uploaded)');}
async function get(id){id=await resolve(id);const g=(await games()).find(x=>x.identity===id);const dir=path.join(work(),folderName(g?.title,id));fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'probe.mlfp'),r=await call('GET','/api/probe/full/get?identity='+id,null,{raw:true});
 const buf=Buffer.from(await r.arrayBuffer()),want=r.headers.get('x-sha256')||g?.sha256;const got=crypto.createHash('sha256').update(buf).digest('hex');
 if(want&&got!==want)fail('sha256 mismatch: '+got+' ≠ '+want);fs.writeFileSync(file,buf);console.log('downloaded',mb(buf.length),'→',file);return unpack(file,dir);}
function unpack(file,dir){dir=dir||path.join(path.dirname(path.resolve(file)),path.basename(file,'.mlfp'));const u=pf.unpack(file,dir),m=u.manifest;
 const by=m.items.reduce((o,i)=>(o[i.kind]=(o[i.kind]||0)+1,o),{});
 console.log(`unpacked ${u.items} items → ${dir}`);console.log(`  ${m.title||'(no title)'} · step ${m.step} · reader ${m.detected||'-'} · exe ${m.exe} · app ${m.app||'?'}`);
 console.log('  items',JSON.stringify(by),'· dropped',m.dropped.length,'· files listed',m.files.length);
 for(const [f,v] of Object.entries(m.versions||{}))console.log('  version',f,v.fileVersion||'',v.strings?.ProductName||'');return u;}
async function finish(id,tomb){id=await resolve(id);const j=await call('POST','/api/probe/full/'+(tomb?'done':'delete'),{identity:id});console.log(id.slice(0,12),JSON.stringify(j));}

async function main(argv){const [cmd,a,b]=argv;
 if(cmd==='list')return list();if(cmd==='get'&&a)return get(a);if(cmd==='unpack'&&a)return unpack(a,b);
 if(cmd==='done'&&a)return finish(a,true);if(cmd==='delete'&&a)return finish(a,false);
 console.log(fs.readFileSync(__filename,'utf8').split('\n').slice(4,20).join('\n').replace(/^\/\*|\*\/$/gm,''));process.exitCode=cmd?1:0;}
if(require.main===module)main(process.argv.slice(2)).catch(e=>fail(e?.stack||e));
module.exports={main,folderName};
