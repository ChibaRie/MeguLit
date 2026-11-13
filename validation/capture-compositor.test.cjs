// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Text architecture part ② (owner, 2026-11-14: MeguLit draws all game text itself): the capture compositor.
   native/compositor/MeguLitCompositor.exe captures the game window (Windows.Graphics.Capture, from Magpie), finds part ①'s
   glyph dots (DotFinder.h), inpaints them, draws MeguLit's text with Direct2D/DirectWrite and presents in its own
   click-through window; native/borderless keeps exclusive-fullscreen games windowed and borderless.
   Native self-tests: native/compositor/build.cmd (DotSelfTest: synthetic 1080p frames), native/borderless/build.cmd
   (bltest x86/x64: fake COM objects, never a real fullscreen mode); off-screen end-to-end replay:
   native/compositor/selftest/replay.cjs. */
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('dot finder is portable, generic and follows dot spec 1', () => {
  const s = read('native/compositor/DotFinder.h');
  assert.doesNotMatch(s, /#include <windows\.h>/, 'no Windows types: same code in the compositor and the self-test');
  assert.doesNotMatch(s, /kirikiri|krkr|siglus|bgi|yuris|bruns|unity|renpy|dustmania|ダスト/i, 'no engine or game names');
  assert.match(s, /if \(w <= 3 && h <= 3 && w >= 1 && h >= 1\) return b\.area == w \* h;/, 'spec-1 dots: solid ≤3 px blocks, clipped ones included');
  assert.match(s, /inline bool IsDotless\(char32_t c\) \{ return c <= 0x20 \|\| c == 0x3000 \|\| c == 0x200B \|\| c == 0xFEFF; \}/, 'same blank set as ①');
  assert.match(s, /inline Box EraseBox\(/, 'shadow/outline copies of a dot are erased with it');
  assert.match(s, /inline bool Isolated\(/, 'fragments of real glyphs are not dots (also for engine-scaled, blurred dots)');
  assert.match(s, /static void DropOutliers\(/, 'click-wait animations away from the line are not dots');
  assert.match(s, /bool Static\(const Dot &d\) const/, 'static UI in the text colour is not a dot');
  assert.match(s, /bool Continues\(const std::vector<Dot> &old, const Dot &f, float pk\) const/, 'ADV line on the old places vs NVL kept line');
  assert.match(s, /inline bool PatchInpaint\(/, 'dithered boxes keep their pattern');
});

test('compositor: Magpie capture, D2D on the same device, click-through window, fallbacks', () => {
  const c = read('native/compositor/Compositor.cpp');
  assert.match(c, /session\.IsBorderRequired\(false\)/, 'no yellow border on Win11');
  assert.match(c, /session\.IsCursorCaptureEnabled\(false\)/);
  assert.match(c, /SetWindowLongPtrW\(opt\.game, GWL_EXSTYLE, ex \| WS_EX_APPWINDOW\)/, 'Magpie retry for windows outside Alt+Tab');
  assert.match(c, /WS_EX_NOREDIRECTIONBITMAP \| WS_EX_LAYERED \| WS_EX_TRANSPARENT \| WS_EX_NOACTIVATE/, 'never takes clicks or focus by itself');
  assert.match(c, /SetWindowsHookExW\(WH_MOUSE_LL, MouseLL/, 'only clicks on MeguLit glyph boxes are taken (look-up)');
  assert.match(c, /Fail\("capture"\)/, 'capture failure → fallback event, old overlay stays');
  assert.match(c, /"too-many-dots" : "reveal-stalled"/, 'a line that cannot be matched is handed back, never misdrawn');
  assert.match(c, /static std::vector<int> Targets\(const LineMsg &l, int n\)/, 'dots map onto ①-reported characters, cached glyphs fill the span');
  assert.match(c, /Magpie Effects\/Lanczos\.hlsl, GPL-3\.0/);
  assert.match(read('THIRD-PARTY.md'), /Magpie/);
});

test('borderless: exclusive fullscreen kept windowed on every API, generic', () => {
  const b = read('native/borderless/Borderless.cpp');
  for (const re of [/pp->Windowed = TRUE/, /Vt\(dev\)\[16\], reinterpret_cast<void \*>\(&MyReset\)/, /Vt\(dev\)\[132\]/, /RealSetFullscreen\(sc, FALSE, nullptr\)/, /d->Windowed = TRUE/, /DDSCL_NORMAL/, /Pretend\(d->dmPelsWidth, d->dmPelsHeight\)/])
    assert.match(b, re);
  assert.doesNotMatch(b, /bruns|kirikiri|siglus|gameplay\.exe/i, 'no game names');
  const t = read('native/borderless/selftest/bltest.cpp');
  assert.match(t, /DISPLAY99/, 'display settings tested on a display that does not exist');
  assert.doesNotMatch(t, /->CreateDevice\(/, 'the self-test never creates a real device');
});

class FakeProc extends EventEmitter {
  constructor() { super(); this.stdout = new EventEmitter(); this.lines = []; this.stdin = { destroyed: false, write: s => this.lines.push(JSON.parse(s)) }; this.exitCode = null; }
  kill() { this.exitCode = 1; }
}

test('bridge: ① events and reader annotations become compositor commands', () => {
  const { CaptureCompositor, strip, rubyToStripped } = require('../services/capture-compositor.cjs');
  const events = []; let proc;
  const cc = new CaptureCompositor({ root, spawn: (exe, args) => { proc = new FakeProc(); proc.args = args; return proc; }, onEvent: e => events.push(e) });
  assert.ok(cc.start({ hwnd: 1234, scale: true }));
  assert.deepStrictEqual(proc.args, ['--hwnd', '1234', '--scale']);
  cc.hookGlyphDots({ type: 'hookGlyphDots', state: 'line', seq: 7, text: '吾輩は猫である。' });
  cc.hookGlyphDots({ type: 'hookGlyphDots', state: 'dots', seq: 7, path: 'ggo', dots: [{ i: 0, ch: '吾', h: 28, b: 24, a: 28, x: 1, y: 2, s: 3, k: 'd' }, { i: -1, k: 'r' }, { i: 1, h: 28, b: 24, a: 28, x: 1, y: 3, s: 3, k: 'p' }] });
  assert.deepStrictEqual(proc.lines[0], { t: 'line', id: 7, text: '吾輩は猫である。', expected: 8 });
  assert.deepStrictEqual(proc.lines[1], { t: 'glyphs', id: 7, glyphs: [{ i: 0, h: 28, b: 24, a: 28, x: 1, y: 2, k: 'd' }] }, 'ruby (r) and previous-line (p) records are not this line\'s cells');
  // Reader text has blanks ①'s text has not: furigana spans move with them.
  assert.deepStrictEqual(strip('「あ い」').text, '「あい」');
  assert.deepStrictEqual(rubyToStripped('猫 が　鳴く', [[4, 5, 'な']]), [[2, 3, 'な']]);
  cc.annotate({ id: 7, fullText: '吾輩は 猫である。', tl: '我是猫。', ruby: [[0, 2, 'わがはい'], [4, 5, 'ねこ']] });
  assert.deepStrictEqual(proc.lines[2], { t: 'annotate', id: 7, tl: '我是猫。', ruby: [[0, 2, 'わがはい'], [3, 4, 'ねこ']] });
  cc.style({ mode: 'translation', tlFont: 'Microsoft YaHei', ruby: false, bogus: 1 });
  assert.deepStrictEqual(proc.lines[3], { t: 'style', mode: 'translation', tlFont: 'Microsoft YaHei', ruby: false });
  proc.stdout.emit('data', '{"e":"lookup","id":7,"index":3,"x":1,"y":2}\n{"e":"undot","id":7,"reason":"reveal-stalled"}\n');
  assert.strictEqual(events[0].char, '猫', 'look-up click → the character of ①\'s line');
  assert.strictEqual(events[1].e, 'undot');
  cc.stop(); assert.deepStrictEqual(proc.lines.at(-1), { t: 'quit' });
});

// Built native self-tests run when their binaries are there (Build.ps1 / CI build them; a source checkout may not have).
const out = process.env.MEGULIT_BUILD_OUT || path.join(root, 'native', 'compositor', 'obj');
test('DotSelfTest: synthetic frames (typewriter, fades, shake, scroll, NVL, spec-1, shadows, dither, choices)', { skip: !fs.existsSync(path.join(out, 'DotSelfTest.exe')) && 'DotSelfTest.exe not built' }, () => {
  const r = spawnSync(path.join(out, 'DotSelfTest.exe'), { encoding: 'utf8', timeout: 120000 });
  const summary = JSON.parse(r.stdout.trim().split('\n').pop()).summary;
  assert.strictEqual(r.status, 0, r.stdout);
  assert.strictEqual(summary.failed, 0);
  assert.ok(summary.meanRate >= .99, 'mean detection rate ' + summary.meanRate);
});

test('runtime: textRenderer setting, compositor with the bound game, overlay hides only while the compositor draws', () => {
  const { CompositorHost, rectsToClient } = require('../core/compositor-host.cjs');
  assert.strictEqual(require('../core/game-style.js').clean({}).textRenderer, undefined, 'no default in per-game styles: absent = overlay');
  assert.match(read('core/gal-native.cjs'), /if\(value&&value\.textRenderer===undefined\)/, 'reader saves keep the app-wide choice');
  assert.strictEqual(require('../core/game-style.js').clean({ textRenderer: 'compositor' }).textRenderer, 'compositor');
  assert.match(read('services/settings-schema.cjs'), /choice\('embedding','textRenderer'/);
  assert.match(read('core/gal-native.cjs'), /this\.compositor\?\.hook\(message\)/);
  assert.match(read('services/reader.cjs'), /g\?\.compositor\?\.text\(String\(r\.text\|\|''\),translated\)/);
  assert.match(read('web/reader/modules/gal.js'), /classList\.toggle\('megulit-composited',message\.compositorDrawing\)/);
  const sent = [], ui = []; let started = null, evt = null;
  const fake = { available: () => true, start: o => { started = o; return true; }, stop() { sent.push({ t: 'quit' }); }, send: o => sent.push(o), style: o => sent.push({ t: 'style', ...o }), hookGlyphDots: m => sent.push({ t: 'dots', seq: m.seq }), annotate: o => sent.push({ t: 'annotate', ...o }), choices: i => sent.push({ t: 'choices', i }) };
  const host = new CompositorHost({ onEvent: m => ui.push(m), make: o => { evt = o.onEvent; return fake; } });
  host.configure({ textRenderer: 'overlay' }, { bound: true, gameHwnd: '123' });
  assert.strictEqual(started, null, 'overlay setting: no compositor');
  host.configure({ textRenderer: 'compositor', interfaceMode: 'translation' }, { bound: true, gameHwnd: '123', gameStarted: 'a', clientWidth: 1280, clientHeight: 720 });
  assert.deepStrictEqual(started, { hwnd: 123 });
  assert.strictEqual(sent.find(x => x.t === 'style').mode, 'translation', 'translation-only follows the reader mode');
  host.hook({ type: 'hookGlyphDots', state: 'line', seq: 4, text: '＄名前＿渚真っ白な手。' });
  host.text('真っ白な 手。', '雪白的手。');
  assert.deepStrictEqual(sent.find(x => x.t === 'annotate'), { t: 'annotate', id: 4, tl: '雪白的手。' }, 'translation reaches the line that shows it (stream junk before it)');
  host.choices(['はい', 'いいえ']);
  assert.deepStrictEqual(sent.find(x => x.t === 'choices').i, [{ text: 'はい' }, { text: 'いいえ' }]);
  evt({ e: 'line', id: 4, status: 'complete', found: 6 });
  assert.deepStrictEqual(ui.at(-1), { compositorDrawing: true });
  evt({ e: 'undot', id: 4 });
  assert.deepStrictEqual(ui.at(-1), { compositorDrawing: false }, 'a handed-back line shows in the overlay again');
  evt({ e: 'fallback', reason: 'capture' });
  assert.ok(ui.some(m => m.type === 'compositorState' && m.state === 'fallback'));
  started = null; host.configure({ textRenderer: 'compositor' }, { bound: true, gameHwnd: '123', gameStarted: 'a' });
  assert.strictEqual(started, null, 'capture failed: this game stays on the overlay');
  // ③ char rects: game screen 1280x720 → a 1920x1080 client keeps the aspect
  assert.deepStrictEqual(rectsToClient({ sw: 1280, sh: 720, viewport: [0, 0, 0, 0], rects: [[100, 600, 32, 32]] }, 1920, 1080), [[150, 900, 48, 48]]);
});
