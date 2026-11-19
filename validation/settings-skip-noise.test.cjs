'use strict';
/* 2026-11-19 integration live runs (logs were overwritten by a restart; the frames below are the shapes the report recorded):
   - 千恋＊万花, back from the system settings "文本" page: the settings page's preview text went into the reader, the choice
     capture took the stage note 「■自動車（車内／走行）」 apart into the "options" 「自動車（車内」「走行）」, and the selection
     followed KiriKiriZ's per-character context (「「「「「「「「……「…)
   - ISLAND (CatSystem2): the Text page's typewriter preview 「テキスト表示サンプル」 was shown out of order as a line
   - 死に逝く君、館に芽吹く憎悪, Ctrl skip: the reader line was 「謎の男謎の男謎の男謎の男美亜美亜」 (names glued while skipping) */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const LineOnce=require('../core/line-once.js');
const {HookNative}=require('../core/hook-native.cjs');
const {ChoiceCapture}=require('../core/choice-capture.cjs');

function hookFixture(t){
 let now=1e6;const shown=[];
 const hook=new HookNative({native:__dirname,hook:__dirname,logs:'Z:/no-settings-noise-log'},m=>{if(typeof m?.hookSource==='string')shown.push(m.hookSource);},()=>{},()=>now);
 hook.trace=()=>{};hook.send=()=>{};hook.artLocate=()=>{};hook.process={stdin:{write(){},end(){}},kill(){}};t.after(()=>hook.stop());
 return {shown,hook,line(text,ms=1500){hook.source({text,sourceName:'KiriKiriZ',sourceCode:'HW-8*14:-8*0@F4600:SenrenBanka.exe',origin:'live'},'');now+=ms;}};
}

test('settings preview text is no dialogue, in order or typed out of order',()=>{
 for(const t of ['テキスト速度のサンプルと…','テキスト表示サンプル','サンテキスプト表ル示サンテプルキテキススト表ト示サン表プル示'])assert.equal(LineOnce.samplePreview(t),true,t);
 for(const t of ['このサンプルを見て','「テキストを読んで」','まだ大雑把な目的地しか伝えていなかったのを思い出した。'])assert.equal(LineOnce.samplePreview(t),false,t);
});

test('names glued while skipping stand for the last name; real lines are kept',()=>{
 assert.equal(LineOnce.nameStack('謎の男謎の男謎の男謎の男美亜美亜'),'美亜');
 assert.equal(LineOnce.nameStack('ムラサメムラサメ芳乃芳乃'),'芳乃');
 for(const t of ['時雨','美亜美亜','うんうん','そうそうだね','はいはいうんうん','ははは','将臣将臣ムラサメ','「あっ、はい」'])assert.equal(LineOnce.nameStack(t),'',t);
});

test('hook source: preview text and glued names never reach the reader; the next line does',t=>{
 const f=hookFixture(t);
 f.line('テキスト速度のサンプルと…');
 f.line('サンテキスプト表ル示サンテプルキテキススト表ト示サン表プル示');
 f.line('謎の男謎の男謎の男謎の男美亜美亜');
 assert.equal(f.shown.length,0,JSON.stringify(f.shown));
 assert.equal(f.hook.speaker?.text,'美亜');
 f.line('「あっ、はい。なんですか」');
 assert.equal(f.shown.at(-1),'「あっ、はい。なんですか」');
});

test('choice capture: a stage note cut at ■ and ／ gives no options; real options still do',()=>{
 const C=new ChoiceCapture(()=>1000);
 assert.deepEqual(C.add('■自動車（車内／走行）'),[]);
 assert.deepEqual(C.add('自動車（車内'),[]);assert.deepEqual(C.add('走行）'),[]);
 assert.deepEqual(C.add('テキスト速度のサンプルと'),[]);
 assert.deepEqual(C.add('はい／いいえ'),['はい','いいえ']);
 assert.deepEqual(new ChoiceCapture(()=>1000).add('上書きで何か吹き込む／（何もしない）'),['上書きで何か吹き込む','（何もしない）']);
});

test('HookBridge follows a new context of the selected hook only on a line that is not still being typed',()=>{
 const cs=fs.readFileSync(path.join(__dirname,'..','native','HookBridge.cs'),'utf8');
 assert.match(cs,/DialogueLike\(text\)&&!Typing\(sib\.prevSample,text\)/);
 assert.match(cs,/c\.prevSample=c\.sample;c\.sample=sample;/);
 const body=cs.slice(cs.indexOf('static bool Typing('),cs.indexOf('static bool DialogueLike('));
 const Typing=new Function('before','now',"if(!before||!now)return false;const a=before.replace(/…+$/,''),b=now.replace(/…+$/,'');return a.length>0&&b.length>0&&a!==b&&(b.startsWith(a)||a.startsWith(b));");
 assert.match(body,/b\.StartsWith\(a\)\|\|a\.StartsWith\(b\)/);
 assert.equal(Typing('「あっ、はい。なん','「あっ、はい。なんですか'),true);
 assert.equal(Typing('「あっ、はい。なんですか」','まだ大雑把な目的地しか伝えていなかった'),false);
 assert.equal(Typing('','「あっ、はい。なんですか」'),false);
});
