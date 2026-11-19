// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-19 (user, live 千恋＊万花 Simplified Chinese edition: "点校准之后 alt+t 闪闪闪的"). Calibration samples read the
   screen, so each one hides the subtitle and the Alt+T menu (gameStylePreview → body.tome-style-probing). The game drew
   Chinese, the source was Japanese: no sample ever matched, every new line reset the per-line attempts, and the menu the
   player had just used blinked two or three times per line until the 90 s deadline. Replay: a calibration with ten lines
   that never match, then ten more lines after it, as the player keeps reading and toggling Alt+T. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{PassThrough}=require('node:stream');
const {GameStyleSync}=require('../core/game-style-sync.cjs');

function rig(t){
 const native=fs.mkdtempSync(path.join(os.tmpdir(),'megulit-calib-flicker-'));fs.writeFileSync(path.join(native,'GameStyleProbe.exe'),'');t.after(()=>fs.rmSync(native,{recursive:true,force:true}));
 const requests=[],events=[],stdout=new PassThrough();const child={stdin:{write:l=>requests.push(JSON.parse(l)),on(){},end(){}},stdout,on(){},kill(){}};
 const sync=new GameStyleSync({native,config:null},m=>events.push(m),()=>child);sync.retryGapMs=0;sync.retryDelayMs=0;sync.lineDelay=60000;
 sync.configure({autoGameStyle:true},{bound:true,gameHwnd:'100',gameProcessId:7,gameStarted:1});t.after(()=>sync.stop());
 const wait=(ms=15)=>new Promise(r=>setTimeout(r,ms));
 /* answer every calibration capture as the probe does when the source line is not on screen */
 let answered=0;const miss=async()=>{for(const q of requests.slice(answered)){answered++;if(q.captureMode==='visible-client')stdout.write(JSON.stringify({id:q.id,result:{valid:false,reason:'source not found'}})+'\n');}await wait();};
 /* the reader's own state: hidden while a preview is on, shown when it ends (game-style-sync-ui.js toggles the class) */
 const hides=()=>events.filter(m=>m.gameStylePreview===true).length;
 const toggles=()=>{let probing=false,n=0;for(const m of events)if(typeof m.gameStylePreview==='boolean'&&m.gameStylePreview!==probing){probing=m.gameStylePreview;n++;}return n;};
 return {sync,requests,events,wait,miss,hides,toggles};}

const LINES=Array.from({length:20},(_,i)=>'将臣はそう言って、窓の外の景色を眺めた。その'+i+'番目の台詞。');

test('a calibration that never finds the original ends after a few misses in all, not after every line',async t=>{const r=rig(t);
 r.sync.observe(LINES[0],false);r.sync.begin('all');r.sync.request(true);
 for(let i=1;i<=10;i++){for(let k=0;k<4;k++){await r.wait();await r.miss();}r.sync.observe(LINES[i],false);}
 for(let k=0;k<4;k++){await r.wait();await r.miss();}
 const states=r.events.map(m=>m.gameStyleState).filter(Boolean);
 assert.ok(states.includes('unmatched'),'the session ends as unmatched: '+states.join(','));
 assert.ok(r.hides()<=4,'the subtitle and the Alt+T menu are hidden at most four times for the whole calibration, not per line: '+r.hides());
 assert.equal(r.events.filter(m=>typeof m.gameStylePreview==='boolean').at(-1).gameStylePreview,false,'and shown again at the end');
});

test('after the calibration gave up, reading on and toggling Alt+T ten times hides nothing',async t=>{const r=rig(t);
 r.sync.observe(LINES[0],false);r.sync.begin('all');r.sync.request(true);
 for(let i=1;i<=4;i++){for(let k=0;k<4;k++){await r.wait();await r.miss();}r.sync.observe(LINES[i],false);}
 for(let k=0;k<4;k++){await r.wait();await r.miss();}
 assert.ok(r.events.some(m=>m.gameStyleState==='unmatched'));
 /* the controller (hook-control finishStyleSync) ends the session on unmatched: calibrating goes false */
 r.sync.calibrating=false;const before=r.toggles(),hiddenBefore=r.hides();
 for(let i=5;i<15;i++){r.sync.observe(LINES[i],false);await r.wait(30);await r.miss();}
 assert.equal(r.hides(),hiddenBefore,'no screen capture hides the reader or the menu once calibration is over');
 assert.equal(r.toggles(),before,'each Alt+T toggle is the only thing that opens or closes the menu');
});

test('a calibration whose original does show still measures it on a later line',async t=>{const r=rig(t);
 r.sync.observe(LINES[0],false);r.sync.begin('all');r.sync.request(true);
 await r.wait();await r.miss();r.sync.observe(LINES[1],false);r.events.length=0;
 /* the original of the next line is on screen: the outstanding capture finds it */
 for(let k=0;k<4&&!r.events.some(m=>m.gameStyleState==='sampling'||m.gameStyleState==='measured');k++){await r.wait(30);
  const q=r.sync.pending;if(q)r.sync.child.stdout.write(JSON.stringify({id:q.id,result:{valid:true,style:{textColor:'#FFFFFF',fontSize:28,box:{left:10,top:70,width:80,height:20}}}})+'\n');await r.wait();}
 assert.ok(r.events.some(m=>m.gameStyleState==='sampling'||m.gameStyleState==='measured'),'one miss does not end the session: '+r.events.map(m=>m.gameStyleState).join(','));
 assert.ok(!r.events.some(m=>m.gameStyleState==='unmatched'));
});
