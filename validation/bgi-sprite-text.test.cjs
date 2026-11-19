// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-19 (素晴らしき日々, BGI): the black-screen quotes at a chapter start are script sprite text, drawn by BGI's own string
   walker and never by the message function EmbedBGI hooks, so no stream carried them. The hook finds the walker by its shape
   (native/megulithook/MeguLitBgiSprite.h, replayed by selftest/bgisprite.cpp) and adds the read-only stream BGISpriteText;
   the bridge passes a *SpriteText stream on as full-screen text; the reader shows it as a line of its own. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {replay}=require('./helpers/hook-replay.cjs');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('hook: the sprite text walker is found by shape after any BGI hook, EmbedBGI keeps the message function',()=>{
 const c=read('native/megulithook/BGI.cpp');
 assert.match(c,/#include "MeguLitBgiSprite\.h"/);
 assert.match(c,/MeguLitBgiMessageFunction = addr;[^\n]*\n\s*return NewHook\(hp, "EmbedBGI"\);/,'the message function is remembered');
 assert.match(c,/skip\.insert\(MeguLitBgiMessageFunction\)/);
 assert.match(c,/hp\.type = USING_STRING;[\s\S]{0,80}NewHook\(hp, "BGISpriteText"\);/,'read-only: no EMBED_ABLE');
 assert.match(c,/if \(InsertBGI4Hook\(\)\)\s*return InsertBGISpriteHook\(\), true;/);
 assert.match(c,/if \(ok\)\s*InsertBGISpriteHook\(\);\s*return ok;/);
 const h=read('native/megulithook/MeguLitBgiSprite.h');
 assert.doesNotMatch(h.replace(/\/\*[\s\S]*?\*\//g,''),/0x4[0-9a-f]{5}/i,'no game address in code');
 for(const f of ['build-x86.cmd','build-x64.cmd'])assert.match(read('native/megulithook/'+f),/MeguLitBgiSprite\.h BGI\.cpp/,f);
 const r=read('native/megulithook/selftest/run.cmd');
 assert.match(r,/bgisprite\.cpp/);assert.match(r,/bgisprite\.exe"\r?\n if errorlevel 1 exit \/b 1/);});
test('bridge: a *SpriteText stream is never auto-picked, reaches the reader before a stream is selected and is marked art',()=>{
 const b=read('native/HookBridge.cs');
 assert.match(b,/const string AutoSkip="[^"]*\|SpriteText\|/);
 assert.match(b,/static bool SpriteTextStream\(string name\)\{return \(name\?\?""\)\.EndsWith\("SpriteText",StringComparison\.Ordinal\);\}/);
 assert.match(b,/other=\(Selected!=""\|\|sprite\)&&tp\.Key\(\)!=Selected&&/);
 assert.match(b,/if\(sprite\)Emit\(new\{type="hookAuxText",text=text,sourceName=name,role=aux\.role,art=true\}\);else Emit\(new\{type="hookAuxText",text=text,sourceName=name,role=aux\.role\}\);/);});
test('reader: sprite text is a line of its own, once, never a choice, and the dialogue stream stays EmbedBGI',()=>{
 const quote='人生は生きるに値する',line='「おはよう、由岐」';
 const rows=[
  {t:1000,m:{type:'hookAuxText',text:quote,sourceName:'BGISpriteText',role:0,art:true}},
  {t:1300,m:{type:'hookAuxText',text:quote,sourceName:'BGISpriteText',role:0,art:true}},
  {t:1600,m:{type:'hookAuxText',text:'他人の為ではなく',sourceName:'BGISpriteText',role:0,art:true}},
  {t:1900,m:{type:'hookAuxText',text:'自分の為に',sourceName:'BGISpriteText',role:0,art:true}},
  {t:5000,m:{type:'hookSource',text:line,sourceName:'EmbedBGI',sourceCode:'EXHSXN8:20@3B350:BGI.exe',hookActive:true}},
  {t:7000,m:{type:'hookAuxText',text:'人の世の幸せとは',sourceName:'BGISpriteText',role:0,art:true}}];
 const file=path.join(os.tmpdir(),'megulit-bgi-sprite-'+process.pid+'.jsonl');
 fs.writeFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n'));
 let inst=null;const {HookNative}=require('../core/hook-native.cjs');const orig=HookNative.prototype.auxText;
 HookNative.prototype.auxText=function(...a){inst=this;return orig.apply(this,a);};
 let r;try{r=replay(file,{name:'BGI.exe'});}finally{HookNative.prototype.auxText=orig;fs.unlinkSync(file);}
 const shown=[];for(const e of r.events)if(typeof e?.hookSource==='string'&&e.hookSource&&shown[shown.length-1]!==e.hookSource)shown.push(e.hookSource);
 assert.deepEqual(shown.filter(s=>s===quote).length,1,'the quote is shown once');
 for(const s of [quote,'他人の為ではなく','自分の為に',line,'人の世の幸せとは'])assert.ok(shown.includes(s),s+' reaches the reader');
 assert.equal(r.locates.length,0,'never taken for choices');
 assert.equal(inst.dialogueHook,'EmbedBGI','the dialogue stream stays the message stream');});
