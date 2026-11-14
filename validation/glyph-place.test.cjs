// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* ① placement: glyph records (MeguLitFont records version 4) -> one client-pixel box per character of the line.
   The record lines below are the format the DLL sends (ToMe_GLYPHDOT dots ... list=i:u:h:b:a:x:y:s:k:px:py:space),
   parsed the way HookBridge parses them, merged by HookNative, then turned into boxes. */
const test = require('node:test'), assert = require('node:assert');
const {glyphRects, scaleOf, clickPoint, extraRects} = require('../core/glyph-place.cjs');
const {HookNative} = require('../core/hook-native.cjs');

/* HookBridge.GlyphDots, as JavaScript (same field rules). */
function parse(list) {
  const out = [];
  for (const e of list.split(';')) {
    const f = e.split(':');
    if ((f.length !== 9 && f.length !== 12) || f[8].length !== 1) continue;
    const d = {i: +f[0], ch: String.fromCharCode(parseInt(f[1], 16)), h: +f[2], b: +f[3], a: +f[4], x: +f[5], y: +f[6], s: +f[7], k: f[8]};
    if (f.length === 12 && f[11] !== '-') d.at = {x: +f[9], y: +f[10], space: f[11]};
    out.push(d);
  }
  return out;
}
function host() { const h = Object.create(HookNative.prototype); Object.assign(h, {state: {}, trace() {}, emit() {}, notify() {}, send() {}}); return h; }
const rec = (text, cells, space, extra = '') => [...text].map((c, i) => `${i}:${c.charCodeAt(0).toString(16).padStart(4, '0')}:28:24:28:0:0:0:d:${cells[i][0]}:${cells[i][1]}:${space}`).join(';') + extra;

test('client-space records (window DC) become boxes as they are', () => {
  const h = host(), text = '吾輩は猫';
  h.glyphDots({type: 'hookGlyphDots', state: 'line', seq: 1, text});
  h.glyphDots({type: 'hookGlyphDots', state: 'dots', seq: 1, path: 'text', dots: parse(rec(text, [[70, 50], [98, 50], [126, 50], [154, 50]], 'c'))});
  const r = glyphRects(h.state.hookGlyphDots, [1280, 720]);
  assert.equal(r.text, text); assert.equal(r.space, 'c');
  assert.deepEqual(r.rects.map(b => [b.x, b.y, b.w, b.h, b.baseline]), [[70, 50, 28, 28, 24], [98, 50, 28, 28, 24], [126, 50, 28, 28, 24], [154, 50, 28, 28, 24]]);
});

test('back-buffer records are scaled to the client area; shadow passes and redraws do not move a box', () => {
  const h = host(), text = '名前';
  h.glyphDots({type: 'hookGlyphDots', state: 'line', seq: 2, text});
  // the engine draws at 1600x900 and shows it in a 1280x720 client; a shadow pass (kind c) at +2,+2 comes after
  h.glyphDots({type: 'hookGlyphDots', state: 'dots', seq: 2, path: 'text', dots: parse(rec(text, [[100, 800], [128, 800]], 'm1600x900', ';0:540d:28:24:28:0:0:0:c:102:802:m1600x900'))});
  const r = glyphRects(h.state.hookGlyphDots, [1280, 720]);
  assert.deepEqual(r.rects.map(b => [b.x, b.y]), [[80, 640], [102.4, 640]]);
  assert.equal(r.rects[0].w, 28 * 0.8); assert.equal(r.space, 'm1600x900');
});

test('not placeable: a missing character, GetGlyphOutline records (no position), GDI+ world units, old 9-field records', () => {
  const h = host(), text = '今日は';
  h.glyphDots({type: 'hookGlyphDots', state: 'line', seq: 3, text});
  h.glyphDots({type: 'hookGlyphDots', state: 'dots', seq: 3, path: 'text', dots: parse(rec('今日', [[0, 0], [28, 0]], 'c'))});
  assert.equal(glyphRects(h.state.hookGlyphDots, [800, 600]), null, 'one character has no box yet');
  const g = host(); g.glyphDots({type: 'hookGlyphDots', state: 'line', seq: 4, text: '雨'});
  g.glyphDots({type: 'hookGlyphDots', state: 'dots', seq: 4, path: 'ggo', dots: parse('0:96e8:28:24:28:1:2:0:d:0:0:-')});
  assert.equal(glyphRects(g.state.hookGlyphDots, [800, 600]), null, 'ggo has no position');
  assert.equal(scaleOf('g', [800, 600]), null); assert.equal(scaleOf('m0x5', [800, 600]), null); assert.equal(scaleOf('t1000x90', [0, 0]), null);
  assert.equal(parse('0:96e8:28:24:28:1:2:3:d')[0].at, undefined, 'spec 2 records still parse, without a position');
});

test('the DLL record format is the one parsed here', () => {
  const c = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'native', 'fontprobe', 'FontProbe.cpp'), 'utf8');
  assert.ok(c.includes('"%s%d:%04x:%d:%d:%d:%d:%d:%d:%c:%d:%d:%s"'));
  const b = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'native', 'HookBridge.cs'), 'utf8');
  assert.ok(b.includes('f.Length!=9&&f.Length!=12'));
});

test('names and choices (extra lines): own ids, own tables, boxes and a click point for each choice', () => {
  const h = host(), sent = []; h.send = m => sent.push(m);
  h.setGlyphExtras({names: true, choices: ['上書きで何か吹き込む', 'やめておく', ' ']});
  assert.deepEqual(sent[0], {type: 'glyphExtras', names: true, choices: ['上書きで何か吹き込む', 'やめておく']});
  h.glyphExtra({type: 'hookGlyphExtra', state: 'line', id: 1, kind: 'n', text: '古河渚'});
  h.glyphExtra({type: 'hookGlyphExtra', state: 'dots', id: 1, path: 'text', dots: parse(rec('古河渚', [[300, 40], [320, 40], [340, 40]], 'c').replace(/:d:/g, ':n:'))});
  h.glyphExtra({type: 'hookGlyphExtra', state: 'line', id: 2, kind: 'o', text: 'やめておく'});
  h.glyphExtra({type: 'hookGlyphExtra', state: 'dots', id: 2, path: 'text', dots: parse(rec('やめておく', [[100, 400], [128, 400], [156, 400], [184, 400], [212, 400]], 'm1280x720').replace(/:d:/g, ':o:'))});
  const all = extraRects(h.state.hookGlyphExtras, [1280, 720]);
  assert.deepEqual(all.map(r => [r.kind, r.text]), [['o', 'やめておく'], ['n', '古河渚']]);
  assert.deepEqual(all[0].click, {x: 170, y: 414}, 'centre of the choice row');
  assert.deepEqual(all[1].rects.map(b => b.x), [300, 320, 340]);
  h.glyphExtra({type: 'hookGlyphExtra', state: 'line', id: 3, kind: 'n', text: '岡崎朋也'});
  assert.equal(Object.values(h.state.hookGlyphExtras).filter(t => t.kind === 'n').length, 1, 'a new name replaces the old one');
  h.setGlyphExtras({names: true, choices: []});
  assert.equal(Object.values(h.state.hookGlyphExtras).filter(t => t.kind === 'o').length, 0, 'choices cleared');
  assert.equal(clickPoint(null), null);
  const b = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'native', 'HookBridge.cs'), 'utf8');
  assert.ok(b.includes('Regex.Match(s,@"^extra id=(')&&b.includes(') kind=([no]) text=(.*)$");') && b.includes('GlyphSend("EXTRA o "+t)') && b.includes('if(GlyphNames&&GlyphWanted())GlyphSend("EXTRA n "'), 'bridge pushes names / choices and forwards the records');
  const c = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'native', 'fontprobe', 'FontProbe.cpp'), 'utf8');
  assert.ok(c.includes('Send("ToMe_GLYPHDOT xdots id="') && c.includes('if (!r && DotMode && !Extras.empty() && ExtraMatch(s, sv, &xid))'), 'DLL: whole-string draws only');
});
