// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* CMVS: Steam / retail folder layout (archives in data/pack, loose scripts in data/code) and the CPZ7 scheme variant
   (アオイトリ: cmvs32.exe 3.80 constants). The real-archive check runs only when the Steam copy is on this machine. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const cmvs=require('../services/original-engines/cmvs.cjs'),F={...require('./helpers/engine-fixtures.cjs'),...require('./helpers/engine-fixtures-d.cjs')},scenes=require('../services/original-engines/scenes.cjs');
const JA=['さくら','「おはよう、遅刻するよ」','朝の光が差し込む。'];

test('CMVS: loose .ps3 scripts in data/code are found (Steam layout)',()=>{
 const game=fs.mkdtempSync(path.join(os.tmpdir(),'cmvs-lay-'));
 F.writeTree(game,{'cmvs32.exe':'MZ','cmvs.cfg':'[CMVS_SYSTEM_MAIN]\r\nSCRIPT_INIT_PATH=data\\code\\\r\n','data/code/sn101.ps3':F.ps2a(JA),'data/code/sn102.ps3':F.ps2a(['二本目の話。'])});
 const list=cmvs.engine.scenes(game);assert.deepEqual(list.map(s=>s.name),['sn101.ps3','sn102.ps3']);
 assert.deepEqual(cmvs.parse(list[0].read()).lines,JA);assert.equal(scenes.detect(game),'cmvs');
});

test('CMVS: CPZ5 archive in data/pack is listed',()=>{
 const game=fs.mkdtempSync(path.join(os.tmpdir(),'cmvs-pack-'));
 F.writeTree(game,{'cmvs32.exe':'MZ','data/pack/event.cpz':F.cpz({'scene/a01.ps3':F.ps2a(JA)},{version:5,variant:'Mirai'})});
 assert.deepEqual(cmvs.engine.scenes(game).map(s=>s.name),['a01.ps3']);
});

test('CMVS: the CPZ7 scheme carries the cmvs32 3.80 constants (Aoi Tori)',()=>{
 const sc=cmvs.DEFAULT7;
 assert.equal(sc.factor,0x1A74F195);assert.equal(sc.indexAddend,0x784C5062);assert.equal(sc.entryTail,0xAE);assert.equal(sc.entrySub,0x5C39E87B);
});

const STEAM='E:/steam/steamapps/common/Aoi Tori',real=fs.existsSync(path.join(STEAM,'data/pack/voice2.cpz'));
test('CMVS CPZ7: Aoi Tori voice2.cpz index and entries decrypt',{skip:!real},()=>{
 const f=path.join(STEAM,'data/pack/voice2.cpz'),a=cmvs.open(f);assert.ok(a);assert.equal(a.h.version,7);assert.equal(a.variant,'Aoi');assert.ok(a.entries.length>100);
 assert.equal(cmvs.read(f,a.entries[0]).toString('latin1',0,4),'OggS');
});
test('CMVS CPZ7: Aoi Tori scripts read as text',{skip:!real},()=>{
 const list=cmvs.engine.scenes(STEAM);assert.ok(list.length>20);
 const n=list.reduce((s,x)=>s+cmvs.parse(x.read()).lines.length,0);assert.ok(n>100);
});

test('CMVS: a CPZ in data/pack alone (no cmvs32.exe) identifies the engine; unknown-scheme CPZ is reported',()=>{
 const game=fs.mkdtempSync(path.join(os.tmpdir(),'cmvs-det-'));const h=Buffer.alloc(0x48);h.write('CPZ6','latin1');
 F.writeTree(game,{'data/pack/script.cpz':h});
 assert.equal(require('../services/original-engines/registry.cjs').engineOf(game)?.name,'CMVS (Purple Software)');
 assert.equal(cmvs.engine.unsupported(game),'CMVS_CPZ7');
});

test('CMVS: an English release keeps its ASCII dialogue as lines, resource ids and control codes stay anchors',()=>{
 const r=cmvs.parse(F.ps2a(['\wc','message01.pb3','ev_etc24a','Girl','"Say..."','I look over to the lit fireplace.','???',{push:'bgm01.ogg'}]));
 assert.deepEqual(r.lines,['Girl','"Say..."','I look over to the lit fireplace.']);assert.ok(r.anchors.includes('message01.pb3')&&r.anchors.includes('\wc')&&r.anchors.includes('ev_etc24a'));
});
test('probe: a correctly read English build is not-japanese, not decode-suspect',()=>{
 const {judgeLanguage}=require('../services/adapter-probe-core.cjs');
 assert.equal(judgeLanguage({lines:17856,japaneseLines:1,dialogueLines:17000,chineseLines:0,title:'Aoi Tori'}),'not-japanese');
 assert.equal(judgeLanguage({lines:5000,japaneseLines:1,dialogueLines:40,chineseLines:0,title:'x'}),'decode-suspect');
});
