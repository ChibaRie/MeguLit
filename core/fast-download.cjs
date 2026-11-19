// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Shared fast downloader for every big file MeguLit fetches (runtime packs, the update package, llama.cpp, speech and
   vocal models, the Anki installer, Locale Emulator, LLM models, voices, the Unity font pack).
   User report (2026-11-19, hundreds of players in mainland China): downloads crawled and the screenshot sat on
   dl.megulit.com. The old code tried one source after another over a single connection and only moved on when a source
   failed outright, so a slow source that never errored held the whole download.
   Now:
   - mainland China puts cn-dl.megulit.com (EdgeOne) before dl.megulit.com (Cloudflare); the list is ordered here, never
     in setup/runtime.json
   - every source is measured at the same time for about 3 s (bytes that actually arrived, not a fixed 1 MB), 4 s at most
   - the file is fetched as ~4 MB Range pieces over 6-8 connections, spread over every source that is about as fast as
     the best one; idle connections steal half of the biggest piece still running at the end
   - a connection clearly slower than the others, or one that sends nothing for 15 s, is dropped and its piece goes to
     another connection/source; a source answering a Range request with 200 is used over one connection only
   - finished byte ranges are kept in <part>.json, so a retry (or the next start) fetches only what is missing
   - the whole file is checked against its SHA-256 at the end; a mismatch throws the copy away and tries again, one
     source at a time, so a source that serves a different file is found and skipped
   The fetch function is injectable (WHATWG fetch shape) so callers keep their own test fakes. */
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');

const MB=1<<20;
const DEFAULTS={probeMs:3000,probeCapMs:4000,segment:4*MB,connections:8,stallMs:15000,slowAfterMs:5000,slowRatio:0.3,maxStrikes:3,minSteal:MB,fastShare:0.25,keepProbe:8*MB,userAgent:'MeguLit-Downloader'};
const CHINA_ZONES=['Asia/Shanghai','Asia/Chongqing','Asia/Harbin','Asia/Urumqi','PRC'];
function inChina(){try{const o=Intl.DateTimeFormat().resolvedOptions();return CHINA_ZONES.includes(o.timeZone||'')||/^zh-CN/i.test(o.locale||'');}catch{return false;}}
const hostOf=u=>{try{return new URL(u).hostname;}catch{return '';}};

/* Mainland China: cn-dl.megulit.com goes right before dl.megulit.com (both move to where the first of them was);
   everything else keeps the caller's order. Duplicates are dropped. */
function orderSources(urls,china=inChina()){
 const list=[...new Set((urls||[]).filter(Boolean).map(String))];if(!china)return list;
 const cn=list.filter(u=>hostOf(u)==='cn-dl.megulit.com'),dl=list.filter(u=>hostOf(u)==='dl.megulit.com');
 if(!cn.length||!dl.length)return list;
 const at=list.findIndex(u=>cn.includes(u)||dl.includes(u)),rest=list.filter(u=>!cn.includes(u)&&!dl.includes(u));
 rest.splice(at,0,...cn,...dl);return rest;
}

const codeError=(code,message,extra)=>Object.assign(Error(message||code),{code},extra||{});
const abortError=()=>Object.assign(Error('aborted'),{name:'AbortError',code:'ABORTED'});
const header=(res,name)=>{const h=res&&res.headers;if(!h)return null;if(typeof h.get==='function'){const v=h.get(name);return v==null?null:String(v);}const k=Object.keys(h).find(x=>x.toLowerCase()===name);return k?String(h[k]):null;};
const statusOf=res=>typeof res.status==='number'?res.status:(res.ok?200:0);
const toBuffer=v=>Buffer.isBuffer(v)?v:ArrayBuffer.isView(v)?Buffer.from(v.buffer,v.byteOffset,v.byteLength):Buffer.from(v);

/* chunks of a response body: web stream, async iterable or a plain arrayBuffer() */
async function* bodyChunks(res){
 const b=res.body;
 if(b&&typeof b.getReader==='function'){const reader=b.getReader();try{for(;;){const {done,value}=await reader.read();if(done)return;if(value&&value.length)yield toBuffer(value);}}finally{try{reader.cancel().catch(()=>{});}catch{}}}
 else if(b&&(typeof b[Symbol.asyncIterator]==='function'||typeof b[Symbol.iterator]==='function')&&typeof b!=='string'){for await(const c of b)if(c&&c.length)yield toBuffer(c);}
 else if(typeof res.arrayBuffer==='function'){const a=toBuffer(await res.arrayBuffer());if(a.length)yield a;}
}
/* Read a body, racing every read against the caller's signal, a stall timer and an optional deadline (fakes and
   proxies that ignore the abort signal can not hang a download). onChunk returning false stops reading.
   Resolves 'end' | 'stop' | 'deadline'; rejects on abort, stall (code STALLED) or a body error. */
async function drain(res,onChunk,{signal,stallMs=0,deadline=0}={}){
 const it=bodyChunks(res);
 try{
  for(;;){
   const next=it.next();next.catch(()=>{});
   let timer=null,onAbort=null;
   const limit=new Promise((resolve,reject)=>{
    if(signal){if(signal.aborted)return reject(abortError(signal));onAbort=()=>reject(abortError(signal));signal.addEventListener('abort',onAbort,{once:true});}
    const toDeadline=deadline?Math.max(0,deadline-Date.now()):Infinity,ms=Math.min(stallMs||Infinity,toDeadline);
    if(ms!==Infinity)timer=setTimeout(()=>ms===toDeadline?resolve({deadline:true}):reject(codeError('STALLED','no data for '+Math.round(ms/1000)+' s')),ms);
   });
   let r;try{r=await Promise.race([next,limit]);}finally{clearTimeout(timer);if(onAbort)signal.removeEventListener('abort',onAbort);}
   if(r.deadline)return 'deadline';if(r.done)return 'end';
   if(await onChunk(r.value)===false)return 'stop';
  }
 }finally{it.return().catch(()=>{});}
}

/* sorted, merged list of finished [start,end) ranges */
function addRange(list,s,e){if(e<=s)return list;const out=[];let placed=false;for(const [a,b] of list){if(b<s){out.push([a,b]);continue;}if(a>e){if(!placed){out.push([s,e]);placed=true;}out.push([a,b]);continue;}s=Math.min(s,a);e=Math.max(e,b);}if(!placed)out.push([s,e]);return out;}
const covered=list=>list.reduce((n,[a,b])=>n+b-a,0);
function missing(list,size){const out=[];let at=0;for(const [a,b] of list){if(a>at)out.push([at,a]);at=Math.max(at,b);}if(at<size)out.push([at,size]);return out;}
const prefix=list=>list.length&&list[0][0]===0?list[0][1]:0;

async function hashFile(file){const h=createHash('sha256');for await(const c of fs.createReadStream(file))h.update(c);return h.digest('hex');}

/* One download. Options:
   urls (candidates), dest (final file), size (bytes, 0 = from the server), sha256 (hex, '' = none),
   onProgress({received,total}), signal, fetch, log(line), china (default: by time zone / locale), headers,
   accept(res,url) (throw to refuse a source), part (default dest+'.part'), and the tunables in DEFAULTS.
   Resolves {file,size,sha256,sources}. Rejects with code ABORTED (part kept for resuming), HASH_MISMATCH,
   SIZE_MISMATCH or DOWNLOAD_FAILED (.last = the last source error). */
async function download(options){
 const o={...DEFAULTS,...options};
 const ctx={...o,fetch:o.fetch||((...a)=>globalThis.fetch(...a)),log:o.log||(()=>{}),signal:o.signal||null};
 const urls=orderSources(o.urls,o.china===undefined?inChina():!!o.china);
 if(!urls.length)throw codeError('DOWNLOAD_FAILED','no download source');
 const part=o.part||o.dest+'.part',stateFile=part+'.json',want=String(o.sha256||'').toLowerCase();
 let size=Number(o.size)||0;
 ctx.part=part;ctx.stateFile=stateFile;
 const check=()=>{if(ctx.signal&&ctx.signal.aborted)throw abortError(ctx.signal);};
 check();

 /* resume: a part with its state file for exactly this file */
 let done=[];
 const loadState=sz=>{try{const s=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(s.v===1&&s.size===sz&&String(s.sha256||'')===want&&fs.statSync(part).size===sz&&Array.isArray(s.done))return s.done.filter(r=>Array.isArray(r)&&r[1]>r[0]&&r[0]>=0&&r[1]<=sz).reduce((l,[a,b])=>addRange(l,a,b),[]);}catch{}return null;};
 /* no size from the caller (LLM models): the state file's size is taken and checked against the servers below */
 let sizeFromState=false;
 if(!size){try{const s=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(s&&s.v===1&&Number(s.size)>0){size=Number(s.size);sizeFromState=true;}}catch{}}
 if(size){const r=loadState(size);if(r){done=r;ctx.log('resume '+covered(done)+'/'+size);}else if(sizeFromState){size=0;sizeFromState=false;}}

 const report=()=>{if(o.onProgress)try{o.onProgress({received:covered(done),total:size});}catch{}};
 let saved=0;
 const saveState=(force)=>{if(!size)return;const now=Date.now();if(!force&&now-saved<1000)return;saved=now;try{fs.writeFileSync(stateFile,JSON.stringify({v:1,size,sha256:want,done}));}catch{}};
 const fresh=async sz=>{done=[];await fsp.mkdir(path.dirname(part),{recursive:true});const h=await fsp.open(part,'w');try{if(sz)await h.truncate(sz);}finally{await h.close();}saveState(true);};
 const finish=async()=>{
  report();
  if(size){const st=fs.statSync(part);if(st.size!==size)throw codeError('SIZE_MISMATCH','size '+st.size+' != '+size);}
  const got=await hashFile(part);
  if(want&&got!==want)throw codeError('HASH_MISMATCH','sha256 mismatch');
  try{fs.rmSync(o.dest,{force:true});}catch{}fs.renameSync(part,o.dest);try{fs.rmSync(stateFile,{force:true});}catch{}
  return {file:o.dest,size:size||fs.statSync(o.dest).size,sha256:got};
 };
 if(size&&done.length&&covered(done)>=size){report();try{return await finish();}catch(e){if(e.code!=='HASH_MISMATCH'&&e.code!=='SIZE_MISMATCH')throw e;try{fs.rmSync(part,{force:true});fs.rmSync(stateFile,{force:true});}catch{}done=[];}}

 /* measure every source at once; the progress bar already moves with the fastest source's first bytes */
 let shown=covered(done);ctx.onProbe=(n,total)=>{if(done.length||n<=shown||!o.onProgress)return;shown=n;try{o.onProgress({received:n,total:size||total||0});}catch{}};
 /* resuming: the measurement already asks for the rest, so its bytes continue the file */
 const sources=await probe(ctx,urls,size&&covered(done)<size?prefix(done):0);check();
 const alive=sources.filter(s=>s.ok);
 if(sizeFromState&&alive.some(s=>s.total)&&!alive.some(s=>s.total===size)){ctx.log('file changed on the server, starting over');size=0;done=[];}
 if(!size){const best=[...alive].sort((a,b)=>b.speed-a.speed).find(s=>s.total);if(best)size=best.total;}
 for(const s of alive)if(size&&s.total&&s.total!==size){s.ok=false;s.banned='size '+s.total+' != '+size;ctx.log('failed '+hostOf(s.url)+' '+s.banned);}
 let usable=sources.filter(s=>s.ok).sort((a,b)=>b.speed-a.speed||a.index-b.index);
 if(!usable.length){const last=sources.map(s=>s.error).filter(Boolean).pop();throw codeError('DOWNLOAD_FAILED','DOWNLOAD_FAILED '+(last?last.message:'no source answered'),{last});}
 ctx.log('sources '+usable.map(s=>hostOf(s.url)+'='+Math.round(s.speed)+'KB/s'+(s.ranged?'':'(no range)')).join(' '));

 if(size&&!done.length){const r=loadState(size);if(r)done=r;}
 if(size&&!done.length)await fresh(size);
 /* the probe's own bytes are not thrown away: the fastest source's start of the file (or all of a small file) */
 const head=usable.find(s=>s.kept&&s.kept.length);
 if(head&&size&&head.keptAt+head.kept.length<=size&&(head.ranged||head.complete)){const h=await fsp.open(part,'r+');try{await h.write(head.kept,0,head.kept.length,head.keptAt);}finally{await h.close();}done=addRange(done,head.keptAt,head.keptAt+head.kept.length);saveState(true);report();}
 for(const s of sources)s.kept=null;

 /* rounds: all fast sources together; after a hash mismatch each source alone, fastest first */
 const rounds=[null,...usable.map(s=>s)];let lastError=null;
 for(let round=0;round<rounds.length;round++){
  check();
  const only=rounds[round];if(only&&only.banned)continue;
  const pool=only?[only]:usable.filter(s=>!s.banned);
  if(!pool.length)break;
  try{
   if(!size||!(covered(done)>=size)){
    const ranged=pool.filter(s=>s.ranged);
    const best=pool[0].speed||0;
    if(size&&ranged.length&&(ranged[0].speed>=best*0.2||!best))await segmented(ctx,ranged,{size,get done(){return done;},set done(v){done=v;},report,saveState});
    else await single(ctx,pool,{get size(){return size;},set size(v){size=v;},get done(){return done;},set done(v){done=v;},report,saveState,fresh});
   }
   check();saveState(true);
   return {...await finish(),sources:pool.map(s=>s.url)};
  }catch(e){
   if(e.name==='AbortError'||(ctx.signal&&ctx.signal.aborted)){saveState(true);throw abortError(ctx.signal);}
   lastError=e;
   if(e.code==='HASH_MISMATCH'||e.code==='SIZE_MISMATCH'){
    ctx.log('failed '+(only?hostOf(only.url):'mixed')+' '+e.code);if(only)only.banned=e.code;
    try{fs.rmSync(part,{force:true});fs.rmSync(stateFile,{force:true});}catch{}
    if(size)await fresh(size);else done=[];
    continue;
   }
   if(!usable.some(s=>!s.banned))break;
   /* every connection of this round failed; the next round (single sources) carries on from the finished ranges */
  }
 }
 saveState(true);
 if(lastError&&(lastError.code==='HASH_MISMATCH'||lastError.code==='SIZE_MISMATCH'))throw lastError;
 throw codeError('DOWNLOAD_FAILED','DOWNLOAD_FAILED '+(lastError?lastError.message:'every source failed'),{last:lastError});
}

/* one HTTP request; range = [from, to) with to null for "to the end" */
async function request(ctx,url,range,signal){
 const headers={'User-Agent':ctx.userAgent,...(ctx.headers||{})};
 if(range)headers.Range='bytes='+range[0]+'-'+(range[1]!=null?range[1]-1:'');
 const res=await ctx.fetch(url,{headers,redirect:'follow',signal});
 const status=statusOf(res);
 if(!(res.ok||status===206)||status>=300){try{res.body&&res.body.cancel&&res.body.cancel().catch(()=>{});}catch{}throw codeError('HTTP_'+status,'HTTP '+status,{fatal:true,status});}
 if(ctx.accept)try{ctx.accept(res,url);}catch(e){e.fatal=true;throw e;}
 let start=0,total=null,ranged=false;
 if(status===206){const m=/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(header(res,'content-range')||'');ranged=true;start=m?Number(m[1]):(range?range[0]:0);total=m&&m[3]!=='*'?Number(m[3]):null;}
 else{total=Number(header(res,'content-length'))||null;}
 return {res,status,ranged,start,total};
}

/* All sources at once for ~probeMs (only until the answer headers when there is a single source). Speed = bytes that
   arrived per second since the request went out, so a slow first byte counts too. */
async function probe(ctx,urls,from=0){
 const t0=Date.now(),window=urls.length>1?ctx.probeMs:0,deadline=t0+window;
 const list=urls.map((url,index)=>({url,index,ok:false,ranged:false,total:null,bytes:0,speed:0,error:null,kept:null,complete:false,strikes:0,active:0,banned:''}));
 await Promise.all(list.map(async s=>{
  const ac=new AbortController(),stop=()=>ac.abort();if(ctx.signal)ctx.signal.addEventListener('abort',stop,{once:true});
  const cap=setTimeout(stop,ctx.probeCapMs);
  try{
   const h=await request(ctx,s.url,[from,null],ac.signal);
   s.ok=true;s.ranged=h.ranged&&h.start===from;s.total=h.total;s.keptAt=s.ranged?from:0;
   const keep=[];let kept=0;
   try{
    if(window>0){
     const end=await drain(h.res,c=>{s.bytes+=c.length;if(kept+c.length<=ctx.keepProbe){keep.push(c);kept+=c.length;if(ctx.onProbe&&(s.ranged||s.bytes===kept))ctx.onProbe(kept,s.total);}},{signal:ac.signal,deadline});
     if(end==='end'){s.complete=kept===s.bytes&&s.keptAt===0;if(!s.total||s.total<s.keptAt+s.bytes)s.total=s.keptAt+s.bytes;}
    }
   }catch(e){
    /* the source answered; a reset or the 4 s cap while reading only ends the measurement (a reset is one strike) */
    if(ctx.signal&&ctx.signal.aborted)throw e;if(!ac.signal.aborted){s.strikes++;ctx.log('probe '+hostOf(s.url)+' cut off: '+e.message);}
   }
   s.kept=s.ranged||s.complete?Buffer.concat(keep):null;
   s.speed=s.bytes/Math.max(1,Date.now()-t0);
   if(s.bytes)ctx.log('probe '+hostOf(s.url)+' '+s.bytes+' B in '+(Date.now()-t0)+' ms'+(s.ranged?'':' (no range)'));
  }catch(e){
   s.ok=false;s.error=ac.signal.aborted&&!(ctx.signal&&ctx.signal.aborted)?codeError('NO_ANSWER','no answer in '+Math.round(ctx.probeCapMs/1000)+' s'):e;if(!(ctx.signal&&ctx.signal.aborted))ctx.log('failed '+hostOf(s.url)+' '+s.error.message);
  }finally{clearTimeout(cap);ac.abort();if(ctx.signal)ctx.signal.removeEventListener('abort',stop);}
 }));
 return list;
}

/* Range pieces over several connections and sources. */
async function segmented(ctx,sources,st){
 const size=st.size,queue=[],active=new Set();let failed=null;
 for(const [a,b] of missing(st.done,size))for(let s=a;s<b;s+=ctx.segment)queue.push({pos:s,end:Math.min(b,s+ctx.segment)});
 const best=Math.max(...sources.map(s=>s.speed));
 for(const s of sources){s.reserve=best>0&&s.speed<best*ctx.fastShare;s.active=0;}
 const fh=await fsp.open(ctx.part,'r+');
 const pick=()=>{
  let pool=sources.filter(s=>!s.banned&&!s.reserve);if(!pool.length)pool=sources.filter(s=>!s.banned);
  let chosen=null,score=Infinity;for(const s of pool){const v=(s.active+1)/Math.max(s.speed,1e-6);if(v<score){score=v;chosen=s;}}return chosen;
 };
 const steal=()=>{let big=null;for(const p of active)if(!big||p.end-p.pos>big.end-big.pos)big=p;if(!big||big.end-big.pos<ctx.minSteal*2)return null;const mid=big.pos+Math.floor((big.end-big.pos)/2);const piece={pos:mid,end:big.end};big.end=mid;return piece;};
 const strike=(s,why)=>{s.strikes++;s.speed*=0.5;/* the last source left is never dropped for being slow, only slowed down */if(why==='slow'&&!sources.some(x=>x!==s&&!x.banned))return;if(s.strikes>=ctx.maxStrikes&&!s.banned){s.banned=why;ctx.log('dropped '+hostOf(s.url)+' '+why);}};
 /* every half second: each connection's recent speed, each source's live speed from its connections, and connections
    clearly slower than the others (or than another source that is free) are dropped so their piece moves */
 const monitor=setInterval(()=>{
  const now=Date.now();
  for(const p of active){const dt=now-(p.tick||p.t0);if(dt<250)continue;const win=(p.got-(p.tickGot||0))/dt;p.tick=now;p.tickGot=p.got;if(now-p.t0>=1000)p.ema=p.ema==null?win:p.ema*0.6+win*0.4;}
  for(const s of sources){const mine=[...active].filter(p=>p.src===s&&p.ema!=null);if(mine.length){const live=mine.reduce((n,p)=>n+p.ema,0)/mine.length;s.speed=s.speed*0.5+live*0.5;}}
  const top=Math.max(0,...sources.filter(s=>!s.banned).map(s=>s.speed));for(const s of sources)s.reserve=top>0&&s.speed<top*ctx.fastShare;
  for(const p of active){
   if(p.ema==null||now-p.t0<ctx.slowAfterMs||p.end-p.pos<Math.min(256*1024,ctx.segment/8))continue;
   const others=[...active].filter(x=>x!==p&&x.ema!=null),avg=others.length?others.reduce((n,x)=>n+x.ema,0)/others.length:0;
   const elsewhere=Math.max(0,...sources.filter(s=>s!==p.src&&!s.banned).map(s=>s.speed));
   if(p.ema<Math.max(avg,elsewhere)*ctx.slowRatio){p.killed='slow';p.ac.abort();}
  }
 },500);
 const runPiece=async(piece,src)=>{
  src.active++;piece.src=src;piece.t0=Date.now();piece.got=0;piece.killed='';piece.ac=new AbortController();active.add(piece);
  const stop=()=>piece.ac.abort();if(ctx.signal)ctx.signal.addEventListener('abort',stop,{once:true});
  try{
   const h=await request(ctx,src.url,[piece.pos,piece.end],piece.ac.signal);
   if(!h.ranged||h.start!==piece.pos){src.ranged=false;src.banned='no range';try{h.res.body&&h.res.body.cancel&&h.res.body.cancel().catch(()=>{});}catch{}throw codeError('NO_RANGE','answered '+h.status+' to a range request');}
   await drain(h.res,async chunk=>{
    const room=piece.end-piece.pos;if(room<=0)return false;
    const b=chunk.length>room?chunk.subarray(0,room):chunk;
    await fh.write(b,0,b.length,piece.pos);
    st.done=addRange(st.done,piece.pos,piece.pos+b.length);piece.pos+=b.length;piece.got+=b.length;
    st.report();st.saveState(false);
    if(piece.pos>=piece.end)return false;
   },{signal:piece.ac.signal,stallMs:ctx.stallMs});
   if(piece.pos<piece.end)throw codeError('SHORT','connection closed early');
   const rate=piece.got/Math.max(1,Date.now()-piece.t0);if(piece.got>=256*1024)src.speed=src.speed?src.speed*0.7+rate*0.3:rate;
  }catch(e){
   if(ctx.signal&&ctx.signal.aborted)throw abortError(ctx.signal);
   if(piece.killed==='slow'){strike(src,'slow');ctx.log('slow '+hostOf(src.url)+' piece '+piece.pos+' moved');}
   else if(e.fatal){if(!src.banned){src.banned=e.message;ctx.log('failed '+hostOf(src.url)+' '+e.message);}}
   else if(e.code!=='NO_RANGE'){strike(src,e.code==='STALLED'?'stalled':e.message);ctx.log('failed '+hostOf(src.url)+' '+(e.code==='STALLED'?'stalled':e.message));}
   else ctx.log('failed '+hostOf(src.url)+' no range');
   failed=e;
   if(piece.pos<piece.end)queue.unshift({pos:piece.pos,end:piece.end});
  }finally{src.active--;active.delete(piece);if(ctx.signal)ctx.signal.removeEventListener('abort',stop);}
 };
 const worker=async()=>{
  for(;;){
   if(ctx.signal&&ctx.signal.aborted)return;
   const piece=queue.shift()||steal();if(!piece)return;
   const src=pick();if(!src){queue.unshift(piece);return;}
   await runPiece(piece,src);
  }
 };
 try{
  const n=Math.max(1,Math.min(ctx.connections,queue.length+1));
  /* a worker that ran out of work while pieces are still running waits a moment and looks again (pieces come back to the queue when a connection is dropped) */
  const loop=async()=>{for(;;){await worker();if(ctx.signal&&ctx.signal.aborted)return;if(!active.size&&!queue.length)return;if(!pick())return;await new Promise(r=>setTimeout(r,100));}};
  await Promise.all(Array.from({length:n},loop));
 }finally{clearInterval(monitor);await fh.close();st.saveState(true);}
 if(ctx.signal&&ctx.signal.aborted)throw abortError(ctx.signal);
 if(covered(st.done)<size)throw failed||codeError('DOWNLOAD_FAILED','incomplete');
}

/* one connection, source after source; resumes with a Range request when the source allows it */
async function single(ctx,sources,st){
 let last=null;
 for(const src of sources){
  if(src.banned)continue;
  for(let attempt=0;attempt<3;attempt++){
   if(ctx.signal&&ctx.signal.aborted)throw abortError(ctx.signal);
   const ac=new AbortController(),stop=()=>ac.abort();if(ctx.signal)ctx.signal.addEventListener('abort',stop,{once:true});
   /* a source that answered the measurement with 200 may still honour a Range from an offset: ask for the rest anyway, a 200 answer starts over */
   let from=st.size?prefix(st.done):0,fh=null;const before=covered(st.done);
   try{
    const h=await request(ctx,src.url,from?[from,null]:null,ac.signal);
    if(from&&(!h.ranged||h.start!==from))from=0;
    if(!st.size&&h.total)st.size=h.total;
    if(st.size&&h.total&&!h.ranged&&h.total!==st.size)throw codeError('SIZE_MISMATCH','size '+h.total+' != '+st.size,{fatal:true});
    if(!from){await st.fresh(st.size);}
    fh=await fsp.open(ctx.part,'r+');let pos=from;
    await drain(h.res,async chunk=>{
     if(st.size&&pos+chunk.length>st.size)throw codeError('SIZE_MISMATCH','more data than expected',{fatal:true});
     await fh.write(chunk,0,chunk.length,pos);st.done=addRange(st.done,pos,pos+chunk.length);pos+=chunk.length;st.report();st.saveState(false);
    },{signal:ac.signal,stallMs:ctx.stallMs});
    if(st.size&&pos<st.size)throw codeError('SHORT','connection closed early');
    if(!st.size){await fh.truncate(pos);st.size=pos;}
    return;
   }catch(e){
    if(ctx.signal&&ctx.signal.aborted)throw abortError(ctx.signal);
    last=e;ctx.log('failed '+hostOf(src.url)+' '+(e.code==='STALLED'?'stalled':e.message));
    if(e.fatal){src.banned=e.message;break;}
    /* a source that delivered something gets two more tries to finish; one that delivered nothing is left */
    if(covered(st.done)<=before)break;
   }finally{if(fh)await fh.close().catch(()=>{});ac.abort();if(ctx.signal)ctx.signal.removeEventListener('abort',stop);}
  }
 }
 throw last||codeError('DOWNLOAD_FAILED','every source failed');
}

module.exports={download,orderSources,inChina,DEFAULTS,_internal:{addRange,missing,covered,drain}};
