// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-19 (user: 「左右留白和边距现在都调整不了文本框位置了」): with the line anchored on the game's own place the box position
   sliders (文本框左边距/上边距) did nothing. In anchored mode they are now the line's offset from the game's place, saved with
   the game's profile (anchorDX/anchorDY, client %, 0 = on the game's first character), applied at once; the reader's own box
   position x/y is kept apart, so a box once dragged to x 16.6 / y 82.2 is never taken for an offset. */
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
let chromium;
try { ({ chromium } = require(process.env.MEGULIT_PLAYWRIGHT || 'H:/MeguLit-Work/pw/node_modules/playwright-core')); } catch { console.log('SKIP text-place sliders (no playwright-core)'); process.exit(0); }
const code = fs.readFileSync(path.join(__dirname, '..', 'web', 'reader', 'modules', 'text-place.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
.sentence-window{position:fixed;left:100px;bottom:20px;width:800px;height:150px;background:rgba(0,0,0,.6);border:2px solid #fff}
.tomoyo-cn-row{display:block;background:rgba(0,0,0,.5)}</style></head><body>
<main><div class="sentence-window tomoyo-hook-reader"><div class="sentence-text"><span class="megulit-ruby-base" data-tomoyo-reading="きょう"><span class="char-token">今</span><span class="char-token">日</span></span><span class="char-token">は</span><span class="char-token">晴</span><span class="char-token">れ</span></div><div class="tomoyo-cn-row">今天是晴天</div></div></main>
<script>window.__tomoyoChinese={};</script></body></html>`;
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(html); await page.addScriptTag({ content: code });
    const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const first = () => page.evaluate(() => { const r = document.querySelector('.sentence-text .char-token').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
    await page.evaluate(() => { const b = window.__tomoyoChinese; window.__prefs = { x: 16.6, y: 82.2 }; b.galPreferences = () => ({ ...window.__prefs }); b.galLayoutInfo = () => ({ clientX: 0, clientY: 0, clientWidth: 1280, clientHeight: 720 }); b.textPlaceMode({ on: true }); b.textPlaceAnchor(true);
      b.textPlace({ text: '今日は晴れ', client: [1280, 720], rects: [0, 1, 2, 3, 4].map(i => [430 + i * 40, 560, 40, 40]) }); });
    await frame(); assert.deepStrictEqual(await first(), [430, 560], 'on the game line at first (the box position x 16.6 / y 82.2 is no offset)');
    /* the user drags 文本框左边距 +5 (%) and 上边距 -2: applied at once (gal.js writes the root style when it previews) */
    await page.evaluate(() => { window.__prefs = { x: 16.6, y: 82.2, anchorDX: 5, anchorDY: -2 }; document.documentElement.style.setProperty('--tomoyo-reader-x', '1px'); });
    await frame(); assert.deepStrictEqual(await first(), [430 + 64, 560 - 14], 'moved by the saved offset (5 % of 1280, -2 % of 720)');
    /* back to the original values: back on the game line */
    await page.evaluate(() => { window.__prefs = { x: 16.6, y: 82.2, anchorDX: 0, anchorDY: 0 }; document.documentElement.style.setProperty('--tomoyo-reader-x', '2px'); });
    await frame(); assert.deepStrictEqual(await first(), [430, 560]);
    console.log('ok text-place sliders');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

/* the offsets are kept by the preference cleaning (core and reader copies) and travel with the game's position profile */
{ const gs = require('../core/game-style.js'), gp = require('../core/game-profile.js');
  const c = gs.clean({ x: 16.6, y: 82.2, anchorDX: 5, anchorDY: -2.04 }); assert.strictEqual(c.anchorDX, 5); assert.strictEqual(c.anchorDY, -2); assert.strictEqual(c.x, 16.6);
  assert.strictEqual(gs.clean({ anchorDX: 400 }).anchorDX, 95);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'web', 'reader', 'modules', 'game-style.js'), 'utf8'), /\['anchorDX','anchorDY'\]/);
  assert.deepStrictEqual(gp.pick({ x: 1, anchorDX: 3, anchorDY: -1 }, 'position'), { x: 1, anchorDX: 3, anchorDY: -1 });
  const gal = fs.readFileSync(path.join(__dirname, '..', 'web', 'reader', 'modules', 'gal.js'), 'utf8');
  assert.match(gal, /anchoredNow\(\) \? \{ x: preferences\.x, y: preferences\.y, anchorDX: Number\(f\('galX'\)\.value\) \|\| 0, anchorDY: Number\(f\('galY'\)\.value\) \|\| 0 \}/, 'anchored: the fields write the offset, x/y stay');
  assert.match(gal, /if \(anchoredNow\(\)\) \{ f\('galX'\)\.value = Number\(preferences\.anchorDX\) \|\| 0;/, 'anchored: the fields show the offset'); }
