// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* web/reader/modules/text-place.js in a real browser (headless Edge through playwright-core; skipped when it is not
   installed: MEGULIT_PLAYWRIGHT=<path to playwright-core>). A reader line with ruby and a translation row is placed on
   recorded character boxes: tokens land on their boxes, ruby bases on the union of theirs, the translation under the
   last row with no plate, translation-only in the Japanese's place, a surface offset (galLayoutInfo) is added, characters
   not drawn yet stay hidden, and the fallback keeps the reader's own place without a plate. */
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
let chromium;
try { ({ chromium } = require(process.env.MEGULIT_PLAYWRIGHT || 'H:/MeguLit-Work/pw/node_modules/playwright-core')); } catch { console.log('SKIP text-place DOM (no playwright-core)'); process.exit(0); }
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
    const box = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); }, sel);
    const nth = n => `.sentence-text .char-token:nth-of-type(${n})`;
    await page.evaluate(() => { const b = window.__tomoyoChinese; b.textPlaceMode({ on: true });
      b.textPlace({ text: '「今日は晴れ', client: [1280, 720], rects: [[60, 500, 30, 32], [100, 500, 30, 32], [130, 500, 30, 32], [160, 500, 30, 32], [100, 540, 30, 32], [130, 540, 30, 32]] }); });
    await frame();
    assert.strictEqual(await page.evaluate(() => document.body.classList.contains('megulit-placed')), true);
    assert.deepStrictEqual(await box('.megulit-ruby-base'), [100, 500, 60, 32], 'ruby base = union of its tokens');
    assert.deepStrictEqual(await box('.megulit-ruby-base .char-token:nth-of-type(2)'), [130, 500, 30, 32]);
    assert.deepStrictEqual(await box('.sentence-text > .char-token:nth-of-type(3)'), [100, 540, 30, 32], 'second row (reader text found after the leading 「)');
    const row = await box('.tomoyo-cn-row');
    assert.strictEqual(row[0], 100); assert.ok(row[1] >= 572, 'translation under the last row');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.tomoyo-cn-row')).backgroundColor), 'rgba(0, 0, 0, 0)', 'no plate');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.sentence-window')).backgroundColor), 'rgba(0, 0, 0, 0)', 'no window plate');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.megulit-ruby-base .char-token')).fontSize), '30px', 'size from the boxes');
    assert.deepStrictEqual(await page.evaluate(() => [getComputedStyle(document.querySelector('.char-token')).pointerEvents, getComputedStyle(document.querySelector('.sentence-window')).pointerEvents]), ['auto', 'none'], 'words take the click, the rest of the full-screen window does not');
    /* translation only: the Chinese in the Japanese's place */
    await page.evaluate(() => document.body.classList.add('tomoyo-gal-zh-only')); await page.evaluate(() => window.__tomoyoChinese.textPlace({ text: '「今日は晴れ', client: [1280, 720], rects: [[60, 500, 30, 32], [100, 500, 30, 32], [130, 500, 30, 32], [160, 500, 30, 32], [100, 540, 30, 32], [131, 540, 30, 32]] })); await frame();
    assert.strictEqual((await box('.tomoyo-cn-row'))[1], 500, 'translation-only: top of the line');
    await page.evaluate(() => document.body.classList.remove('tomoyo-gal-zh-only'));
    /* surface offset + scale (reader window bigger than the game; physical px) and characters not drawn yet */
    await page.evaluate(() => { const b = window.__tomoyoChinese; b.galLayoutInfo = () => ({ clientX: 40, clientY: 20, clientWidth: 640, clientHeight: 360 });
      b.textPlace({ text: '今日は晴れ', client: [1280, 720], rects: [[100, 500, 30, 32], [130, 500, 30, 32], [160, 500, 30, 32], null, null] }); });
    await frame();
    assert.deepStrictEqual(await box('.megulit-ruby-base'), [90, 270, 30, 16], 'offset + scale');
    assert.strictEqual(await page.evaluate(n => getComputedStyle(document.querySelector(n)).display, nth(4)), 'none', 'not drawn yet = hidden');
    /* fallback: own place, no plate */
    await page.evaluate(() => { delete window.__tomoyoChinese.galLayoutInfo; window.__tomoyoChinese.textPlace({ fallback: true, text: '今日は晴れ' }); }); await frame();
    assert.deepStrictEqual(await page.evaluate(() => [document.body.classList.contains('megulit-placed'), document.body.classList.contains('megulit-place-fallback')]), [false, true]);
    assert.deepStrictEqual(await box('.sentence-window'), [100, 546, 804, 154], 'reader keeps its own box');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.sentence-window')).backgroundColor), 'rgba(0, 0, 0, 0)', 'fallback: no plate');
    /* name plate and a choice drawn on their boxes, click-through */
    await page.evaluate(() => window.__tomoyoChinese.textPlaceExtra({ client: [1280, 720], items: [{ id: 1, kind: 'n', text: '朋也', rects: [[80, 450, 28, 30], [108, 450, 28, 30]] }, { id: 2, kind: 'o', text: 'はい', rects: [[600, 200, 32, 34], [632, 200, 32, 34]] }] })); await frame();
    assert.deepStrictEqual(await box('.megulit-place-name span:nth-child(2)'), [108, 450, 28, 30], 'name plate on its boxes');
    assert.deepStrictEqual(await box('.megulit-place-choice span'), [600, 200, 32, 34], 'choice on its boxes');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.getElementById('megulit-place-extras')).pointerEvents), 'none', 'click-through');
    /* off: everything back */
    await page.evaluate(() => window.__tomoyoChinese.textPlaceMode({ on: false })); await frame();
    assert.deepStrictEqual(await page.evaluate(() => [document.body.className, !!document.getElementById('megulit-place-extras')]), ['', false]);
    console.log('PASS text-place DOM');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
