'use strict';
/* 2026-11-19 (rig2 千恋＊万花 bound after the game was already on its title): its TextRender renderers existed before MeguLit's
   script wrapped the class, so no line reported its character boxes and the reader stayed in its own box. A TextRender game
   whose dialogue stream gives three lines without one character record steps back from hiding (the game's own text shows)
   and, when MeguLit did not start it, is told once to start it from the library; the first box resumes hiding. A game that
   reports boxes, or a KiriKiri game without the TextRender plugin, is left alone. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {HookNative}=require('../core/hook-native.cjs');
const BOX='ToMe_CHARS engine=krkr line=100001 hidden=1 sw=1280 sh=720 vx=0 vy=0 vw=0 vh=0 n=2 rects=300,560,28,28;328,560,28,28 text=お客';
function fixture(t,{textRender=true,launched=false}={}){let now=1e6;const notes=[],sent=[];
 const hook=new HookNative({native:__dirname,hook:__dirname,logs:'Z:/no-late-attach-log'},m=>{if(m?.hookNotice)notes.push(m.hookNotice);},()=>{},()=>now);
 hook.trace=()=>{};hook.send=m=>sent.push(m);hook.artLocate=()=>{};hook.process={stdin:{write(){},end(){}},kill(){}};hook.enabled=true;t.after(()=>hook.stop());
 hook.state={...(hook.state||{}),gameProcessId:4242};if(launched)hook.launchedPid=4242;
 if(textRender){hook.source({text:'オ',sourceName:'TextRender',origin:'live'},'');now+=3000;}
 return {hook,notes,sent,lines(n){for(let i=0;i<n;i++){hook.source({text:'台詞の'+i+'番目です。よろしくお願いします。',sourceName:'EmbedKrkrZ',origin:'live'},'');now+=3000;}},
  disabled:()=>sent.filter(m=>m.type==='disable'&&m.reason==='no-positions').length,enabled:()=>sent.filter(m=>m.type==='enable').length};}
const NOTICE=/从 MeguLit 游戏库启动/;
test('late binding (no box in three lines): told once, hiding steps back; the first box brings hiding back',t=>{
 const f=fixture(t);f.lines(1);assert.equal(f.disabled(),0);f.lines(2);assert.equal(f.disabled(),1);assert.equal(f.notes.filter(n=>NOTICE.test(n)).length,1);
 f.lines(5);assert.equal(f.disabled(),1,'stepped back once');assert.equal(f.notes.filter(n=>NOTICE.test(n)).length,1,'told once');
 const before=f.enabled();f.hook.charRects(BOX);assert.equal(f.enabled(),before+1,'hiding resumes with the first box');
});
test('started from the library: hiding steps back for the opening lines without boxes, but nobody is told to restart',t=>{
 const f=fixture(t,{launched:true});f.lines(3);assert.equal(f.disabled(),1);assert.equal(f.notes.filter(n=>NOTICE.test(n)).length,0);
});
test('boxes from the start, or no TextRender plugin: left alone',t=>{
 const a=fixture(t);a.hook.charRects(BOX);a.lines(6);assert.equal(a.disabled(),0);assert.equal(a.notes.length,0);
 const b=fixture(t,{textRender:false});b.lines(6);assert.equal(b.disabled(),0);assert.equal(b.notes.length,0);
});
test('library launches mark their process; other paths cannot re-enable hiding during the step-back',()=>{
 assert.match(fs.readFileSync(path.join(__dirname,'..','services','runtime.cjs'),'utf8'),/bindLaunched\(pid\)\{[^}]*h\.launchedPid=Number\(pid\)/);
 const src=fs.readFileSync(path.join(__dirname,'..','core','hook-native.cjs'),'utf8');
 assert.match(src,/if\(enabled&&!this\.posSuspended\)this\.send\(\{type:'enable'\}\)/);assert.match(src,/if\(!this\.posSuspended\)this\.send\(\{type:'enable'\}\)/);
});
