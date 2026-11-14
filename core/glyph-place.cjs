// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Text architecture ①, placement (docs/text-architecture.md, "Placement"): the current line's glyph records
   (HookNative state.hookGlyphDots, MeguLitFont records version 4) as one box per non-blank character of the line, in
   the game window's client pixels, for the reader overlay (core/overlay-placement.cjs). The game drew the line blank;
   these boxes say where each character would have been.
   - space "c": already client pixels.
   - space "m<W>x<H>" / "t<W>x<H>": pixels of the surface the game drew into (back buffer, Direct2D target). The game
     shows that surface stretched over its client area, so the point is scaled by client/W, client/H.
   - space "g" (GDI+ world units) and "-" (GetGlyphOutline: no position) cannot be placed.
   A line is placeable only when every character of it has a box; otherwise null (the overlay must not guess).
   Of several records for one index (shadow/outline passes, kind c redraws) the first kind-d record wins. */

function scaleOf(space, client) {
  if (space === 'c') return [1, 1];
  const m = /^[mt](\d{1,5})x(\d{1,5})$/.exec(space || '');
  if (!m || !client || !(client[0] > 0) || !(client[1] > 0)) return null;
  const w = Number(m[1]), h = Number(m[2]);
  return w > 0 && h > 0 ? [client[0] / w, client[1] / h] : null;
}

/* table: {seq, text, dots:[{i,ch,h,b,a,k,at:{x,y,space}}]}; client: [width, height] of the game's client area.
   Returns {seq, text, rects:[{x,y,w,h,baseline}], space} or null. */
function glyphRects(table, client) {
  if (!table || typeof table.text !== 'string' || !Array.isArray(table.dots)) return null;
  const chars = [...table.text];
  if (!chars.length) return null;
  const by = new Map();
  for (const d of table.dots) {
    if (!d || d.k !== 'd' || !Number.isInteger(d.i) || d.i < 0 || d.i >= chars.length || by.has(d.i)) continue;
    if (d.ch !== chars[d.i] || !d.at) continue;
    by.set(d.i, d);
  }
  if (by.size !== chars.length) return null;
  const rects = [], spaces = new Set();
  for (let i = 0; i < chars.length; i++) {
    const d = by.get(i), s = scaleOf(d.at.space, client);
    if (!s) return null;
    spaces.add(d.at.space);
    rects.push({x: d.at.x * s[0], y: d.at.y * s[1], w: Math.max(1, d.a) * s[0], h: Math.max(1, d.h) * s[1], baseline: d.b * s[1]});
  }
  return {seq: table.seq, text: table.text, rects, space: spaces.size === 1 ? [...spaces][0] : 'mixed'};
}

module.exports = {glyphRects, scaleOf};
