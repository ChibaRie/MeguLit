// SPDX-License-Identifier: GPL-3.0-or-later
// Dot font, in place (text architecture: "dot the font at its source", docs/text-architecture.md). Given the bytes of a
// TrueType font or collection (sfnt 0x00010000 / 'true' / 'ttcf'), every glyph outline is replaced inside its own glyf
// slot by one small square at the glyph's black-box top-left (side = unitsPerEm / 12, clipped to the black box), the
// rest of the slot zeroed. Nothing else changes: cmap, hmtx/vmtx advances, ascent/descent, kerning, units per em, loca
// and every table size stay as they were, so the engine lays out and wraps exactly as before and the buffer keeps its
// length (the caller swaps it in place: a file read, a mapped view, a decrypted copy in memory). Embedded bitmap strikes
// (EBLC/EBDT, CBLC/CBDT, bloc/bdat, sbix) are switched off by renaming their tags, so no size falls back to the
// original pixels. CFF ('OTTO') fonts get the same square through their Type 2 charstrings (see Cff below).
// Pure: no Windows calls; self-test native/fontdot/selftest.
#pragma once
#include <stdint.h>
#include <string.h>

namespace FontDot {
 static inline uint16_t U16(const uint8_t *p) { return (uint16_t)(p[0] << 8 | p[1]); }
 static inline int16_t S16(const uint8_t *p) { return (int16_t)U16(p); }
 static inline uint32_t U32(const uint8_t *p) { return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }
 static inline void W16(uint8_t *p, int v) { p[0] = (uint8_t)((uint16_t)v >> 8); p[1] = (uint8_t)v; }
 static const uint32_t TAG_TTCF = 0x74746366, TAG_TRUE = 0x74727565, TAG_OTTO = 0x4F54544F, SFNT = 0x00010000;

 struct Result { int fonts = 0, glyphs = 0, dotted = 0, emptied = 0, cff = 0, strikes = 0; uint32_t size = 0; bool ok = false; };

 // One sfnt (table directory at `off` in buf). Fills the needed end of the font into *end.
 static bool Table(const uint8_t *buf, size_t len, size_t off, uint32_t tag, uint32_t *at, uint32_t *size) {
  if (off + 12 > len) return false; int n = U16(buf + off + 4);
  for (int i = 0; i < n; i++) { size_t r = off + 12 + 16 * (size_t)i; if (r + 16 > len) return false;
   if (U32(buf + r) == tag) { *at = U32(buf + r + 8); *size = U32(buf + r + 12); return (size_t)*at + *size <= len; } }
  return false;
 }
 // Is there a plausible sfnt header at buf[off]? Returns the bytes the font needs from buf start (max table end), 0 if not.
 static uint32_t SfntExtent(const uint8_t *buf, size_t len, size_t off) {
  if (off + 12 > len) return 0; uint32_t v = U32(buf + off);
  if (v != SFNT && v != TAG_TRUE && v != TAG_OTTO) return 0;
  int n = U16(buf + off + 4); if (n < 4 || n > 64) return 0;
  int sr = U16(buf + off + 6), es = U16(buf + off + 8);
  int p = 1, e = 0; while (p * 2 <= n) { p *= 2; e++; } if (sr != p * 16 || es != e) return 0;
  if (off + 12 + 16 * (size_t)n > len) return 0;
  uint32_t end = 0, prev = 0; bool head = false, cmap = false;
  for (int i = 0; i < n; i++) { const uint8_t *r = buf + off + 12 + 16 * i; uint32_t tag = U32(r), o = U32(r + 8), l = U32(r + 12);
   if (i && tag <= prev) return 0; prev = tag; if (o > 0x40000000u || l > 0x40000000u) return 0;
   if (o + l > end) end = o + l; if (tag == 0x68656164) head = true; if (tag == 0x636D6170) cmap = true; }
  return head && cmap ? end : 0;
 }
 // Bytes needed for the whole font or collection starting at buf (0: not a font). For a collection the table offsets
 // are relative to the collection start, as they are in a single font relative to its own start.
 static uint32_t Extent(const uint8_t *buf, size_t len) {
  if (len < 12) return 0;
  if (U32(buf) == TAG_TTCF) { uint32_t n = U32(buf + 8); if (n < 1 || n > 64 || 12 + 4 * (size_t)n > len) return 0; uint32_t end = 0;
   for (uint32_t i = 0; i < n; i++) { uint32_t o = U32(buf + 12 + 4 * i); uint32_t e = SfntExtent(buf, len, o); if (!e) return 0; if (e > end) end = e; }
   return end; }
  return SfntExtent(buf, len, 0);
 }
 // Only the table directory is needed to know the extent: how many leading bytes must be read before Extent() works.
 static uint32_t HeaderBytes(const uint8_t *buf, size_t len) {
  if (len < 12) return 12;
  if (U32(buf) == TAG_TTCF) { uint32_t n = U32(buf + 8); if (n > 64) return 0; uint32_t need = 12 + 4 * n; if (len < need) return need;
   for (uint32_t i = 0; i < n; i++) { uint32_t o = U32(buf + 12 + 4 * i); uint32_t d = o + 12; if (len < d) return d > need ? d : need; uint32_t t = o + 12 + 16 * U16(buf + o + 4); if (t > need) need = t; }
   return need; }
  return 12 + 16 * (uint32_t)U16(buf + 4);
 }

 static void Dot(uint8_t *g, uint32_t glen, int upem, Result &r) {
  if (glen < 10) return; // empty glyph (space): nothing to draw
  int16_t nc = S16(g); int x0 = S16(g + 2), y0 = S16(g + 4), x1 = S16(g + 6), y1 = S16(g + 8);
  if (nc == 0) return;
  r.glyphs++;
  int s = upem / 12; if (s < 1) s = 1; int w = x1 - x0, h = y1 - y0;
  int sx = s < w && w > 0 ? s : (w > 0 ? w : s), sy = s < h && h > 0 ? s : (h > 0 ? h : s);
  if (glen < 34) { memset(g, 0, glen); r.emptied++; return; } // no room for a square: draw nothing (still hidden)
  memset(g, 0, glen);
  W16(g, 1); W16(g + 2, x0); W16(g + 4, y1 - sy); W16(g + 6, x0 + sx); W16(g + 8, y1);
  W16(g + 10, 3); W16(g + 12, 0);                           // endPtsOfContours[0] = 3, no instructions
  g[14] = g[15] = g[16] = g[17] = 0x01;                      // 4 on-curve points, int16 deltas
  W16(g + 18, x0); W16(g + 20, sx); W16(g + 22, 0); W16(g + 24, -sx);  // (x0,y1) (x0+sx,y1) (x0+sx,y1-sy) (x0,y1-sy)
  W16(g + 26, y1); W16(g + 28, 0); W16(g + 30, -sy); W16(g + 32, 0);   // clockwise: TrueType outer contour
  r.dotted++;
 }

 // ---- CFF (OpenType 'OTTO'): each Type 2 charstring is rewritten in its own slot as "x y rmoveto s 0 rlineto 0 -s
 // rlineto -s 0 rlineto endchar" (no width operand: advances come from hmtx), the rest of the slot zero (ignored after
 // endchar). x = hmtx left side bearing (= xMin for CFF), top = vertical origin - vmtx top side bearing (VORG or the
 // ascender as origin); without vmtx the OS/2 typo ascender x 0.88 (the usual CJK top) stands in.
 static int CffNum(uint8_t *p, int v) {
  if (v >= -107 && v <= 107) { p[0] = (uint8_t)(v + 139); return 1; }
  if (v >= 108 && v <= 1131) { v -= 108; p[0] = (uint8_t)((v >> 8) + 247); p[1] = (uint8_t)v; return 2; }
  if (v <= -108 && v >= -1131) { v = -v - 108; p[0] = (uint8_t)((v >> 8) + 251); p[1] = (uint8_t)v; return 2; }
  p[0] = 28; p[1] = (uint8_t)((uint16_t)v >> 8); p[2] = (uint8_t)v; return 3;
 }
 // INDEX at p: count, offsets; returns the byte after it and fills data start / offSize.
 static bool CffIndex(const uint8_t *base, size_t len, size_t at, uint32_t *count, uint32_t *offSize, size_t *data, size_t *next) {
  if (at + 2 > len) return false; *count = U16(base + at); if (*count == 0) { *next = at + 2; *offSize = 0; *data = at + 2; return true; }
  if (at + 3 > len) return false; *offSize = base[at + 2]; if (*offSize < 1 || *offSize > 4) return false;
  size_t offs = at + 3; *data = offs + (*count + 1) * (size_t)*offSize - 1; if (*data >= len) return false;
  uint32_t last = 0; for (uint32_t k = 0; k < *offSize; k++) last = last << 8 | base[offs + *count * (size_t)*offSize + k];
  *next = *data + last; return *next <= len;
 }
 static uint32_t CffOff(const uint8_t *base, size_t offs, uint32_t offSize, uint32_t i) { uint32_t v = 0; for (uint32_t k = 0; k < offSize; k++) v = v << 8 | base[offs + i * (size_t)offSize + k]; return v; }
 // Top DICT: the CharStrings offset (operator 17).
 static bool CffCharStrings(const uint8_t *d, size_t n, uint32_t *at) {
  int32_t stack[48]; int sp = 0; size_t i = 0;
  while (i < n) { uint8_t b = d[i];
   if (b <= 21) { int op = b; i++; if (b == 12) { if (i >= n) return false; op = 1200 + d[i++]; }
    if (op == 17 && sp >= 1) { *at = (uint32_t)stack[sp - 1]; return true; } sp = 0; continue; }
   int32_t v = 0;
   if (b == 28) { if (i + 3 > n) return false; v = (int16_t)(d[i + 1] << 8 | d[i + 2]); i += 3; }
   else if (b == 29) { if (i + 5 > n) return false; v = (int32_t)((uint32_t)d[i + 1] << 24 | (uint32_t)d[i + 2] << 16 | (uint32_t)d[i + 3] << 8 | d[i + 4]); i += 5; }
   else if (b == 30) { i++; while (i < n) { uint8_t c = d[i++]; if ((c & 15) == 15 || (c >> 4) == 15) break; } v = 0; }
   else if (b >= 32 && b <= 246) { v = b - 139; i++; }
   else if (b >= 247 && b <= 250) { if (i + 2 > n) return false; v = (b - 247) * 256 + d[i + 1] + 108; i += 2; }
   else if (b >= 251 && b <= 254) { if (i + 2 > n) return false; v = -(b - 251) * 256 - d[i + 1] - 108; i += 2; }
   else return false;
   if (sp < 48) stack[sp++] = v; }
  return false;
 }
 static void Cff(uint8_t *buf, size_t len, size_t off, Result &r) {
  uint32_t cAt, cLen, hAt, hLen, mAt, mLen, hhAt, hhLen, xAt, xLen;
  if (!Table(buf, len, off, 0x43464620, &cAt, &cLen) || !Table(buf, len, off, 0x68656164, &hAt, &hLen) || hLen < 54 ||
      !Table(buf, len, off, 0x6D617870, &mAt, &mLen) || !Table(buf, len, off, 0x68686561, &hhAt, &hhLen) || hhLen < 36 ||
      !Table(buf, len, off, 0x686D7478, &xAt, &xLen)) return;
  int upem = U16(buf + hAt + 18), glyphs = U16(buf + mAt + 4), nH = U16(buf + hhAt + 34); if (upem < 16 || nH < 1) return;
  uint32_t vAt = 0, vLen = 0, vhAt = 0, vhLen = 0, oAt = 0, oLen = 0, gAt = 0, gLen = 0; int nV = 0, origin = 0;
  bool vm = Table(buf, len, off, 0x766D7478, &vAt, &vLen) && Table(buf, len, off, 0x76686561, &vhAt, &vhLen) && vhLen >= 36;
  if (vm) nV = U16(buf + vhAt + 34);
  bool vorg = Table(buf, len, off, 0x564F5247, &gAt, &gLen) && gLen >= 8;
  int typoAsc = (int)(upem * 0.88);
  if (Table(buf, len, off, 0x4F532F32, &oAt, &oLen) && oLen >= 72) { origin = S16(buf + oAt + 68); typoAsc = origin * 88 / 100; } else origin = S16(buf + hhAt + 4);
  if (vorg) origin = S16(buf + gAt + 4);
  const uint8_t *c = buf + cAt; uint8_t *cw = buf + cAt; size_t cl = cLen;
  if (cl < 4) return; size_t at = c[2]; uint32_t cnt, osz; size_t data, next;
  if (!CffIndex(c, cl, at, &cnt, &osz, &data, &next)) return;           // Name INDEX
  at = next; if (!CffIndex(c, cl, at, &cnt, &osz, &data, &next) || cnt < 1) return; // Top DICT INDEX
  size_t t0 = data + CffOff(c, at + 3, osz, 0), t1 = data + CffOff(c, at + 3, osz, 1); if (t1 > cl || t0 >= t1) return;
  uint32_t csAt; if (!CffCharStrings(c + t0, t1 - t0, &csAt) || csAt >= cl) return;
  if (!CffIndex(c, cl, csAt, &cnt, &osz, &data, &next)) return;
  int s = upem / 12; if (s < 1) s = 1;
  for (uint32_t g = 0; g < cnt && (int)g < glyphs; g++) {
   size_t a = data + CffOff(c, csAt + 3, osz, g), b = data + CffOff(c, csAt + 3, osz, g + 1); if (b <= a || b > cl) continue;
   uint8_t *p = cw + a; size_t n = b - a;
   if (n <= 1) continue; // endchar only: empty glyph
   r.glyphs++;
   int lsb = 0; { int k = (int)g < nH ? (int)g : nH - 1; size_t at2 = xAt + 4 * (size_t)k + 2; if ((int)g >= nH) at2 = xAt + 4 * (size_t)nH + 2 * ((size_t)g - nH); if (at2 + 2 <= (size_t)xAt + xLen) lsb = S16(buf + at2); }
   int top = typoAsc;
   if (vm && vLen) { int k = (int)g < nV ? (int)g : nV - 1; size_t at3 = (int)g < nV ? vAt + 4 * (size_t)g + 2 : vAt + 4 * (size_t)nV + 2 * ((size_t)g - nV);
    if (at3 + 2 <= (size_t)vAt + vLen) { int o = origin;
     if (vorg) { int nv = U16(buf + gAt + 6); for (int q = 0; q < nv; q++) { size_t e = gAt + 8 + 4 * (size_t)q; if (e + 4 > (size_t)gAt + gLen) break; if (U16(buf + e) == g) { o = S16(buf + e + 2); break; } } }
     top = o - S16(buf + at3); (void)k; } }
   uint8_t tmp[32]; int w = 0;
   w += CffNum(tmp + w, lsb); w += CffNum(tmp + w, top); tmp[w++] = 21;     // rmoveto
   w += CffNum(tmp + w, s); w += CffNum(tmp + w, 0); tmp[w++] = 5;          // rlineto
   w += CffNum(tmp + w, 0); w += CffNum(tmp + w, -s); tmp[w++] = 5;
   w += CffNum(tmp + w, -s); w += CffNum(tmp + w, 0); tmp[w++] = 5;
   tmp[w++] = 14;                                                           // endchar
   if ((size_t)w > n) { memset(p, 0, n); p[0] = 14; r.emptied++; continue; }
   memset(p, 0, n); memcpy(p, tmp, w); r.dotted++;
  }
 }

 static void Sfnt(uint8_t *buf, size_t len, size_t off, Result &r) {
  uint32_t v = U32(buf + off); int n = U16(buf + off + 4);
  for (int i = 0; i < n; i++) { uint8_t *t = buf + off + 12 + 16 * i; uint32_t tag = U32(t);
   if (tag == 0x45424C43 || tag == 0x45424454 || tag == 0x43424C43 || tag == 0x43424454 || tag == 0x626C6F63 || tag == 0x62646174 || tag == 0x73626978) { t[0] = 'x'; r.strikes++; } }
  r.fonts++;
  if (v == TAG_OTTO) { r.cff++; Cff(buf, len, off, r); return; }
  uint32_t hAt, hLen, mAt, mLen, lAt, lLen, gAt, gLen;
  if (!Table(buf, len, off, 0x68656164, &hAt, &hLen) || hLen < 54 || !Table(buf, len, off, 0x6D617870, &mAt, &mLen) || mLen < 6 ||
      !Table(buf, len, off, 0x6C6F6361, &lAt, &lLen) || !Table(buf, len, off, 0x676C7966, &gAt, &gLen)) return;
  if (U32(buf + hAt + 12) != 0x5F0F3CF5) return; // head.magicNumber
  int upem = U16(buf + hAt + 18), longLoca = S16(buf + hAt + 50), glyphs = U16(buf + mAt + 4);
  if (upem < 16) return;
  for (int i = 0; i < glyphs; i++) {
   uint32_t a, b;
   if (longLoca) { if (lLen < 4 * (uint32_t)(i + 2)) break; a = U32(buf + lAt + 4 * i); b = U32(buf + lAt + 4 * i + 4); }
   else { if (lLen < 2 * (uint32_t)(i + 2)) break; a = 2u * U16(buf + lAt + 2 * i); b = 2u * U16(buf + lAt + 2 * i + 2); }
   if (b <= a || b > gLen) continue;
   Dot(buf + gAt + a, b - a, upem, r);
  }
 }

 // Patch a whole font / collection in place. buf must hold Extent(buf) bytes.
 static Result Patch(uint8_t *buf, size_t len) {
  Result r; uint32_t e = Extent(buf, len); if (!e || e > len) return r; r.size = e;
  if (U32(buf) == TAG_TTCF) { uint32_t n = U32(buf + 8); for (uint32_t i = 0; i < n; i++) Sfnt(buf, len, U32(buf + 12 + 4 * i), r); }
  else Sfnt(buf, len, 0, r);
  r.ok = r.fonts > 0; return r;
 }
}
