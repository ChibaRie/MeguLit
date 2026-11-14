// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert = require('node:assert');
const { OverlayPlacement } = require('../core/overlay-placement.cjs');
const sent = [], p = new OverlayPlacement({ send: m => sent.push(m) });
p.wanted = () => true;
p.configure({}, { bound: true, clientWidth: 1280, clientHeight: 720 });
assert.deepStrictEqual(sent.shift(), { type: 'textPlaceMode', on: true });
const rec = { type: 'hookCharRects', engine: 'krkr', line: 3, hidden: true, sw: 1280, sh: 720, viewport: [0, 0, 1280, 720], rects: [[10, 20, 30, 40], [40, 20, 30, 40], [10, 60, 30, 40]], text: 'あい\u001fう' };
p.hook(rec);
const m = sent.shift();
assert.strictEqual(m.type, 'textPlace'); assert.strictEqual(m.text, 'あいう'); assert.deepStrictEqual(m.rects[2], [10, 60, 30, 40]);
p.hook(rec); assert.strictEqual(sent.length, 0, 'same line twice is sent once');
p.hook({ ...rec, rects: rec.rects.slice(0, 2) }); assert.strictEqual(sent.length, 0, 'rect count mismatch is not placeable');
p.hook({ ...rec, hidden: false }); assert.deepStrictEqual(sent.shift(), { type: 'textPlace', clear: true });
p.configure({}, { bound: false }); assert.deepStrictEqual(sent.pop(), { type: 'textPlaceMode', on: false });
/* glyph records (spec 3): client space, memory surface scaled to the client, cache gap filled, g / - not placeable */
p.configure({}, { bound: true, layout: { clientWidth: 1280, clientHeight: 720 } }); sent.length = 0;
p.glyph({ seq: 7, text: 'かきく', dots: [{ i: 0, ch: 'か', h: 30, a: 28, k: 'd', at: { x: 100, y: 500, space: 'c' } }, { i: 2, ch: 'く', h: 30, a: 28, k: 'd', at: { x: 112, y: 500, space: 'm640x360' } }] });
let gm = sent.shift();
assert.deepStrictEqual(gm.rects, [[100, 500, 28, 30], [128, 500, 28, 30], [224, 1000, 56, 60]]);
assert.strictEqual(gm.text, 'かきく');
p.glyph({ seq: 8, text: 'さ', dots: [{ i: 0, ch: 'さ', h: 30, a: 28, k: 'd', at: { x: 1, y: 1, space: 'g' } }] });
gm = sent.shift(); assert.strictEqual(gm.approx, true, 'no device position: laid out from the learned anchor');
assert.deepStrictEqual(gm.rects, [[100, 500, 28, 30]], 'anchor = left/top of the last exact line');
{ /* no anchor yet: fallback (reader keeps its own place, no plate); an outside locator gives one */
  const out = [], q = new OverlayPlacement({ send: m => out.push(m) }); q.wanted = () => true;
  q.configure({}, { bound: true, layout: { clientWidth: 1280, clientHeight: 720 } }); out.length = 0;
  const t = { seq: 1, text: 'なにぬねの', dots: [0, 1, 2].map(i => ({ i, ch: 'なにぬねの'[i], h: 24, a: 24, k: 'd' })) };
  q.glyph(t); let o = out.shift(); assert.strictEqual(o.fallback, true); assert.strictEqual(o.rects, undefined);
  q.anchor({ x: 200, y: 560, size: 24, width: 50, pitch: 36 });
  q.glyph({ ...t, seq: 2 }); o = out.shift(); assert.strictEqual(o.approx, true);
  assert.deepStrictEqual(o.rects, [[200, 560, 24, 24], [224, 560, 24, 24], [200, 596, 24, 24], null, null], 'wraps at the anchor width; undrawn characters wait');
}
p.glyph({ seq: 9, text: 'たち', dots: [{ i: 0, ch: 'た', h: 30, a: 28, k: 'd', at: { x: 10, y: 10, space: 'c' } }] });
gm = sent.shift(); assert.deepStrictEqual(gm.rects, [[10, 10, 28, 30], null], 'not yet drawn = not placed (typing)');
/* extra lines: name (n) and choices (o) placed only when complete */
p.extras({ 3: { id: 3, kind: 'n', text: '朋也', dots: [{ i: 0, ch: '朋', h: 30, a: 28, k: 'n', at: { x: 80, y: 450, space: 'c' } }, { i: 1, ch: '也', h: 30, a: 28, k: 'n', at: { x: 108, y: 450, space: 'c' } }] },
  4: { id: 4, kind: 'o', text: 'いいえ', dots: [{ i: 0, ch: 'い', h: 30, a: 28, k: 'o', at: { x: 1, y: 1, space: 'c' } }] } });
let ex = sent.shift(); assert.strictEqual(ex.type, 'textPlaceExtra'); assert.deepStrictEqual(ex.items.map(i => i.text), ['朋也'], 'incomplete option not placed');
assert.deepStrictEqual(ex.items[0].rects[1], [108, 450, 28, 30]);
const { HookNative } = require('../core/hook-native.cjs'), hn = Object.create(HookNative.prototype);
hn.state = {}; hn.emit = () => {}; hn.notify = v => { hn.state = { ...hn.state, ...v }; };
hn.glyphDots({ state: 'line', seq: 1, text: 'あ' });
hn.glyphDots({ state: 'dots', seq: 1, path: 'text', dots: [{ i: 0, ch: 'あ', h: 20, b: 16, a: 20, x: 0, y: 0, s: 0, k: 'd', at: { x: 5, y: 6, space: 'c' } }] });
assert.deepStrictEqual(hn.state.hookGlyphDots.dots[0].at, { x: 5, y: 6, space: 'c' }, 'cell origin kept in the line table');
process.env.MEGULIT_CAPTURE_COMPOSITOR = '1';
assert.strictEqual(new OverlayPlacement({}).wanted({ textRenderer: 'compositor' }), false);
delete process.env.MEGULIT_CAPTURE_COMPOSITOR;
assert.strictEqual(new OverlayPlacement({}).wanted({ textRenderer: 'compositor' }), true);
const gd = require('../core/glyph-dots.cjs');
assert.strictEqual(gd.capture(), false);
console.log('PASS overlay placement');
