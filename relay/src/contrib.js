// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-15 adaptation contribution packages (services/adapter-contrib.cjs): scripts and program code of library games
   that do not read well, sent by players who agreed, for the maintainer to write adapter packs from. Rule 3 lives here:
   a package is deleted when the maintainer marks the game adapted, and on its own CONTRIB_DAYS (30) after it arrived;
   parts of an upload that never finished go after 2 days. The relay keeps the gzip parts in R2 as they came (no
   assembling in the Worker); the workbench (tools/contrib-workbench.cjs) joins them and checks the sha256.

   Public (the app, consent checked there):
     POST /api/contrib/chunk          raw bytes of one part; headers x-contrib-upload (uuid), -part, -parts, -size, -sha256,
                                      -identity (64 hex, optional), -title (URI-encoded, first part)
                                      → {ok,received,complete} | {ok,duplicate:true} when the game is already held / adapted
     GET  /api/contrib/status?upload=&sha256=   {state:'none'|'receiving'|'complete', received:[part numbers]} (resume)
     GET  /api/contrib/has?id=<identity>        {state:'none'|'receiving'|'complete'|'done'|'expired'}
   Maintainer (Authorization: Bearer ADAPTER_ADMIN_TOKEN):
     GET  /api/contrib/list                     packages held, newest first
     GET  /api/contrib/part/<upload>/<n>        one stored part
     POST /api/contrib/done   {upload}|{identity}   the game is adapted: its parts are deleted now, the row stays as 'done'
     POST /api/contrib/delete {upload}          delete now without marking adapted (row → 'expired') */
export const CONTRIB_LIMITS={chunk:4*1024*1024,size:32*1024*1024,parts:16,days:30,staleHours:48,list:200};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,HEX64=/^[a-f0-9]{64}$/;

function same(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
const admin=(request,env)=>!!env.ADAPTER_ADMIN_TOKEN&&same(request.headers.get('authorization')||'','Bearer '+env.ADAPTER_ADMIN_TOKEN);
const partKey=(upload,i)=>`contrib/${upload}/${i}`;
const sec=now=>Math.floor(now.getTime()/1000);
const int=v=>{const n=Number(v);return Number.isSafeInteger(n)?n:-1;};

async function chunk(request,env,ip,now,{json,fail}){
 if(Number(request.headers.get('content-length')||0)>CONTRIB_LIMITS.chunk)return fail('PAYLOAD_TOO_LARGE',413);
 const h=k=>request.headers.get('x-contrib-'+k)||'';const upload=h('upload').toLowerCase(),part=int(h('part')),parts=int(h('parts')),size=int(h('size')),hash=h('sha256').toLowerCase(),identity=h('identity').toLowerCase();
 if(!UUID.test(upload)||parts<1||parts>CONTRIB_LIMITS.parts||part<0||part>=parts||size<1||size>CONTRIB_LIMITS.size||!HEX64.test(hash)||identity&&!HEX64.test(identity))return fail('INVALID_CHUNK');
 if(Math.ceil(size/CONTRIB_LIMITS.chunk)!==parts)return fail('INVALID_PARTS');
 const bytes=new Uint8Array(await request.arrayBuffer());const want=part<parts-1?CONTRIB_LIMITS.chunk:size-CONTRIB_LIMITS.chunk*(parts-1);if(bytes.length!==want)return fail('CHUNK_SIZE');
 if(part===0&&!(bytes[0]===0x1f&&bytes[1]===0x8b))return fail('NOT_GZIP');
 const t=sec(now);let row=await env.DB.prepare('SELECT upload,identity,size,sha256,parts,state FROM contrib_uploads WHERE upload=?').bind(upload).first();
 if(!row){
  /* one package per game: one already held (or adapted) is enough */
  if(identity){const held=await env.DB.prepare("SELECT state FROM contrib_uploads WHERE identity=? AND state IN ('complete','done') LIMIT 1").bind(identity).first();if(held)return json({ok:true,duplicate:true,state:held.state});}
  let title='';try{title=decodeURIComponent(h('title')).replace(/[\u0000-\u001f]/g,' ').slice(0,120);}catch{}
  await env.DB.prepare("INSERT INTO contrib_uploads(upload,identity,title,app,size,sha256,parts,state,ip_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,'receiving',?,?,?) ON CONFLICT(upload) DO NOTHING")
   .bind(upload,identity,title,String(request.headers.get('x-megulit-version')||'').replace(/[^0-9A-Za-z.-]/g,'').slice(0,40),size,hash,parts,ip,t,t+CONTRIB_LIMITS.days*86400).run();
  row={upload,identity,size,sha256:hash,parts,state:'receiving'};}
 else if(row.size!==size||row.sha256!==hash||row.parts!==parts)return fail('UPLOAD_MISMATCH',409);
 if(row.state!=='receiving')return json({ok:true,complete:row.state==='complete',state:row.state});
 await env.BUCKET.put(partKey(upload,part),bytes,{httpMetadata:{contentType:'application/octet-stream'}});
 await env.DB.prepare('INSERT INTO contrib_parts(upload,part,size,created_at) VALUES(?,?,?,?) ON CONFLICT(upload,part) DO NOTHING').bind(upload,part,bytes.length,t).run();
 const have=(await env.DB.prepare('SELECT COUNT(*) AS n FROM contrib_parts WHERE upload=?').bind(upload).first())?.n|0;
 if(have>=parts){await env.DB.prepare("UPDATE contrib_uploads SET state='complete',completed_at=? WHERE upload=?").bind(t,upload).run();return json({ok:true,received:have,complete:true},201);}
 return json({ok:true,received:have,complete:false});}

async function status(env,url,{json,fail}){const upload=(url.searchParams.get('upload')||'').toLowerCase();if(!UUID.test(upload))return fail('INVALID_UPLOAD');
 const row=await env.DB.prepare('SELECT state,sha256 FROM contrib_uploads WHERE upload=?').bind(upload).first();if(!row)return json({state:'none',received:[]});
 const want=(url.searchParams.get('sha256')||'').toLowerCase();if(want&&want!==row.sha256)return json({state:'none',received:[]});
 const received=((await env.DB.prepare('SELECT part FROM contrib_parts WHERE upload=? ORDER BY part').bind(upload).all()).results||[]).map(r=>r.part);
 return json({state:row.state==='receiving'?'receiving':row.state==='complete'?'complete':'none',received});}

async function has(env,url,{json,fail}){const id=(url.searchParams.get('id')||'').toLowerCase();if(!HEX64.test(id))return fail('INVALID_ID');
 const rows=((await env.DB.prepare('SELECT state FROM contrib_uploads WHERE identity=?').bind(id).all()).results||[]).map(r=>r.state);
 const state=['done','complete','receiving','expired'].find(s=>rows.includes(s))||'none';return json({state});}

/* rule 3: every stored part of an upload goes */
async function dropParts(env,upload){const rows=((await env.DB.prepare('SELECT part FROM contrib_parts WHERE upload=?').bind(upload).all()).results||[]);
 for(const r of rows){try{await env.BUCKET.delete(partKey(upload,r.part));}catch{}}
 await env.DB.prepare('DELETE FROM contrib_parts WHERE upload=?').bind(upload).run();return rows.length;}

async function list(env,{json}){const rows=(await env.DB.prepare("SELECT upload,identity,title,app,size,sha256,parts,state,created_at,completed_at,done_at,expires_at FROM contrib_uploads WHERE state IN ('receiving','complete') ORDER BY created_at DESC LIMIT ?").bind(CONTRIB_LIMITS.list).all()).results||[];
 return json({packages:rows});}
async function part(env,upload,n,{fail}){const row=await env.DB.prepare("SELECT state FROM contrib_uploads WHERE upload=?").bind(upload).first();if(!row||row.state!=='complete')return fail('NOT_FOUND',404);
 const o=await env.BUCKET.get(partKey(upload,n));if(!o)return fail('NOT_FOUND',404);return new Response(o.body,{headers:{'content-type':'application/octet-stream','cache-control':'private, no-store'}});}
async function done(request,env,now,{json,fail,readJSON},{mark='done'}={}){const body=await readJSON(request);const v=body.value||{};
 const upload=String(v.upload||'').toLowerCase(),identity=String(v.identity||'').toLowerCase();
 if(!UUID.test(upload)&&!(mark==='done'&&HEX64.test(identity)))return fail('INVALID_ID');
 const rows=((UUID.test(upload)?await env.DB.prepare('SELECT upload FROM contrib_uploads WHERE upload=?').bind(upload).all():await env.DB.prepare('SELECT upload FROM contrib_uploads WHERE identity=?').bind(identity).all()).results||[]);
 let parts=0;for(const r of rows){parts+=await dropParts(env,r.upload);await env.DB.prepare(`UPDATE contrib_uploads SET state=?,done_at=? WHERE upload=?`).bind(mark,sec(now),r.upload).run();}
 return json({ok:true,packages:rows.length,partsDeleted:parts});}

/* cron: packages past expires_at and uploads stuck receiving for staleHours go; old 'done'/'expired' rows after a year */
export async function cleanupContrib(env,now=new Date()){if(!env.DB||!env.BUCKET)return 0;const t=sec(now);let n=0;
 const due=(await env.DB.prepare("SELECT upload FROM contrib_uploads WHERE (state IN ('receiving','complete') AND expires_at<=?) OR (state='receiving' AND created_at<=?) LIMIT 200").bind(t,t-CONTRIB_LIMITS.staleHours*3600).all()).results||[];
 for(const r of due){await dropParts(env,r.upload);await env.DB.prepare("UPDATE contrib_uploads SET state='expired',done_at=? WHERE upload=?").bind(t,r.upload).run();n++;}
 await env.DB.prepare("DELETE FROM contrib_uploads WHERE state IN ('done','expired') AND done_at<=?").bind(t-365*86400).run();
 return n;}

export async function contribRoute(request,env,ip,now,url,path,deps){
 const {fail,hit}=deps,m=request.method;
 if(path==='/api/contrib/chunk'&&m==='POST')return await hit(env,'contrib',ip,now.getTime())?chunk(request,env,ip,now,deps):fail('RATE_LIMITED',429);
 if(path==='/api/contrib/status'&&m==='GET')return status(env,url,deps);
 if(path==='/api/contrib/has'&&m==='GET')return has(env,url,deps);
 const pm=/^\/api\/contrib\/part\/([0-9a-f-]{36})\/(\d{1,2})$/.exec(path);
 if(pm||['/api/contrib/list','/api/contrib/done','/api/contrib/delete'].includes(path)){
  if(!admin(request,env))return fail('UNAUTHORIZED',401);
  if(pm&&m==='GET')return part(env,pm[1],Number(pm[2]),deps);
  if(path==='/api/contrib/list'&&m==='GET')return list(env,deps);
  if(path==='/api/contrib/done'&&m==='POST')return done(request,env,now,deps);
  if(path==='/api/contrib/delete'&&m==='POST')return done(request,env,now,deps,{mark:'expired'});
  return fail('METHOD_NOT_ALLOWED',405);}
 return null;}

