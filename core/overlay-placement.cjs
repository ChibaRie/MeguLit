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
    /* GalWindowBridge reports the client size in its layout message (state.layout); older callers passed it flat */
    const size = state?.layout?.clientWidth ? state.layout : state;
    if (size?.clientWidth && size?.clientHeight) this.client = [size.clientWidth, size.clientHeight];
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
  /* ① MeguLitFont blank mode (record spec 3): the current line's table (hook-native state.hookGlyphDots) with a cell
     origin per character. Spaces: c = client px, m<W>x<H> / t<W>x<H> = a surface of that size (scaled to the client),
     g / - = no device position (not placeable). A character the engine drew from its glyph cache has no record: it sits
     right after the previous placed one on the same row (advance), as long as a later character of the line was drawn. */
  glyph(table) {
    if (!this.on || !table || typeof table.text !== 'string' || !table.text) return;
    const chars = [...table.text], rects = new Array(chars.length).fill(null), [cw, ch] = this.client;
    for (const d of Array.isArray(table.dots) ? table.dots : []) {
      if (!d || !(d.k === 'd' || d.k === 'c') || !(d.i >= 0 && d.i < chars.length) || !d.at) continue;
      const sp = String(d.at.space || ''), m = /^[mt](\d+)x(\d+)$/.exec(sp);
      let kx = 1, ky = 1;
      if (m) { const w = +m[1], h = +m[2]; if (!(w > 0 && h > 0 && cw > 0 && ch > 0)) continue; kx = cw / w; ky = ch / h; }
      else if (sp !== 'c') continue;
      const hgt = d.h > 0 ? d.h : 0, adv = d.a > 0 ? d.a : hgt;
      if (!hgt) continue;
      rects[d.i] = [d.at.x * kx, d.at.y * ky, adv * kx, hgt * ky];
    }
    let last = -1; for (let i = rects.length - 1; i >= 0; i--) if (rects[i]) { last = i; break; }
    if (last < 0) return;
    for (let i = 1; i < last; i++) if (!rects[i] && rects[i - 1]) { const p = rects[i - 1]; rects[i] = [p[0] + p[2], p[1], p[2], p[3]]; }
    const line = { id: 'glyph:' + (Number(table.seq) || 0), engine: 'glyph', text: table.text, rects, client: this.client.slice() };
    const key = JSON.stringify(line);
    if (key === this.lastKey) return; this.lastKey = key; this.current = line;
    this.send({ type: 'textPlace', ...line });
  }
  stop() { this.clear(); this.on = false; }
}

module.exports = { OverlayPlacement };
