'use strict';
// E590 automatic Japanese: setting switch, file restore with self-check revert, redirect plug-in, no Japanese data, undo, switches.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const jr=require('../core/japanese-restore.cjs'),{encrypt,decrypt,parse}=jr._internal,auto=require('../core/japanese-auto.cjs'),LS=require('../core/game-language-switch.cjs');
const base=fs.existsSync('H:\\MeguLit-Work')?path.join('H:\\MeguLit-Work','tmp'):os.tmpdir();fs.mkdirSync(base,{recursive:true});
const tmp=p=>fs.mkdtempSync(path.join(base,'megulit-auto-'+p));
function table(rows,{share=false}={}){const cols=rows[0].length,head=28,fmt=head,data=fmt+cols*8,text=data+rows.length*cols*4,pool=[],idx=new Map();let size=0;
 const put=s=>{if(!share||!idx.has(s)){const b=Buffer.from(s+'\0','utf16le');idx.set(s,size);pool.push(b);size+=b.length;}return idx.get(s);};
 const b=Buffer.alloc(text);b.writeUInt32LE(rows.length,4);b.writeUInt32LE(cols,8);b.writeUInt32LE(head,12);b.writeUInt32LE(fmt,16);b.writeUInt32LE(data,20);b.writeUInt32LE(text,24);
 for(let c=0;c<cols;c++){b.writeUInt32LE(c,fmt+c*8);b.writeUInt32LE(0x53,fmt+c*8+4);}
 rows.forEach((r,ri)=>r.forEach((v,ci)=>b.writeUInt32LE(put(v),data+(ri*cols+ci)*4)));
 const raw=Buffer.concat([b,...pool]);raw.writeUInt32LE(raw.length,0);return encrypt(1,raw);}
const cells=f=>{const d=decrypt(fs.readFileSync(f));return parse(d.raw,d.marker).cells;};
function siglusGame(){const g=tmp('sig'),dat=path.join(g,'dat');fs.mkdirSync(dat);const rows=[];for(let i=0;i<20;i++)rows.push(['「島に着いた」'+i,'We reached the island '+i,'我们到了岛上'+i]);
 fs.writeFileSync(path.join(dat,'10_story.dbs'),table(rows));return {g,story:path.join(dat,'10_story.dbs'),orig:fs.readFileSync(path.join(dat,'10_story.dbs'))};}
const enc=s=>[...s].map(c=>'\\x'+c.codePointAt(0).toString(16)).join('');
function ksd(text){const body=Buffer.from(text,'utf16le'),z=zlib.deflateSync(body),h=Buffer.alloc(21);Buffer.from([0xFE,0xFE,0x02,0xFF,0xFE]).copy(h);h.writeBigUInt64LE(BigInt(z.length),5);h.writeBigUInt64LE(BigInt(body.length),13);return Buffer.concat([h,z]);}
const noSteam={steamRunning:()=>false,registry:{query:()=>[],set:()=>{throw Error('no registry');}}};

test('own language setting (KiriKiri save) is set to Japanese; game folder files untouched; undo is final',()=>{
 const root=tmp('root'),game=tmp('krkr'),appData=tmp('app');fs.writeFileSync(path.join(game,'data.xp3'),'XP3');fs.mkdirSync(path.join(game,'plugin'));fs.writeFileSync(path.join(game,'plugin','krkrsteam.dll'),'x');
 fs.writeFileSync(path.join(game,'game.cf'),'datapath="'+enc('$(appdatapath)/メーカー/game')+'"\n');
 const dir=path.join(appData,'メーカー','game');fs.mkdirSync(dir,{recursive:true});const save=path.join(dir,'data_anchor.ksd');
 fs.writeFileSync(save,ksd('(const) %[\n "core" => (const) %[\n  "textLanguageType" => 1,\n  "volume" => 80\n ]\n]'));
 const options={...noSteam,appData},xp3=fs.readFileSync(path.join(game,'data.xp3'));
 assert.equal(auto.decide(game,options).action,'setting');
 const r=auto.run(root,'g1',game,{options});assert.equal(r.done,true);assert.equal(r.mode,'setting');
 assert.match(LS._internal.readKrkr(fs.readFileSync(save)).text,/"textLanguageType" => 0,/);
 assert.ok(fs.readFileSync(path.join(game,'data.xp3')).equals(xp3));
 assert.deepEqual(auto.takeNotices(root).map(n=>n.id),['g1']);assert.deepEqual(auto.takeNotices(root),[]);
 assert.equal(auto.status(root,'g1',game,options).state,'auto');
 /* a second scan does nothing */
 assert.equal(auto.run(root,'g1',game,{options}).reason,'ALREADY_AUTO');
 auto.undo(root,'g1',game,{restore:d=>LS.restore(d,options)});
 assert.match(LS._internal.readKrkr(fs.readFileSync(save)).text,/"textLanguageType" => 1,/);
 assert.equal(auto.run(root,'g1',game,{options}).reason,'USER_UNDID');assert.equal(auto.status(root,'g1',game,options).state,'undone');
});

test('Japanese data not selectable: file restore with backup; next launch self-checks; a failed launch reverts byte-for-byte',()=>{
 const root=tmp('root'),{g,story,orig}=siglusGame();
 assert.equal(auto.decide(g).action,'files');
 const r=auto.run(root,'s1',g,{trigger:'launch'});assert.equal(r.done,true);assert.equal(r.mode,'files');
 assert.equal(cells(story)[3][2],'「島に着いた」3');assert.ok(fs.existsSync(path.join(g,'.megulit-japanese','dat','10_story.dbs')),'backup first');
 assert.ok(!jr._internal.sharedPool(story),'strings never shared');assert.equal(auto.verifyFiles(g).ok,true);
 /* launch 1: self-check passes, the launch reaches a window */
 assert.deepEqual(auto.selfCheck(root,'s1',g),{checked:true,ok:true});auto.launchResult(root,'s1',true);
 /* launch 2: self-check passes, but the game never starts */
 assert.equal(auto.selfCheck(root,'s1',g).ok,true);auto.launchResult(root,'s1',false);
 /* launch 3: reverted */
 const c=auto.selfCheck(root,'s1',g);assert.equal(c.reverted,true);assert.equal(c.reason,'LAUNCH_FAILED');
 assert.ok(fs.readFileSync(story).equals(orig));assert.equal(auto.status(root,'s1',g).state,'reverted');
 assert.equal(auto.run(root,'s1',g).reason,'AUTO_REVERTED','never switched again by itself');
});

test('a written table with shared strings (E278) is reverted before launch',()=>{
 const root=tmp('root'),{g,story,orig}=siglusGame();auto.run(root,'s2',g);
 const m=JSON.parse(fs.readFileSync(path.join(g,'.megulit-japanese','manifest.json'),'utf8'));
 const bad=table(cells(story),{share:true});fs.writeFileSync(story,bad);m.files[0].patchedSha256=require('node:crypto').createHash('sha256').update(bad).digest('hex');
 fs.writeFileSync(path.join(g,'.megulit-japanese','manifest.json'),JSON.stringify(m));
 assert.equal(auto.verifyFiles(g).reason,'SHARED_STRINGS');
 const c=auto.selfCheck(root,'s2',g);assert.equal(c.reverted,true);assert.equal(c.reason,'SHARED_STRINGS');assert.ok(fs.readFileSync(story).equals(orig));
});

test('a launch that never reported back (MeguLit closed mid-launch) counts as not started',()=>{
 const root=tmp('root'),{g,story,orig}=siglusGame();auto.run(root,'s3',g);auto.selfCheck(root,'s3',g);
 assert.equal(auto.selfCheck(root,'s3',g).reverted,true);assert.ok(fs.readFileSync(story).equals(orig));
});

test('a read redirect, when one is registered, is preferred over writing files',()=>{
 const root=tmp('root'),{g,story,orig}=siglusGame();
 const off=auto.registerRedirect({name:'early-launcher',can:(dir,d)=>d.adapter==='siglus-dbs',prepare:()=>({})});
 try{assert.equal(auto.decide(g).action,'redirect');const r=auto.run(root,'r1',g);assert.equal(r.mode,'redirect');assert.ok(fs.readFileSync(story).equals(orig),'no file written');
  assert.equal(auto.selfCheck(root,'r1',g).checked,false);auto.undo(root,'r1',g);assert.equal(auto.status(root,'r1',g).state,'undone');}finally{off();}
 assert.equal(auto.decide(g).action,'files');
});

test('no Japanese data (Chinese-only build): nothing automatic',()=>{
 const root=tmp('root'),g=tmp('cn'),dat=path.join(g,'dat');fs.mkdirSync(dat);const rows=[];for(let i=0;i<20;i++)rows.push(['We reached '+i,'我们到了岛上'+i]);
 fs.writeFileSync(path.join(dat,'10_story.dbs'),table(rows));const before=fs.readFileSync(path.join(dat,'10_story.dbs'));
 const r=auto.run(root,'c1',g);assert.equal(r.done,false);assert.equal(r.reason,'none');assert.ok(fs.readFileSync(path.join(dat,'10_story.dbs')).equals(before));
 assert.equal(auto.status(root,'c1',g).state,'no-japanese');assert.deepEqual(auto.takeNotices(root),[]);
 const e=tmp('empty');fs.writeFileSync(path.join(e,'game.exe'),'MZ');assert.equal(auto.run(root,'c2',e).reason,'none');
});

test('already Japanese is reported, not touched',()=>{
 const root=tmp('root'),{g}=siglusGame();jr.apply(g);assert.equal(auto.status(root,'a1',g).state,'manual');
 const g2=tmp('ja'),dat=path.join(g2,'dat');fs.mkdirSync(dat);const rows=[];for(let i=0;i<20;i++)rows.push(['「島に着いた」'+i,'voice_'+i]);fs.writeFileSync(path.join(dat,'10_story.dbs'),table(rows));
 assert.equal(auto.run(root,'a2',g2).reason,'already');assert.equal(auto.status(root,'a2',g2).state,'japanese');
});

test('global switch (default on) and per-game off',()=>{
 const root=tmp('root'),{g,story,orig}=siglusGame();assert.equal(auto.read(root).enabled,true);
 auto.setEnabled(root,false);assert.equal(auto.run(root,'x',g).reason,'GLOBAL_OFF');auto.setEnabled(root,true);
 auto.setGameOff(root,'x',true);assert.equal(auto.run(root,'x',g).reason,'GAME_OFF');assert.ok(fs.readFileSync(story).equals(orig));
 auto.setGameOff(root,'x',false);assert.equal(auto.run(root,'x',g).done,true);
});

test('library scan queue: each game once, off the start-up path',async()=>{
 const run=require('../services/japanese-auto-run.cjs'),root=tmp('root'),{g}=siglusGame(),done=[];
 run.considerLibrary(root,[{id:'q1',executable:path.join(g,'game.exe')}],{delay:5,gap:5,onDone:id=>done.push(id)});
 await new Promise(r=>setTimeout(r,8000));assert.deepEqual(done,['q1']);
 assert.equal(run.considerLibrary(root,[{id:'q1',executable:path.join(g,'game.exe')}],{delay:5}),0,'not queued again');
});

test('a write that fails part-way leaves the game as it was; a brief EPERM is retried',()=>{
 const root=tmp('root'),g=tmp('two'),dat=path.join(g,'dat');fs.mkdirSync(dat);const rows=[];for(let i=0;i<20;i++)rows.push(['「島に着いた」'+i,'We reached '+i,'我们到了'+i]);
 for(const n of ['10_a.dbs','20_b.dbs'])fs.writeFileSync(path.join(dat,n),table(rows));const before=fs.readdirSync(dat).map(n=>fs.readFileSync(path.join(dat,n)));
 const real=fs.renameSync;let calls=0;
 fs.renameSync=(a,b)=>{if(/20_b\.dbs\.megulit-tmp$/.test(a))throw Object.assign(Error('EPERM'),{code:'EPERM'});return real(a,b);};
 try{const r=auto.run(root,'p1',g);assert.equal(r.reason,'APPLY_FAILED');}finally{fs.renameSync=real;}
 assert.deepEqual(fs.readdirSync(dat).sort(),['10_a.dbs','20_b.dbs'],'no temp file left');
 fs.readdirSync(dat).forEach((n,i)=>assert.ok(fs.readFileSync(path.join(dat,n)).equals(before[i]),n+' back to original'));
 assert.ok(!fs.existsSync(path.join(g,'.megulit-japanese')));
 fs.renameSync=(a,b)=>{if(/\.megulit-tmp$/.test(a)&&calls++===0)throw Object.assign(Error('EPERM'),{code:'EPERM'});return real(a,b);};
 try{assert.equal(auto.run(root,'p2',g).done,true);}finally{fs.renameSync=real;}
 assert.equal(auto.verifyFiles(g).ok,true);
});
