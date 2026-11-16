// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-16 live-usage stats for the beta dashboard (relay/src/probe-stats.js). Covers: a MeguLit client request marks
   the caller active once per 10-min bucket (deduped), a non-MeguLit request does not; the public /api/probe/stats needs
   no token, returns aggregate-only counts (online / active / today / probe games / full probes / a title top-list) with
   an open CORS header and no identity or IP; the cron cleanup drops old pulse rows. Relay in-process, no network. */
process.env.MEGULIT_RELAY_BASE??='off';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url'),{DatabaseSync}=require('node:sqlite');

const relayDir=path.join(__dirname,'..','relay'),MIGRATION=fs.readdirSync(path.join(relayDir,'migrations')).filter(f=>f.endsWith('.sql')).sort().map(f=>fs.readFileSync(path.join(relayDir,'migrations',f),'utf8')).join('');
function d1(){const db=new DatabaseSync(':memory:');db.exec(MIGRATION);const stmt=(sql,args=[])=>({bind:(...a)=>stmt(sql,a),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>{const r=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)||0}};}});return {prepare:sql=>stmt(sql),raw:db};}
function env(){return {DB:d1(),BUCKET:{},LINK_SECRET:'link',HASH_SALT:'salt',ADAPTER_ADMIN_TOKEN:'admin'};}
let mod;const relay=async()=>mod??=await import(pathToFileURL(path.join(relayDir,'src','worker.js')).href);
async function hit(ENV,ip,{ua='MeguLit',path='/api/probe/has?id='+'a'.repeat(64),now=new Date()}={}){const {handle}=await relay();const tasks=[];
 const r=await handle(new Request('https://relay.test'+path,{headers:{'cf-connecting-ip':ip,'user-agent':ua}}),ENV,now,{waitUntil:p=>tasks.push(p)});await Promise.all(tasks);return r;}
const stats=async ENV=>{const {handle}=await relay();return handle(new Request('https://relay.test/api/probe/stats'),ENV,new Date(),{waitUntil:()=>{}});};
const rows=(ENV,sql)=>ENV.DB.raw.prepare(sql).all();

test('pulse: MeguLit clients count once per 10-min bucket; other agents and the stats call do not',async()=>{
 const ENV=env(),now=new Date();
 await hit(ENV,'10.0.0.1',{now});await hit(ENV,'10.0.0.1',{now});/* same client twice → one row */
 await hit(ENV,'10.0.0.2',{now});
 await hit(ENV,'10.0.0.3',{ua:'curl/8',now});/* not MeguLit → not counted */
 assert.equal(rows(ENV,'SELECT COUNT(*) n FROM probe_pulse')[0].n,2,'two distinct MeguLit clients, deduped');
 const s=await (await stats(ENV)).json();assert.equal(s.online,2);
 /* the stats request itself is not MeguLit and must not pulse */
 assert.equal(rows(ENV,'SELECT COUNT(*) n FROM probe_pulse')[0].n,2);
});

test('stats: public (no token), CORS open, aggregate only — counts + title top-list, no IP or identity',async()=>{
 const ENV=env();
 /* some probe data */
 ENV.DB.raw.exec("INSERT INTO probe_games(identity,bundle_id,state,items,reporters,first_at,updated_at) VALUES('"+'b'.repeat(64)+"','x','complete',5,7,0,0)");
 ENV.DB.raw.exec("INSERT INTO probe_full(identity,upload,object_key,sha256,size,parts,state,title,step,created_at,updated_at,expires_at,reporters) VALUES('"+'c'.repeat(64)+"','u','k','"+'d'.repeat(64)+"',4000,1,'ready','この素晴らしい世界に','decrypt-failed',0,0,9999999999,9)");
 ENV.DB.raw.exec("INSERT INTO probe_full(identity,upload,object_key,sha256,size,parts,state,title,step,created_at,updated_at,expires_at,reporters) VALUES('"+'e'.repeat(64)+"','u2','k2','"+'f'.repeat(64)+"',2000,1,'done','別のゲーム','parse-failed',0,0,9999999999,3)");
 await hit(ENV,'10.0.0.9');
 const r=await stats(ENV);assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'*');
 const s=await r.json();
 assert.equal(s.online,1);assert.equal(s.probedGames,1);assert.equal(s.reporters,7);
 assert.equal(s.full.games,2);assert.equal(s.full.ready,1);assert.equal(s.full.done,1);assert.equal(s.full.storedMB,0,'only ready bytes, <1MB rounds to 0');assert.equal(s.full.limitMB,8192);
 assert.equal(s.top[0].title,'この素晴らしい世界に');assert.equal(s.top[0].reporters,9);assert.equal(s.top[0].full,true);
 const text=JSON.stringify(s);assert.doesNotMatch(text,/10\.0\.0\.9|[a-f0-9]{64}/,'no IP, no identity in the public payload');
});

test('stats: no token required and admin paths still protected; cleanup drops old pulse rows',async()=>{
 const ENV=env();const {handle}=await relay();
 assert.equal((await handle(new Request('https://relay.test/api/probe/stats'),ENV,new Date(),{waitUntil:()=>{}})).status,200,'open to all');
 assert.notEqual((await handle(new Request('https://relay.test/api/probe/full/list'),ENV,new Date(),{waitUntil:()=>{}})).status,200,'maintainer paths are not publicly readable');
 const {pulse,cleanupProbeStats,nowBucket}=await import(pathToFileURL(path.join(relayDir,'src','probe-stats.js')).href);
 const old=new Date(Date.now()-10*86400000);await pulse(ENV,'aaaaaaaa',old);await pulse(ENV,'bbbbbbbb',new Date());
 assert.equal(rows(ENV,'SELECT COUNT(*) n FROM probe_pulse')[0].n,2);
 const c=await cleanupProbeStats(ENV,new Date());assert.equal(c.removed,1,'the 10-day-old row went');
 assert.equal(rows(ENV,'SELECT COUNT(*) n FROM probe_pulse')[0].n,1);
 /* cron wires it */
 assert.match(fs.readFileSync(path.join(relayDir,'src','worker.js'),'utf8'),/cleanupProbeStats\(env/);
});
