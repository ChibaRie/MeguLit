'use strict';
/* 2026-11-19 (user, 素晴らしき日々 on the installed 1.4.17: 「一说话（有语音的句子）字就飞不见了，位置也一直乱跑」). Every voiced 「」 line
   had its first glyph exactly on the client's top edge (reader layoutDiagnostic firstGlyphTop = clientY, on the test copy too):
   its glyph boxes came from a buffer drawn at its own origin, above or on the client's top row. sane() clamped them into the
   client, the line went to the top of the game and learn() made that the anchor for the next estimated lines. Such boxes have
   no place now: the line keeps the reader's box and the anchor stays where the real lines are. Any engine. */
const test=require('node:test'),assert=require('node:assert/strict');
const {OverlayPlacement}=require('../core/overlay-placement.cjs');
const C=[1280,720];
test('sane: boxes above the client or all on its top row are no place; real boxes still are',()=>{
 assert.equal(OverlayPlacement.sane([[300,-40,28,28],[328,-40,28,28]],C),null,'above the client');
 assert.equal(OverlayPlacement.sane([[300,0,28,28],[328,0,28,28],[356,0,28,28]],C),null,'all on the top row');
 assert.deepEqual(OverlayPlacement.sane([[300,560,28,28],[328,560,28,28]],C),[[300,560,28,28],[328,560,28,28]]);
 assert.deepEqual(OverlayPlacement.sane([[300,0,28,28],[300,36,28,28]],C),[[300,0,28,28],[300,36,28,28]],'a page starting at the top with more rows is kept');
 assert.deepEqual(OverlayPlacement.sane([[300,-3,28,28],[328,-3,28,28],[300,30,28,28]],C)[0],[300,0,28,28],'a few px of bearing above the edge is still clamped');
});
function rig(){const traces=[],sent=[];const p=new OverlayPlacement({send:m=>sent.push(m),trace:t=>traces.push(t)});p.wanted=()=>true;
 p.configure({},{bound:true,layout:{clientWidth:C[0],clientHeight:C[1]}});return {p,traces,lines:()=>sent.filter(m=>m.type==='textPlace'&&!m.clear)};}
const dots=(text,x,y)=>[...text].map((ch,i)=>({i,ch,k:'d',h:28,a:28,at:{x:x+i*28,y,space:'c'}}));
test('glyph path: a voiced line drawn at a buffer origin keeps the reader box, the anchor stays on the real lines',()=>{
 const {p,traces,lines}=rig();
 p.glyph({seq:1,text:'金曜日の昼……。',dots:dots('金曜日の昼……。',300,560)});
 assert.ok(lines().at(-1).rects,'narration placed');const anchor={...p.anchorBox};
 p.glyph({seq:2,text:'「ふぅ……」',dots:dots('「ふぅ……」',40,0)});
 assert.equal(lines().at(-1).fallback,true,'voiced line: not at the top of the game');assert.deepEqual(p.anchorBox,anchor,'anchor not taught the top edge');
 assert.ok(traces.some(t=>t.includes('has no box on the game client')),JSON.stringify(traces));
 p.glyph({seq:3,text:'「ヒラヒラ服だわね」',dots:dots('「ヒラヒラ服だわね」',40,-36)});assert.equal(lines().at(-1).fallback,true,'above the client: no place');
 p.glyph({seq:4,text:'　たばこの銘柄',dots:dots('　たばこの銘柄',300,560)});assert.equal(lines().at(-1).rects[0][1],560,'the next real line is placed as before');
});
test('hook path (char rects from the engine): boxes above the client are no place either',()=>{
 const {p,lines}=rig();
 p.hook({type:'hookCharRects',engine:'krkr',line:1,hidden:true,sw:1280,sh:720,rects:[[300,-60,28,28],[328,-60,28,28]],text:'お客'});
 assert.equal(lines().at(-1).fallback,true);
});
