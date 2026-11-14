// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-14 月姬 v1.4 / v1.6 (Chinese NScripter builds) "can't be played": the patched engine draws GBK through TextOutA,
   LunaHook read it as Shift-JIS (half-width katakana noise), no stream was picked and the reader waited with no word why;
   importing a Japanese original skipped the script (0.txt). */
const test=require('node:test'),assert=require('node:assert'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const tmp=p=>fs.mkdtempSync(path.join(os.tmpdir(),p));
const ZH='*define\r\ngame\r\n*start\r\n;-BLOCK-1-\r\n　为了不让我听到，医生压低声音向护士交代着。\\r\n「知得留老师的授课」？@\r\n　外面的天气很不错，清凉的风，正宣告着夏天的终结。\\r\n';
const JA='*define\r\ngame\r\n*start\r\n　医者は僕に聞こえないように、声をひそめて看護婦に話している。\\r\n「シエル先生の授業」？@\r\n　外はいい天気で、涼しい風が夏の終わりを告げていた。\\r\n';
const gbk=s=>{const map=new Map(),dec=new TextDecoder('gbk');for(let a=0x81;a<=0xfe;a++)for(let b=0x40;b<=0xfe;b++){if(b===0x7f)continue;const c=dec.decode(Buffer.from([a,b]));if(c.length===1&&!map.has(c))map.set(c,[a,b]);}
 const out=[];for(const ch of s){const c=ch.codePointAt(0);if(c<0x80)out.push(c);else out.push(...map.get(ch));}return Buffer.from(out);};
const sjis=s=>require('../services/original-engines/kit.cjs').encodeSjis(s);
function game(text,enc,{dat=false}={}){const dir=tmp('nscr-');fs.writeFileSync(path.join(dir,'Tsukihime.exe'),Buffer.from('MZ'));let b=enc(text.repeat(20));
 if(dat){b=Buffer.from(b);for(let i=0;i<b.length;i++)b[i]^=0x84;fs.writeFileSync(path.join(dir,'nscript.dat'),b);}else fs.writeFileSync(path.join(dir,'0.txt'),b);return dir;}

test('the hook reads a Chinese NScripter build with code page 936, a Japanese one with 932',()=>{
 const ns=require('../services/original-engines/nscripter.cjs'),{hookCodepage}=require('../core/hook-codepage.cjs');
 const zh=game(ZH,gbk),zhDat=game(ZH,gbk,{dat:true}),ja=game(JA,sjis),none=tmp('none-');
 assert.strictEqual(ns.codepage(zh),'gbk');assert.strictEqual(ns.codepage(zhDat),'gbk');assert.strictEqual(ns.codepage(ja),'shift_jis');assert.strictEqual(ns.codepage(none),'');
 assert.strictEqual(hookCodepage(path.join(zh,'Tsukihime.exe')),936);assert.strictEqual(hookCodepage(path.join(zhDat,'Tsukihime.exe')),936);
 assert.strictEqual(hookCodepage(path.join(ja,'Tsukihime.exe')),932);assert.strictEqual(hookCodepage(path.join(none,'Game.exe')),932);assert.strictEqual(hookCodepage(''),932);
});

test('the bridge is told the code page once it reports the game program',()=>{
 const {HookNative}=require('../core/hook-native.cjs'),zh=game(ZH,gbk),sent=[];const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
 const out=new PassThrough(),child=Object.assign(new EventEmitter(),{stdout:out,stdin:{write:l=>{sent.push(JSON.parse(l));return true;},on(){}},kill(){}});
 const native=tmp('n-'),hook=tmp('h-');fs.writeFileSync(path.join(native,'HookBridge.exe'),'');for(const n of ['LunaHost64.dll','LunaHook32.dll','LunaHook64.dll'])fs.writeFileSync(path.join(hook,n),'');
 const h=new HookNative({native,hook,logs:tmp('l-')},()=>{},()=>child,()=>Date.now());clearInterval(h.timer);
 h.start({pid:process.pid,hwnd:'1',name:'Tsukihime',started:'1234567890123'});h.process=child;h.send=m=>sent.push(m);
 out.write(JSON.stringify({type:'hookProcess',path:path.join(zh,'Tsukihime.exe')})+'\n');
 return new Promise(r=>setTimeout(r,50)).then(()=>{assert.ok(sent.some(m=>m.type==='codepage'&&m.value===936),JSON.stringify(sent));});
});

test('with nothing selected, a stream of changing Chinese prose raises the Chinese-build notice',()=>{
 const {HookNative}=require('../core/hook-native.cjs'),events=[];const h=new HookNative({native:tmp('n-'),hook:tmp('h-'),logs:tmp('l-')},e=>events.push(e),()=>({}),()=>0);clearInterval(h.timer);
 const menu={id:'m',name:'DrawTextExW',sample:'画面字体显示形式文字速度声音快进到下一选项CD音轨版本情报终了',selected:false};
 for(const line of ['　为了不让我听到，医生压低声音向护士交代着。','　外面的天气很不错，清凉的风，正宣告着夏天的终结。','「知得留老师的授课」？我还是去教室吧。']){
  h.state.hookThreads=[menu,{id:'t',name:'TextOutA',sample:line,selected:false}];h.unselectedChinese();}
 assert.strictEqual(h.state.sourceChinese,true);assert.match(h.state.hookMessage,/中文.*日文原版/);
 const j=new HookNative({native:tmp('n-'),hook:tmp('h-'),logs:tmp('l-')},()=>{},()=>({}),()=>0);clearInterval(j.timer);
 for(const line of ['「やっと来たね」と彼は言った。','冬弥は小さく頷いた。','そうですね……今日は雨です。'])
  {j.state.hookThreads=[{id:'t',name:'TextOutA',sample:line,selected:false}];j.unselectedChinese();}
 assert.notStrictEqual(j.state.sourceChinese,true);
 for(let i=0;i<5;i++){j.state.hookThreads=[menu];j.unselectedChinese();}assert.notStrictEqual(j.state.sourceChinese,true,'a fixed menu string is not a story');
});

test('importing a Japanese original swaps the NScripter script 0.txt, other text files stay skipped',()=>{
 const {walk}=require('../core/japanese-import-original.cjs')._internal,dir=game(JA,sjis);fs.writeFileSync(path.join(dir,'readme.txt'),'x');fs.writeFileSync(path.join(dir,'12.txt'),'x');
 const files=walk(dir).map(f=>f.toLowerCase());assert.ok(files.includes('0.txt'));assert.ok(files.includes('12.txt'));assert.ok(!files.includes('readme.txt'));
});
