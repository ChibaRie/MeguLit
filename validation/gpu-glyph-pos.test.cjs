'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {parseGlyphPos, fillPlaces} = require('../core/gpu-glyph-pos.cjs');

// The record the self-test (native/gpuhide/selftest/ggohost.cpp, run-trace.cmd) gets from the DLL for 吾輩は猫である。
const LINE1 = 'ToMe_GLYPHPOS line=1 sw=640 sh=480 n=8 list=543E,63,404,22,21;8F29,89,403,22,23;306F,116,404,21,20;732B,141,403,22,23;3067,168,406,20,18;3042,195,403,20,23;308B,221,404,18,21;3002,246,418,7,8';

test('parses the DLL record', () => {
  const p = parseGlyphPos(LINE1);
  assert.equal(p.line, 1); assert.equal(p.sw, 640); assert.equal(p.sh, 480); assert.equal(p.glyphs.length, 8);
  assert.deepEqual(p.glyphs[0], {ch: '吾', x: 63, y: 404, w: 22, h: 21});
  assert.equal(p.glyphs[7].ch, '。');
  assert.equal(parseGlyphPos('ToMe_CHARS engine=gpu'), null);
});

test('places every character of a GetGlyphOutline line (records with space -) on one cell row', () => {
  const text = '吾輩は猫である。';
  const table = {seq: 4, text, dots: [...text].map((ch, i) => ({i, ch, h: 24, b: 21, a: 24, x: 0, y: 0, s: 0, k: 'd', at: {x: 0, y: 0, space: '-'}}))};
  const out = fillPlaces(table, parseGlyphPos(LINE1));
  assert.equal(out.gpuPlaced, 8);
  for (const d of out.dots) { assert.equal(d.at.space, 'm640x480'); assert.equal(d.at.y, 403, 'row top = highest ink top'); }
  assert.deepEqual(out.dots.map((d) => d.at.x), [63, 89, 116, 141, 168, 195, 221, 246]);
  assert.equal(table.dots[0].at.space, '-', 'input not changed');
});

test('a cached glyph without a ① record gets one; matching is in order and skips foreign entries', () => {
  const text = '猫は猫';
  const pos = parseGlyphPos('ToMe_GLYPHPOS line=2 sw=1280 sh=720 n=5 list=5B57,10,10,20,20;732B,100,500,24,24;306F,130,502,22,20;732B,160,500,24,24;0,190,500,24,24');
  const out = fillPlaces({seq: 2, text, dots: [{i: 1, ch: 'は', h: 24, b: 20, a: 24, k: 'd', at: {x: 0, y: 0, space: '-'}}]}, pos);
  assert.equal(out.gpuPlaced, 3);
  const byI = new Map(out.dots.map((d) => [d.i, d]));
  assert.equal(byI.get(0).at.x, 100); assert.equal(byI.get(1).at.x, 130); assert.equal(byI.get(2).at.x, 160);
  assert.equal(byI.get(0).k, 'd'); assert.equal(byI.get(0).at.space, 'm1280x720'); assert.equal(byI.get(0).at.y, 500);
});

test('an unmatched character leaves the line unplaced (no guessing)', () => {
  const out = fillPlaces({seq: 1, text: '猫犬', dots: []}, parseGlyphPos('ToMe_GLYPHPOS line=1 sw=640 sh=480 n=1 list=732B,10,10,20,20'));
  assert.equal(out.gpuPlaced, 1); assert.equal(out.dots.length, 1);
});

test('HookBridge passes ToMe_GLYPHPOS on and hook-native keeps the latest', () => {
  const cs = fs.readFileSync(path.join(__dirname, '../native/GpuHideLayer.cs'), 'utf8');
  assert.match(cs, /ToMe_GLYPHPOS /); assert.match(cs, /type="hookGlyphPos",line=s/);
  const hn = fs.readFileSync(path.join(__dirname, '../core/hook-native.cjs'), 'utf8');
  assert.match(hn, /hookGlyphPos/);
  const c = fs.readFileSync(path.join(__dirname, '../native/gpuhide/GpuHide.cpp'), 'utf8');
  assert.match(c, /h\("GetGlyphOutlineW", \(void \*\)HGgoW/); assert.match(c, /Hook<519>\(tv\[19\], HTexLock\)/); assert.match(c, /Hook<31>\(vt\[31\], HUpdateTexture\)/);
  const run = fs.readFileSync(path.join(__dirname, '../native/gpuhide/selftest/run.cmd'), 'utf8');
  assert.match(run, /run-trace\.cmd/);
});
