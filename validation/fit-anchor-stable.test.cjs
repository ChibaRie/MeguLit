'use strict';
/* 2026-11-19 (千恋＊万花 maximised, user: 「位置又开始到处跑」): with the box at y 82 % every two- and three-row sentence moved its
   first row up 45-65 px (textTop 852 -> 808 -> 787) and short ones dropped back, because the fit pass moved the whole block
   up whenever Japanese + translation crossed the client bottom. The first row now keeps its anchor like the game's own text:
   the translation shrinks (to 60 %) and then scrolls; the block moves up only as far as the Japanese alone crosses the limit,
   and only for that sentence. Rows: 87.6 px, ruby padding 18.9 px, translation 46 px per row (the recorded live values). */
const test=require('node:test'),assert=require('node:assert/strict');const fit=require('../web/reader/modules/game-fit.js');
const client={top:0,bottom:1080},ROW=87.6,PAD=18.9,CN=46;
function place(anchor,rows,cnRows){let f=1,shift=0,room=0;
 for(let i=0;i<8;i++){const jp={top:anchor,bottom:anchor+PAD+rows*ROW},win={top:anchor,bottom:jp.bottom+cnRows*CN*f};const p=fit.plan(win,client,f,jp);
  if(p.fit===f&&p.shift===shift&&p.room===room)break;f=p.fit;shift=p.shift;room=p.room;}
 return {textTop:anchor+shift,fit:f,room};}
const SEQ=[1,2,1,3,2,1,1,2,3,1,2,2,1,3,1,2,1,1,2,3];
test('20 sentences of one to three rows: the first row stays on its anchor, the translation gives way',()=>{
 const tops=SEQ.map(r=>place(756,r,r).textTop);assert.deepEqual([...new Set(tops)],[756],JSON.stringify(tops));
 const low=SEQ.filter(r=>r<=2).map(r=>place(852,r,r));assert.deepEqual([...new Set(low.map(x=>x.textTop))],[852],'box at 82 %: one and two rows never move');
 assert.ok(low.some(x=>x.fit<1||x.room>0),'the translation is what gives way at 82 %');
});
test('a sentence too long for the room below moves up only by what the Japanese needs, and the next one is back on its anchor',()=>{
 const long=place(852,3,3);assert.ok(long.textTop<852&&long.textTop>=852-(PAD+3*ROW-(1080-4-852)),JSON.stringify(long));
 assert.equal(Math.round(852-long.textTop),Math.round(852+PAD+3*ROW-(1080-4)));
 assert.equal(place(852,1,1).textTop,852);
});
test('without the Japanese extent the old rule still applies (callers that pass only the block)',()=>{
 assert.deepStrictEqual(fit.plan({top:700,bottom:1100},client,fit.MIN),{fit:fit.MIN,shift:-24,room:0});
});
