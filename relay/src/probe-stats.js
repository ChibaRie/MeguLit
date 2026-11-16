// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-16 closed-beta live stats (owner: 我想看实时有多少人在使用). A public, read-only, aggregate-only snapshot the
   手机 dashboard (an Artifact) polls. No identities, no IPs, no personal data — counts and galgame titles only.

   pulse(env,ipHash,now): every MeguLit client request (worker.handle, by user-agent) marks the caller active in a 10-min
   bucket, one write per client per bucket (INSERT OR IGNORE), so "online" is the distinct callers in the last bucket.
   GET /api/probe/stats → {ok,now,online,active1h,today,probedGames,reporters,full:{…},top:[{title,reporters,step,full}]}
   Cleanup (cleanupProbeStats, cron): pulse rows older than a day go. */
const BUCKET=600;/* seconds: a 10-minute activity bucket */
export const nowBucket=now=>Math.floor(now.getTime()/1000/BUCKET);

/* record a live MeguLit client; cheap and deduped per 10-min bucket. never throws into the request path */
export async function pulse(env,ipHash,now){try{if(!env.DB||!/^[a-f0-9]{8,}$/.test(String(ipHash||'')))return;
 await env.DB.prepare('INSERT OR IGNORE INTO probe_pulse(ip_hash,bucket,at) VALUES(?,?,?)').bind(ipHash,nowBucket(now),Math.floor(now.getTime()/1000)).run();}catch{}}

const one=async(env,sql,...args)=>{try{return (await env.DB.prepare(sql).bind(...args).first())||{};}catch{return {};}};

export async function probeStats(env,now,{json,fail}){
 if(!env.DB)return fail('NOT_CONFIGURED',503);
 /* "today" is the players' day (Beijing time, UTC+8), not the Worker's UTC day */
 const t=Math.floor(now.getTime()/1000),dayStart=Math.floor((t+8*3600)/86400)*86400-8*3600;
 const b=nowBucket(now),todayBucket=Math.floor(dayStart/BUCKET);
 const online=(await one(env,'SELECT COUNT(DISTINCT ip_hash) n FROM probe_pulse WHERE bucket>=?',b-1)).n|0;
 const active1h=(await one(env,'SELECT COUNT(DISTINCT ip_hash) n FROM probe_pulse WHERE bucket>=?',b-6)).n|0;
 const today=(await one(env,'SELECT COUNT(DISTINCT ip_hash) n FROM probe_pulse WHERE bucket>=?',todayBucket)).n|0;
 const pg=await one(env,'SELECT COUNT(*) games, COALESCE(SUM(reporters),0) reporters FROM probe_games');
 const pf=await one(env,"SELECT COUNT(*) games, COALESCE(SUM(CASE WHEN state='ready' THEN 1 ELSE 0 END),0) ready, COALESCE(SUM(CASE WHEN state='uploading' THEN 1 ELSE 0 END),0) uploading, COALESCE(SUM(CASE WHEN state='done' THEN 1 ELSE 0 END),0) done, COALESCE(SUM(CASE WHEN state='ready' THEN size ELSE 0 END),0) bytes FROM probe_full");
 let top=[];try{top=((await env.DB.prepare("SELECT title, reporters, state, step FROM probe_full WHERE title<>'' ORDER BY reporters DESC, updated_at DESC LIMIT 24").all()).results||[])
  .map(r=>({title:String(r.title).slice(0,80),reporters:r.reporters|0,step:String(r.step||''),state:String(r.state||''),full:true}));}catch{}
 if(top.length<12){try{const seen=new Set(top.map(t=>t.title));
  for(const r of (await env.DB.prepare('SELECT title, reporters, step FROM probe_games WHERE title<>? ORDER BY reporters DESC LIMIT 40').bind('').all()).results||[]){
   if(top.length>=24)break;const t=String(r.title).slice(0,80);if(seen.has(t))continue;seen.add(t);top.push({title:t,reporters:r.reporters|0,step:String(r.step||''),state:'',full:false});}}catch{}}
 const body={ok:true,now:Math.floor(now.getTime()/1000),online,active1h,today,probedGames:pg.games|0,reporters:pg.reporters|0,
  full:{games:pf.games|0,ready:pf.ready|0,uploading:pf.uploading|0,done:pf.done|0,storedMB:Math.round((pf.bytes|0)/1048576*10)/10,limitMB:8192},
  top:top.sort((a,b)=>b.reporters-a.reporters).slice(0,24)};
 return json(body,200,{'access-control-allow-origin':'*','cache-control':'public, max-age=15'});}

export async function cleanupProbeStats(env,now=new Date()){if(!env.DB)return {removed:0};
 try{const r=await env.DB.prepare('DELETE FROM probe_pulse WHERE bucket<?').bind(nowBucket(now)-144).run();return {removed:r?.meta?.changes|0};}catch{return {removed:0};}}
