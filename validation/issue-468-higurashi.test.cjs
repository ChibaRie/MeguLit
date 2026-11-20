'use strict';
/* #468 ひぐらしのなく頃に解 (Unity, whole-page NVL, TextController.SetText): the hooked text always wins, every piece reaches the
   reader once and fast, and an OCR reading of the page the hook already gave is never a line (「最高潮」 read as 「最咼潮」).
   higurashi.jsonl: live HookBridge recording (ひぐらし 奉, same TextController). higurashi-ocr.jsonl: its first page plus what the
   art scan reads from that page 6 s later (two OCR glyph errors) and a picture card nothing hooked carries. */
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {replay}=require('./helpers/hook-replay.cjs'),{latency}=require('./helpers/unity-replay/latency.cjs'),{HookNative}=require('../core/hook-native.cjs');
const dir=path.join(__dirname,'helpers','unity-replay'),EXE='HigurashiEp01.exe';
const shown=r=>{const out=[];for(const e of r.events)if(e&&typeof e.hookSource==='string'&&e.hookSource&&e.hookSource!==out[out.length-1]?.text)out.push({text:e.hookSource,engine:e.hookSourceEngine});return out;};

test('comma pieces are never lost: each joins the rest of its sentence',()=>{
 const out=shown(replay(path.join(dir,'higurashi.jsonl'),{name:EXE})).map(l=>l.text);
 for(const s of ['どうせ引き裂かれるなら、身を引き裂かされる方がはるかにマシだと思った。','自分に言い聞かせるような、そんな涙声が…もうたまらなく馬鹿馬鹿しくて…。','なのに、…彼女のそれはまだ聞こえる気がする。','彼女に、俺のために流す涙がないのなら、俺にだって。'])
  assert.ok(out.includes(s),'missing '+s);
 /* a line once: no full line is shown twice */
 const full=out.filter(l=>/[。？！…]$/.test(l));assert.equal(new Set(full).size,full.length,'repeated line');
});

test('latency: every hooked piece is on the reader within 400 ms (skip bursts aside)',()=>{
 const o=latency(path.join(dir,'higurashi.jsonl'),EXE);
 const lost=o.filter(x=>x.ms==null).map(x=>x.text);
 assert.deepEqual(lost,['それなのに…痛み、目を潤ませてしまうのは…どうして？'],'only the line inside a 1 ms skip burst is passed over');
 for(const x of o)if(x.ms!=null)assert.ok(x.ms<=400,x.text+' '+x.ms+' ms');
});

test('an OCR reading of the hooked page never becomes a line; a picture card still does',()=>{
 const r=replay(path.join(dir,'higurashi-ocr.jsonl'),{name:EXE});
 const ocr=r.traces.filter(t=>/^ocr line "/.test(t));
 assert.ok(!ocr.some(t=>/浄かに|験がしい/.test(t)),'OCR page taken: '+ocr.join(' | '));
 assert.ok(r.traces.some(t=>/ocr line refused \(text the hook already gave\)/.test(t)),'refusal traced');
 assert.ok(ocr.some(t=>t.includes('昭和五十八年')),'picture card read');
});

test('hookOverlap tolerates OCR glyph errors and ignores unrelated text',()=>{
 const now=1e6,recent=[{key:'その瞬間が最高潮だった。',at:now-1000}];
 assert.ok(HookNative.hookOverlap('その瞬間が最咼潮だった。',recent,now)>=0.5);
 assert.ok(HookNative.hookOverlap('昭和五十八年、初夏',recent,now)<0.5);
 assert.equal(HookNative.hookOverlap('その瞬間が最咼潮だった。',[{key:'その瞬間が最高潮だった。',at:now-700000}],now),0,'older than ten minutes');
});

test('a game read by OCR at runtime is a probe problem even when the static probe said ok',()=>{
 const fs=require('node:fs'),os=require('node:os'),probe=require('../services/adapter-probe.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'m468-'));
 try{
  fs.mkdirSync(path.join(root,'data','adapter-probe'),{recursive:true});
  fs.writeFileSync(probe.fileOf(root),JSON.stringify({version:1,results:{g1:{step:'ok',title:'ひぐらし'},g2:{step:'ok',title:'other'}}}));
  assert.deepEqual(probe.problems(root),[]);
  assert.equal(probe.markRuntime(root,'g1','ocr-fallback','reader lines came from OCR'),true);
  assert.equal(probe.markRuntime(root,'g1','ocr-fallback'),false,'once');
  assert.deepEqual(probe.problems(root).map(p=>[p.id,p.step]),[['g1','ocr-fallback']]);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
