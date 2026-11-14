// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Overlay placement for GetGlyphOutline engines (Siglus, AdvHD, ISLAND...): their glyph records carry no position (space
   "-"). feat/glyph-dots' locating marks (core/glyph-locate.cjs, HookNative.setGlyphMarks) give it: with MARK on, the
   DLL leaves one pixel of coverage 1/64 (at most 4 grey levels) at the first, second and last character of a line.
   Cycle, only while a game's position is not known yet, never every frame:
     line A complete (marks off): one lossless frame of the game window = base (the box shows no marks);
     MARK on; line B complete: one frame = marked; findMarks(base, marked) → locate → merge → saveCalib; MARK off.
   Two agreeing lines confirm the calibration; from then on MARK stays off and every line is laid out from it
   (layout(); also while the game is still typing: characters not drawn yet stay out). Three failed lines (no GRAY8
   glyphs, glyph cache, animation) give up for this run: the line keeps the older anchor estimate / fallback.
   Marks are for locating only, never cover anything, and are off as soon as the calibration is confirmed. */
let L = null; try { L = require('./glyph-locate.cjs'); } catch {}

class GlyphLocateHost {
  constructor({ root, hooks, frame, exe = () => '', trace = () => {}, lib = L } = {}) {
    Object.assign(this, { root, hooks, frame, exe, trace, L: lib });
    this.calib = null; this.confirmed = 0; this.failures = 0; this.marksOn = false; this.base = null; this.handled = -1; this.exeKey = ''; this.timer = null;
  }
  available() { return !!this.L && typeof this.hooks?.setGlyphMarks === 'function' && typeof this.frame === 'function'; }
  marks(on) { if (on === this.marksOn) return; this.marksOn = on; try { this.hooks.setGlyphMarks(on); } catch {} }
  sync() {
    const exe = String(this.exe() || '');
    if (exe === this.exeKey) return;
    this.exeKey = exe; this.calib = exe ? this.L.loadCalib(this.root, exe) : null; this.confirmed = this.calib ? 2 : 0; this.failures = 0; this.base = null; this.marks(false);
  }
  /* every hookGlyphDots update of the current line while placement is on */
  onTable(table) {
    if (!this.available() || !table || typeof table.text !== 'string') return;
    this.sync();
    if (this.confirmed >= 2 || this.failures >= 3) { this.marks(false); return; }
    if ((table.dots || []).some(d => d?.at && d.at.space !== '-')) return; /* the source reports positions: nothing to learn */
    if (!this.L.cells(table) || table.seq === this.handled) return;
    const seq = table.seq; clearTimeout(this.timer);
    /* the last record arrives with the last glyph: give the game a moment to present it */
    this.timer = setTimeout(() => this.step(table, seq).catch(e => this.trace('glyph locate: ' + e.message)), 180); this.timer.unref?.();
  }
  async step(table, seq) {
    if (this.handled === seq || this.confirmed >= 2 || this.failures >= 3) return; this.handled = seq;
    const f = await this.frame(); if (!f) { this.trace('glyph locate: no frame'); return; }
    if (!this.marksOn) { this.base = f; this.marks(true); this.trace('glyph locate: base frame, marks on'); return; }
    const base = this.base; this.base = null; this.marks(false); /* the next base must not hold this line's marks */
    if (!base || base.width !== f.width || base.height !== f.height) return;
    const found = this.L.findMarks(base.data, f.data, f.width, f.height), c = this.L.locate(table, found);
    if (!c) { this.failures++; this.trace('glyph locate: ' + found.length + ' marks, no fit (' + this.failures + '/3)'); if (this.failures >= 3) this.trace('glyph locate: given up for this run'); return; }
    const same = this.calib && Math.abs(this.calib.originX - c.originX) <= 3 && Math.abs(this.calib.originY - c.originY) <= 3;
    this.calib = this.L.merge(this.calib, c); this.confirmed = same ? this.confirmed + 1 : 1;
    if (this.confirmed >= 2) this.L.saveCalib(this.root, this.exeKey, this.calib);
    this.trace('glyph locate: origin ' + Math.round(this.calib.originX) + ',' + Math.round(this.calib.originY) + ' scale ' + this.calib.scale.toFixed(3) + (this.confirmed >= 2 ? ' confirmed' : ''));
  }
  /* boxes [x,y,w,h] (client px) per character of the line from the calibration; null without one. While the game types,
     characters without a record get the line's median size and stay out (null). */
  layout(table) {
    if (!this.L || !this.calib || !table || typeof table.text !== 'string') return null;
    this.sync(); if (!this.calib) return null;
    const chars = [...table.text], have = new Set(), dots = [];
    for (const d of table.dots || []) if (d && d.k === 'd' && d.i >= 0 && d.i < chars.length && !have.has(d.i) && d.ch === chars[d.i]) { have.add(d.i); dots.push(d); }
    if (!dots.length) return null;
    const med = k => { const v = dots.map(d => d[k]).filter(n => n > 0).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 0; };
    const h = med('h'), a = med('a') || h, b = med('b');
    const full = { seq: table.seq, text: table.text, dots: [...dots, ...chars.map((ch, i) => have.has(i) ? null : { i, ch, h, b, a: /[\x20-\x7e｡-ﾟ]/.test(ch) ? a / 2 : a, x: 0, y: 0, s: 0, k: 'd' }).filter(Boolean)] };
    const out = this.L.layout(full, this.calib); if (!out) return null;
    return out.rects.map((r, i) => have.has(i) ? [r.x, r.y, r.w, r.h] : null);
  }
  stop() { clearTimeout(this.timer); this.marks(false); }
}

module.exports = { GlyphLocateHost, available: () => !!L };
