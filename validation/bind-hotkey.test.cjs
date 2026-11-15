'use strict';
/* 2026-11-15 (user: alt+m从开关主页的快捷键改一下 改成绑定当前游戏窗口的快捷键): Alt+M binds the window in front through the
   same bind as the Alt+T window picker, refuses MeguLit itself, the desktop and Explorer with a hint, says 「已绑定：<标题>」
   once the bridge reports that window bound, and nothing in the UI still calls Alt+M the home toggle. Offline only. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const lib=require('../services/bind-hotkey.cjs');
const fake=()=>{const calls=[];return {calls,reader:{gal:{preferences:{fontSize:30,bindEnabled:false},bind:(hwnd,settings)=>calls.push({hwnd,settings})},translator:()=>({clearContext:()=>calls.push('clear')})}};};

test('Alt+M: only a real game window in front is bound',()=>{
 const game={hwnd:'4523',pid:900,title:'さくらの詩',className:'SakuraWindow',processName:'sakura',own:false};
 assert.equal(lib.classify(game),'ok');
 assert.equal(lib.classify({...game,own:true}),'own');
 assert.equal(lib.classify({...game,processName:'MeguLit'}),'own');
 assert.equal(lib.classify({...game,processName:'msedgewebview2'}),'own');
 assert.equal(lib.classify({...game,className:'Progman',processName:'explorer'}),'desktop');
 assert.equal(lib.classify({...game,className:'WorkerW',processName:'explorer'}),'desktop');
 assert.equal(lib.classify({...game,className:'Shell_TrayWnd',processName:'explorer'}),'desktop');
 assert.equal(lib.classify({...game,className:'CabinetWClass',processName:'explorer'}),'explorer');
 assert.equal(lib.classify({...game,hwnd:'0'}),'none');
 assert.equal(lib.classify({...game,hwnd:'abc'}),'none');
});

test('Alt+M binds like the window picker and reports 「已绑定：<标题>」 when that window is bound',()=>{
 const {calls,reader}=fake(),out=[];
 assert.equal(lib.request(reader,{type:'bindHotkey',hwnd:'4523',title:'さくらの詩',className:'SakuraWindow',processName:'sakura'},e=>out.push(e),'zh'),true);
 const bind=calls.find(c=>c.hwnd);assert.equal(bind.hwnd,'4523');assert.equal(bind.settings.bindEnabled,true);assert.equal(bind.settings.fontSize,30,'current reader settings go with the bind');
 assert.ok(calls.includes('clear'),'translation context restarts for the new game');assert.equal(out.length,0,'nothing said before the bridge confirms');
 lib.follow(reader,{type:'bound',gameHwnd:'999',gameTitle:'other'},e=>out.push(e),'zh');assert.equal(out.length,0,'another window bound is not this one');
 lib.follow(reader,{type:'bound',bound:true,gameHwnd:'4523',gameTitle:'さくらの詩 ver1.0'},e=>out.push(e),'zh');
 assert.deepEqual(out,[{type:'bindHotkeyResult',ok:true,kind:'bound',title:'さくらの詩 ver1.0',message:'已绑定：さくらの詩 ver1.0'}]);
 assert.equal(reader.hotkeyBind,null);
 lib.follow(reader,{type:'bound',gameHwnd:'4523'},e=>out.push(e),'zh');assert.equal(out.length,1,'said once');
});

test('Alt+M refuses MeguLit, the desktop and Explorer with a hint in the UI language, and reports a failed bind',()=>{
 for(const [m,word] of [[{hwnd:'7',processName:'MeguLit',own:true},'MeguLit'],[{hwnd:'7',className:'Progman',processName:'explorer'},'桌面'],[{hwnd:'7',className:'CabinetWClass',processName:'explorer'},'资源管理器']]){
  const {calls,reader}=fake(),out=[];assert.equal(lib.request(reader,{type:'bindHotkey',...m},e=>out.push(e),'zh'),false);
  assert.equal(calls.length,0,'nothing bound');assert.equal(out[0].ok,false);assert.match(out[0].message,new RegExp(word));assert.match(out[0].message,/Alt\+M/);}
 const out=[];lib.request(fake().reader,{hwnd:'7',className:'Progman',processName:'explorer'},e=>out.push(e),'ja');assert.match(out[0].message,/デスクトップ/);
 lib.request(fake().reader,{hwnd:'7',className:'CabinetWClass',processName:'explorer'},e=>out.push(e),'en');assert.match(out[1].message,/File Explorer/);
 const {reader}=fake(),fail=[];lib.request(reader,{hwnd:'55',title:'x',processName:'game'},e=>fail.push(e),'zh');lib.follow(reader,{type:'error',message:'请选择有效的游戏窗口'},e=>fail.push(e),'zh');
 assert.equal(fail[0].ok,false);assert.equal(fail[0].message,'绑定失败：请选择有效的游戏窗口');
 const none=[];lib.request({gal:null},{hwnd:'55',processName:'game'},e=>none.push(e),'en');assert.equal(none[0].kind,'busy');
});

test('the native hotkey reports the window in front, the service binds it, the home toggle is gone',()=>{
 const cs=read('native/GalWindowBridge.cs');
 assert.match(cs,/wParam\.ToUInt64\(\)==0x543\)\{BindHotkey\(\);\}/,'Alt+M runs BindHotkey');
 assert.match(cs,/static void BindHotkey\(\)\{[^\n]*GetForegroundWindow\(\)[^\n]*GetAncestor\(fg,2\)/);assert.match(cs,/type="bindHotkey",hwnd=/);
 assert.doesNotMatch(cs,/type="homeHotkey"/);
 assert.match(read('core/gal-native.cjs'),/message\.type==='bindHotkey'\)\) \{ this\.onEvent\(message\)/);
 const reader=read('services/reader.cjs');assert.match(reader,/message\.type==='bindHotkey'\)\{require\('\.\/bind-hotkey\.cjs'\)\.request/);assert.doesNotMatch(reader,/home-toggle/);
 assert.match(read('web/reader/bootstrap.js'),/bindHotkeyResult'\)\{b\.bindHotkeyResult/);assert.match(read('web/reader/modules/gal.js'),/bridge\.bindHotkeyResult = message =>/);
 assert.match(read('web/app.js'),/type==='bindHotkeyResult'\)\{if\(!document\.hidden/);
});

test('every Alt+M label says it binds the current window (zh / ja / en), none calls it the home toggle',()=>{
 const files=['web/reader/modules/menu-layout.js','web/reader/modules/polish.js','web/reader/modules/settings.js','web/reader/modules/i18n.js','web/guide-content.js','site/public/assets/js/guide.js','native/GalWindowBridge.cs'];
 for(const f of files){const s=read(f);assert.doesNotMatch(s,/Alt\+M[^'"\n]{0,12}(开关主页|开关 MeguLit 主页|显示／隐藏 MeguLit 主页|切换翻译文本框|切换普通界面)/,f);assert.doesNotMatch(s,/k\('M'\) \+ ' (显示 \/ 隐藏 MeguLit 主页|MeguLit ホームの表示|shows or hides the MeguLit home)/,f);}
 assert.match(read('web/reader/modules/polish.js'),/<kbd>Alt\+M<\/kbd>绑定当前窗口/);
 assert.match(read('web/reader/modules/menu-layout.js'),/Alt\+M 绑定当前窗口 · Alt\+T/);
 assert.match(read('web/reader/modules/settings.js'),/Alt\+M 绑定当前游戏窗口，Alt\+T 开关菜单/);
 const i18n=read('web/reader/modules/i18n.js');for(const k of ['绑定当前窗口','Alt+M 绑定当前游戏窗口，Alt+T 开关菜单','Alt+M 绑定当前窗口 · Alt+T 开关菜单 · 拖动即时预览'])assert.ok(i18n.includes(`'${k}':[`),'i18n en/ja for '+k);
 const guide=read('web/guide-content.js');assert.equal((guide.match(/\['Alt\+M', '/g)||[]).length,3,'in-app guide lists Alt+M in zh, ja and en');
 const site=read('site/public/assets/js/guide.js');for(const w of ['把当前在前面的游戏窗口绑定给 MeguLit','前面のゲームウィンドウを MeguLit に割り当て','binds the game window in front to MeguLit'])assert.ok(site.includes(w),w);
});
