// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* probe engine fingerprints: inventories of real unknown-pack probes (issues 294 âge, 300/301 Unity, 303 Leaf) classify
   as unsupported-engine with the right engine; archive magics are raw header bytes, never '?'-masked. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const core=require('../services/adapter-probe-core.cjs'),fp=require('../services/engine-fingerprint.cjs');
const inv=rows=>({archives:rows.map(([name,magic])=>({name,magic,size:9000,format:''})),scripts:0,markers:[]});
const FIX={
 age:[['alternative16.rio','593f3f5e6f3f233e'],['alternative16.rio.002','3f0402053f3f0400'],['alternative16.rio.ruo1','3f5a613f3f3f013f'],['fcxzzd.int','3f3f3f3f3f3f3f3f'],['alternative16.rio.ici','743f3f363f3f2f3f']],
 unity300:[['亜亜_Data/resources.assets.resS','0000000000000000'],['亜亜_Data/resources.resource','4653423501000000'],['亜亜_Data/sharedassets0.assets','0000000000000000'],['亜亜_Data/resources.assets','0000000000000000']],
 unity301:[['TheLamentingGeese_Data/resources.assets.resS','2a2a2a002a2a2a00'],['TheLamentingGeese_Data/resources.resource','4653423501000000'],['TheLamentingGeese_Data/sharedassets0.assets','0000000000000000']],
 leaf:[['Data/Game/BG.pck','46696c656e616d65'],['Data/Game/Voice.pck','46696c656e616d65'],['Data/BGM.pck','46696c656e616d65']]};
test('issue inventories name their engine',()=>{
 const want={age:'age',unity300:'unity',unity301:'unity',leaf:'leaf'};
 for(const [k,e] of Object.entries(want)){const r=core.classify({engines:[],inventory:inv(FIX[k])});assert.deepEqual([r.step,r.detail],['unsupported-engine',e],k);}});
test('unknown magic without fingerprint stays unknown-pack',()=>{
 const r=core.classify({engines:[],inventory:inv([['data/scene.pak','4d47504b01000000']])});assert.equal(r.step,'unknown-pack');});
test('Unity resource-only files are not script archives, groups collapse',()=>{
 const t=fp.tidy(inv(FIX.unity300).archives);assert.equal(t[t.length-1].resource,true);assert.ok(t.every(a=>a.engine==='unity'));
 assert.equal(fp.archiveInfo('x_Data/a.resS','00').resource,true);assert.equal(fp.archiveInfo('Data/BG.pck','46696c656e616d65').engine,'leaf');
 assert.equal(fp.archiveInfo('a.bundle','556e6974794653000000').engine,'unity');});
test('inventory magic is the raw header, no 3f masking',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'megulit-fp-'));fs.mkdirSync(path.join(dir,'Game_Data'));
 const rio=Buffer.alloc(8192,0x41);Buffer.from([0x59,0xa1,0xb2,0x5e,0x6f,0xc3,0x23,0x3e]).copy(rio);fs.writeFileSync(path.join(dir,'game.rio'),rio);
 fs.writeFileSync(path.join(dir,'Game_Data','resources.assets'),Buffer.alloc(8192));fs.writeFileSync(path.join(dir,'UnityPlayer.dll'),Buffer.alloc(16));
 const i=core.inventory(dir);const a=i.archives.find(x=>x.name==='game.rio');assert.equal(a.magic,'59a1b25e6fc3233e');assert.ok(i.markers.includes('unity'));
 fs.rmSync(dir,{recursive:true,force:true});});
