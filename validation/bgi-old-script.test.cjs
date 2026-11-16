// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Older BGI scripts (キラ☆キラ): no BurikoCompiledScript magic, header size 0x10, push-string (3) operands are absolute offsets. */
const test=require('node:test'),assert=require('node:assert');
const bgi=require('../services/original-engines/bgi.cjs'),sjis=require('../services/original-engines/kit.cjs').encodeSjis;
const w=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
test('old BGI script lines',()=>{
 const a=Buffer.concat([Buffer.from(sjis('こんにちは')),Buffer.from([0])]),b=Buffer.concat([Buffer.from(sjis('世界')),Buffer.from([0])]);
 const code=Buffer.concat([w(0x10),Buffer.alloc(12),w(3),w(0),w(3),w(0),w(0),w(0),w(0),w(0),w(0),w(0)]);/* two pushes, patched below */
 const at=code.length,c=Buffer.from(code);c.writeUInt32LE(at,0x14);c.writeUInt32LE(at+a.length,0x1c);
 assert.deepStrictEqual(bgi.scriptLines(Buffer.concat([c,a,b])),['こんにちは','世界']);
 assert.strictEqual(bgi.scriptLines(Buffer.alloc(64)),null);
});
