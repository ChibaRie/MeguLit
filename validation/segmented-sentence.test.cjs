// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-19 user (素晴らしき日々 BGI, 17:45): 「やっぱり……いい女には、たばこと屋上と……そしてヒラヒラ服だわね……」 is one sentence the game adds to
   its box one click at a time; the reader showed four sentences replacing each other and each its own translation piece.
   Not split by a commit: the reader never joined it (BGI sends no page reports; v1.4.16 left たばこと/屋上と to the game as
   labels). Replay of the live event order (hook-events 08:46:17-22Z, stream EmbedBGI, about 1.5 s apart) through
   HookNative.source with the game's real script and patch lines: the line grows, the next narration line is a new one, and
   every stage carries the translation of what is shown so far. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {Matcher}=require('../services/original-text.cjs');
const {SentencePieces,unfinished,continues}=require('../core/sentence-pieces.cjs');
const JA=["打","か","変","　街の喧噪の中に立っている時とは打って変わって、ここはとても静かだ……。","　こんな時間にこんな場所で過ごしている人間がいたとしたら……、","　それは間違いなく、サボりか、ニートか……、私だ。","yuki_000001","由岐","「ふぅ……」","yuki_000002_a","由岐","「やっぱり……いい女には、","ev0001_l","yuki_000002_b","たばこと","ev0001_l","yuki_000002_c","屋上と","yuki_000002_d","……そして\n","ev0001_l","ヒラヒラ服だわね……」","ev0001_l","　たばこの銘柄はマイナーなもの……誰も吸ってない様なものが好ましい。","bgm017","ev0001"];
const ZH=["打","  ","变","  跟站在街上的喧嚣中时截然不同，这里非常安静……。","  如果说有什么人会在这种时间在这种地方闲晃的话……","  那肯定要么是逃课的，要么是NEET……要不然，就是我。 ","yuki_000001","由岐","「呼……」","yuki_000002_a","由岐","「果然……好女人要有的是， ","ev0001_l","yuki_000002_b","烟、 ","ev0001_l","yuki_000002_c","楼顶 ","yuki_000002_d","……还有\n ","ev0001_l","轻飘飘的衣服呀……」","ev0001_l","  烟的品牌是小众向的……但我很喜爱这种不会有人抽的烟。 ","bgm017","ev0001"];
const flat=s=>String(s||'').replace(/\s+/g,'');
const tmp=p=>fs.mkdtempSync(path.join(os.tmpdir(),p));

function rig(){
 const {HookNative}=require('../core/hook-native.cjs'),events=[];let clock=1795075577000;
 const out=new PassThrough(),child=Object.assign(new EventEmitter(),{stdout:out,stdin:{write:()=>true,on(){}},kill(){}});
 const native=tmp('n-'),hook=tmp('h-');fs.writeFileSync(path.join(native,'HookBridge.exe'),'');for(const n of ['LunaHost64.dll','LunaHook32.dll','LunaHook64.dll'])fs.writeFileSync(path.join(hook,n),'');
 const h=new HookNative({native,hook,logs:tmp('l-')},e=>events.push(e),()=>child,()=>clock);clearInterval(h.timer);
 h.start({pid:process.pid,hwnd:'1',name:'BGI',started:'1234567890123'});h.process=child;h.send=()=>{};
 const m=new Matcher(JA,ZH);h.originalText={kind:'patch',resolve:text=>{const r=m.match(text);return r.japanese===undefined?r:{...r,translation:r.japanese,japanese:undefined};},near:()=>-1};
 const shown=[],translations=new Map();const notify=h.notify.bind(h);h.notify=s=>{if(typeof s.hookSource==='string'&&s.hookSource)shown.push(s.hookSource);return notify(s);};
 const emit=h.emit?.bind(h);h.emit=e=>{if(e?.type==='hookPatchTranslation')translations.set(flat(e.japanese),flat(e.chinese));return emit?.(e);};
 const feed=(text,gap=1500)=>{clock+=gap;h.source({type:'hookSource',text,sourceCode:'HS-1C@43B350:BGI.exe',sourceName:'EmbedBGI'},'EmbedBGI');};
 return {h,shown,translations,feed};
}

test('the four pieces grow one line; the narration line after it is a new line; every stage has its translation',()=>{
 const {shown,translations,feed}=rig();
 for(const piece of ['「ふぅ……」','「やっぱり……いい女には、','たばこと','屋上と','……そして\nヒラヒラ服だわね……」','　たばこの銘柄はマイナーなもの……誰も吸ってない様なものが好ましい。'])feed(piece);
 assert.deepEqual(shown.map(flat),['「ふぅ……」','「やっぱり……いい女には、','「やっぱり……いい女には、たばこと','「やっぱり……いい女には、たばこと屋上と','「やっぱり……いい女には、たばこと屋上と……そしてヒラヒラ服だわね……」','たばこの銘柄はマイナーなもの……誰も吸ってない様なものが好ましい。']);
 assert.equal(translations.get('「やっぱり……いい女には、'),'「果然……好女人要有的是，');
 assert.equal(translations.get('「やっぱり……いい女には、たばこと'),'「果然……好女人要有的是，烟、');
 assert.equal(translations.get('「やっぱり……いい女には、たばこと屋上と'),'「果然……好女人要有的是，烟、楼顶');
 assert.equal(translations.get('「やっぱり……いい女には、たばこと屋上と……そしてヒラヒラ服だわね……」'),'「果然……好女人要有的是，烟、楼顶……还有轻飘飘的衣服呀……」','the whole sentence carries the whole translation');
 assert.equal(translations.get('たばこの銘柄はマイナーなもの……誰も吸ってない様なものが好ましい。'),'烟的品牌是小众向的……但我很喜爱这种不会有人抽的烟。');
});

test('the last two pieces may come as two lines (the bridge did not join the \\x05 part): the sentence still grows',()=>{
 const {shown,translations,feed}=rig();
 for(const piece of ['「やっぱり……いい女には、','たばこと','屋上と','……そして\n','ヒラヒラ服だわね……」'])feed(piece);
 assert.equal(flat(shown.at(-1)),'「やっぱり……いい女には、たばこと屋上と……そしてヒラヒラ服だわね……」');
 assert.equal(translations.get(flat(shown.at(-1))),'「果然……好女人要有的是，烟、楼顶……还有轻飘飘的衣服呀……」');
});

test('only an open quotation grows: closed lines, narration, a new quotation and a long pause start a new line',()=>{
 assert.equal(unfinished('「やっぱり……いい女には、'),true);assert.equal(unfinished('「ふぅ……」'),false);assert.equal(unfinished('　空は、'),false,'narration without a quotation');
 assert.equal(unfinished('「何それ。'),false,'a sentence end');assert.equal(continues('たばこと'),true);assert.equal(continues('「次の台詞」'),false);assert.equal(continues('　地の文。'),false);
 let t=0;const p=new SentencePieces(()=>t);
 assert.equal(p.take('s','「あのね、'),'「あのね、');t+=1000;assert.equal(p.take('s','明日は'),'「あのね、明日は');
 t+=1000;assert.equal(p.take('s','明日は'),'「あのね、明日は','a redraw of the last piece adds nothing');
 t+=1000;assert.equal(p.take('other','雨だよ」'),'雨だよ」','another stream is not this sentence');
 const q=new SentencePieces(()=>t);q.take('s','「あのね、');t+=61000;assert.equal(q.take('s','明日は'),'明日は','a minute later it is a new line');
 const r=new SentencePieces(()=>t);r.take('s','「あのね、');assert.equal(r.take('s','「あのね、明日は'),'「あのね、明日は','an engine that sends the grown line itself is left as it is');
 const s=new SentencePieces(()=>t);s.take('s','「あのね、');s.reset();assert.equal(s.take('s','明日は'),'明日は','a page reset ends the sentence');
});

test('counter-examples: narration without a full stop, a new speaker, a closed 」 then a new 「」 never join',()=>{
 {const {shown,feed}=rig();for(const piece of ['そこに覆い被さる重く真っ青な空は','いつでも当たり前の姿を私達に見せてくれる'])feed(piece);
  assert.deepEqual(shown.map(flat),['そこに覆い被さる重く真っ青な空は','いつでも当たり前の姿を私達に見せてくれる'],'two narration lines without 。 stay two lines');}
 {const {shown,feed}=rig();for(const piece of ['「ふぅ……」','「やっぱり……いい女には、'])feed(piece);
  assert.deepEqual(shown.map(flat),['「ふぅ……」','「やっぱり……いい女には、'],'a closed 」 then a new 「 is a new line');}
 {const {h,shown,feed}=rig();feed('「やっぱり……いい女には、');h.speaker={text:'希実香',at:h.now()};feed('たばこと');
  assert.deepEqual(shown.map(flat),['「やっぱり……いい女には、','たばこと'],'a new speaker name before the piece starts a new line');}
 let t=0;const p=new SentencePieces(()=>t);
 assert.equal(p.take('s','「あのね、','由岐'),'「あのね、');t+=1000;assert.equal(p.take('s','明日は','希実香'),'明日は','another speaker');
 const q=new SentencePieces(()=>t);q.take('s','「あのね、','由岐');t+=1000;assert.equal(q.take('s','明日は','由岐'),'「あのね、明日は','the same speaker goes on');
 const r=new SentencePieces(()=>t);r.take('s','「あのね、');t+=1000;assert.equal(r.take('s','由岐「次の台詞」'),'由岐「次の台詞」','a name before a bracket opens a new line');
});

/* The same path for every engine: no engine or game name decides it (core/sentence-pieces.cjs is called from HookNative.source
   for every stream). Two other shapes: a KiriKiri-style stream sending each piece of a quotation, a Siglus-style stream that
   sends the grown sentence itself; and a KiriKiri counter-example. No script here: the translation is the reader's. */
function plain(sourceName,sourceCode){const r=rig();r.h.originalText=null;r.feed=(text,gap=1200)=>{r.h.now=(n=>()=>n)(r.h.now()+gap);r.h.source({type:'hookSource',text,sourceCode,sourceName},sourceName);};return r;}
test('any engine: KiriKiri-style pieces of one quotation grow one line, a Siglus-style grown line is kept as sent',()=>{
 {const {shown,feed}=plain('KiriKiri','HW-8@1E5C40:SenrenBanka.exe');for(const piece of ['「それでね、','明日の放課後、','屋上で待ってるから」','　芳乃はそう言って笑った。'])feed(piece);
  assert.deepEqual(shown.map(flat),['「それでね、','「それでね、明日の放課後、','「それでね、明日の放課後、屋上で待ってるから」','芳乃はそう言って笑った。']);}
 {const {shown,feed}=plain('SiglusEngine','HW-1C@5A1B20:SiglusEngine.exe');for(const piece of ['「ねえ、','「ねえ、聞いてる？」'])feed(piece);
  assert.deepEqual(shown.map(flat),['「ねえ、','「ねえ、聞いてる？」'],'the engine already sends the grown line: nothing is doubled');}
});
test('any engine, counter-example: two KiriKiri lines, each a closed quotation or narration, stay two lines',()=>{
 const {shown,feed}=plain('KiriKiri','HW-8@1E5C40:SenrenBanka.exe');
 for(const piece of ['「おはよう」','「今日もいい天気だね」','　空には雲ひとつない','　風が少し冷たい'])feed(piece);
 assert.deepEqual(shown.map(flat),['「おはよう」','「今日もいい天気だね」','空には雲ひとつない','風が少し冷たい']);
});
