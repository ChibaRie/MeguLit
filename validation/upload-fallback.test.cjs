// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 (v1.4.10 user could not send logs; the 检查完成 dialog showed a dead 确认上传)
   - one-click log / feedback uploads try cn-api first, then api.megulit.com, and skip the local 429 / backoff gate
   - a hidden dialog button stays hidden despite the plate CSS; the finished check dialog has one primary 完成 */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'megulit-upfb-'));
const zip=dir=>{const f=path.join(dir,'d.zip');fs.writeFileSync(f,Buffer.concat([Buffer.from('PK'),Buffer.alloc(40)]));return f;};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('relay endpoints: cn-api first by default, only the saved address when one is set',()=>{
 const rc=require('../services/relay-config.cjs'),root=tmp();
 assert.deepEqual(rc.endpoints(root,'/api/diagnostics',{}),['https://cn-api.megulit.com/api/diagnostics','https://api.megulit.com/api/diagnostics']);
 assert.deepEqual(rc.endpoints(root,'/api/feedback',{MEGULIT_RELAY_BASE:'https://relay.example.com'}),['https://relay.example.com/api/feedback']);
 assert.deepEqual(rc.endpoints(root,'/api/feedback',{MEGULIT_RELAY_BASE:'off'}),[]);
});

test('log upload: next relay on network error / 429 / 5xx, a 4xx refusal is final',async()=>{
 const up=require('../services/diagnostics-upload.cjs'),root=tmp(),file=zip(root);
 let seen=[];
 let r=await up.upload(file,{version:'1.4.11'},{root,fetcher:async u=>{seen.push(new URL(u).host);if(u.includes('cn-api'))throw new TypeError('fetch failed');return json({ok:true,id:'x'},201);}});
 assert.equal(r.state,'uploaded');assert.deepEqual(seen,['cn-api.megulit.com','api.megulit.com']);
 seen=[];r=await up.upload(file,{version:'1.4.11'},{root,fetcher:async u=>{seen.push(new URL(u).host);return u.includes('cn-api')?json({ok:false,error:'RATE_LIMITED'},429):json({ok:true,id:'y'},201);}});
 assert.equal(r.state,'uploaded');assert.equal(seen.length,2);
 seen=[];r=await up.upload(file,{version:'1.4.11'},{root,fetcher:async u=>{seen.push(u);return json({ok:false,error:'CHECKSUM_MISMATCH'},400);}});
 assert.deepEqual(r,{state:'failed',error:'CHECKSUM_MISMATCH'});assert.equal(seen.length,1);
 r=await up.upload(file,{version:'1.4.11'},{root,fetcher:async()=>{throw new TypeError('fetch failed');}});
 assert.deepEqual(r,{state:'failed',error:'NETWORK'});
});

test('feedback text: same fallback',async()=>{
 const fb=require('../services/feedback.cjs'),root=tmp(),seen=[];
 const r=await fb.send(root,{kind:'feedback',text:'logs did not go up'},{env:{},fetcher:async u=>{seen.push(new URL(u).host);return u.includes('cn-api')?json({ok:false},502):json({ok:true,url:'https://github.com/a/b/issues/2'});}});
 assert.equal(r.ok,true);assert.deepEqual(seen,['cn-api.megulit.com','api.megulit.com']);
});

test('relay gate: a contribution 429 does not block a one-click log upload',async()=>{
 const {createGate}=require('../services/relay-gate.cjs');let t=1e6,calls=0;
 const g=createGate(async u=>{calls++;return String(u).includes('/api/contrib/')?json({ok:false,error:'RATE_LIMITED'},429):json({ok:true});},{now:()=>t});
 assert.equal((await g('https://api.megulit.com/api/contrib/chunk',{method:'POST'})).status,429);
 assert.equal((await g('https://api.megulit.com/api/adaptation')).status,429,'background calls still wait');assert.equal(calls,1);
 assert.equal((await g('https://api.megulit.com/api/diagnostics',{method:'POST'})).status,200);
 assert.equal((await g('https://cn-api.megulit.com/api/feedback',{method:'POST'})).status,200);assert.equal(calls,3);
});

test('dialog: hidden buttons stay hidden over the plate CSS; finished check shows one primary 完成',()=>{
 const css=fs.readFileSync(path.join(ROOT,'web','launch-plate.css'),'utf8'),ui=fs.readFileSync(path.join(ROOT,'web','adapter-probe-ui.js'),'utf8');
 /* id weight of the heaviest top-level selector in a list (commas inside :is()/:not() do not split) */
 const ids=list=>{const parts=[];let depth=0,cur='';for(const ch of list.replace(/\/\*[\s\S]*?\*\//g,'')){if(ch==='(')depth++;if(ch===')')depth--;if(ch===','&&!depth){parts.push(cur);cur='';}else cur+=ch;}parts.push(cur);
  return Math.max(...parts.map(p=>(p.replace(/:is\([^()]*\)/g,'').match(/#[\w-]+/g)||[]).length));};
 const guard=css.split('}').find(r=>/body \[hidden\]\{display:none!important$/.test(r.trim()));assert.ok(guard,'guard rule');
 const heaviest=Math.max(...css.split('}').filter(r=>r!==guard&&/display:[^;]*!important/.test(r)).map(r=>ids(r.split('{')[0])));
 assert.ok(ids(guard.split('{')[0])>heaviest,'guard outweighs every plate rule');
 assert.match(ui,/finish:'完成'/);
 assert.match(ui,/if\(!problems\.length\)\{now\.textContent=t\.done\+' · '\+t\.allGood;finish\(\);/);
 assert.match(ui,/const finish=\(\)=>\{[^}]*send\.hidden=true;send\.onclick=null;closer\.className='primary';closer\.textContent=t\.finish;/);
});
