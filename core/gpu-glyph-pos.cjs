// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Hide layer 4 glyph trace (native/gpuhide/GlyphTrace.h, docs/hide-layers.md "Glyph trace"): where the characters of a
   GetGlyphOutline engine (CLANNAD / Siglus, ISLAND / CatSystem2, AdvHD) were drawn, for the glyph records of ①
   (MeguLitFont, state.hookGlyphDots) whose space is "-" (no position known to GDI).

   DLL record: ToMe_GLYPHPOS line=<seq> sw=<back W> sh=<back H> n=<k> list=<u hex>,<x>,<y>,<w>,<h>;...
   - one entry per character drawn since the line started, in draw order, x/y/w/h = the glyph's ink box in back-buffer
     pixels (u 0 = drawn by glyph index, character unknown);
   - the back buffer is shown stretched over the client area, so the space is "m<sw>x<sh>" (core/glyph-place.cjs scales
     by client / back buffer, as for GDI memory surfaces).

   fillPlaces(table, pos): the line's characters (table.text, blanks already removed by ①) are matched to the entries in
   order (same character, or unknown), each next match after the previous one. A matched character's kind-d record gets
   `at` = the cell's top-left: x = the ink's left, y = the top of its row (the highest ink top of the entries on that row,
   so 。 and ー sit in the same cell row as kanji). A character with no ① record (the engine reused a cached glyph, so
   GetGlyphOutline was not called) gets one from the entry (h = row height, a = ink width, b = 0.8 h).
   Characters left unmatched stay as they were: core/glyph-place.cjs then returns null for the line (never guesses). */

function parseGlyphPos(line) {
  const m = /^ToMe_GLYPHPOS line=(\d+) sw=(\d+) sh=(\d+) n=(\d+) list=(.*)$/.exec(String(line || ''));
  if (!m) return null;
  const glyphs = [];
  for (const part of m[5].split(';')) {
    const f = /^([0-9A-Fa-f]{1,6}),(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(part);
    if (!f) continue;
    const u = parseInt(f[1], 16);
    glyphs.push({ch: u ? String.fromCodePoint(u) : '', x: +f[2], y: +f[3], w: +f[4], h: +f[5]});
  }
  return {line: +m[1], sw: +m[2], sh: +m[3], glyphs};
}

// rows: entries whose vertical centres lie within 0.6 of a glyph height of each other; returns the top of each entry's row
function rowTops(glyphs) {
  const tops = new Array(glyphs.length);
  const rows = [];
  glyphs.forEach((g, i) => {
    const c = g.y + g.h / 2;
    let r = rows.find((row) => Math.abs(row.c - c) <= 0.6 * Math.max(row.h, g.h));
    if (!r) { r = {c, h: g.h, top: g.y, bottom: g.y + g.h, members: []}; rows.push(r); }
    r.top = Math.min(r.top, g.y); r.bottom = Math.max(r.bottom, g.y + g.h); r.h = Math.max(r.h, g.h); r.members.push(i);
  });
  for (const r of rows) for (const i of r.members) tops[i] = {top: r.top, h: r.bottom - r.top};
  return tops;
}

function fillPlaces(table, pos) {
  if (!table || typeof table.text !== 'string' || !Array.isArray(table.dots) || !pos || !Array.isArray(pos.glyphs) || !pos.glyphs.length) return table;
  const chars = [...table.text];
  const space = `m${pos.sw}x${pos.sh}`;
  const tops = rowTops(pos.glyphs);
  const dots = table.dots.map((d) => ({...d}));
  let from = 0, placed = 0;
  for (let i = 0; i < chars.length; i++) {
    let j = from;
    while (j < pos.glyphs.length && pos.glyphs[j].ch && pos.glyphs[j].ch !== chars[i]) j++;
    if (j >= pos.glyphs.length) continue;
    from = j + 1;
    const g = pos.glyphs[j], row = tops[j];
    const at = {x: g.x, y: row.top, space};
    const d = dots.find((x) => x && x.k === 'd' && x.i === i);
    if (d) { if (!d.at || d.at.space === '-') d.at = at; }
    else dots.push({i, ch: chars[i], h: row.h, b: Math.round(row.h * 0.8), a: Math.max(1, g.w), x: 0, y: 0, s: 0, k: 'd', at});
    placed++;
  }
  return {...table, dots, gpuPlaced: placed};
}

module.exports = {parseGlyphPos, fillPlaces, rowTops};
