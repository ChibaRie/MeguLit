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

/* table: {seq, text, dots:[{i,ch,h,b,a,k,at:{x,y,space}}]} (a line), or an extra line from state.hookGlyphExtras
   ({id, kind:'n'|'o', text, dots}); client: [width, height] of the game's client area.
   Returns {seq, text, rects:[{x,y,w,h,baseline}], space} or null. */
function glyphRects(table, client) {
  const kind = table && (table.kind === 'n' || table.kind === 'o') ? table.kind : 'd';
  if (!table || typeof table.text !== 'string' || !Array.isArray(table.dots)) return null;
  const chars = [...table.text];
  if (!chars.length) return null;
  const by = new Map();
  for (const d of table.dots) {
    if (!d || d.k !== kind || !Number.isInteger(d.i) || d.i < 0 || d.i >= chars.length || by.has(d.i)) continue;
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
  return {seq: table.seq ?? table.id, kind, text: table.text, rects, space: spaces.size === 1 ? [...spaces][0] : 'mixed'};
}

/* Where to click so the game gets a click on this choice: the centre of its boxes, in client pixels. The reader posts
   it to the game window (PostMessage WM_LBUTTONDOWN/UP with these client coordinates); the real cursor never moves. */
function clickPoint(placed) {
  if (!placed || !Array.isArray(placed.rects) || !placed.rects.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of placed.rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return {x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2)};
}

/* Every placeable extra line (names, choices) of state.hookGlyphExtras, newest first per kind. */
function extraRects(extras, client) {
  const out = [];
  for (const t of Object.values(extras || {}).sort((a, b) => b.id - a.id)) { const r = glyphRects(t, client); if (r) out.push(r.kind === 'o' ? {...r, click: clickPoint(r)} : r); }
  return out;
}

module.exports = {glyphRects, scaleOf, clickPoint, extraRects};
