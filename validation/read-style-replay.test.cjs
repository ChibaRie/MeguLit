// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Read / unread styles, replayed without a game (validation/helpers/read-style-replay/*.jsonl, one JSON object per row):
     meta    what the recording is (engine, kind synthetic|live, game)
     line    a raw engine record as the game side wrote it (ToMe_KRKR / ToMe_RENPY begin|end ... [color=] [paint=] [text=]),
             parsed like native/HookBridge.cs PageInfo and routed through the real HookNative
     source  the hook text of the sentence
     status  a reader status message (hookSourceRead + hookSourceReadOrigin; with text it also carries that sentence)
     sample  the game's own pixels for the sentence on screen (core/line-pixels.cjs result)
     expect  what the reader paints now: color (#rrggbb / #rrggbbaa, null = no override), edge (null = the saved outline)
     expectPos live recordings: the game's pixel colour of that step (pixel), which the colour handed to the reader must match
     expectNot a colour the reader must not show now
   A live recording is replayed by the same driver. */
process.env.MEGULIT_RELAY_BASE??='off';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {HookNative}=require('../core/hook-native.cjs');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),dir=path.join(__dirname,'helpers','read-style-replay');
const pageInfo=s=>{const m=/^ToMe_(KRKR|RENPY) (begin|end) line=(\d+) same=([01]) nvl=([01]) x0=(-?\d+) y0=(-?\d+) x1=(-?\d+) y1=(-?\d+) size=(\d+) sw=(\d+) sh=(\d+) n=(\d+)(?: color=([0-9a-f]{6}))?(?: paint=([0-9a-fes:,.\-]{1,120}))?(?: text=(.*))?$/.exec(s);if(!m)return null;
 return {type:'hookEngineLine',engine:m[1].toLowerCase(),phase:m[2],line:+m[3],same:m[4]==='1',nvl:m[5]==='1',x0:+m[6],y0:+m[7],x1:+m[8],y1:+m[9],size:+m[10],sw:+m[11],sh:+m[12],count:+m[13],color:m[14]?'#'+m[14]:null,paint:m[15]||null,text:(m[16]||'').replace(/\x1f/g,'\n')};};
function reader(t,prefs={}){
 t.mock.timers.enable({apis:['setTimeout']});
 const classes=new Set(),vars=new Map(),preferences={textColor:'#fffaf2',readTextColor:'',autoGameStyle:true,...prefs};
 const document={documentElement:{style:{setProperty:(k,v)=>vars.set(k,v),removeProperty:k=>vars.delete(k)}},head:{append(){}},
  body:{classList:{toggle(c,on){on?classes.add(c):classes.delete(c);},contains:c=>classes.has(c)}},querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({}),addEventListener(){}};
 const b={galStatus(){},galPreferences:()=>preferences,galLayoutInfo:()=>({clientWidth:1280,clientHeight:720}),previewGalPosition(){}};
 const window={__tomoyoChinese:b,devicePixelRatio:1,__tomoyoTranslateRequest(){}};
 const ctx={window,document,MutationObserver:class{observe(){}},getComputedStyle:()=>({getPropertyValue:()=>'',fontSize:'28px'}),Date,setTimeout,clearTimeout};
 vm.createContext(ctx);vm.runInContext(read('web/reader/modules/game-style.js'),ctx);window.TomoyoGameStyle=ctx.TomoyoGameStyle;
 for(const f of ['island-source','hook-reader','text-position'])vm.runInContext(read('web/reader/modules/'+f+'.js'),ctx);
 let now=100000,lastPos=null;const route=m=>{if(m.type==='hookTextPos'){if(m.color||m.style)lastPos=m;b.textPosition(m);}else if(m.type==='lineStyleSample')b.lineStyleSample(m);else b.galStatus(m);};
 const hook=new HookNative({native:__dirname,hook:__dirname,logs:'Z:/no-read-style-log'},route,()=>{},()=>now);hook.trace=()=>{};hook.send=()=>{};t.after(()=>hook.stop());
 const paint=()=>({color:classes.has('tome-line-color')?vars.get('--tomoyo-gal-line-color'):null,edge:classes.has('tome-line-edge')?vars.get('--tomoyo-gal-line-edge'):null});
 return {b,window,classes,paint,
  play(row){
   if(row.t==='line'){const m=pageInfo(row.raw);assert.ok(m,'unparsed engine record: '+row.raw);hook.pageLine(m);}
   else if(row.t==='source'){now+=1000;hook.source({text:row.text,sourceName:'KiriKiriZ',origin:'live'},'');}
   else if(row.t==='status'){const {t:_,text,...m}=row;now+=1000;if(typeof text==='string')route({...m,hookSource:text,hookSequence:Math.round(now/1000)});else route(m);}
   else if(row.t==='sample')route({type:'lineStyleSample',sourceToken:window.TomeIslandSource.token(row.text),style:row.style});
   else if(row.t==='expect'){const p=paint();assert.equal(p.color,row.color,'fill of line '+row.line);assert.equal(p.edge,row.edge,'outline of line '+row.line);return 1;}
   else if(row.t==='expectPos'){/* live recordings: the colour the reader is given for the sentence equals the game's pixels of that step */
    assert.ok(lastPos,'no draw colour reached the reader for '+row.shot);const h=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)),x=h(lastPos.style?.fill||lastPos.color),y=h(row.pixel),d=Math.abs(x[0]-y[0])+Math.abs(x[1]-y[1])+Math.abs(x[2]-y[2]);
    assert.ok(d<=48,row.shot+' '+row.text+': reader '+(lastPos.style?.fill||lastPos.color)+' vs game pixels '+row.pixel);if(lastPos.style)assert.equal(lastPos.style.fill,lastPos.color);return 1;}
   else if(row.t==='expectNot'){assert.notEqual(paint().color,row.color,'line '+row.line+' must not show '+row.color);}
   return 0;}};
}
const fixtures=fs.readdirSync(dir).filter(f=>f.endsWith('.jsonl')).sort();
const rowsOf=f=>read(path.join('validation','helpers','read-style-replay',f)).split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));
for(const f of fixtures)test('read-style replay: '+f,t=>{const rows=rowsOf(f),meta=rows[0],r=reader(t,meta.prefs||{});let checked=0;for(const row of rows.slice(1))checked+=r.play(row);assert.ok(checked>=(meta.min||20),'at least '+(meta.min||20)+' sentences are checked ('+checked+')');});
test('the four cases are present: colour switch, no distinction, dimming, flag + pixels',()=>{for(const n of ['colour-read-to-unread','no-distinction','no-evidence','dim-read-to-unread','flag-and-pixels'])assert.ok(fixtures.includes(n+'.jsonl'),n);});
test('furigana and the base text read the same per-line variables',()=>{const css=read('web/reader/modules/gal.js');
 assert.ok(css.includes('.megulit-ruby-base[data-tomoyo-reading]::before { -webkit-text-fill-color:var(--tomoyo-gal-color'));
 assert.ok(css.includes('body.tome-line-edge .sentence-window:not(.tome-island-page) { --tomoyo-jp-stroke-color:var(--tomoyo-gal-line-edge); --tomoyo-ruby-stroke-color:var(--tomoyo-gal-line-edge); }'));});
test('a read sample never paints an unread sentence and the memory ends with the game session',t=>{const r=reader(t);
 r.play({t:'status',hookSourceRead:true,hookSourceReadOrigin:'engine',text:'既読の一行目の文章です。'});r.play({t:'sample',text:'既読の一行目の文章です。',style:{fill:'#b0e2ff',alpha:.5,edge:'#102030',edgeAlpha:1}});
 assert.deepEqual(r.paint(),{color:'#b0e2ff80',edge:'#102030'});
 r.play({t:'status',hookSourceRead:false,hookSourceReadOrigin:'engine',text:'未読の二行目の文章です。'});assert.deepEqual(r.paint(),{color:null,edge:null},'no unread sample yet: the saved colours, not the read one');
 r.play({t:'status',hookSourceRead:true,hookSourceReadOrigin:'engine',text:'既読の三行目の文章です。'});assert.deepEqual(r.paint(),{color:'#b0e2ff80',edge:'#102030'},'same state: last reliable sample');
 r.play({t:'status',hookSourceRead:true,hookSourceReadOrigin:'tome-history',text:'履歴だけが既読と言う文章です。'});assert.equal(r.paint().color,null,'the reader\'s own history is not the game\'s read state');
 r.b.galStatus({type:'gameClosed'});r.play({t:'status',hookSourceRead:true,hookSourceReadOrigin:'engine',text:'次の起動の既読の文章です。'});assert.equal(r.paint().color,null);});
test('paint field: malformed or absent parts are dropped, never guessed',()=>{
 assert.deepEqual(HookNative.paint('f:ffff00ff'),{fill:'#ffff00',alpha:1});assert.equal(HookNative.paint('f:ffff00'),null);assert.equal(HookNative.paint('e:000000ff:2'),null);assert.equal(HookNative.paint('f:ffff00ff,x:1'),null);
 assert.deepEqual(HookNative.paint('f:ffffff80,e:00000000:2'),{fill:'#ffffff',alpha:.502},'an outline at opacity 0 was not drawn');});
/* Per-sentence pixel samples (core/game-style-sync.cjs lineStyle): a stand-in helper answers like native/GameStyleProbe.exe. */
function pixelRig(t){const os=require('node:os'),{PassThrough}=require('node:stream'),{GameStyleSync}=require('../core/game-style-sync.cjs'),islandSource=require('../core/island-source.js');
 const native=fs.mkdtempSync(path.join(os.tmpdir(),'megulit-line-pixels-'));fs.writeFileSync(path.join(native,'GameStyleProbe.exe'),'');t.after(()=>fs.rmSync(native,{recursive:true,force:true}));
 const requests=[],events=[],stdout=new PassThrough();const child={stdin:{write:l=>requests.push(JSON.parse(l)),on(){},end(){}},stdout,on(){},kill(){}};
 const sync=new GameStyleSync({native,config:null},m=>events.push(m),()=>child);sync.lineDelay=0;sync.configure({autoGameStyle:true},{bound:true,gameHwnd:'100',gameProcessId:7,gameStarted:1});t.after(()=>sync.stop());
 const wait=()=>new Promise(r=>setTimeout(r,15)),answer=(id,style)=>{stdout.write(JSON.stringify({id,result:style?{valid:true,style}:{valid:false,reason:'source not found'}})+'\n');return wait();};
 return {sync,requests,events,wait,answer,token:s=>islandSource.token(s),samples:()=>events.filter(m=>m.type==='lineStyleSample')};}
test('pixel sample: each sentence is measured for itself from the game window and never from the reader layer',async t=>{const r=pixelRig(t);
 assert.equal(r.sync.lineStyle('既に読んだ台詞がここに表示されています。'),true);await r.wait();
 assert.equal(r.requests.length,1);assert.equal(r.requests[0].captureMode,undefined,'the game window alone, not the visible screen with MeguLit over it');assert.equal(r.requests[0].source,'既に読んだ台詞がここに表示されています。');
 await r.answer(r.requests[0].id,{textColor:'#FFE080',textEdgeColor:'#101010'});
 assert.deepEqual(r.samples().map(m=>({token:m.sourceToken,style:m.style})),[{token:r.token('既に読んだ台詞がここに表示されています。'),style:{fill:'#ffe080',alpha:1,edge:'#101010',edgeAlpha:1}}]);
 /* the next sentence starts while the previous answer is still out: the late answer is dropped, the new one is its own */
 r.sync.lineStyle('まだ読んでいない台詞がここに表示されています。');await r.wait();const first=r.requests.at(-1);
 r.sync.lineStyle('さらに次の未読の台詞がここに表示されています。');await r.answer(first.id,{textColor:'#ffffff'});
 assert.equal(r.samples().length,1,'an answer for an earlier sentence never paints the current one');});
test('pixel sample: a sentence the game does not draw gives no sample, and draw-call evidence switches sampling off',async t=>{const r=pixelRig(t);
 r.sync.lineStyle('隠された台詞はゲームの画面にありません。');await r.wait();await r.answer(r.requests[0].id,null);await new Promise(x=>setTimeout(x,950));
 assert.equal(r.requests.length,2,'one more look while the sentence may still be typing');await r.answer(r.requests[1].id,null);await new Promise(x=>setTimeout(x,950));
 assert.equal(r.requests.length,2);assert.equal(r.samples().length,0,'nothing is guessed');
 r.sync.evidence();assert.equal(r.sync.lineStyle('エンジンが描画色を報告している台詞です。'),false);assert.equal(r.sync.lineStyle('履歴から戻った台詞です。',false),false);
 r.sync.lineEvidenceAt=0;r.sync.lineStyle('グラデーションの台詞がここに表示されています。');await r.wait();await r.answer(r.requests.at(-1).id,{textColor:'#ffffff',textGradient:true,textGradientTop:'#ffffff',textGradientBottom:'#88aaff'});
 assert.equal(r.samples().length,0,'a gradient is left to the saved gradient style');});
