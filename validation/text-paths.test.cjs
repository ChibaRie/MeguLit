// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Text architecture ③ (docs/text-architecture.md): engines that do not take glyphs from Windows hide the current line
   themselves and report each character's box as ToMe_CHARS (core/text-paths.cjs). These tests cover the shared record,
   geometry, hidden confirmation and crash canary, the Ren'Py script against the stand-in Ren'Py, the KiriKiri script's
   record, the web path's switches and page script, and the HookBridge / hook-native wiring. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const TP=require('../core/text-paths.cjs'),W=require('../core/text-paths-web.cjs');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const tmp=()=>fs.mkdtempSync(path.join(process.env.MEGULIT_TEST_TMP||os.tmpdir(),'megulit-tp-'));

test('ToMe_CHARS round trip: one rect per drawn character, newlines kept in the text only',()=>{
 const line=TP.formatChars({engine:'krkr',line:7,hidden:true,sw:1280,sh:720,rects:[[60,80,28,28],[88,80,28,28],[60,118,28.5,28]],text:'一行\n目'});
 assert.equal(line,'ToMe_CHARS engine=krkr line=7 hidden=1 sw=1280 sh=720 vx=0 vy=0 vw=0 vh=0 n=3 rects=60,80,28,28;88,80,28,28;60,118,28.5,28 text=一行\x1f目');
 const r=TP.parseChars(line);
 assert.deepEqual([r.type,r.engine,r.line,r.hidden,r.sw,r.sh,r.text,r.rects.length],['hookCharRects','krkr',7,true,1280,720,'一行\n目',3]);
 assert.equal(TP.parseChars(line.replace('n=3','n=2')),null,'count must match');
 assert.equal(TP.parseChars(line.replace('text=一行\x1f目','text=一行')),null,'one rect per character');
 assert.equal(TP.parseChars(line.replace('engine=krkr','engine=other')),null,'known engines only');
 assert.equal(TP.parseChars('ToMe_KRKR end line=1'),null);
});

test('game screen -> client: engine viewport wins, otherwise aspect fit centred',()=>{
 const rec={sw:1280,sh:720,viewport:[0,0,0,0],rects:[[0,0,10,10],[1270,710,10,10]]};
 assert.deepEqual(TP.toClient(rec,1280,720),[[0,0,10,10],[1270,710,10,10]]);
 assert.deepEqual(TP.toClient(rec,1920,1200),[[0,60,15,15],[1905,1125,15,15]],'16:9 game in a 16:10 window: bars top and bottom');
 assert.deepEqual(TP.toClient({...rec,viewport:[100,0,640,360]},1920,1200),[[100,0,5,5],[735,355,5,5]]);
});

test('hidden: the latest record of a line decides; a path that never confirms stays read-only',()=>{
 const g=new TP.HiddenGate({grace:2});
 assert.equal(g.report({line:1,hidden:false}),false);assert.equal(g.report({line:1,hidden:true}),true);assert.equal(g.confirmed,true);
 assert.equal(g.report({line:1,hidden:false}),false,'drawn again (MeguLit went away): not hidden');
 g.report({line:2,hidden:false});g.report({line:3,hidden:false});assert.equal(g.confirmed,false);
});

test('crash canary: armed, died within 20 s -> off next launch; 20 s alive or a clean quit -> stays on',()=>{
 const dir=tmp(),exe=path.join(dir,'Game.exe');fs.writeFileSync(exe,'MZ');let now=1e6;const mk=()=>new TP.Canary(dir,exe,{now:()=>now});
 assert.equal(path.basename(mk().file),'Game.exe-2.json','same key as HookBridge MemoryPath (name-size)');
 let c=mk();c.settle();c.arm('web');now+=4000;c.alive('web');
 c=mk();assert.ok(c.settle().web,'left armed 4 s in');assert.equal(c.allowed('web'),false);
 c.reset('web');assert.equal(c.allowed('web'),true);
 c.arm('unity');now+=21000;c.alive('unity');c=mk();c.settle();assert.equal(c.allowed('unity'),true);
 c.arm('unity');c.exited('unity',0);assert.equal(c.allowed('unity'),true);
 c.arm('unity');c.exited('unity',-1073741819);assert.equal(c.allowed('unity'),false);assert.match(c.read().off.unity.reason,/-1073741819/);
 fs.rmSync(dir,{recursive:true,force:true});
 const cs=read('native/TextPathCanary.cs');assert.match(cs,/public const long SafeAfter=20000;/);assert.match(read('native/HookBridge.cs'),/TextPathCanary\.SelfTest\(\)/);
});

function python(){for(const [cmd,args] of [['python',['-I']],['py',['-3','-I']]]){const r=spawnSync(cmd,[...args,'-c','import sys;print(sys.version_info[0])'],{encoding:'utf8'});if(r.status===0&&r.stdout.trim()==='3')return [cmd,args];}return null;}
const py=python();
test('Ren\'Py: every located sentence (ADV too) sends its character boxes; the say Text is drawn at alpha 0 only while asked, and back at once',{skip:!py&&'no CPython 3 on PATH'},()=>{
 const r=spawnSync(py[0],[...py[1],path.join(root,'native/renpytext/selftest/host.py'),'--sink',path.join(root,'native/MeguLitRenpy.py')],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const lines=JSON.parse(r.stdout),chars=lines.filter(l=>l.startsWith('ToMe_CHARS ')).map(TP.parseChars);
 assert.ok(chars.every(Boolean),'every record parses');
 assert.deepEqual(chars.map(c=>[c.line,c.hidden,c.rects.length,c.text]),[[1,false,14,'春の風が吹いた。\n二行目です。'],[2,false,6,'漢字を読む。'],[3,true,6,'普通の台詞。'],[3,false,6,'普通の台詞。'],[4,false,5,'新しい頁。']],'line 3 sent again as drawn when MeguLit stops asking');
 assert.deepEqual(chars[0].rects.slice(0,2),[[120,80,28,38],[148,80,28,38]],'virtual pixels; width from the next glyph when the glyph has none');
 assert.deepEqual(chars[1].rects[0],[220,250,14,19],'zoomed branch scaled');
 assert.deepEqual(chars[2].rects[0],[160,550,24,34],'ADV line located too');
 assert.equal(lines.at(-1),'HOST alpha3=[0.0, 1.0]','alpha 0 while asked, 1 again the frame after MeguLit stops asking');
 const s=read('native/MeguLitRenpy.py');assert.match(s,/MeguLitRenpyHide-%d/);assert.match(s,/if not self\.connected:\s*\r?\n\s*return False/,'never hidden without the pipe to MeguLit');
});

test('KiriKiri: the TJS script reports each sentence\'s boxes at its end; hidden only after real opacity-0 draws; the DLL forwards ToMe_CHARS',()=>{
 const s=read('native/krkrtext/script.inc'),c=read('native/krkrtext/KrkrText.cpp'),h=read('native/krkrtext/selftest/host.cpp');
 assert.match(s,/rec\.rs\+=\(rec\.cn>0\?';':''\)\+int\(cx\)\+','\+int\(cy\)\+','\+int\(cw\)\+','\+int\(size\);rec\.cn\+\+;/);
 assert.match(s,/var h=\(this\.hid>rec\.h0 && this\.hideOn\(\)\)\?1:0;/);
 assert.match(s,/'ToMe_CHARS engine=krkr line='\+rec\.line\+' hidden='\+h/);
 assert.match(s,/if\(rec\.n>0\) \{this\.send\('end',rec,rec\.x0,rec\.x1\);try \{this\.chars\(rec\);\} catch\(e\) \{\}\}/,'a failing record never breaks the end line');
 assert.match(c,/wcsncmp\(text, L"ToMe_CHARS ", 11\) == 0 && len < 28000/);
 assert.match(h,/text architecture 3 char records/);
});

test('web: Chromium shells only, switches only, page script hides by one style rule and measures with getClientRects',()=>{
 const dir=tmp();const exe=path.join(dir,'Game.exe');fs.writeFileSync(exe,'');
 assert.equal(W.chromiumShell(exe),null);fs.writeFileSync(path.join(dir,'icudtl.dat'),'');assert.equal(W.chromiumShell(exe),null);
 fs.writeFileSync(path.join(dir,'nw.dll'),'');assert.equal(W.chromiumShell(exe),'nwjs');fs.rmSync(path.join(dir,'nw.dll'));
 fs.mkdirSync(path.join(dir,'resources'));fs.writeFileSync(path.join(dir,'resources','app.asar'),'');assert.equal(W.chromiumShell(exe),'electron');
 fs.rmSync(dir,{recursive:true,force:true});
 assert.deepEqual(W.launchArgs(9333),['--remote-debugging-port=9333','--remote-debugging-address=127.0.0.1','--remote-allow-origins=http://127.0.0.1:9333']);
 const p=W.PAGE_SCRIPT;new Function(p);
 for(const k of ['.message_inner','[data-content="dialog"]','[class*="TextBox_main"]'])assert.ok(p.includes(k),k);
 assert.match(p,/color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important/);
 assert.match(p,/r\.getClientRects\(\)/);assert.match(p,/devicePixelRatio/);assert.match(p,/closest\('rt,rp,script,style'\)/,'ruby left out');
 assert.doesNotMatch(p,/localStorage|indexedDB|\.save\(|writeFile/,'never touches game storage');
});

test('web path end to end over a fake DevTools page: report -> ToMe_CHARS, canary armed on the first hidden record',async()=>{
 const dir=tmp(),exe=path.join(dir,'g.exe');fs.writeFileSync(exe,'x');const canary=new TP.Canary(dir,exe);const out=[];
 const w=new W.WebTextPath({port:1,onChars:l=>out.push(TP.parseChars(l)),canary});
 w.report(JSON.stringify({line:1,hidden:false,sw:1280,sh:720,rects:[[1,2,3,4]],text:'あ'}));
 w.report(JSON.stringify({line:1,hidden:true,sw:1280,sh:720,rects:[[1,2,3,4]],text:'あ'}));
 assert.deepEqual(out.map(r=>[r.engine,r.line,r.hidden,r.viewport]),[['web',1,false,[0,0,1280,720]],['web',1,true,[0,0,1280,720]]]);
 assert.ok(canary.read().armed.web);w.exited(0);assert.equal(canary.read().armed.web,undefined);
 fs.rmSync(dir,{recursive:true,force:true});
});

test('HookBridge and hook-native: char records reach the front end as hookCharRects; Ren\'Py gets the engine hide',()=>{
 const b=read('native/HookBridge.cs');
 assert.ok(b.includes('if(line.StartsWith("ToMe_CHARS ",StringComparison.Ordinal)){if(line.Length<=28000)Emit(new{type="hookChars",line=line});continue;}'));
 assert.ok(b.includes('if(tag=="KRKR"||tag=="RENPY")StartEngineHide(tag);'));
 assert.ok(b.includes('if(!TextPathCanary.Allowed(path)){Diagnostic(path+" invisible drawing off for this game (crash canary): "'));
 assert.ok(b.includes('if(want)TextPathCanary.Arm(path);'));
 assert.ok(b.includes('TextPathCanary.Exited(GameProcess.ExitCode)'));
 assert.ok(read('native/Build-HookBridge.ps1').includes("'TextPathCanary.cs'"));
 const {HookNative}=require('../core/hook-native.cjs');const events=[];
 const hook=new HookNative({native:__dirname,hook:__dirname,logs:'Z:/no-fixture-log'},m=>events.push(m),()=>{},()=>5);hook.trace=()=>{};
 hook.charRects('ToMe_CHARS engine=renpy line=3 hidden=1 sw=1280 sh=720 vx=0 vy=0 vw=0 vh=0 n=2 rects=1,2,3,4;5,6,7,8 text=台詞');
 hook.charRects('ToMe_CHARS engine=renpy line=3 hidden=1 sw=1280 sh=720 vx=0 vy=0 vw=0 vh=0 n=3 rects=1,2,3,4;5,6,7,8 text=台詞');
 hook.stop();
 const got=events.filter(e=>e.type==='hookCharRects');assert.equal(got.length,1,'malformed record dropped');assert.deepEqual([got[0].type,got[0].engine,got[0].hidden,got[0].text],['hookCharRects','renpy',true,'台詞']);
});
