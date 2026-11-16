// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* ExHIBIT: a seed that is not in rld-seeds.json is found among the 32-bit windows of the game exe. */
const test=require('node:test'),assert=require('node:assert'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ex=require('../services/original-engines/exhibit.cjs');
const sjis=require('../services/original-engines/kit.cjs').encodeSjis;
test('key0 matches the full key table',()=>{for(const s of [1,0xdeadbeef,0x12345678,0xfffffffe])assert.strictEqual(ex.key0(s),ex.keyTable(s)[0]);});
test('seed recovered from the exe',()=>{
 const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;};
 const str=s=>Buffer.concat([Buffer.from(sjis(s)),Buffer.from([0])]);
 const ins=(op,ints,strs)=>Buffer.concat([u32(op|(ints.length<<16)|(strs.length<<24)),...ints.map(u32),...strs.map(str)]);
 const body=[ins(0x1c,[0,0,0,0,0,0,0],['魔女','こんにちは']),ins(0x1c,[0,0,0,0,0,0,0],['*','世界'])];
 const plain=Buffer.concat([Buffer.from('\0DLR','latin1'),u32(1),u32(0x10),u32(body.length),...body]);
 const seed=0x5a17c0de,enc=ex.crypt(plain,seed);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'exh-'));
 const exe=Buffer.concat([Buffer.alloc(4096,7),u32(seed),Buffer.alloc(4096,9)]);fs.writeFileSync(path.join(dir,'game.exe'),exe);fs.writeFileSync(path.join(dir,'a.rld'),enc);
 assert.strictEqual(ex.engine.unsupported(dir),'');
 const sc=ex.engine.scenes(dir);assert.deepStrictEqual(ex.engine.parse(sc[0].read()).lines,['魔女','こんにちは','世界']);
 fs.writeFileSync(path.join(dir,'a.rld'),ex.crypt(plain,0x0badf00d));fs.writeFileSync(path.join(dir,'game.exe'),Buffer.alloc(4096,7));
 assert.strictEqual(ex.engine.unsupported(dir),'EXHIBIT_SEED');
});
