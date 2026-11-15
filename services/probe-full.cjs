// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 closed-beta full probe (owner: 封测默认把完整剧本原文 + exe 传上来，越精简越好).
   For a game that does not read well, besides the desensitized probe (adapter-sample.cjs), the background queue
   (probe-auto.cjs) sends the maintainer what it takes to reproduce the game on their PC:
     - the script entries only: what a scenes.cjs reader opened (decoded bytes), raw script entries of XP3 / NPK2 / PFS
       archives (encrypted ones as stored: the exe has the filter), loose script files, and the head and tail of an
       archive no reader could list (its index lives there). Never images, voices, movies or fonts (extension and magic)
     - the game's exe, the other exes in the folder (a Chinese patch exe) and the DLLs next to them, cut down to what
       holds code and keys: section offsets stay, .rsrc over RSRC_KEEP and every byte after the last section (overlay,
       certificate) are dropped, so the file is a PE a disassembler opens at the same addresses
     - versions: each exe's / DLL's version resource; every file's path and size; sha256 of exes, DLLs, archives and
       scripts (archives over HASH_FULL: sha256 of size + first + last 4 MiB, marked "partial")
   Chinese patches (patch*.xp3, a second exe, a Chinese .npk) are just more files of the folder and go up the same way.
   Every item is gzipped on its own; items go in priority order until PACKED_MAX (compressed) is reached.

   File (megulit.probe-full v1, little endian):
     "MLFP" u32 version=1 u32 manifestBytes  manifest (gzip JSON)  item blobs (gzip each, at manifest.items[i].offset
     from the end of the manifest)
   manifest: {schema,version,app,createdAt,identity,title,vndb,step,detected,exe,budget,files:[{path,size,sha256?,partial?}],
              versions:{path:{fileVersion,productVersion,strings}},items:[{kind,path,archive?,entry?,size,sha256,offset,packed,
              same?,pe?}],dropped:[{path,kind,reason}]}
   kind: script (a reader's decoded scene) | entry (raw archive entry) | loose (loose script file) | index (archive head
   / tail) | exe | dll
   collect() writes data/adapter-probe/full/<sha256>.mlfp; upload() sends it in CHUNK parts (R2 multipart on the relay,
   resumable) and deletes it when the relay has it. unpack() is the maintainer's side (tools/probe-workbench.cjs). */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const CHUNK=5<<20,PACKED_MAX=48<<20,RAW_MAX=320<<20,ENTRY_MAX=32<<20,EXE_MAX=96<<20,RSRC_KEEP=1<<20,INDEX_SPAN=1<<20,HASH_FULL=1<<30,
 FILES_MAX=20000,COLLECT_MS=240000,KEEP_DAYS=7;
const MAGIC='MLFP';
const fullDir=root=>path.join(root,'data','adapter-probe','full');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const kit=()=>require('./original-engines/kit.cjs');
const rel=(dir,f)=>path.relative(dir,f).replace(/\\/g,'/');

/* ---- what is a script, what is media ----------------------------------------------------------------------------- */
const MEDIA_EXT=/\.(png|bmp|jpe?g|gif|tga|dds|webp|tlg|pna|pnap|ogg|wav|mp3|m4a|opus|flac|aac|wma|mpe?g|wmv|avi|mp4|m4v|webm|ogv|mkv|ttf|otf|ttc|fnt|psd|ico|cur|mid|midi|amv|bik|usm|awb|acb|hca|fsb|bank|svg|mov|flv)$/i;
const SCRIPT_EXT=/\.(ks|tjs|scn|ss|s|sc|scr|txt|csv|tsv|ast|lua|json|rpy|rpyc|rpa|ws2|bsc|asb|mjo|hcb|ybn|sd|snr|tbl|msg|mes|ini|cfg|xml|ya?ml|lst|sco|nut|dat|bin|ydat|psb|scb|sob|cst|mrg|isf|sdat|ssb|kag|func|def|txt2|ain|bsd|stb|book|str|sn|org|win|wsc)$/i;
const ARCHIVE_EXT=/\.(xp3|pfs|npk|pak|arc|dat|bin|pac|ypf|mpk|int|nsa|sar|cpk|afs|p|lpk|bnd|ign|gxp|pck|vfs|fpk|tcd|ism|g2|iga|paz|ar2|ar3|dx|wolf|rgss\w*|epk|cab|zip|7z)$/i;
const MEDIA_MAGIC=['OggS','RIFF','\x89PNG','BM','\xff\xd8\xff','GIF8','ID3','fLaC','\x1aE\xdf\xa3','\0\0\0\x18ftyp','\0\0\0\x1cftyp','\0\0\0\x20ftyp','OTTO','wOFF','TLG','8BPS','DDS ','MThd','FSB5','BKHD','CRID','AFS\0','@UTF'];
const isMediaBytes=b=>{if(!b||b.length<4)return false;const t=Buffer.from(b.subarray(0,12)).toString('latin1');return MEDIA_MAGIC.some(m=>t.startsWith(m));};
const isMediaName=n=>MEDIA_EXT.test(String(n));
const isScriptName=n=>SCRIPT_EXT.test(String(n))&&!isMediaName(n);
const SKIP_DIR=/^(\$RECYCLE\.BIN|System Volume Information|savedata|save|saves|movie|movies|video|voice|bgm|se|sound|sounds|cg|bg|image|images|fgimage|bgimage|_CommonRedist|redist|DirectX|vcredist|MeguLit)$/i;

/* ---- PE: version + slim copy --------------------------------------------------------------------------------------- */
function peSections(buf){
 if(buf.length<0x40||buf[0]!==0x4d||buf[1]!==0x5a)return null;const pe=buf.readUInt32LE(0x3c);
 if(pe+24>buf.length||buf.readUInt32LE(pe)!==0x4550)return null;const count=buf.readUInt16LE(pe+6),optSize=buf.readUInt16LE(pe+20),table=pe+24+optSize,out=[];
 for(let i=0;i<count&&table+i*40+40<=buf.length;i++){const p=table+i*40;out.push({name:buf.toString('latin1',p,p+8).replace(/\0+$/,''),vsize:buf.readUInt32LE(p+8),va:buf.readUInt32LE(p+12),rawSize:buf.readUInt32LE(p+16),rawAt:buf.readUInt32LE(p+20),flags:buf.readUInt32LE(p+36)});}
 return {sections:out,headerEnd:table+count*40};}
/* VS_FIXEDFILEINFO + the common StringFileInfo values */
function versionOf(buf){
 const out={};const sig=buf.indexOf(Buffer.from([0xbd,0x04,0xef,0xfe]));
 if(sig>=0&&sig+52<=buf.length){const v=(hi,lo)=>[hi>>>16,hi&0xffff,lo>>>16,lo&0xffff].join('.');out.fileVersion=v(buf.readUInt32LE(sig+8),buf.readUInt32LE(sig+12));out.productVersion=v(buf.readUInt32LE(sig+16),buf.readUInt32LE(sig+20));}
 const strings={};for(const key of ['CompanyName','FileDescription','FileVersion','InternalName','OriginalFilename','ProductName','ProductVersion','LegalCopyright']){
  const k=Buffer.from(key+'\0','utf16le');const at=buf.indexOf(k);if(at<0)continue;let p=at+k.length;if(p%4)p+=4-p%4;while(p+1<buf.length&&!(buf[p]|buf[p+1])&&p-at<80)p+=2;let end=p;while(end+1<buf.length&&(buf[end]|buf[end+1])&&end-p<512)end+=2;
  const s=buf.toString('utf16le',p,end).trim();if(s)strings[key]=s.slice(0,200);}
 if(Object.keys(strings).length)out.strings=strings;return out;}
/* the PE with .rsrc (when big), overlay and certificate dropped; file offsets unchanged (dropped bytes are zeros) */
function slimPe(buf){
 const pe=peSections(buf);if(!pe)return null;let end=pe.headerEnd;const dropped=[];
 for(const s of pe.sections)if(s.rawSize&&s.rawAt<buf.length)end=Math.max(end,Math.min(buf.length,s.rawAt+s.rawSize));
 const out=Buffer.from(buf.subarray(0,end));
 for(const s of pe.sections){const code=(s.flags&0x20)||(s.flags&0x20000000);
  if(!code&&/^\.rsrc$/i.test(s.name)&&s.rawSize>RSRC_KEEP){out.fill(0,Math.min(end,s.rawAt),Math.min(end,s.rawAt+s.rawSize));dropped.push(s.name);}}
 return {data:out,pe:{sections:pe.sections.map(s=>({name:s.name,va:s.va,vsize:s.vsize,rawAt:s.rawAt,rawSize:s.rawSize,flags:s.flags})),overlay:buf.length-end,dropped,original:buf.length}};}

/* ---- files of the game --------------------------------------------------------------------------------------------- */
function walk(dir,{depth=4,limit=FILES_MAX}={}){const out=[];const go=(d,level)=>{let list;try{list=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
 for(const e of list){if(out.length>=limit)return;const full=path.join(d,e.name);if(e.isDirectory()){if(level<depth&&!(level>0&&SKIP_DIR.test(e.name)))go(full,level+1);continue;}
  if(!e.isFile())continue;let size=0;try{size=fs.statSync(full).size;}catch{continue;}out.push({full,path:rel(dir,full),size});}};go(dir,0);return out;}
function fileHash(f,size){if(size<=HASH_FULL){const h=crypto.createHash('sha256'),fd=fs.openSync(f,'r'),b=Buffer.alloc(4<<20);try{let at=0,n;while((n=fs.readSync(fd,b,0,b.length,at))>0){h.update(b.subarray(0,n));at+=n;}}finally{fs.closeSync(fd);}return {sha256:h.digest('hex')};}
 const k=kit();return {sha256:sha(Buffer.concat([Buffer.from(String(size)),k.readAt(f,0,4<<20),k.readAt(f,size-(4<<20),4<<20)])),partial:true};}

/* ---- archive entries: XP3, NPK2, PFS (raw, as stored) ---------------------------------------------------------------- */
function archiveEntries(file){
 const head=kit().readAt(file,0,16),t=head.toString('latin1',0,4),out=[];
 try{if(head.subarray(0,11).equals(require('./original-engines/xp3.cjs').MAGIC)){const xp3=require('./original-engines/xp3.cjs'),l=xp3.list(file);
   for(const e of l?.files||[])out.push({name:e.name,size:e.size,encrypted:!!e.encrypted,read:()=>xp3.read(file,e)});return {format:'xp3',entries:out};}
  if(t==='NPK2'){const l=require('./original-engines/npk.cjs').list(file);for(const e of l||[])out.push({name:e.name,size:e.unpacked,read:e.read});return {format:'npk',entries:out,listed:!!l};}
  if(/^pf[68]/.test(t)){const sc=require('./original-engines/scenes.cjs'),l=sc.pfsList(file);for(const e of l?.files||[])out.push({name:e.name,size:e.size,read:()=>sc.pfsRead(file,e,l.key)});return {format:'pfs',entries:out};}}catch{}
 return null;}

/* ---- collect --------------------------------------------------------------------------------------------------------- */
/* collect({dir,executable,result,out,identity,title,vndb,app}) → {file,sha256,bytes,items,dropped,ms} | {empty:true}
   runs in the probe worker (adapter-probe-worker.cjs type 'full') */
function collect({dir,executable,result={},out,identity='',title='',vndb='',app='',packedMax=PACKED_MAX,rawMax=RAW_MAX,budgetMs=COLLECT_MS}){
 const start=Date.now(),late=()=>Date.now()-start>budgetMs;
 const files=walk(dir),items=[],blobs=[],dropped=[],seen=new Map();let packed=0,raw=0;
 const exeFull=path.resolve(String(executable||''));
 /* one item: gzip it, keep it when the budget allows, the same bytes twice are stored once */
 const add=(kind,data,meta)=>{
  if(!data||!data.length)return false;if(kind!=='exe'&&kind!=='dll'&&isMediaBytes(data)){dropped.push({...pick(meta),kind,reason:'media'});return false;}
  const h=sha(data);if(seen.has(h)){items.push({kind,...meta,size:data.length,sha256:h,same:seen.get(h)});return true;}
  if(raw+data.length>rawMax){dropped.push({...pick(meta),kind,reason:'raw-budget'});return false;}
  const z=zlib.gzipSync(data,{level:9});if(packed+z.length>packedMax){dropped.push({...pick(meta),kind,reason:'packed-budget'});return false;}
  seen.set(h,items.length);items.push({kind,...meta,size:data.length,sha256:h,packed:z.length});blobs.push(z);packed+=z.length;raw+=data.length;return true;};
 const pick=m=>({path:m.path,...(m.archive?{archive:m.archive}:{}),...(m.entry?{entry:m.entry}:{})});

 /* 1 the main exe (code and keys first) */
 const pes=files.filter(f=>/\.(exe|dll)$/i.test(f.path)).sort((a,b)=>(path.resolve(b.full)===exeFull)-(path.resolve(a.full)===exeFull)||/\.exe$/i.test(b.path)-/\.exe$/i.test(a.path)||a.size-b.size);
 const versions={},hashes=new Map();
 const peItem=f=>{if(f.size>EXE_MAX*4){dropped.push({path:f.path,kind:'exe',reason:'size'});return;}let buf;try{buf=fs.readFileSync(f.full);}catch{return;}
  hashes.set(f.full,{sha256:sha(buf)});const v=versionOf(buf);if(Object.keys(v).length)versions[f.path]=v;
  const s=slimPe(buf);if(!s){dropped.push({path:f.path,kind:'exe',reason:'not-pe'});return;}if(s.data.length>EXE_MAX){dropped.push({path:f.path,kind:'exe',reason:'size'});return;}
  add(/\.dll$/i.test(f.path)?'dll':'exe',s.data,{path:f.path,pe:s.pe});};
 const main=pes.find(f=>path.resolve(f.full)===exeFull);if(main)peItem(main);

 /* 2 the scenes a reader opened (decoded) */
 const scenes=(()=>{try{return require('./original-engines/scenes.cjs');}catch{return null;}})();
 const readers=[...new Set([result.detected,...(result.engines||[]).filter(e=>e.scenes>0).map(e=>e.id)].filter(Boolean))];
 for(const id of readers){const eng=scenes?.ENGINES?.[id];if(!eng||late())continue;let list=[];try{list=eng.scenes(dir)||[];}catch{continue;}
  for(const s of list){if(late())break;let b;try{b=s.read();}catch{continue;}if(!Buffer.isBuffer(b))b=Buffer.from(b||'');if(b.length>ENTRY_MAX){dropped.push({path:String(s.name),kind:'script',reason:'size'});continue;}
   add('script',b,{path:'scenes/'+id+'/'+String(s.name).replace(/\\/g,'/'),reader:id});}}

 /* 3 raw script entries of every archive a lister knows; head and tail of the others */
 const archives=files.filter(f=>f.size>=4096&&(ARCHIVE_EXT.test(f.path)||(result._archives||[]).some(a=>path.resolve(a)===path.resolve(f.full)))&&!isMediaName(f.path)).sort((a,b)=>/patch/i.test(b.path)-/patch/i.test(a.path)||a.size-b.size);
 for(const f of archives){if(late())break;let head;try{head=kit().readAt(f.full,0,16);}catch{continue;}if(isMediaBytes(head))continue;
  const a=archiveEntries(f.full);
  if(a&&a.entries.length){for(const e of a.entries){if(late())break;if(!isScriptName(e.name)){continue;}if(e.size>ENTRY_MAX){dropped.push({path:f.path,entry:e.name,kind:'entry',reason:'size'});continue;}
    let b;try{b=e.read();}catch{continue;}add('entry',b,{path:f.path+'/'+e.name.replace(/\\/g,'/'),archive:f.path,entry:e.name,format:a.format,...(e.encrypted?{encrypted:true}:{})});}continue;}
  /* not listable here: the index regions */
  const k=kit();add('index',k.readAt(f.full,0,Math.min(INDEX_SPAN,f.size)),{path:f.path+'#head',archive:f.path,at:0,...(a?{format:a.format}:{})});
  if(f.size>INDEX_SPAN)add('index',k.readAt(f.full,Math.max(INDEX_SPAN,f.size-INDEX_SPAN),Math.min(INDEX_SPAN,f.size-INDEX_SPAN)),{path:f.path+'#tail',archive:f.path,at:Math.max(INDEX_SPAN,f.size-INDEX_SPAN)});}

 /* 4 loose script files */
 for(const f of files){if(late())break;if(archives.includes(f)||!isScriptName(f.path)||/\.(exe|dll)$/i.test(f.path))continue;if(f.size>ENTRY_MAX){dropped.push({path:f.path,kind:'loose',reason:'size'});continue;}
  let b;try{b=fs.readFileSync(f.full);}catch{continue;}add('loose',b,{path:f.path});}

 /* 5 the other exes (a Chinese patch exe, a launcher), then the DLLs */
 for(const f of pes){if(f===main)continue;if(late()){dropped.push({path:f.path,kind:'exe',reason:'time'});continue;}peItem(f);}

 /* versions: sizes of everything, hashes of exes / DLLs / archives / scripts */
 const list=files.map(f=>{const o={path:f.path,size:f.size};const known=hashes.get(f.full);if(known)return {...o,...known};
  if(!late()&&(archives.includes(f)||isScriptName(f.path)))try{return {...o,...fileHash(f.full,f.size)};}catch{}return o;});
 if(!items.length)return {empty:true};
 let offset=0;for(let i=0,b=0;i<items.length;i++){if(items[i].same!==undefined)continue;items[i].offset=offset;offset+=blobs[b++].length;}
 const manifest={schema:'megulit.probe-full',version:1,app,createdAt:new Date().toISOString(),identity,title:String(title||'').slice(0,120),vndb,step:result.step||'',detected:result.detected||null,
  exe:main?main.path:path.basename(exeFull),budget:{packed,raw,packedMax,rawMax,ms:Date.now()-start},files:list,versions,items,dropped:dropped.slice(0,2000)};
 const m=zlib.gzipSync(Buffer.from(JSON.stringify(manifest)),{level:9}),head=Buffer.alloc(12);head.write(MAGIC,0,'latin1');head.writeUInt32LE(1,4);head.writeUInt32LE(m.length,8);
 const body=Buffer.concat([head,m,...blobs]),hash=sha(body);
 const dest=out||fullDir(process.cwd());fs.mkdirSync(dest,{recursive:true});const file=path.join(dest,hash+'.mlfp');fs.writeFileSync(file+'.tmp',body);fs.renameSync(file+'.tmp',file);
 return {file,sha256:hash,bytes:body.length,raw,items:items.length,kinds:items.reduce((o,i)=>(o[i.kind]=(o[i.kind]||0)+1,o),{}),dropped:dropped.length,ms:Date.now()-start};}

/* ---- read a .mlfp (maintainer side and tests) --------------------------------------------------------------------- */
function open(buf){if(buf.length<12||buf.toString('latin1',0,4)!==MAGIC)throw Error('NOT_MLFP');if(buf.readUInt32LE(4)!==1)throw Error('MLFP_VERSION');
 const n=buf.readUInt32LE(8),manifest=JSON.parse(zlib.gunzipSync(buf.subarray(12,12+n))),base=12+n;
 const data=i=>{let it=manifest.items[i];if(it.same!==undefined)it=manifest.items[it.same];return zlib.gunzipSync(buf.subarray(base+it.offset,base+it.offset+it.packed));};
 return {manifest,data};}
/* unpack(file,outDir) → {dir,items}: scripts at their paths, exes / DLLs as slim PEs, manifest.json, versions.json */
function unpack(file,outDir){const buf=fs.readFileSync(file),{manifest,data}=open(buf);fs.mkdirSync(outDir,{recursive:true});
 const safe=p=>String(p).replace(/[:*?"<>|]/g,'_').split('/').filter(s=>s&&s!=='.'&&s!=='..').join(path.sep);
 const dirs={script:'scripts',entry:'archives',loose:'loose',index:'index',exe:'bin',dll:'bin'};let n=0;
 manifest.items.forEach((it,i)=>{const f=path.join(outDir,dirs[it.kind]||'other',safe(it.path));fs.mkdirSync(path.dirname(f),{recursive:true});const b=data(i);if(sha(b)!==it.sha256)throw Error('ITEM_HASH '+it.path);fs.writeFileSync(f,b);n++;});
 fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,1));fs.writeFileSync(path.join(outDir,'versions.json'),JSON.stringify(manifest.versions,null,1));
 return {dir:outDir,items:n,manifest};}

/* ---- upload (resumable, CHUNK parts) ----------------------------------------------------------------------------------- */
const stateOf=file=>file.replace(/\.mlfp$/,'.json');
const readJSON=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return {};}};
function drop(file){for(const f of [file,stateOf(file)])try{fs.rmSync(f,{force:true});}catch{}}
/* upload(root,{file,identity,title,vndb,step,app}) → {state:'uploaded'|'duplicate'|'failed'|'not-configured',error?} */
async function upload(root,{file,identity,title='',vndb='',step='',app='',fetcher=globalThis.fetch,base}={}){
 base=base??(()=>{try{return require('./relay-config.cjs').endpoint(root,'/api/probe/full');}catch{return '';}})();if(!base)return {state:'not-configured'};
 if(!/^[a-f0-9]{64}$/.test(String(identity||'')))return {state:'failed',error:'IDENTITY'};
 let size;try{size=fs.statSync(file).size;}catch{return {state:'failed',error:'NOT_PREPARED'};}
 const hash=path.basename(file,'.mlfp');const parts=Math.max(1,Math.ceil(size/CHUNK));
 const headers={'user-agent':'MeguLit','x-megulit-version':String(app||'')};
 const call=async(url,init)=>{for(let attempt=0;;attempt++){try{const r=await fetcher(url,{...init,headers:{...headers,...(init.headers||{})},signal:AbortSignal.timeout(120000)});if(r.ok||r.status<500||attempt===2)return r;}catch(e){if(attempt===2)throw e;}await new Promise(res=>setTimeout(res,1000*(attempt+1)));}};
 try{
  const st=readJSON(stateOf(file));
  let r=await call(base+'/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,identity,size,sha256:hash,parts,chunk:CHUNK,title:String(title).slice(0,120),vndb,step,app,...(st.upload?{upload:st.upload}:{})})});
  let j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)return {state:'failed',error:String(j.error||'HTTP_'+r.status).slice(0,60)};
  if(j.duplicate){drop(file);return {state:'duplicate'};}
  fs.writeFileSync(stateOf(file),JSON.stringify({upload:j.upload,at:Date.now()}));
  const have=new Set((j.have||[]).map(Number)),fd=fs.openSync(file,'r');
  try{for(let i=0;i<parts;i++){if(have.has(i))continue;const n=Math.min(CHUNK,size-i*CHUNK),b=Buffer.alloc(n);fs.readSync(fd,b,0,n,i*CHUNK);
   r=await call(base+'/part?upload='+j.upload+'&part='+i,{method:'PUT',headers:{'content-type':'application/octet-stream','x-sha256':sha(b)},body:b});
   const p=await r.json().catch(()=>({}));if(!r.ok||!p.ok)return {state:'failed',error:String(p.error||'HTTP_'+r.status).slice(0,60),part:i};}}finally{fs.closeSync(fd);}
  r=await call(base+'/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({upload:j.upload})});
  const c=await r.json().catch(()=>({}));if(!r.ok||!c.ok)return {state:'failed',error:String(c.error||'HTTP_'+r.status).slice(0,60)};
  drop(file);return {state:'uploaded',id:String(c.id||'')};
 }catch(e){return {state:'failed',error:e?.name==='TimeoutError'?'TIMEOUT':'NETWORK'};}}
/* old leftovers (a game removed, an upload that never got through) go after KEEP_DAYS */
function sweep(root,{now=Date.now()}={}){let n=0;try{for(const f of fs.readdirSync(fullDir(root))){const p=path.join(fullDir(root),f);try{if(now-fs.statSync(p).mtimeMs>KEEP_DAYS*86400000){fs.rmSync(p,{force:true});n++;}}catch{}}}catch{}return n;}
function pending(root,hash){const f=path.join(fullDir(root),String(hash)+'.mlfp');return /^[a-f0-9]{64}$/.test(String(hash))&&fs.existsSync(f)?f:null;}

module.exports={collect,open,unpack,upload,sweep,pending,fullDir,slimPe,versionOf,peSections,archiveEntries,isMediaBytes,isMediaName,isScriptName,CHUNK,PACKED_MAX,RAW_MAX,MAGIC};
