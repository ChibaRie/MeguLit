#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 maintainer workbench for adaptation contribution packages (relay/src/contrib.js,
   services/adapter-contrib.cjs). Everything lands under H:\MeguLit-Work\contrib (never C:), one folder per package.

     node tools/contrib-workbench.cjs                            overview: what waits on the relay, what is local, what to do next
     node tools/contrib-workbench.cjs list [--json]              packages on the relay, with age, days left and the local state
     node tools/contrib-workbench.cjs sync                       get every complete package that is not local yet
     node tools/contrib-workbench.cjs get <id>                   pull + unpack + text + SUMMARY.md
     node tools/contrib-workbench.cjs pull <id>                  download, join, check sha256 → <work>/<upload>/package.mgct.gz
     node tools/contrib-workbench.cjs unpack <file|id>           → <work>/<upload>/files/… (scripts, exe sections) + manifest.json
     node tools/contrib-workbench.cjs text <id>                  scripts decoded to UTF-8 → <work>/<upload>/text/… (Shift-JIS, UTF-16, UTF-8)
     node tools/contrib-workbench.cjs info <id>                  what the package holds (also written to SUMMARY.md)
     node tools/contrib-workbench.cjs done <id> [--keep]         game adapted: the relay deletes the package (rule 3) and the local copy goes too
     node tools/contrib-workbench.cjs delete <id>                delete on the relay without marking adapted
     node tools/contrib-workbench.cjs clean <id>|--all           delete the local working copy (--all: every copy the relay no longer holds)

   <id>: the upload uuid, its first 6+ characters, the game identity, or a part of the title (it must match one package).

   Environment: MEGULIT_ADMIN_TOKEN or MEGULIT_ADAPTER_ADMIN_TOKEN (the relay secret ADAPTER_ADMIN_TOKEN, the same one
   tools/adapter-pack.cjs uses), MEGULIT_RELAY (default https://api.megulit.com, then https://cn-api.megulit.com when the
   first cannot be reached), MEGULIT_CONTRIB_WORK (default H:\MeguLit-Work\contrib). */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const contrib=require('../services/adapter-contrib.cjs');
const RELAYS=process.env.MEGULIT_RELAY?[process.env.MEGULIT_RELAY.replace(/\/+$/,'')]:['https://api.megulit.com','https://cn-api.megulit.com'];
const WORK=process.env.MEGULIT_CONTRIB_WORK||'H:\\MeguLit-Work\\contrib';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,HEX64=/^[a-f0-9]{64}$/;
function workDir(){if(/^c:/i.test(path.resolve(WORK))&&!process.env.MEGULIT_CONTRIB_ALLOW_C)throw Error('work folder is on C: — set MEGULIT_CONTRIB_WORK to H:\\… (or MEGULIT_CONTRIB_ALLOW_C=1)');fs.mkdirSync(WORK,{recursive:true});return WORK;}
function auth(){const t=process.env.MEGULIT_ADMIN_TOKEN||process.env.MEGULIT_ADAPTER_ADMIN_TOKEN;if(!t)throw Error('set MEGULIT_ADMIN_TOKEN (or MEGULIT_ADAPTER_ADMIN_TOKEN): the relay secret ADAPTER_ADMIN_TOKEN');return {authorization:'Bearer '+t,'user-agent':'megulit-workbench'};}
/* one request; a relay that cannot be reached at all (no HTTP answer) hands over to the next one, an HTTP error does not */
async function call(route,{method='GET',body,fetcher=globalThis.fetch,relay}={}){
 const relays=relay?[relay]:RELAYS;let last;
 for(const base of relays){let r;
  try{r=await fetcher(base+route,{method,headers:{...auth(),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});}
  catch(e){if(/^set MEGULIT_/.test(String(e?.message)))throw e;last=Error(route+' → '+base+' unreachable ('+String(e?.cause?.code||e?.message||e)+')');continue;}
  if(!r.ok){let e='';try{e=(await r.json()).error;}catch{}
   throw Error(route+' → HTTP '+r.status+(e?' '+e:'')+(r.status===401?' (the token is not the relay secret ADAPTER_ADMIN_TOKEN)':''));}
  return r;}
 throw last||Error(route+' → no relay');}
async function list(o={}){return (await (await call('/api/contrib/list',o)).json()).packages||[];}
/* <id> → one package of the relay list: uuid, uuid prefix (6+), identity, or part of the title */
function match(all,id,{complete=true}={}){const q=String(id||'').trim(),low=q.toLowerCase();if(!q)throw Error('which package? pass an upload id, its first characters, or part of the title');
 const pool=complete?all.filter(p=>p.state==='complete'):all;
 const exact=pool.filter(p=>p.upload===low||p.identity===low);if(exact.length)return exact[0];
 const hits=pool.filter(p=>low.length>=6&&/^[0-9a-f-]+$/.test(low)&&p.upload.startsWith(low)||String(p.title||'').toLowerCase().includes(low));
 if(hits.length===1)return hits[0];
 if(!hits.length)throw Error('no '+(complete?'complete ':'')+'package '+q);
 throw Error(q+' matches '+hits.length+' packages: '+hits.map(p=>p.upload.slice(0,8)+' '+(p.title||'?')).join(', '));}
async function find(id,o){return match(await list(o),id);}
/* pull: parts joined, sha256 checked; a copy already here with the same sha256 is kept */
async function pull(id,o={}){const p=await find(id,o),dir=path.join(o.work||workDir(),p.upload);fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'package.mgct.gz');
 if(fs.existsSync(file)&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===p.sha256){fs.writeFileSync(path.join(dir,'relay.json'),JSON.stringify(p,null,1));return {file,dir,package:p,cached:true};}
 const bufs=[];
 for(let i=0;i<p.parts;i++){const r=await call(`/api/contrib/part/${p.upload}/${i}`,o);bufs.push(Buffer.from(await r.arrayBuffer()));}
 const all=Buffer.concat(bufs),hash=crypto.createHash('sha256').update(all).digest('hex');if(hash!==p.sha256)throw Error('sha256 mismatch for '+p.upload);
 fs.writeFileSync(file,all);fs.writeFileSync(path.join(dir,'relay.json'),JSON.stringify(p,null,1));return {file,dir,package:p,cached:false};}
/* unpack: every entry under files/ by its name (archive::entry → archive/entry), the manifest beside it */
const safe=n=>String(n).replace(/::/g,'/').replace(/#/g,'.section.').split(/[\\/]+/).filter(x=>x&&x!=='.'&&x!=='..').map(x=>x.replace(/[<>:"|?*\u0000-\u001f]/g,'_').slice(0,120)).join(path.sep)||'unnamed';
const binary=f=>String(f.role||'').startsWith('exe-')||String(f.role||'').startsWith('plugin-');
function unpack(file,o={}){const buf=fs.readFileSync(file),{manifest,files}=contrib.unpack(buf),dir=o.dir||path.dirname(file),out=path.join(dir,'files');fs.mkdirSync(out,{recursive:true});
 for(const f of files){const target=path.join(out,safe(f.name)+(binary(f)?'.bin':''));if(!target.startsWith(out))continue;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,f.data);}
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,1));return {dir,out,manifest,count:files.length};}
/* which text encoding a script is in: BOMs, strict UTF-8, then Shift-JIS when it decodes cleanly and holds kana or kanji;
   anything else (compiled or encrypted scripts) is binary and is left alone */
function decodeText(data){
 if(!data||!data.length)return null;
 if(data[0]===0xff&&data[1]===0xfe)return {encoding:'utf-16le',text:new TextDecoder('utf-16le').decode(data.subarray(2))};
 if(data[0]===0xfe&&data[1]===0xff)return {encoding:'utf-16be',text:new TextDecoder('utf-16be').decode(data.subarray(2))};
 const body=data[0]===0xef&&data[1]===0xbb&&data[2]===0xbf?data.subarray(3):data;
 let nul=0;const probe=body.subarray(0,4096);for(const b of probe)if(b===0)nul++;
 if(nul>probe.length/8){ /* every other byte zero: UTF-16 without a BOM */
  let odd=0;for(let i=1;i<probe.length;i+=2)if(probe[i]===0)odd++;
  if(odd>probe.length/4){try{return {encoding:'utf-16le',text:new TextDecoder('utf-16le',{fatal:true}).decode(body)};}catch{}}
  return null;}
 if(nul)return null;
 try{return {encoding:'utf-8',text:new TextDecoder('utf-8',{fatal:true}).decode(body)};}catch{}
 try{const text=new TextDecoder('shift_jis',{fatal:true}).decode(body);if(/[\u3040-\u30ff\u4e00-\u9fff]/.test(text))return {encoding:'shift_jis',text};}catch{}
 return null;}
/* text: every script the package holds that is plain text, as UTF-8 under text/ (same tree as files/) */
function textOut(dir){const file=path.join(dir,'package.mgct.gz'),{files}=contrib.unpack(fs.readFileSync(file)),out=path.join(dir,'text');
 const rows=[];fs.rmSync(out,{recursive:true,force:true});
 for(const f of files){if(binary(f))continue;const d=decodeText(f.data);if(!d){rows.push({name:f.name,encoding:'binary',size:f.data.length});continue;}
  const target=path.join(out,safe(f.name));if(!target.startsWith(out))continue;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,d.text.replace(/\r\n?/g,'\n'),'utf8');
  rows.push({name:f.name,encoding:d.encoding,size:f.data.length,japanese:(d.text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g)||[]).length});}
 return {out,rows};}
const mb=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
/* info: what the package holds, by role and by encoding; written to SUMMARY.md so a session can start from one file */
function info(dir){const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 let relay={};try{relay=JSON.parse(fs.readFileSync(path.join(dir,'relay.json'),'utf8'));}catch{}
 const t=textOut(dir),game=manifest.game||{},roles={};
 for(const f of manifest.files||[]){const r=roles[f.role]||(roles[f.role]={count:0,size:0});r.count++;r.size+=Number(f.size)||0;}
 const enc={};for(const r of t.rows){const e=enc[r.encoding]||(enc[r.encoding]={count:0,size:0,japanese:0});e.count++;e.size+=r.size;e.japanese+=r.japanese||0;}
 const biggest=t.rows.filter(r=>r.encoding!=='binary'&&r.japanese).sort((a,b)=>b.japanese-a.japanese).slice(0,8);
 const dropped=manifest.dropped||{},sections=[
  ['# '+(game.title||relay.title||'?'),[
   'upload: '+(relay.upload||path.basename(dir)),
   'identity: '+(manifest.identity||relay.identity||''),
   'app: '+(manifest.app||relay.app||'?')+', packed '+(manifest.createdAt||'?'),
   'probe: step '+(game.step??'?')+', detected '+(typeof game.detected==='string'?game.detected:JSON.stringify(game.detected??null)),
   'exe: '+(game.exe?.name||'?')+' ('+mb(Number(game.exe?.size)||0)+', sha256 '+String(game.exe?.sha256||'').slice(0,16)+')',
   ...(relay.expires_at?['relay deletes it on '+new Date(relay.expires_at*1000).toISOString().slice(0,10)+' (or at `done`)']:[])]],
  ['## Files by role',Object.entries(roles).sort((a,b)=>b[1].size-a[1].size).map(([k,v])=>`${k}: ${v.count} files, ${mb(v.size)}`)],
  ['## Scripts by encoding',Object.keys(enc).length?Object.entries(enc).map(([k,v])=>`${k}: ${v.count} files, ${mb(v.size)}`+(v.japanese?`, ${v.japanese} kana/kanji`:'')+(k==='binary'?' (compiled or encrypted: under files/ as they came)':'')):['(no script entries)']],
  ['## Most Japanese text (start reading here)',biggest.map(r=>`text/${safe(r.name).split(path.sep).join('/')} — ${r.encoding}, ${r.japanese} kana/kanji`)],
  ['## Left out by the app',Object.entries(dropped).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`)],
  ['## Folders',['files/ — raw entries, exe sections as .bin','text/ — scripts as UTF-8','manifest.json, relay.json']]];
 const text=sections.filter(([,items])=>items.length).map(([h,items])=>h+'\n\n'+items.map(x=>'- '+x).join('\n')).join('\n\n')+'\n';
 fs.writeFileSync(path.join(dir,'SUMMARY.md'),text,'utf8');
 return {text,manifest,roles,encodings:enc,textDir:t.out};}
async function get(id,o={}){const p=await pull(id,o),x=unpack(p.file),i=info(p.dir);return {...p,...x,info:i};}
/* local copies: <work>/<upload>/ with a package in it */
function localCopies(work){let names=[];try{names=fs.readdirSync(work);}catch{}return names.filter(n=>UUID.test(n)&&fs.existsSync(path.join(work,n,'package.mgct.gz')));}
function cleanLocal(work,upload){if(!UUID.test(String(upload)))return false;const dir=path.join(work,upload);if(!fs.existsSync(dir))return false;fs.rmSync(dir,{recursive:true,force:true});return true;}
/* sync: every complete package not local yet (or local with another sha256) */
async function sync(o={}){const work=o.work||workDir(),all=await list(o),got=[],kept=[],failed=[];
 for(const p of all.filter(x=>x.state==='complete')){try{const r=await get(p.upload,{...o,work});(r.cached?kept:got).push({upload:p.upload,title:r.manifest?.game?.title||p.title,dir:r.dir});}catch(e){failed.push({upload:p.upload,title:p.title,error:String(e?.message||e)});}}
 return {got,kept,failed,receiving:all.filter(p=>p.state==='receiving').length};}
/* done: the relay deletes the package; the local copy goes with it (rule 3) unless keep */
async function done(id,o={}){let body=UUID.test(id)?{upload:id}:HEX64.test(id)?{identity:id}:null,uploads=[];
 if(!body)body={upload:match(await list(o),id,{complete:false}).upload};
 if(body.upload)uploads=[body.upload];else{try{uploads=(await list(o)).filter(p=>p.identity===body.identity).map(p=>p.upload);}catch{}}
 const r=await (await call('/api/contrib/done',{...o,method:'POST',body})).json();
 let removed=0;if(!o.keep){let work='';try{work=o.work||workDir();}catch{}if(work)for(const u of uploads)if(cleanLocal(work,u))removed++;}
 return {...r,localRemoved:removed};}
async function remove(id,o={}){let upload=id;if(!UUID.test(String(id)))upload=match(await list(o),id,{complete:false}).upload;return (await call('/api/contrib/delete',{...o,method:'POST',body:{upload}})).json();}
const day=86400;
function rows(all,work,now=Date.now()/1000){const local=new Set(localCopies(work));
 return all.map(p=>({upload:p.upload,state:p.state,size:p.size,title:p.title||'',app:p.app||'',identity:p.identity||'',ageDays:Math.floor((now-p.created_at)/day),daysLeft:Math.max(0,Math.ceil((p.expires_at-now)/day)),local:local.has(p.upload)}));}
function table(list){if(!list.length)return '(relay 上没有包)';
 const head=['上传','状态','大小','已到','剩余','本地','版本','游戏'],body=list.map(r=>[r.upload.slice(0,8),r.state==='complete'?'收齐':'接收中',mb(r.size),r.ageDays+' 天',r.daysLeft+' 天',r.local?'有':'-',r.app||'?',r.title||'?']);
 const wide=s=>[...String(s)].reduce((n,c)=>n+(c.charCodeAt(0)>0x2e7f?2:1),0),w=head.map((h,i)=>Math.max(wide(h),...body.map(b=>wide(b[i]))));
 return [head,...body].map(r=>r.map((c,i)=>i===r.length-1?c:c+' '.repeat(w[i]-wide(c))).join('  ')).join('\n');}
async function overview(o={}){const work=o.work||workDir(),all=await list(o),r=rows(all,work),held=new Set(all.map(p=>p.upload)),stale=localCopies(work).filter(u=>!held.has(u));
 const todo=r.filter(x=>x.state==='complete'&&!x.local),soon=r.filter(x=>x.state==='complete'&&x.daysLeft<=5),lines=[table(r),''];
 if(todo.length)lines.push(`${todo.length} 个包还没下载 → node tools/contrib-workbench.cjs sync`);
 if(soon.length)lines.push(`${soon.length} 个包 5 天内过期：${soon.map(x=>x.upload.slice(0,8)+' '+(x.title||'?')).join('、')}`);
 if(stale.length)lines.push(`${stale.length} 个本地副本 relay 已不再保存 → node tools/contrib-workbench.cjs clean --all`);
 if(r.some(x=>x.local))lines.push('适配做完后 → node tools/contrib-workbench.cjs done <上传>');
 if(!todo.length&&!soon.length&&!stale.length&&!r.length)lines.push('没有待处理的包');
 lines.push('工作目录 '+work);return {text:lines.join('\n'),rows:r,stale};}
async function main(argv){const flags=new Set(argv.filter(a=>a.startsWith('--'))),[cmd,arg]=argv.filter(a=>!a.startsWith('--'));
 if(!cmd){if(flags.has('--help')){console.log(fs.readFileSync(__filename,'utf8').split('*/')[0].split('\n').slice(3).join('\n'));return;}console.log((await overview()).text);return;}
 if(cmd==='list'){const r=rows(await list(),workDir());console.log(flags.has('--json')?JSON.stringify(r,null,1):table(r));return;}
 if(cmd==='sync'){const r=await sync();for(const g of r.got)console.log('下载 '+g.upload.slice(0,8)+'  '+(g.title||'?')+'  → '+g.dir);
  for(const f of r.failed)console.log('失败 '+f.upload.slice(0,8)+'  '+(f.title||'?')+'  '+f.error);
  console.log(`新下载 ${r.got.length}，已有 ${r.kept.length}，失败 ${r.failed.length}`+(r.receiving?`，另有 ${r.receiving} 个还在接收`:''));if(r.failed.length)process.exitCode=1;return;}
 if(cmd==='pull'){const r=await pull(arg);console.log((r.cached?'already here ':'saved ')+r.file);return;}
 if(cmd==='unpack'){const file=fs.existsSync(arg||'')?arg:path.join(workDir(),(await find(arg)).upload,'package.mgct.gz');const r=unpack(file);console.log(`${r.count} files → ${r.out}`);return;}
 /* a package already here is found without asking the relay (it may be gone there) */
 const localDir=async id=>{const work=workDir(),q=String(id||'').toLowerCase(),here=localCopies(work).filter(u=>u===q||q.length>=6&&u.startsWith(q));if(here.length===1)return path.join(work,here[0]);return path.join(work,(await find(id)).upload);};
 if(cmd==='text'){const dir=await localDir(arg);if(!fs.existsSync(path.join(dir,'package.mgct.gz')))await pull(arg);const r=textOut(dir),bin=r.rows.filter(x=>x.encoding==='binary').length;console.log(`${r.rows.length-bin} scripts as UTF-8 → ${r.out}`+(bin?`  (${bin} binary, left under files/)`:''));return;}
 if(cmd==='info'){const dir=await localDir(arg);if(!fs.existsSync(path.join(dir,'manifest.json'))){const p=await pull(arg);unpack(p.file);}console.log(info(dir).text);return;}
 if(cmd==='get'){const r=await get(arg);console.log(r.info.text);console.log('→ '+r.dir);return;}
 if(cmd==='done'){const r=await done(arg,{keep:flags.has('--keep')});console.log(`relay 已删除 ${r.packages} 个包（${r.partsDeleted} 个分块）`+(r.localRemoved?`，本地副本已删 ${r.localRemoved} 个`:''));return;}
 if(cmd==='delete'){console.log(await remove(arg));return;}
 if(cmd==='clean'){const work=workDir();if(flags.has('--all')){const held=new Set((await list()).map(p=>p.upload));let n=0;for(const u of localCopies(work))if(!held.has(u)&&cleanLocal(work,u))n++;console.log('removed '+n);return;}
  const q=String(arg||'').toLowerCase(),here=localCopies(work).filter(u=>u===q||q.length>=6&&u.startsWith(q));if(here.length!==1)throw Error(here.length?'several local copies match '+q:'no local copy '+q);cleanLocal(work,here[0]);console.log('removed '+here[0]);return;}
 console.log(fs.readFileSync(__filename,'utf8').split('*/')[0].split('\n').slice(3).join('\n'));}
if(require.main===module)main(process.argv.slice(2)).catch(e=>{console.error(String(e?.message||e));process.exit(1);});
module.exports={list,pull,unpack,done,remove,safe,match,get,sync,info,textOut,decodeText,rows,table,overview,localCopies,call};
