'use strict';
/* 2026-11-19 (rig2 千恋＊万花 bound after the game was already on its title): the TextRender renderers existed before MeguLit's
   script wrapped the class, so no line reported its character boxes and the reader stayed in its own box. A KiriKiri game
   MeguLit did not start itself that gives five dialogue lines with no character record is told once to start it from the
   MeguLit library; a game started from the library, or one that reports boxes, is never told. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {HookNative}=require('../core/hook-native.cjs');
function fixture(t){let now=1e6;const notes=[];const hook=new HookNative({native:__dirname,hook:__dirname,logs:'Z:/no-late-attach-log'},m=>{if(m?.hookNotice)notes.push(m.hookNotice);},()=>{},()=>now);
 hook.trace=()=>{};hook.send=()=>{};hook.artLocate=()=>{};hook.process={stdin:{write(){},end(){}},kill(){}};t.after(()=>hook.stop());hook.state={...(hook.state||{}),gameProcessId:4242};
 return {hook,notes,lines(n){for(let i=0;i<n;i++){hook.source({text:'台詞の'+i+'番目です。よろしくお願いします。',sourceName:'EmbedKrkrZ',origin:'live'},'');now+=3000;}}};}
const NOTICE=/从 MeguLit 游戏库启动游戏/;
test('a KiriKiri game started before MeguLit with no character records: told once after five lines',t=>{
 const f=fixture(t);f.lines(4);assert.equal(f.notes.filter(n=>NOTICE.test(n)).length,0);f.lines(6);assert.equal(f.notes.filter(n=>NOTICE.test(n)).length,1);
});
test('started from the library, or reporting boxes: never told',t=>{
 const a=fixture(t);a.hook.launchedPid=4242;a.lines(10);assert.equal(a.notes.filter(n=>NOTICE.test(n)).length,0);
 const b=fixture(t);b.hook.charRects('ToMe_CHARS engine=krkr line=100001 hidden=1 sw=1280 sh=720 vx=0 vy=0 vw=0 vh=0 n=2 rects=300,560,28,28;328,560,28,28 text=お客');b.lines(10);assert.equal(b.notes.filter(n=>NOTICE.test(n)).length,0);
});
test('library launches mark their process for the check',()=>{
 assert.match(fs.readFileSync(path.join(__dirname,'..','services','runtime.cjs'),'utf8'),/bindLaunched\(pid\)\{[^}]*h\.launchedPid=Number\(pid\)/);
});
