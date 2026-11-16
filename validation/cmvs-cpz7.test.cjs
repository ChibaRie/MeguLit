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

test('CMVS: schemes list carries the Aoi7 CPZ7 variant',()=>{
 const sc=cmvs.DEFAULT;assert.equal(sc.alts.length,1);assert.equal(sc.alts[0].name,'Aoi7');
 assert.equal(sc.alts[0].factor,0x1A74F195);assert.equal(sc.alts[0].indexAddend,0x784C5062);assert.equal(sc.alts[0].entryTail,0xAE);
});

const STEAM='E:/steam/steamapps/common/Aoi Tori',real=fs.existsSync(path.join(STEAM,'data/pack/voice2.cpz'));
test('CMVS CPZ7: Aoi Tori voice2.cpz index and entries decrypt',{skip:!real},()=>{
 const f=path.join(STEAM,'data/pack/voice2.cpz'),a=cmvs.open(f);assert.ok(a);assert.equal(a.h.version,7);assert.equal(a.sc.name,'Aoi7');assert.ok(a.entries.length>100);
 assert.equal(cmvs.read(f,a.entries[0]).toString('latin1',0,4),'OggS');
});
test('CMVS CPZ7: Aoi Tori scripts read as text',{skip:!real},()=>{
 const list=cmvs.engine.scenes(STEAM);assert.ok(list.length>20);
 const n=list.reduce((s,x)=>s+cmvs.parse(x.read()).lines.length,0);assert.ok(n>100);
});
