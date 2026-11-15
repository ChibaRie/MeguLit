// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-15 closed-beta full probes (services/probe-full.cjs): a game's script entries + its exe / DLLs cut down to code,
   one .mlfp file per game identity, stored in R2 (multipart: resumable, parts of PART bytes, the last one shorter).

   App (no account):
     POST /api/probe/full/start     {version:1,identity,size,sha256,parts,chunk,title?,vndb?,step?,app?,upload?}
                                    → {ok,upload,have:[part…]}   resume: the same identity + sha256 gets the same upload
                                      and the parts already stored;  {ok,duplicate:true} when the relay already holds a
                                      full probe of that game (or the maintainer finished it within DONE_HOLD)
     PUT  /api/probe/full/part?upload=&part=   raw bytes (x-sha256: their sha256)  → {ok,part}
     POST /api/probe/full/complete  {upload}  → {ok,id}   all parts there: the R2 multipart upload is completed
   Maintainer (Authorization: Bearer ADAPTER_ADMIN_TOKEN; tools/probe-workbench.cjs):
     GET  /api/probe/full/list                 [{identity,title,vndb,step,app,size,sha256,state,reporters,createdAt,expiresAt}]
     GET  /api/probe/full/get?identity=        the .mlfp
     POST /api/probe/full/done   {identity}    adapted: the file goes, a tombstone keeps apps from sending it again
     POST /api/probe/full/delete {identity}    the file and the row go (the game may be sent again)
   Cleanup (cron, cleanupProbeFull): ready files after KEEP_DAYS, unfinished uploads after STALE_DAYS (R2 multipart
   aborted), tombstones after DONE_HOLD. R2 free tier is 10 GB: at most MAX_STORED bytes are held; past it start answers
   FULL_STORAGE until the cleanup or the maintainer makes room. */
const HEX64=/^[a-f0-9]{64}$/,UUID=/^[0-9a-f-]{36}$/;
export const FULL_LIMITS={part:5*1024*1024,size:64*1024*1024,parts:13,keepDays:30,staleDays:3,doneHoldDays:14,maxStored:8*1024*1024*1024};
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha256=async b=>hex(await crypto.subtle.digest('SHA-256',b));
const clean=(s,n)=>String(s??'').replace(/[\u0000-\u001f]/g,' ').slice(0,n);
const sec=now=>Math.floor(now.getTime()/1000);
const keyOf=(identity,sha)=>`probe-full/${identity}/${sha}.mlfp`;
const row=(env,identity)=>env.DB.prepare('SELECT * FROM probe_full WHERE identity=?').bind(identity).first();
const byUpload=(env,upload)=>env.DB.prepare('SELECT * FROM probe_full WHERE upload=?').bind(upload).first();
async function abort(env,r){if(r?.r2_upload){try{await env.BUCKET.resumeMultipartUpload(r.object_key,r.r2_upload).abort();}catch{}}
 await env.DB.prepare('DELETE FROM probe_full_parts WHERE identity=?').bind(r.identity).run();}
async function dropRow(env,r){if(r.state==='uploading')await abort(env,r);else if(r.object_key){try{await env.BUCKET.delete(r.object_key);}catch{}}
 await env.DB.prepare('DELETE FROM probe_full_parts WHERE identity=?').bind(r.identity).run();await env.DB.prepare('DELETE FROM probe_full WHERE identity=?').bind(r.identity).run();}
const stored=async env=>(await env.DB.prepare("SELECT COALESCE(SUM(size),0) AS n FROM probe_full WHERE state IN ('ready','uploading')").first())?.n||0;

async function start(request,env,ip,now,{json,fail,readJSON}){
 const body=await readJSON(request,8192);if(body.error)return fail(body.error,body.error==='PAYLOAD_TOO_LARGE'?413:400);const v=body.value||{};
 if(v.version!==1||!HEX64.test(String(v.identity||''))||!HEX64.test(String(v.sha256||''))||!Number.isSafeInteger(v.size)||v.size<12||v.size>FULL_LIMITS.size
  ||v.chunk!==FULL_LIMITS.part||v.parts!==Math.ceil(v.size/FULL_LIMITS.part))return fail('INVALID_START');
 const t=sec(now);let r=await row(env,v.identity);
 if(r?.state==='ready'||r?.state==='done'&&t-r.updated_at<FULL_LIMITS.doneHoldDays*86400){
  await env.DB.prepare('UPDATE probe_full SET reporters=reporters+1 WHERE identity=?').bind(v.identity).run();return json({ok:true,duplicate:true});}
 /* resume the same bytes */
 if(r?.state==='uploading'&&r.sha256===v.sha256){const have=((await env.DB.prepare('SELECT part FROM probe_full_parts WHERE identity=? ORDER BY part').bind(v.identity).all()).results||[]).map(x=>x.part);
  await env.DB.prepare('UPDATE probe_full SET updated_at=? WHERE identity=?').bind(t,v.identity).run();return json({ok:true,upload:r.upload,have});}
 /* someone else's unfinished upload of this game that is still moving: let it finish */
 if(r?.state==='uploading'&&t-r.updated_at<6*3600)return json({ok:true,duplicate:true});
 if(r)await dropRow(env,r);
 if(await stored(env)+v.size>FULL_LIMITS.maxStored)return fail('FULL_STORAGE',507);
 const objectKey=keyOf(v.identity,v.sha256),mp=await env.BUCKET.createMultipartUpload(objectKey,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{sha256:v.sha256,identity:v.identity}});
 const upload=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO probe_full(identity,upload,r2_upload,object_key,sha256,size,parts,state,title,vndb,step,app,ip_hash,reporters,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)')
  .bind(v.identity,upload,mp.uploadId,objectKey,v.sha256,v.size,v.parts,'uploading',clean(v.title,120),/^v[1-9]\d{0,7}$/.test(String(v.vndb||''))?v.vndb:'',clean(v.step,30),clean(v.app,40),ip,t,t,t+FULL_LIMITS.keepDays*86400).run();
 return json({ok:true,upload,have:[]},201);}

async function part(request,env,now,url,{json,fail}){
 const upload=url.searchParams.get('upload')||'',n=Number(url.searchParams.get('part'));if(!UUID.test(upload)||!Number.isSafeInteger(n))return fail('INVALID_PART');
 const r=await byUpload(env,upload);if(!r||r.state!=='uploading')return fail('UNKNOWN_UPLOAD',404);if(n<0||n>=r.parts)return fail('INVALID_PART');
 const want=n<r.parts-1?FULL_LIMITS.part:r.size-FULL_LIMITS.part*(r.parts-1);
 if(Number(request.headers.get('content-length')||want)!==want)return fail('PART_SIZE',400);
 const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length!==want)return fail('PART_SIZE',400);
 const claimed=String(request.headers.get('x-sha256')||'');if(!HEX64.test(claimed)||await sha256(bytes)!==claimed)return fail('PART_CHECKSUM',409);
 const mp=env.BUCKET.resumeMultipartUpload(r.object_key,r.r2_upload),done=await mp.uploadPart(n+1,bytes);
 await env.DB.prepare('INSERT INTO probe_full_parts(identity,part,etag,size) VALUES(?,?,?,?) ON CONFLICT(identity,part) DO UPDATE SET etag=excluded.etag,size=excluded.size').bind(r.identity,n,done.etag,bytes.length).run();
 await env.DB.prepare('UPDATE probe_full SET updated_at=? WHERE identity=?').bind(sec(now),r.identity).run();
 return json({ok:true,part:n});}

async function complete(request,env,now,{json,fail,readJSON}){
 const body=await readJSON(request,1024);const upload=String(body.value?.upload||'');if(!UUID.test(upload))return fail('INVALID_UPLOAD');
 const r=await byUpload(env,upload);if(!r)return fail('UNKNOWN_UPLOAD',404);if(r.state==='ready')return json({ok:true,id:r.identity});if(r.state!=='uploading')return fail('UNKNOWN_UPLOAD',404);
 const parts=(await env.DB.prepare('SELECT part,etag,size FROM probe_full_parts WHERE identity=? ORDER BY part').bind(r.identity).all()).results||[];
 if(parts.length!==r.parts||parts.reduce((n,p)=>n+p.size,0)!==r.size)return json({ok:false,error:'PARTS_MISSING',have:parts.map(p=>p.part)},409);
 await env.BUCKET.resumeMultipartUpload(r.object_key,r.r2_upload).complete(parts.map(p=>({partNumber:p.part+1,etag:p.etag})));
 const t=sec(now);await env.DB.prepare("UPDATE probe_full SET state='ready',r2_upload='',updated_at=?,expires_at=? WHERE identity=?").bind(t,t+FULL_LIMITS.keepDays*86400,r.identity).run();
 await env.DB.prepare('DELETE FROM probe_full_parts WHERE identity=?').bind(r.identity).run();
 return json({ok:true,id:r.identity},201);}

/* ---- maintainer ---------------------------------------------------------------------------------------------------- */
async function list(env,{json}){const rows=(await env.DB.prepare('SELECT * FROM probe_full ORDER BY updated_at DESC LIMIT 500').all()).results||[];
 return json({ok:true,stored:await stored(env),limit:FULL_LIMITS.maxStored,games:rows.map(r=>({identity:r.identity,title:r.title,vndb:r.vndb,step:r.step,app:r.app,size:r.size,sha256:r.sha256,state:r.state,reporters:r.reporters,createdAt:r.created_at,updatedAt:r.updated_at,expiresAt:r.expires_at}))});}
async function get(env,url,{fail}){const id=url.searchParams.get('identity')||'';if(!HEX64.test(id))return fail('INVALID_ID');const r=await row(env,id);if(!r||r.state!=='ready')return fail('NOT_FOUND',404);
 const o=await env.BUCKET.get(r.object_key);if(!o)return fail('NOT_FOUND',404);
 return new Response(o.body,{headers:{'content-type':'application/octet-stream','content-length':String(r.size),'x-sha256':r.sha256,'content-disposition':`attachment; filename="${r.identity.slice(0,16)}-${r.sha256.slice(0,12)}.mlfp"`,'cache-control':'private, no-store'}});}
async function finish(request,env,now,{json,fail,readJSON},tomb){const body=await readJSON(request,1024);const id=String(body.value?.identity||'');if(!HEX64.test(id))return fail('INVALID_ID');
 const r=await row(env,id);if(!r)return json({ok:true,gone:true});
 if(!tomb){await dropRow(env,r);return json({ok:true,deleted:true});}
 if(r.state==='uploading')await abort(env,r);else if(r.object_key){try{await env.BUCKET.delete(r.object_key);}catch{}}
 await env.DB.prepare("UPDATE probe_full SET state='done',r2_upload='',updated_at=? WHERE identity=?").bind(sec(now),id).run();return json({ok:true,done:true});}

/* cron: expired files, stale uploads, old tombstones → {removed} */
export async function cleanupProbeFull(env,now=new Date()){if(!env.DB||!env.BUCKET)return {removed:0};const t=sec(now);let removed=0;
 const rows=(await env.DB.prepare("SELECT * FROM probe_full WHERE (state='ready' AND expires_at<?) OR (state='uploading' AND updated_at<?) OR (state='done' AND updated_at<?) LIMIT 200")
  .bind(t,t-FULL_LIMITS.staleDays*86400,t-FULL_LIMITS.doneHoldDays*86400).all()).results||[];
 for(const r of rows){try{await dropRow(env,r);removed++;}catch{}}return {removed};}

const admin=(request,env)=>{const want='Bearer '+(env.ADAPTER_ADMIN_TOKEN||''),got=request.headers.get('authorization')||'';if(!env.ADAPTER_ADMIN_TOKEN||got.length!==want.length)return false;let d=0;for(let i=0;i<got.length;i++)d|=got.charCodeAt(i)^want.charCodeAt(i);return d===0;};
export async function probeFullRoute(request,env,ip,now,url,path,deps){
 const {fail,hit}=deps,m=request.method;if(!env.BUCKET?.createMultipartUpload)return fail('NOT_CONFIGURED',503);
 if(path==='/api/probe/full/start'&&m==='POST')return await hit(env,'probe-full',ip,now.getTime())?start(request,env,ip,now,deps):fail('RATE_LIMITED',429);
 if(path==='/api/probe/full/part'&&m==='PUT')return await hit(env,'probe-full',ip,now.getTime())?part(request,env,now,url,deps):fail('RATE_LIMITED',429);
 if(path==='/api/probe/full/complete'&&m==='POST')return await hit(env,'probe-full',ip,now.getTime())?complete(request,env,now,deps):fail('RATE_LIMITED',429);
 if(['/api/probe/full/list','/api/probe/full/get','/api/probe/full/done','/api/probe/full/delete'].includes(path)){if(!admin(request,env))return fail('UNAUTHORIZED',401);
  if(path==='/api/probe/full/list'&&m==='GET')return list(env,deps);
  if(path==='/api/probe/full/get'&&m==='GET')return get(env,url,deps);
  if(path==='/api/probe/full/done'&&m==='POST')return finish(request,env,now,deps,true);
  if(path==='/api/probe/full/delete'&&m==='POST')return finish(request,env,now,deps,false);}
 return fail('NOT_FOUND',404);}
