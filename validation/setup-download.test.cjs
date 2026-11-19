// SPDX-License-Identifier: GPL-3.0-or-later
// First-launch runtime download (setup\setup-runtime.ps1, class MeguFetch) against local throttled HTTP sources:
// parallel probe, segments from several fast sources at once, a source that slows down mid-way gets replaced,
// a 404 source is dropped, resume only fetches missing segments, a no-Range source is used alone, SHA-256 is enforced.
// Windows only (runs powershell.exe); nothing is shown on screen.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),{spawn}=require('node:child_process');
const repo=path.join(__dirname,'..'),script=path.join(repo,'setup','setup-runtime.ps1'),driver=path.join(__dirname,'helpers','setup-download','driver.ps1');
const MB=1<<20,skip=process.platform!=='win32';
const tmpBase=process.env.MEGULIT_TEST_TMP||os.tmpdir();

function source(file,o={}){
 const reqs=[];let firstSeg=0,active=0,maxActive=0;
 const server=http.createServer((req,res)=>{
  const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const probe=!m||!m[2];
  const r={range:req.headers.range||'',probe,t:Date.now(),start:m?+m[1]:0};reqs.push(r);
  if(o.status){res.writeHead(o.status);return res.end();}
  const body=o.body||file;let start=0,end=body.length-1,code=200;
  if(m&&o.range!==false){start=+m[1];end=m[2]?Math.min(+m[2],body.length-1):body.length-1;code=206;}
  if(!probe&&!firstSeg)firstSeg=Date.now();
  const h={'Content-Length':end-start+1,'Content-Type':'application/zip'};
  if(code===206)h['Content-Range']=`bytes ${start}-${end}/${body.length}`;
  res.writeHead(code,h);active++;maxActive=Math.max(maxActive,active);
  let pos=start,closed=false;res.on('close',()=>{closed=true;active--;});
  const tick=()=>{
   if(closed)return;
   const late=firstSeg&&Date.now()-firstSeg;
   if(o.stallAfterMs&&late>o.stallAfterMs&&!probe)return;   /* stays open, sends nothing */
   const rate=o.slowAfterMs&&late>o.slowAfterMs?o.slowRate:o.rate;
   const n=Math.max(512,Math.round(rate/20));res.write(body.subarray(pos,Math.min(end+1,pos+n)));pos+=n;
   if(pos>end)res.end();else setTimeout(tick,50);
  };tick();
 });
 return new Promise(ok=>server.listen(0,'127.0.0.1',()=>ok({
  url:`http://127.0.0.1:${server.address().port}/files/runtime-v1/MeguLit-runtime-test.zip`,host:`127.0.0.1:${server.address().port}`,reqs,
  get firstSeg(){return firstSeg;},get maxActive(){return maxActive;},close:()=>{server.closeAllConnections();server.close();}})));
}
function run(args){
 return new Promise((ok,bad)=>{
  const a=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',driver,'-Script',script];
  for(const [k,v] of Object.entries(args))a.push('-'+k,typeof v==='string'?v:'b64:'+Buffer.from(JSON.stringify(v)).toString('base64'));
  const p=spawn('powershell.exe',a,{windowsHide:true});let out='',err='';
  p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);
  p.on('close',code=>{try{const j=JSON.parse(out.trim().split(/\r?\n/).pop());ok(j);}catch(e){bad(new Error('driver failed '+code+'\n'+out+'\n'+err));}});
 });
}
const fixture=(size)=>{const file=crypto.randomBytes(size),dir=fs.mkdtempSync(path.join(tmpBase,'megulit-setup-dl-'));
 return {file,dir,part:path.join(dir,'runtime-test.setup.part'),sha:crypto.createHash('sha256').update(file).digest('hex').toUpperCase()};};
const segReqs=s=>s.reqs.filter(r=>!r.probe);

test('China order: cn-dl before dl.megulit.com, GitHub last; elsewhere GitHub first',{skip},async()=>{
 const gh='https://github.com/ilynthn/MeguLit/releases/download/runtime-v1.0.0/x.zip';
 const urls=[gh,'https://dl.megulit.com/files/runtime-v1.0.0/x.zip','https://cn-dl.megulit.com/files/runtime-v1.0.0/x.zip','https://gh-proxy.com/'+gh,'https://ghproxy.net/'+gh];
 const j=await run({Rank:{urls}});
 assert.deepEqual(j.china.map(u=>new URL(u).host),['cn-dl.megulit.com','dl.megulit.com','gh-proxy.com','ghproxy.net','github.com']);
 assert.deepEqual(j.world.map(u=>new URL(u).host),['github.com','dl.megulit.com','cn-dl.megulit.com','gh-proxy.com','ghproxy.net']);
});

test('parallel probe, several fast sources at once, mid-way slowdown replaced, 404 dropped, hash ok',{skip,timeout:90000},async()=>{
 const f=fixture(40*MB);
 const dead=await source(f.file,{status:404}),slowmid=await source(f.file,{rate:800*1024,slowAfterMs:1500,slowRate:20*1024});
 const fast=await source(f.file,{rate:1200*1024}),medium=await source(f.file,{rate:700*1024});
 try{
  const j=await run({Urls:[dead.url,slowmid.url,fast.url,medium.url].join('|'),Part:f.part,Size:String(f.file.length),Sha:f.sha,
   Options:{SegmentSize:MB,SlowGraceMs:2500,StallMs:6000}});
  console.log(j.log);
  assert.equal(j.phase,'done',j.error);
  assert.ok(fs.readFileSync(f.part).equals(f.file),'file content');
  assert.equal(fs.existsSync(f.part+'.json'),false,'state removed after success');
  assert.ok(j.probeMs<=4000,'probe took '+j.probeMs+' ms');
  // all sources were probed at the same time, not one after another
  const probeStarts=[dead,slowmid,fast,medium].map(s=>s.reqs[0].t);
  assert.ok(Math.max(...probeStarts)-Math.min(...probeStarts)<1000,'probes started together');
  const src=h=>j.sources.find(s=>s.host===h);
  assert.equal(src(dead.host).dead,true);
  assert.equal(segReqs(dead).length,0,'404 source never used for segments');
  assert.ok(j.maxSources>=3,'several sources downloading at once: '+j.maxSources);
  assert.ok(fast.maxActive>=3,'fast source gets several connections: '+fast.maxActive);
  assert.ok(src(fast.host).bytes>src(medium.host).bytes,'fast source carried more than medium');
  assert.ok(j.slowKills+j.steals>=1,'slow connection was dropped');
  const lateSlow=segReqs(slowmid).filter(r=>r.t>slowmid.firstSeg+1500+5000);
  assert.equal(lateSlow.length,0,'slowed source not given new segments');
  assert.ok(j.labels.some(l=>/ 等 \d+ 个源$/.test(l)),'label shows several sources: '+j.labels);
  assert.ok(j.ms<40000,'finished in '+j.ms+' ms');
 }finally{[dead,slowmid,fast,medium].forEach(s=>s.close());}
});

test('resume after cancel only fetches missing segments',{skip,timeout:90000},async()=>{
 const f=fixture(16*MB);
 const a=await source(f.file,{rate:1000*1024}),b=await source(f.file,{rate:800*1024});
 try{
  const opts={SegmentSize:MB};
  const j1=await run({Urls:[a.url,b.url].join('|'),Part:f.part,Size:String(f.file.length),Sha:f.sha,Options:opts,CancelAt:String(10*MB)});
  assert.equal(j1.phase,'cancelled',j1.error);
  const state=JSON.parse(fs.readFileSync(f.part+'.json','utf8'));
  const done=new Set(state.done.split(',').filter(Boolean).map(Number));
  assert.ok(done.size>=3&&done.size<16,'some segments done: '+done.size);
  a.reqs.length=0;b.reqs.length=0;
  const j2=await run({Urls:[a.url,b.url].join('|'),Part:f.part,Size:String(f.file.length),Sha:f.sha,Options:opts});
  console.log(j2.log);
  assert.equal(j2.phase,'done',j2.error);
  assert.equal(j2.resumed,done.size*MB);
  const starts=[...segReqs(a),...segReqs(b)].map(r=>r.start/MB);
  assert.equal(starts.filter(k=>done.has(k)).length,0,'no finished segment downloaded again');
  assert.equal(new Set(starts).size,16-done.size,'every missing segment fetched');
  assert.ok(fs.readFileSync(f.part).equals(f.file));
 }finally{a.close();b.close();}
});

test('source without Range: one connection for the whole file',{skip,timeout:60000},async()=>{
 const f=fixture(6*MB);
 const plain=await source(f.file,{rate:4*MB,range:false}),dead=await source(f.file,{status:404});
 try{
  const j=await run({Urls:[dead.url,plain.url].join('|'),Part:f.part,Size:String(f.file.length),Sha:f.sha,Options:{SegmentSize:MB}});
  assert.equal(j.phase,'done',j.error);
  assert.equal(j.single,true);
  assert.equal(plain.reqs.length,2,'probe + one whole-file request');
  assert.ok(fs.readFileSync(f.part).equals(f.file));
 }finally{plain.close();dead.close();}
});

test('stalled connection is dropped and its segment refetched elsewhere',{skip,timeout:60000},async()=>{
 const f=fixture(8*MB);
 const stall=await source(f.file,{rate:900*1024,stallAfterMs:500}),ok=await source(f.file,{rate:700*1024});
 try{
  const j=await run({Urls:[stall.url,ok.url].join('|'),Part:f.part,Size:String(f.file.length),Sha:f.sha,Options:{SegmentSize:MB,StallMs:2000,SlowGraceMs:60000}});
  console.log(j.log);
  assert.equal(j.phase,'done',j.error);
  assert.ok(j.stallKills>=1,'stall detected');
  assert.ok(fs.readFileSync(f.part).equals(f.file));
 }finally{stall.close();ok.close();}
});

test('wrong bytes from every source: SHA-256 check fails, nothing kept',{skip,timeout:60000},async()=>{
 const f=fixture(3*MB);
 const bad=await source(f.file,{rate:4*MB,body:crypto.randomBytes(3*MB)});
 try{
  const j=await run({Urls:bad.url,Part:f.part,Size:String(f.file.length),Sha:f.sha,Options:{SegmentSize:MB}});
  assert.equal(j.phase,'failed');
  assert.match(j.error,/校验/);
  assert.equal(fs.existsSync(f.part+'.json'),false);
 }finally{bad.close();}
});

test('two setup windows on one folder do not share the .part file',{skip,timeout:60000},async()=>{
 const f=fixture(4*MB);
 const s=await source(f.file,{rate:2*MB});
 try{
  const args={Urls:s.url,Part:f.part,Size:String(f.file.length),Sha:f.sha,Options:{SegmentSize:MB}};
  const [a,b]=await Promise.all([run(args),run(args)]);
  assert.equal(a.phase,'done',a.error);assert.equal(b.phase,'done',b.error);
  assert.ok(fs.existsSync(f.part)&&fs.existsSync(f.part+'-1'),'second run took its own file');
  assert.ok(fs.readFileSync(f.part).equals(f.file)&&fs.readFileSync(f.part+'-1').equals(f.file));
  assert.equal(fs.readdirSync(f.dir).filter(n=>n.endsWith('.lock')).length,0,'locks released');
 }finally{s.close();}
});
