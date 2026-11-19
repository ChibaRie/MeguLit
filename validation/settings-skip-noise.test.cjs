'use strict';
/* 2026-11-19 integration live runs (logs were overwritten by a restart; the frames below are the shapes the report recorded):
   - 千恋＊万花, back from the system settings "文本" page: the settings page's preview text went into the reader, the choice
     capture took the stage note 「■自動車（車内／走行）」 apart into the "options" 「自動車（車内」「走行）」, and the selection
     followed KiriKiriZ's per-character context (「「「「「「「「……「…)
   - ISLAND (CatSystem2): the Text page's typewriter preview 「テキスト表示サンプル」 was shown out of order as a line
   - 死に逝く君、館に芽吹く憎悪, Ctrl skip: the reader line was 「謎の男謎の男謎の男謎の男美亜美亜」 (names glued while skipping) */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const LineOnce=require('../core/line-once.js');
const {HookNative}=require('../core/hook-native.cjs');
const {ChoiceCapture}=require('../core/choice-capture.cjs');

function hookFixture(t){
 let now=1e6;const shown=[];
 const hook=new HookNative({native:__dirname,hook:__dirname,logs:'Z:/no-settings-noise-log'},m=>{if(typeof m?.hookSource==='string')shown.push(m.hookSource);},()=>{},()=>now);
 hook.trace=()=>{};hook.send=()=>{};hook.artLocate=()=>{};hook.process={stdin:{write(){},end(){}},kill(){}};t.after(()=>hook.stop());
 return {shown,hook,line(text,ms=1500){hook.source({text,sourceName:'KiriKiriZ',sourceCode:'HW-8*14:-8*0@F4600:SenrenBanka.exe',origin:'live'},'');now+=ms;}};
}

/* the preview text is judged by state (the game's dialogue box hidden on a settings page), never by its words: the very same
   text arriving in the dialogue state is a line like any other */
function readerFixture(){let now=1e6;const b={galStatus(){}};const window={__tomoyoChinese:b};
 const document={documentElement:{},head:{append(){}},body:{classList:{toggle(){}}},querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({}),addEventListener(){}};
 const ctx={window,document,MutationObserver:class{observe(){}},Date:{now:()=>now},setTimeout,clearTimeout};vm.createContext(ctx);
 for(const f of ['line-once','island-source','hook-reader'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..','web','reader','modules',f+'.js'),'utf8'),ctx);
 let seq=0;return {b,wait(ms){now+=ms;},say(text){if(seq)b.hookPage({same:false});b.galStatus({hookActive:true,hookSource:text,hookSequence:++seq});},chars:()=>b.hookReaderStatus().chars};}
const PREVIEW='テキスト速度のサンプルと、オート速度のサンプルです。';
test('reader: preview text arriving while the dialogue box is hidden (settings page) is not taken, the same text in dialogue is',()=>{
 const f=readerFixture();
 f.say('まだ大雑把な目的地しか伝えていなかったのを思い出した。');const before=f.chars();
 f.b.galStatus({dialogVisible:false,reason:'marker'});f.wait(1500);
 f.say(PREVIEW);f.say('サンテキスプト表ル示サンテプルキテキススト表ト示サン表プル示');
 assert.equal(f.chars(),before,'the settings page text is not shown');assert.deepEqual([...f.b.hookPageLines()],[]);
 f.b.galStatus({dialogVisible:true});assert.equal(f.chars(),before,'nor drawn when the box comes back');
 f.say('「あっ、はい。なんですか」');assert.equal(f.chars(),'「あっ、はい。なんですか」'.length);
 const g=readerFixture();g.say(PREVIEW);assert.equal(g.chars(),PREVIEW.length,'in the dialogue state the same text is a line');
});
test('reader: a line arriving just as the box hides is still the line',()=>{
 const f=readerFixture();f.b.galStatus({dialogVisible:false,reason:'marker'});f.wait(100);
 f.say('「え？　あ、そうでしたね」');assert.equal(f.chars(),'「え？　あ、そうでしたね」'.length);
});

test('names glued while skipping stand for the last name; real lines are kept',()=>{
 assert.equal(LineOnce.nameStack('謎の男謎の男謎の男謎の男美亜美亜'),'美亜');
 assert.equal(LineOnce.nameStack('ムラサメムラサメ芳乃芳乃'),'芳乃');
 for(const t of ['時雨','美亜美亜','うんうん','そうそうだね','はいはいうんうん','ははは','将臣将臣ムラサメ','「あっ、はい」'])assert.equal(LineOnce.nameStack(t),'',t);
});

test('hook source: glued names never reach the reader; the next line does',t=>{
 const f=hookFixture(t);
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
