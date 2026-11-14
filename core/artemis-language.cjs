'use strict';
/* E591 Artemis multi-language releases (Steam The Shell: every .ast message holds ja/en/cn/tw, but the language list and
   the save offer no Japanese). Nothing of the game is changed: one extra archive <base>.pfs.NNN (numbered after the
   game's own patches, so it is read last and wins) carries the game's own Lua file that defines get_language, with the
   main text language fixed to "ja". UI language, sub language and voices stay the game's. Undo deletes that archive. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sc=()=>require('../services/original-engines/scenes.cjs');
const ADAPTER='artemis-pfs',BACKUP_DIR='.megulit-japanese';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

/* archives in load order: base.pfs, then base.pfs.000, .001 ... (numeric) */
function archives(gameDir){
 let names=[];try{names=fs.readdirSync(gameDir);}catch{return [];}
 const bases=names.filter(n=>/\.pfs$/i.test(n));
 return bases.map(b=>({base:b,files:[b,...names.filter(n=>n.toLowerCase().startsWith(b.toLowerCase()+'.')&&/\.\d{3}$/.test(n)).sort((x,y)=>+x.slice(-3)-+y.slice(-3))]}));
}
function entries(file){try{return sc().pfsList(file);}catch{return null;}}
function readEntry(file,list,name){const e=list.files.find(f=>f.name.toLowerCase()===name.toLowerCase());return e?sc().pfsRead(file,e,list.key):null;}

/* the text holds Japanese next to other languages */
function multilingual(dir,files){
 for(const f of files){const list=entries(path.join(dir,f));if(!list)continue;
  for(const e of list.files.filter(e=>/\.ast$/i.test(e.name)&&e.size>4000).slice(0,8)){let t='';try{t=sc().pfsRead(path.join(dir,f),e,list.key).toString('utf8');}catch{continue;}
   if(/\bja\s*=\s*\{[^]{0,400}?[ぁ-ヿ]/.test(t)&&/\b(en|cn|tw|zh)\s*=\s*\{/.test(t))return true;}}
 return false;
}
/* the last archive that holds the Lua file defining get_language wins, like the engine */
function languageLua(dir,files){
 let found=null;
 for(const f of files){const list=entries(path.join(dir,f));if(!list)continue;
  for(const e of list.files.filter(e=>/\.lua$/i.test(e.name))){let t;try{t=sc().pfsRead(path.join(dir,f),e,list.key);}catch{continue;}
   if(/function\s+get_language\s*\(\s*\w+\s*\)/.test(t.toString('latin1')))found={archive:f,name:e.name,data:t};}}
 return found;
}
const MARK='-- MeguLit: Japanese text';
function patchLua(buf){
 const t=buf.toString('utf8');if(t.includes(MARK))return null;
 const m=/function\s+get_language\s*\(\s*(\w+)\s*\)/.exec(t);if(!m)return null;
 const at=m.index+m[0].length;
 return Buffer.from(t.slice(0,at)+'\n\tif '+m[1]+' then return "ja" end\t'+MARK+t.slice(at),'utf8');
}

/* pf8 writer, the layout the engine's own archives use: "pf8", index size, index {count, entries {name, 0, offset,
   size}, count+1, u64 position of every entry's fixed block, 0, table offset}, data XOR SHA-1(index) */
function pf8(files){
 const names=files.map(f=>Buffer.from(f.name,'utf8'));
 const entriesLen=names.reduce((n,b)=>n+4+b.length+12,0),tableLen=4+(files.length+1)*8+4,indexLen=4+entriesLen+tableLen;
 const index=Buffer.alloc(indexLen);let p=0,offset=7+indexLen;const blocks=[];
 index.writeUInt32LE(files.length,p);p+=4;
 files.forEach((f,i)=>{index.writeUInt32LE(names[i].length,p);p+=4;names[i].copy(index,p);p+=names[i].length;blocks.push(p);index.writeUInt32LE(0,p);index.writeUInt32LE(offset,p+4);index.writeUInt32LE(f.data.length,p+8);p+=12;offset+=f.data.length;});
 const table=p;index.writeUInt32LE(files.length+1,p);p+=4;for(const b of blocks){index.writeBigUInt64LE(BigInt(b),p);p+=8;}index.writeBigUInt64LE(0n,p);p+=8;index.writeUInt32LE(table,p);
 const key=crypto.createHash('sha1').update(index).digest(),head=Buffer.alloc(7);head.write('pf8',0,'latin1');head.writeUInt32LE(indexLen,3);
 const data=files.map(f=>{const b=Buffer.from(f.data);for(let i=0;i<b.length;i++)b[i]^=key[i%20];return b;});
 return Buffer.concat([head,index,...data]);
}

function manifestPath(dir){return path.join(dir,BACKUP_DIR,'manifest.json');}
function readManifest(dir){try{const m=JSON.parse(fs.readFileSync(manifestPath(dir),'utf8'));return m?.adapter===ADAPTER?m:null;}catch{return null;}}

function plan(gameDir){
 for(const set of archives(gameDir)){
  if(!multilingual(gameDir,set.files))continue;
  const lua=languageLua(gameDir,set.files);if(!lua)return {state:'unsupported',reason:'ARTEMIS_NO_LANGUAGE_LUA'};
  const next=patchLua(lua.data);if(!next)return {state:'already',adapter:ADAPTER};
  const used=set.files.map(f=>/\.(\d{3})$/.exec(f)?.[1]).filter(Boolean).map(Number),n=Math.max(-1,...used)+1;
  if(n>999)return {state:'unsupported',reason:'ARTEMIS_NO_SLOT'};
  return {state:'restorable',adapter:ADAPTER,file:set.base+'.'+String(n).padStart(3,'0'),lua:lua.name,from:lua.archive,data:next};
 }
 return null;
}
function detect(gameDir){
 gameDir=path.resolve(String(gameDir||''));const m=readManifest(gameDir);
 if(m)return {state:'applied',adapter:ADAPTER,files:1,cells:0,pending:0,manifest:{at:m.at,files:1}};
 const p=plan(gameDir);if(!p)return {state:'none'};
 const {data,...rest}=p;return {...rest,files:p.state==='restorable'?1:0,cells:0,pending:p.state==='restorable'?1:0};
}
function apply(gameDir){
 gameDir=path.resolve(String(gameDir||''));if(readManifest(gameDir))throw Error('ALREADY_APPLIED');
 const p=plan(gameDir);if(!p||p.state!=='restorable')throw Error('NOTHING_TO_RESTORE');
 const out=pf8([{name:p.lua,data:p.data}]),target=path.join(gameDir,p.file);
 if(fs.existsSync(target))throw Error('ARTEMIS_SLOT_TAKEN');
 /* read back through the same reader the engine layout is checked with */
 const tmp=target+'.megulit-tmp';fs.writeFileSync(tmp,out);
 try{const list=entries(tmp);const back=list&&readEntry(tmp,list,p.lua);if(!back||!back.equals(p.data))throw Error('ROUNDTRIP_FAILED '+p.file);}catch(error){fs.rmSync(tmp,{force:true});throw error;}
 fs.mkdirSync(path.join(gameDir,BACKUP_DIR),{recursive:true});
 fs.renameSync(tmp,target);
 fs.writeFileSync(manifestPath(gameDir),JSON.stringify({version:1,adapter:ADAPTER,at:new Date().toISOString(),added:p.file,sha256:sha(out),lua:p.lua,from:p.from},null,1));
 return {applied:1,cells:0,added:p.file};
}
function restore(gameDir){
 gameDir=path.resolve(String(gameDir||''));const m=readManifest(gameDir);if(!m)throw Error('NOT_APPLIED');
 const target=path.join(gameDir,m.added),skipped=[];
 if(fs.existsSync(target)){if(sha(fs.readFileSync(target))===m.sha256)fs.rmSync(target);else skipped.push(m.added);}
 if(!skipped.length)fs.rmSync(path.join(gameDir,BACKUP_DIR),{recursive:true,force:true});
 return {restored:skipped.length?0:1,skipped};
}
/* the added archive is still ours and readable */
function verify(gameDir){
 const m=readManifest(path.resolve(gameDir));if(!m)return {ok:false,reason:'MANIFEST_MISSING'};
 const f=path.join(gameDir,m.added);if(!fs.existsSync(f))return {ok:false,reason:'FILE_MISSING',file:m.added};
 if(sha(fs.readFileSync(f))!==m.sha256)return {ok:true};
 const list=entries(f),back=list&&readEntry(f,list,m.lua);
 return back&&back.toString('utf8').includes(MARK)?{ok:true}:{ok:false,reason:'TABLE_UNREADABLE',file:m.added};
}
module.exports={detect,apply,restore,verify,readManifest,ADAPTER,_internal:{pf8,patchLua,archives,plan}};
