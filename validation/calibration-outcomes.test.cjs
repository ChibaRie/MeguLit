process.env.MEGULIT_RELAY_BASE??='off';/* tests never reach the real relay */
// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-19 (user, 素晴らしき日々 / BGI 1.647, windowed): "校准像一坨屎，黑字白描边变成全黑了", "莫名其妙点了校准之后字就不替换了".
   Log: the writable EmbedBGI stream was written back hidden until the first calibration showed the original; the font layer then saw
   GDI glyphs, one hit "proved" the glyph pass-through, every later line reached the game unchanged, and BGI, which keeps the glyphs it
   rasterised, left kana and common kanji on screen (some as the black outline pass alone). The calibration and the per-line pixel
   sample measured that leftover: black. Whatever a calibration ends with, the hide state is the one from before it. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {HookNative}=require('../core/hook-native.cjs');
const {HookControl}=require('../core/hook-control.cjs');
const {GameStyleSync,combine}=require('../core/game-style-sync.cjs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

function rig({placement=true,engine='krkr',publish=true}={}){
 const sent=[],hook=new HookNative({native:__dirname,hook:__dirname,logs:'Z:/no-fixture-log'},()=>{},()=>{},()=>1000);
 clearInterval(hook.timer);
 hook.send=m=>sent.push(m);hook.trace=()=>{};
 hook.ownTextFn=()=>placement;hook.compositedFn=()=>false;hook.pageMode=engine?{engine}:null;
 const state={bound:true,gameProcessId:123,gameStarted:'1',gameHwnd:'456',coverEnabled:true};
 const preferences={hookProfile:'embed',hookHide:true,hookAutoStart:true,bindEnabled:true,maskMode:'hook',autoGameStyle:true};
 hook.process={kill(){}};hook.pid=123;hook.started='1';hook.enabled=true;hook.route='embed';
 const style={statuses:[],status(s){this.statuses.push(s);},begin(){},request(){},publish(){return publish;},cancel(){this.cancelled=true;}};
 const host={state,preferences,hooks:hook,styleSync:style,onEvent(){},notify(){},send(){},save(){}};
 const control=new HookControl(host,()=>1000);control.plan='embed';control.running=true;
 hook.configure(preferences,state);sent.length=0;
 return {hook,control,style,sent,switches:()=>sent.filter(m=>m.type==='enable'||m.type==='disable'),hide:()=>({enabled:hook.enabled,route:hook.route,preflight:hook.preflight,calibrating:hook.calibrating===true})};
}
const outcomes={
 'measured':r=>r.control.finishStyleSync(true),
 'not found':r=>r.control.finishStyleSync(false),
 'cancelled by the user':r=>r.control.finishStyleSync(false,true),
 'cancelled twice':r=>{r.control.finishStyleSync(false,true);r.control.finishStyleSync(false,true);},
 'the game was closed and started again':r=>{r.control.host.state.gameStarted='2';r.control.finishStyleSync(false);r.control.host.state.gameStarted='1';},
};
for(const engine of ['krkr','']) for(const placement of [true,false]) for(const manual of [true,false]) for(const [name,end] of Object.entries(outcomes)){
 test('a calibration that ends "'+name+'" leaves hiding as it was ('+(engine||'no engine page')+', '+(placement?'overlay placement':'reader box')+', '+(manual?'manual':'automatic')+')',()=>{
  const r=rig({engine,placement});const before=r.hide();
  r.control.beginStyleSync(manual,'all');
  assert.deepEqual(r.switches(),[{type:'disable',reason:'reader-preflight'}],'every hide layer gives way while the probe measures');
  end(r);
  if(name==='the game was closed and started again'){assert.equal(r.hook.preflight,false);assert.equal(r.hook.calibrating===true,false);return;} /* another process: its own start decides */
  assert.deepEqual(r.hide(),before,'hide state after = hide state before');
  assert.deepEqual(r.switches().map(m=>m.type),['disable','enable'],'one give-way, one return; nothing in between, nothing after');
 });}
test('a second calibration started while one runs does not leave the first one\'s give-way behind',()=>{const r=rig();const before=r.hide();
 r.control.beginStyleSync(true,'all');r.control.beginStyleSync(true,'text');r.control.finishStyleSync(false);
 assert.deepEqual(r.hide(),before);assert.equal(r.switches().at(-1).type,'enable');assert.equal(r.switches().filter(m=>m.type==='disable').length,1);});

test('a fill as dark as the outline it is drawn with is a mis-measure: the colours stay, position and size apply',()=>{
 assert.equal(combine.darkOnDark({textColor:'#0b0b10'},{japaneseOutline:true,japaneseOutlineColor:'#000000',shadow:'outline'}),'#000000');
 assert.equal(combine.darkOnDark({textColor:'#0b0b10'},undefined),'#000000','the default outline is black');
 assert.equal(combine.darkOnDark({textColor:'#fefefe'},{japaneseOutlineColor:'#000000'}),'','light text on a dark outline: the common case');
 assert.equal(combine.darkOnDark({textColor:'#101010'},{japaneseOutlineColor:'#ffffff'}),'','black text with a white outline is readable');
 assert.equal(combine.darkOnDark({textColor:'#101010'},{japaneseOutline:false,japaneseOutlineColor:'#000000'}),'','black text without an outline (light text box)');
 assert.equal(combine.darkOnDark({textColor:'#101010'},{shadow:'none',japaneseOutlineColor:'#000000'}),'');
 assert.equal(combine.darkOnDark({textColor:'#703020'},{japaneseOutlineColor:'#000000'}),'','a dark red is a colour, not a mis-measure');
 const sample=(color,read)=>({read,lineKind:'narration',style:{x:10,y:70,width:60,height:10,japaneseSize:30,japaneseSpacingPx:0,lineHeight:1.4,textColor:color},width:1280,height:720,inkHeight:30,advance:30,lineStep:42,wrapWidth:700,inkLeft:130,inkTop:500,rows:1});
 const sync=new GameStyleSync({native:__dirname,config:null},()=>{},()=>null);sync.p={textColor:'#f8f8f8',japaneseOutline:true,japaneseOutlineColor:'#000000',shadow:'outline'};
 const statuses=[];sync.status=(s,x)=>statuses.push({s,x});
 sync.samples=[sample('#07070a',false)];
 {assert.equal(sync.publish(),true);const st=sync.latest.style;
  for(const k of ['textColor','narrationTextColor','speechTextColor','readTextColor'])assert.equal(st[k],undefined,k+' is not written');
  assert.equal(sync.latest.colourRejected,true);assert.equal(sync.rejected.textColor,'#07070a');assert.ok(Number.isFinite(st.x)&&Number.isFinite(st.japaneseSize),'position and size still apply');}
 sync.samples=[sample('#fdfdfd',false)];
 {assert.equal(sync.publish(),true);assert.equal(sync.latest.style.textColor,'#fdfdfd');assert.equal(sync.latest.colourRejected,undefined);}
 assert.ok(combine([sample('#fdfdfd',false)]),'the fixture sample is a valid one');});

test('no per-line pixel sample while MeguLit hides the game text: what is found then is a leftover of the hide',()=>{
 const sync=new GameStyleSync({native:__dirname,config:null},()=>{},()=>null);sync.lineDelay=0;sync.configure({autoGameStyle:true},{bound:true,gameHwnd:'100',gameProcessId:7,gameStarted:1});
 try{assert.equal(sync.lineStyle('当たり前と言えば当たり前……、',true,true),false);assert.equal(sync.lineStyle('当たり前と言えば当たり前……、',true,false),true);}finally{sync.stop();}
 assert.ok(read('core/gal-native.cjs').includes("this.styleSync.lineStyle(message.hookSource,message.hookSourceOrigin!=='history',this.hooks.enabled===true&&this.hooks.preflight!==true);"));});

test('the glyph pass-through is taken back by a cache report or two lines with unblanked glyphs; the writable stream is written back hidden again',()=>{const hb=read('native/HookBridge.cs');
 const ok=hb.slice(hb.indexOf('public static bool GlyphAllOk(string text){'));
 assert.ok(ok.indexOf('if(GlyphPassLeaked)return false;')>0&&ok.indexOf('if(GlyphPassLeaked)return false;')<ok.indexOf('if(GlyphProven)return true;'),'the verdict outranks the proof');
 assert.ok(hb.includes('static void GlyphAllProof(string by){if(GlyphProven||GlyphPassLeaked)return;'),'a later hit does not prove it again');
 assert.ok(hb.includes('if(GlyphMode!="dot")GlyphPassLeak("cache "+s.Substring(6));'),'the cache report on the dots channel counts in blank mode');
 assert.ok(hb.includes('static void GlyphReport(string s){Diagnostic("glyph hide "+s);GlyphLineReport(s);'));
 assert.ok(hb.includes('if(Interlocked.Increment(ref GlyphLeakLines)>=2)GlyphPassLeak('));
 assert.ok(hb.includes('if(!GlyphLeakSelfTest()){'));
 /* the recorded lines of that session */
 assert.ok(hb.includes('GlyphLineReport("line seq=6 chars=13 placed=2 hidden=2 requested=3 repeat=2 missing=2");')&&hb.includes('GlyphDots("cache seq=15 missing=3 of 3");'));});

test('discarding the new settings also drops the colour painted on the current sentence; the probe knows white text on a light sky',()=>{
 assert.ok(read('web/reader/modules/game-style-sync-ui.js').includes('const before=session.cancel();apply(before.prefs,before.map);/* the colour painted on the current sentence from a sample taken during the discarded calibration goes with it */b.lineColorReset?.();'));
 assert.ok(read('native/GameStyleProbe.cs').includes('new[]{Color.FromArgb(120,170,230),Color.White,Color.FromArgb(16,16,24)},new[]{Color.FromArgb(190,215,240),Color.FromArgb(250,250,250),Color.Black}};'));});
