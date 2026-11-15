#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 maintainer workbench for adaptation contribution packages (relay/src/contrib.js,
   services/adapter-contrib.cjs). Everything lands under H:\MeguLit-Work\contrib (never C:), one folder per package.

     node tools/contrib-workbench.cjs list                       packages on the relay (receiving / complete)
     node tools/contrib-workbench.cjs pull <upload|identity>     download, join, check sha256 → <work>/<id>/package.mgct.gz
     node tools/contrib-workbench.cjs unpack <file|upload>       → <work>/<id>/files/… (scripts, exe sections) + manifest.json
     node tools/contrib-workbench.cjs get <upload|identity>      pull + unpack
     node tools/contrib-workbench.cjs done <upload|identity>     game adapted: the relay deletes the package (rule 3)
     node tools/contrib-workbench.cjs delete <upload>            delete on the relay without marking adapted
     node tools/contrib-workbench.cjs clean <upload>             delete the local working copy

   Environment: MEGULIT_ADMIN_TOKEN (the relay's ADAPTER_ADMIN_TOKEN), MEGULIT_RELAY (default https://api.megulit.com;
   https://cn-api.megulit.com from mainland China), MEGULIT_CONTRIB_WORK (default H:\MeguLit-Work\contrib). */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const contrib=require('../services/adapter-contrib.cjs');
const RELAY=(process.env.MEGULIT_RELAY||'https://api.megulit.com').replace(/\/+$/,'');
const WORK=process.env.MEGULIT_CONTRIB_WORK||'H:\\MeguLit-Work\\contrib';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,HEX64=/^[a-f0-9]{64}$/;
function workDir(){if(/^c:/i.test(path.resolve(WORK))&&!process.env.MEGULIT_CONTRIB_ALLOW_C)throw Error('work folder is on C: — set MEGULIT_CONTRIB_WORK to H:\\… (or MEGULIT_CONTRIB_ALLOW_C=1)');fs.mkdirSync(WORK,{recursive:true});return WORK;}
function auth(){const t=process.env.MEGULIT_ADMIN_TOKEN;if(!t)throw Error('set MEGULIT_ADMIN_TOKEN');return {authorization:'Bearer '+t,'user-agent':'megulit-workbench'};}
async function call(route,{method='GET',body,fetcher=globalThis.fetch,relay=RELAY}={}){const r=await fetcher(relay+route,{method,headers:{...auth(),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 if(!r.ok){let e='';try{e=(await r.json()).error;}catch{}throw Error(route+' → HTTP '+r.status+(e?' '+e:''));}return r;}
async function list(o={}){return (await (await call('/api/contrib/list',o)).json()).packages||[];}
async function find(id,o){const all=await list(o);const p=all.find(x=>x.upload===id||x.identity===id&&x.state==='complete');if(!p)throw Error('no complete package '+id);return p;}
/* pull: parts joined, sha256 checked */
async function pull(id,o={}){const p=await find(id,o),dir=path.join(o.work||workDir(),p.upload);fs.mkdirSync(dir,{recursive:true});const bufs=[];
 for(let i=0;i<p.parts;i++){const r=await call(`/api/contrib/part/${p.upload}/${i}`,o);bufs.push(Buffer.from(await r.arrayBuffer()));}
 const all=Buffer.concat(bufs),hash=crypto.createHash('sha256').update(all).digest('hex');if(hash!==p.sha256)throw Error('sha256 mismatch for '+p.upload);
 const file=path.join(dir,'package.mgct.gz');fs.writeFileSync(file,all);fs.writeFileSync(path.join(dir,'relay.json'),JSON.stringify(p,null,1));return {file,dir,package:p};}
/* unpack: every entry under files/ by its name (archive::entry → archive/entry), the manifest beside it */
const safe=n=>String(n).replace(/::/g,'/').replace(/#/g,'.section.').split(/[\\/]+/).filter(x=>x&&x!=='.'&&x!=='..').map(x=>x.replace(/[<>:"|?*\u0000-\u001f]/g,'_').slice(0,120)).join(path.sep)||'unnamed';
function unpack(file,o={}){const buf=fs.readFileSync(file),{manifest,files}=contrib.unpack(buf),dir=o.dir||path.dirname(file),out=path.join(dir,'files');fs.mkdirSync(out,{recursive:true});
 for(const f of files){const target=path.join(out,safe(f.name)+(f.role.startsWith('exe-')||f.role.startsWith('plugin-')?'.bin':''));if(!target.startsWith(out))continue;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,f.data);}
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,1));return {dir,out,manifest,count:files.length};}
async function done(id,o={}){const body=UUID.test(id)?{upload:id}:HEX64.test(id)?{identity:id}:null;if(!body)throw Error('upload uuid or identity');return (await call('/api/contrib/done',{...o,method:'POST',body})).json();}
async function remove(id,o={}){if(!UUID.test(id))throw Error('upload uuid');return (await call('/api/contrib/delete',{...o,method:'POST',body:{upload:id}})).json();}
const mb=n=>(n/1048576).toFixed(1)+' MB';
async function main([cmd,arg]){
 if(cmd==='list'){const rows=await list();if(!rows.length){console.log('(no packages)');return;}for(const p of rows)console.log(`${p.upload}  ${p.state.padEnd(9)} ${mb(p.size).padStart(8)}  ${new Date(p.created_at*1000).toISOString().slice(0,10)}  ${p.app||'?'}  ${p.title||'?'}  ${p.identity?p.identity.slice(0,12):''}`);return;}
 if(cmd==='pull'){const r=await pull(arg);console.log('saved',r.file);return;}
 if(cmd==='unpack'){const file=fs.existsSync(arg||'')?arg:path.join(workDir(),String(arg),'package.mgct.gz');const r=unpack(file);console.log(`${r.count} files → ${r.out}`);return;}
 if(cmd==='get'){const p=await pull(arg),r=unpack(p.file);console.log(`${r.manifest.game.title}: ${r.count} files → ${r.out}`);return;}
 if(cmd==='done'){console.log(await done(arg));return;}
 if(cmd==='delete'){console.log(await remove(arg));return;}
 if(cmd==='clean'){if(!UUID.test(String(arg)))throw Error('upload uuid');fs.rmSync(path.join(workDir(),arg),{recursive:true,force:true});console.log('removed');return;}
 console.log(fs.readFileSync(__filename,'utf8').split('*/')[0].split('\n').slice(3).join('\n'));}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(String(e?.message||e));process.exit(1);});
module.exports={list,pull,unpack,done,remove,safe};
