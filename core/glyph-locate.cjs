// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Text architecture ①, placement for GetGlyphOutline engines (docs/text-architecture.md, "Locating marks").
   Those engines place each glyph bitmap themselves, so the glyph records carry no position (space "-"). With
   `MARK on` the DLL leaves ONE pixel of coverage 1/64 (at most 4 of 255 levels, on one pixel) at the black-box top-left of
   the first, second and last character of a line (record s = 1). This module:
   - findMarks(prev, cur, w, h): the marks that appeared between two captures of the game's client area (frame
     difference; small isolated changes only, anything near a large change is animation and ignored);
   - locate(table, marks): the line origin (cell top-left of the first character), the scale between glyph pixels and
     client pixels, the row pitch and the wrap width, by matching the marks against the line's own advances;
   - merge(old, new): one calibration per game (the text box rarely moves; a new origin replaces the old one);
   - layout(table, calib): every character's box in client pixels from its advance (greedy wrap at the learned width,
     optional kinsoku), in the same shape as glyph-place.glyphRects.
   Captures are the reader's (PrintWindow / Windows.Graphics.Capture of the game window); this module only reads pixels.
   Marks are for locating only, never for covering anything. */
const fs = require('node:fs'), path = require('node:path');

const NO_START = new Set([...'、。，．・：；？！ー～…‥」』）］｝〉》】〕”’ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々!?),.']);

/* RGBA / BGRA byte buffers of the same size. A mark = a cluster of at most 3x3 pixels changed by 1..maxSmall levels, with
   no pixel changed by more within one pixel around it. Returns [{x,y,n}] (cluster top-left, pixel count). */
function findMarks(prev, cur, w, h, {maxSmall = 12} = {}) {
  const d = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const v = Math.max(Math.abs(cur[p] - prev[p]), Math.abs(cur[p + 1] - prev[p + 1]), Math.abs(cur[p + 2] - prev[p + 2]));
    d[i] = v === 0 ? 0 : v <= maxSmall ? 1 : 2;
  }
  const seen = new Uint8Array(w * h), out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = y * w + x; if (d[s] !== 1 || seen[s]) continue;
    const stack = [s]; seen[s] = 1; let x0 = x, y0 = y, x1 = x, y1 = y, n = 0, big = false;
    while (stack.length) {
      const q = stack.pop(), qx = q % w, qy = (q - qx) / w; n++;
      x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ax = qx + dx, ay = qy + dy; if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
        const t = ay * w + ax; if (d[t] === 2) big = true; else if (d[t] === 1 && !seen[t]) { seen[t] = 1; stack.push(t); }
      }
    }
    if (!big && n <= 9 && x1 - x0 <= 2 && y1 - y0 <= 2) out.push({x: x0, y: y0, n});
  }
  return out;
}

/* The line's characters with their records: [{ch,a,h,b,x,y,s}] in order, or null when a character has no record. */
function cells(table) {
  if (!table || typeof table.text !== 'string' || !Array.isArray(table.dots)) return null;
  const chars = [...table.text], by = new Map();
  for (const d of table.dots) if (d && d.k === 'd' && Number.isInteger(d.i) && d.i >= 0 && d.i < chars.length && d.ch === chars[d.i] && !by.has(d.i)) by.set(d.i, d);
  if (!chars.length || by.size !== chars.length) return null;
  return chars.map((ch, i) => { const d = by.get(i); return {ch, a: d.a, h: d.h, b: d.b, x: d.x, y: d.y, s: d.s}; });
}

/* Greedy rows: pen (glyph px) and row of every character for wrap width W (glyph px); kinsoku keeps a character that may
   not start a line on the previous row (hanging). */
function rows(c, W, kinsoku) {
  const out = []; let pen = 0, row = 0;
  for (let i = 0; i < c.length; i++) {
    if (pen > 0 && pen + c[i].a > W && !(kinsoku && NO_START.has(c[i].ch))) { pen = 0; row++; }
    out.push({pen, row}); pen += c[i].a;
  }
  return out;
}

const near = (m, x, y, tol) => Math.abs(m.x - x) <= tol && Math.abs(m.y - y) <= tol;

/* Solve the line placement from its marks. Returns {originX, originY, scale, pitch, wrapMin, wrapMax, kinsoku} (client px
   for origin/pitch, glyph px for the wrap range) or null. tol: pixel tolerance of a match. */
function locate(table, marks, {tol = 1.5} = {}) {
  const c = cells(table); if (!c || c.length < 2 || !Array.isArray(marks) || marks.length < 2) return null;
  const n = c.length, A = [0]; for (const x of c) A.push(A[A.length - 1] + x.a);
  const last = n - 1, results = [];
  for (const p of marks) for (const q of marks) {
    if (q === p || q.x <= p.x || Math.abs(q.y - p.y) > 2) continue;
    const span = A[1] + c[1].x - c[0].x; if (span <= 0) continue;
    const k = (q.x - p.x) / span; if (k < 0.25 || k > 4) continue;
    const ox = p.x - k * c[0].x, oy = p.y - k * c[0].y;
    if (Math.abs(oy + k * c[1].y - q.y) > tol + 1) continue;
    if (last < 2) { results.push({originX: ox, originY: oy, scale: k, pitch: null, wrapMin: A[n], wrapMax: Infinity, kinsoku: null, score: 2}); continue; }
    // the last character: one row (no wrap), or a later row for some wrap width W
    // a scale from two neighbours is coarse (whole pixels over one advance): the same row's last mark refines it
    const far = A[last] + c[last].x - c[0].x;
    const one = marks.find(m => m !== p && m !== q && Math.abs(m.y - p.y) <= 2 && Math.abs((m.x - p.x) / far - k) <= k * 0.06 + 2 / far);
    if (one) { const k1 = (one.x - p.x) / far; results.push({originX: p.x - k1 * c[0].x, originY: p.y - k1 * c[0].y, scale: k1, pitch: null, wrapMin: A[n], wrapMax: Infinity, kinsoku: null, score: 3}); continue; }
    for (const r of marks) {
      if (r === p || r === q || r.y <= p.y + k * c[0].h * 0.5) continue;
      for (const kin of [false, true]) {
        let lo = Infinity, hi = -Infinity, pitch = null;
        for (let j = 2; j < n; j++) {
          const W = A[j], lay = rows(c, W, kin), L = lay[last]; if (L.row < 1 || L.row > 4) continue;
          const px = ox + k * (L.pen + c[last].x); if (Math.abs(px - r.x) > tol + 2 * (L.pen + c[last].x) / span) continue;
          const pt = (r.y - oy - k * c[last].y) / L.row; if (pt < k * c[0].h * 0.8 || pt > k * c[0].h * 3) continue;
          // every W in [A[j], next breakpoint) gives the same rows: keep the range
          lo = Math.min(lo, W); let nx = A[n]; for (let t = j + 1; t <= n; t++) if (A[t] > W) { nx = A[t]; break; }
          hi = Math.max(hi, nx); pitch = pitch === null ? pt : (pitch + pt) / 2;
        }
        if (pitch !== null) results.push({originX: ox, originY: oy, scale: k, pitch, wrapMin: lo, wrapMax: hi, kinsoku: kin, score: 3});
      }
    }
  }
  if (!results.length) return null;
  results.sort((a, b) => b.score - a.score || (a.wrapMax - a.wrapMin) - (b.wrapMax - b.wrapMin));
  const best = results[0]; delete best.score; return best;
}

/* One calibration per game: same origin (within 3 px) narrows the wrap range and keeps a pitch; another origin replaces. */
function merge(old, next) {
  if (!next) return old || null; if (!old || Math.abs(old.originX - next.originX) > 3 || Math.abs(old.originY - next.originY) > 3 || Math.abs(old.scale - next.scale) > 0.02) return {...next};
  const lo = Math.max(old.wrapMin, next.wrapMin), hi = Math.min(old.wrapMax, next.wrapMax);
  return {originX: (old.originX + next.originX) / 2, originY: (old.originY + next.originY) / 2, scale: (old.scale + next.scale) / 2,
    pitch: old.pitch && next.pitch ? (old.pitch + next.pitch) / 2 : old.pitch || next.pitch, wrapMin: lo <= hi ? lo : next.wrapMin, wrapMax: lo <= hi ? hi : next.wrapMax,
    kinsoku: next.kinsoku ?? old.kinsoku};
}

/* Every character's box in client px from a calibration (null when the line has no complete records). */
function layout(table, calib) {
  const c = cells(table); if (!c || !calib) return null;
  const W = Number.isFinite(calib.wrapMax) ? (calib.wrapMin + calib.wrapMax) / 2 : Infinity, k = calib.scale;
  const lay = rows(c, W, calib.kinsoku === true), pitch = calib.pitch || k * c[0].h * 1.5;
  const rects = c.map((x, i) => ({x: calib.originX + k * lay[i].pen, y: calib.originY + lay[i].row * pitch, w: k * x.a, h: k * x.h, baseline: k * x.b}));
  return {seq: table.seq, kind: 'd', text: table.text, rects, space: 'c', located: true};
}

/* data/glyph-place/<exe name>-<size>.json, the same naming as the dialogue-font memory. */
function calibFile(root, exe) {
  try { const size = fs.statSync(exe).size; return path.join(root, 'data', 'glyph-place', path.basename(exe).replace(/[^A-Za-z0-9._-]/g, '_') + '-' + size + '.json'); } catch { return ''; }
}
function loadCalib(root, exe) { try { const j = JSON.parse(fs.readFileSync(calibFile(root, exe), 'utf8')); if (j.wrapMax === null) j.wrapMax = Infinity; return Number.isFinite(j.originX) && j.scale > 0 ? j : null; } catch { return null; } }
function saveCalib(root, exe, calib) {
  const f = calibFile(root, exe); if (!f || !calib) return false;
  try { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, JSON.stringify({...calib, wrapMax: Number.isFinite(calib.wrapMax) ? calib.wrapMax : null, at: new Date().toISOString()})); return true; } catch { return false; }
}

module.exports = {findMarks, locate, merge, layout, rows, cells, calibFile, loadCalib, saveCalib};
