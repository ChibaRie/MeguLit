// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* these tests cover the capture compositor path, off by default since 2026-11-14 (overlay placement) */
process.env.MEGULIT_CAPTURE_COMPOSITOR = '1';
/* Text architecture ① in the normal launch flow (core/glyph-dots.cjs): with 文字显示 = compositor a game MeguLit starts
   as a plain process goes through MeguLitLaunch<bit>.exe (dots before the first glyph, dot-blind + the remembered dialogue
   font); HookBridge starts in dot mode; Steam / Locale Emulator / shell-open launches keep the late attach. */
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('glyph-dots: off by default; compositor setting turns on the launcher and the bridge mode; seed from the remembered font', () => {
  const g = require('../core/glyph-dots.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glyph-dots-'));
  try {
    fs.mkdirSync(path.join(root, 'native')); fs.mkdirSync(path.join(root, 'data', 'config'), {recursive: true}); fs.mkdirSync(path.join(root, 'data', 'glyph-hide'));
    const exe = path.join(root, 'ゲーム.exe'); fs.writeFileSync(exe, 'MZ' + 'x'.repeat(98));
    const saved = process.env.MEGULIT_GLYPH_MODE; delete process.env.MEGULIT_GLYPH_MODE;
    try {
      assert.equal(g.wanted(root), false); assert.deepEqual(g.bridgeEnv(root), {}); assert.equal(g.earlyStart(root, exe, [], true), null, 'off: no launcher');
      fs.writeFileSync(path.join(root, 'data', 'config', 'gal-preferences.json'), JSON.stringify({textRenderer: 'compositor'}));
      assert.equal(g.wanted(root), true); assert.deepEqual(g.bridgeEnv(root), {MEGULIT_GLYPH_MODE: 'dot', MEGULIT_GLYPH_ALL: '1', MEGULIT_GLYPH_BLIND: '1'});
      assert.equal(g.earlyStart(root, exe, [], true), null, 'launcher binaries missing: plain start');
      for (const f of ['MeguLitLaunch32.exe', 'MeguLitFont32.dll']) fs.writeFileSync(path.join(root, 'native', f), 'x');
      let e = g.earlyStart(root, exe, ['-a'], true, {PATH: 'p', MEGULIT_GLYPH_FONT: 'stale'});
      assert.equal(path.basename(e.file), 'MeguLitLaunch32.exe'); assert.deepEqual(e.args.slice(1), [exe, '-a']); assert.equal(path.basename(e.args[0]), 'MeguLitFont32.dll');
      assert.equal(e.env.MEGULIT_GLYPH_MODE, 'dot-blind'); assert.equal(e.env.PATH, 'p'); assert.equal(e.env.MEGULIT_GLYPH_FONT, undefined, 'no stale font without a memory');
      fs.writeFileSync(path.join(root, 'data', 'glyph-hide', '___.exe-100.json'), JSON.stringify({face: 'MS Gothic', size: 20}));
      e = g.earlyStart(root, exe, [], true); assert.equal(e.env.MEGULIT_GLYPH_FONT, '20 MS Gothic', 'remembered font, HookBridge file naming');
      assert.equal(g.earlyStart(root, exe, [], false), null, '64-bit game needs MeguLitLaunch64');
      const le = path.join(root, 'le'); fs.mkdirSync(le);
      const l = g.earlyLocale(root, le, exe);
      assert.equal(l.file, path.join(le, 'MeguLitLaunch32.exe'), '日文环境: the launcher runs from a copy in the LE folder');
      assert.ok(fs.existsSync(l.file)); assert.equal(l.env.MEGULIT_LAUNCH_LE, le); assert.equal(l.env.MEGULIT_GLYPH_MODE, 'dot-blind');
      assert.equal(g.earlyLocale(root, path.join(root, 'missing'), exe), null, 'copy fails: LEProc path');
    } finally { if (saved === undefined) delete process.env.MEGULIT_GLYPH_MODE; else process.env.MEGULIT_GLYPH_MODE = saved; }
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('launch flow: direct starts use the launcher (helper, not indirect); Steam and ③ shadow starts keep their own path; HookBridge gets the dot env', () => {
  const b = read('services/bridge.cjs');
  assert.ok(b.includes("const early=steam||textPath?null:require('../core/glyph-dots.cjs').earlyStart(root,launchExe,companion?companionArgs:[],require('../core/locale-emulator.cjs').x86(game.executable),directEnv||process.env);"));
  assert.ok(b.includes("startProcess(early?early.file:steam?'explorer.exe':launchExe,early?early.args:"));
  assert.ok(b.includes('{helper:steam||!!early,indirect:steam,'), 'the launcher exiting is not the game exiting; a game that quits at once is still seen');
  assert.ok(read('core/hook-native.cjs').includes("env:{...process.env,...require('./glyph-dots.cjs').bridgeEnv(path.join(this.folder,'..')),"));
  const lc = read('core/locale-emulator.cjs');
  assert.ok(lc.includes("const early=require('./glyph-dots.cjs').earlyLocale(this.root,s.dir,launchExe);")&&lc.includes("trace('locale-early-failed'"),'日文环境 tries the early launcher, falls back to LEProc');
  assert.ok(read('native/fontprobe/Launch.cpp').includes('GetProcAddress(m, "LeCreateProcess")'),'launcher creates through LE loader');
});
