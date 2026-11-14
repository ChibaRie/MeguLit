// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* core/glyph-locate-host.cjs on synthetic captures (no game): a GetGlyphOutline engine whose records have no position.
   base frame (marks off) → MARK on → marked frame of the next line → locate; a second agreeing line confirms and saves
   the calibration, MARK goes off for good, and OverlayPlacement places the following lines from it (located), also
   while the game is still typing. Needs core/glyph-locate.cjs (feat/glyph-dots 2e58da4+); before that merge it is read
   from that branch through git, or the test is skipped. */
const assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
let lib = null;
try { lib = require('../core/glyph-locate.cjs'); } catch {
  try { const src = execFileSync('git', ['show', 'feat/glyph-dots:core/glyph-locate.cjs'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'megulit-gl-')), 'glyph-locate.cjs'); fs.writeFileSync(tmp, src); lib = require(tmp); } catch {}
}
if (!lib) { console.log('SKIP glyph-locate host (no core/glyph-locate.cjs)'); process.exit(0); }
const { GlyphLocateHost } = require('../core/glyph-locate-host.cjs'), { OverlayPlacement } = require('../core/overlay-placement.cjs');
const W = 1280, H = 720, ORIGIN = [100, 520], K = 1, WRAP = 28 * 20, PITCH = 44;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function base() { const r = rng(7), f = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = (y * W + x) * 4, box = x >= 60 && x < 1220 && y >= 470 && y < 700, v = box ? 20 + Math.floor(r() * 6) : 90 + ((x + y) >> 4) % 60 + Math.floor(r() * 20); f[p] = v; f[p + 1] = Math.min(255, v + 3); f[p + 2] = Math.max(0, v - 3); f[p + 3] = 255; } return f; }
const BASE = base();
function table(seq, text) { const chars = [...text], n = chars.length; return { seq, text, dots: chars.map((ch, i) => ({ i, ch, h: 28, b: 24, a: 28, x: 1 + (i % 3), y: 2 + (i % 2), s: i === 0 || i === 1 || i === n - 1 ? 1 : 0, k: 'd' })) }; }
/* the frame the game shows at the end of a line: blank text; with MARK on, the 3 marks (1/64 of white) */
function shot(t, marked) {
  const f = Uint8Array.from(BASE); if (!marked) return f;
  const c = lib.cells(t), lay = lib.rows(c, WRAP, false), n = c.length;
  for (const i of [0, 1, n - 1]) { const x = Math.round(ORIGIN[0] + K * (lay[i].pen + c[i].x)), y = Math.round(ORIGIN[1] + lay[i].row * PITCH + K * c[i].y), p = (y * W + x) * 4; for (let k = 0; k < 3; k++) f[p + k] = Math.round(f[p + k] + (255 - f[p + k]) / 64); }
  return f;
}
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megulit-glh-')), exe = path.join(root, 'SiglusEngine.exe'); fs.writeFileSync(exe, 'MZ test');
  let marksOn = false, current = null; const switches = [];
  const hooks = { setGlyphMarks: on => { marksOn = on; switches.push(on); } };
  const host = new GlyphLocateHost({ root, hooks, lib, exe: () => exe, frame: async () => ({ width: W, height: H, data: shot(current.t, current.marked) }) });
  const lines = ['今日はいい天気ですね。', 'そうだね、どこかへ出かけようか。とても長い文章なので二行目まで続いていきます。', '朝ごはんは食べた？', 'まだだよ。一緒に食べに行こう。それから公園も歩こうね。'];
  let seq = 0;
  for (const text of lines) { const t = table(++seq, text); current = { t, marked: marksOn }; host.onTable(t); clearTimeout(host.timer); await host.step(t, t.seq); }
  assert.strictEqual(host.confirmed >= 2, true, 'two agreeing lines confirm');
  assert.strictEqual(marksOn, false, 'MARK off once confirmed');
  assert.deepStrictEqual(switches, [true, false, true, false], 'marks only on for one line at a time');
  assert.ok(Math.abs(host.calib.originX - ORIGIN[0]) <= 1.5 && Math.abs(host.calib.originY - ORIGIN[1]) <= 1.5, 'origin ' + JSON.stringify(host.calib));
  assert.ok(fs.existsSync(lib.calibFile(root, exe)), 'calibration saved per game');
  /* placement from the calibration, also while typing */
  const sent = [], p = new OverlayPlacement({ send: m => sent.push(m) }); p.wanted = () => true; p.locator = t => host.layout(t);
  p.configure({}, { bound: true, layout: { clientWidth: W, clientHeight: H } }); sent.length = 0;
  const next = table(++seq, 'もう一度だけ言うよ。');
  p.glyph(next); let m = sent.shift();
  assert.strictEqual(m.located, true);
  assert.deepStrictEqual(m.rects[0].map(Math.round), [100, 520, 28, 28]); assert.deepStrictEqual(m.rects[3].map(Math.round), [184, 520, 28, 28]);
  const typing = { ...next, seq: ++seq, dots: next.dots.slice(0, 4) };
  p.glyph(typing); m = sent.shift();
  assert.deepStrictEqual(m.rects.slice(3, 5).map(r => r && r.map(Math.round)), [[184, 520, 28, 28], null], 'not drawn yet = waits');
  /* a new run of the same game starts from the saved calibration: no marks at all */
  let again = false; const host2 = new GlyphLocateHost({ root, lib, exe: () => exe, hooks: { setGlyphMarks: on => { if (on) again = true; } }, frame: async () => null });
  host2.onTable(table(1, 'テスト')); assert.strictEqual(again, false); assert.ok(host2.layout(table(2, 'テスト'))[0]);
  /* no marks found three times: given up, MARK off, no layout */
  let on3 = false; const host3 = new GlyphLocateHost({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'megulit-glh-')), lib, exe: () => exe, hooks: { setGlyphMarks: on => { on3 = on; } }, frame: async () => ({ width: W, height: H, data: Uint8Array.from(BASE) }) });
  for (let i = 1; i <= 8; i++) { const t = table(i, '何も見えない文章です。'); host3.onTable(t); clearTimeout(host3.timer); await host3.step(t, i); }
  assert.strictEqual(host3.failures, 3); assert.strictEqual(on3, false); assert.strictEqual(host3.layout(table(9, 'テスト')), null);
  console.log('PASS glyph-locate host');
})().catch(e => { console.error(e); process.exit(1); });
