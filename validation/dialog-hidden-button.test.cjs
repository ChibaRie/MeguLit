// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 (user group: 检查游戏库的适配情况 said "nothing to upload" yet showed 确认上传, and pressing it did nothing).
   web/launch-plate.css sets display with !important on dialog buttons; a button a dialog hides with the hidden attribute
   must stay hidden, and show again when the attribute goes. Real browser (headless Edge), skipped without playwright-core. */
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
let chromium;
try { ({ chromium } = require(process.env.MEGULIT_PLAYWRIGHT || 'H:/MeguLit-Work/pw/node_modules/playwright-core')); } catch { console.log('SKIP dialog hidden button (no playwright-core)'); process.exit(0); }
const css = ['app.css', 'game-dialog.css', 'launch-plate.css'].map(f => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8')).join('\n');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>${css}</style><body><dialog class="game-dialog diag-dialog probe-dialog" open><div class="dialog-actions"><button class="text-button" data-close>关闭</button><button class="text-button" data-x hidden>x</button><button class="primary" data-upload hidden>确认上传</button></div></dialog></body>`);
    const display = sel => page.evaluate(s => getComputedStyle(document.querySelector(s)).display, sel);
    assert.strictEqual(await display('[data-upload]'), 'none', 'hidden primary button stays hidden');
    assert.strictEqual(await display('[data-x]'), 'none', 'hidden text button stays hidden');
    assert.notStrictEqual(await display('[data-close]'), 'none');
    await page.evaluate(() => { document.querySelector('[data-upload]').hidden = false; });
    assert.notStrictEqual(await display('[data-upload]'), 'none', 'shown again without the attribute');
    console.log('PASS dialog hidden button');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
