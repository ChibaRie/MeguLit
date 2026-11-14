// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Text architecture, overlay placement (2026-11-14, replaces the capture compositor as the default).
   The sources stop the game drawing the current line (blank glyphs, opacity 0 layers, alpha 0 renderers) and report
   where every character is. This host turns those reports into one `textPlace` message per line for the reader
   overlay (web/reader/modules/text-place.js), which draws MeguLit's Japanese, ruby and translation at exactly those
   boxes and keeps its usual interaction (word card, drag-select, clicks elsewhere go to the game).
   Positions come from the sources only, never from screen pixels:
     - ③ hookCharRects (KiriKiri, Unity, Ren'Py, web): game-screen px + viewport → client px;
     - ① hookGlyphDots records with a cell position (MeguLitFont v4, blank mode): client px of each cell.
   Switched on by 文字显示 = 画进游戏画面 (gal-preferences textRenderer 'compositor'), unless the old capture compositor is
   forced for tests (MEGULIT_CAPTURE_COMPOSITOR=1). */
const fs = require('node:fs'), path = require('node:path');
const { rectsToClient } = require('./compositor-host.cjs');

class OverlayPlacement {
  constructor({ root, send = () => {} } = {}) {
    this.root = root; this.send = send; this.client = [0, 0]; this.current = null; this.on = false;
  }
  wanted(preferences) {
    if (process.env.MEGULIT_CAPTURE_COMPOSITOR === '1') return false;
    if (this.root) try {
      const file = path.join(this.root, 'data', 'config', 'gal-preferences.json'), t = fs.statSync(file).mtimeMs;
      if (t !== this.settingTime) { this.settingTime = t; this.setting = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).textRenderer; }
      if (this.setting) return this.setting === 'compositor';
    } catch {}
    return preferences?.textRenderer === 'compositor';
  }
  configure(preferences, state) {
    if (state?.clientWidth && state?.clientHeight) this.client = [state.clientWidth, state.clientHeight];
    const on = this.wanted(preferences) && state?.bound === true;
    if (on !== this.on) { this.on = on; if (!on) this.clear(); this.send({ type: 'textPlaceMode', on }); }
  }
  clear() { if (this.current) { this.current = null; this.send({ type: 'textPlace', clear: true }); } }
  hook(m) {
    if (!this.on || !m) return;
    if (m.type === 'hookCharRects') {
      const chars = [...String(m.text || '')].map(c => c === '\u001f' ? '\n' : c), flat = [];
      for (const c of chars) if (c !== '\n' && c !== '\r') flat.push(c);
      const rects = rectsToClient(m, this.client[0], this.client[1]);
      if (rects.length !== flat.length) return; // one rect per character is the protocol; anything else is not placeable
      const id = String(m.engine || 'path') + ':' + (Number(m.line) || 0);
      if (m.hidden !== true) { if (this.current?.id === id) this.clear(); return; }
      const line = { id, engine: m.engine, text: flat.join(''), rects, client: this.client.slice() };
      const key = JSON.stringify(line);
      if (key === this.lastKey) return; this.lastKey = key; this.current = line;
      this.send({ type: 'textPlace', ...line });
    }
  }
  stop() { this.clear(); this.on = false; }
}

module.exports = { OverlayPlacement };
