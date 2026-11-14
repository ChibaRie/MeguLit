// SPDX-License-Identifier: GPL-3.0-or-later
// GlyphTrace.h: where each GetGlyphOutline glyph ends up on screen (hide layer 4, MeguLitGpu; docs/hide-layers.md,
// "Glyph trace"). For engines that rasterise every character with GetGlyphOutline and copy the bitmap into their own
// Direct3D texture with their own code (CLANNAD / Siglus, ISLAND / CatSystem2, Under The Moon / AdvHD), no GDI call says
// where the character is drawn. Three steps, all generic:
//  1. Glyph: every GetGlyphOutline call that returns a bitmap (GGO_BITMAP, GGO_GRAY2/4/8) is queued with its character,
//     metrics and coverage (0..255), oldest first, for 1.5 s.
//  2. Write: a texture write (D3D9 LockRect/UnlockRect on a texture or its level-0 surface, UpdateSurface/UpdateTexture
//     copies, D3D11 UpdateSubresource) takes queued glyphs:
//     - a written rectangle of one glyph's size (the engine uploads glyph by glyph) takes the oldest glyph that fits;
//       inside it the bitmap is placed by content when the glyph has ink, else the rectangle is the cell;
//     - a bigger write (whole texture) is searched for each queued glyph's bitmap (anchor pixel + full compare), or,
//       for a blank glyph (MeguLitFont blank mode) that carries a mark pixel at its top-left (coverage 1..48 of 255),
//       for that mark with an empty box after it.
//     The cell (texture, texel rect, character) is kept; a later cell over the same texels replaces it.
//  3. Draw: a textured quad whose texel rect is centred on a known cell is that character, at the quad's place (render
//     target pixels mapped to the back buffer like layer 4's glyph rects). Per dialogue line (LINE from HookBridge) the
//     characters drawn since the line started are reported in draw order:
//       ToMe_GLYPHPOS line=<seq> sw=<back W> sh=<back H> n=<k> list=<u hex>,<x>,<y>,<w>,<h>;...
//     Positions closer than 40 % of the glyph height with the same character are one (shadow / outline passes).
//     A previous line still drawn after LINE (fading out) is reported too; the reader matches characters in order.
//     Cached glyphs (no new GetGlyphOutline call) are found through their cell like new ones.
#pragma once
#include <string>
#include <vector>
#include <deque>
#include <map>
#include <functional>
#include <cmath>
#include <stdint.h>
#include <stdio.h>

struct GtGlyph { unsigned ord, at; uint32_t u; int bw, bh, cell, ink; std::vector<uint8_t> cov; };
struct GtCell { int x, y, w, h; uint32_t u; unsigned ord; };

struct GlyphTrace {
 struct Q { float x0, y0, x1, y1, u0, v0, u1, v1; };
 struct Pos { uint32_t u; float x, y, w, h; unsigned order; };
 std::function<void(const std::string &)> emit; void (*log)(const char *, ...) = nullptr;
 std::deque<GtGlyph> pending; unsigned ord = 0, traced = 0;
 std::map<void *, std::vector<GtCell>> cells;
 unsigned seq = 0, lineAt = 0, order = 0, lastEmit = 0; bool dirty = false; std::vector<Pos> drawn;

 static int Pad(int h) { return (std::max)(8, h / 2); }
 void Expire(unsigned now) { while (!pending.empty() && (int)(now - pending.front().at) > 1500) pending.pop_front(); while (pending.size() > 256) pending.pop_front(); }

 // 1. GetGlyphOutline returned a bitmap. cov: bw x bh coverage 0..255 (row-major, no padding); cellH: the font's cell
 //    height (tmHeight), the upper bound of a one-glyph upload together with the advance.
 void Glyph(uint32_t u, int bw, int bh, int cellH, const uint8_t *cov, unsigned now) {
  if (bw <= 0 || bh <= 0 || bw > 512 || bh > 512) return; Expire(now);
  GtGlyph g; g.ord = ++ord; g.at = now; g.u = u; g.bw = bw; g.bh = bh; g.cell = (std::max)(cellH, (std::max)(bw, bh)); g.cov.assign(cov, cov + (size_t)bw * bh); g.ink = 0;
  for (uint8_t c : g.cov) if (c > 48) g.ink++;
  pending.push_back(std::move(g));
 }
 bool Waiting() const { return !pending.empty(); }
 bool Known(void *tex) const { return cells.count(tex) > 0; }

 void Keep(void *tex, const GtCell &c) {
  auto &v = cells[tex]; for (size_t i = 0; i < v.size();) { const GtCell &o = v[i]; if (o.x < c.x + c.w && c.x < o.x + o.w && o.y < c.y + c.h && c.y < o.y + o.h) v.erase(v.begin() + i); else i++; }
  if (v.size() >= 8192) v.erase(v.begin()); v.push_back(c); traced++; if (cells.size() > 256) { auto keep = cells[tex]; cells.clear(); cells[tex] = keep; }
 }
 // Best place of glyph g inside the region (rx,ry,rw,rh) of read(x,y) (-1 = unreadable): returns false when not found.
 template <class R> static bool Find(const GtGlyph &g, const R &read, int rx, int ry, int rw, int rh, int &fx, int &fy, const std::vector<GtCell> *taken = nullptr) {
  auto used = [&](int x, int y) { if (taken) for (const GtCell &c : *taken) if (x < c.x + c.w && c.x < x + g.bw && y < c.y + c.h && c.y < y + g.bh) return true; return false; };
  if (g.bw > rw || g.bh > rh) return false;
  if (g.ink >= 3) {
   int ax = 0, ay = 0, av = -1; for (int y = 0; y < g.bh; y++) for (int x = 0; x < g.bw; x++) if (g.cov[(size_t)y * g.bw + x] > av) { av = g.cov[(size_t)y * g.bw + x]; ax = x; ay = y; }
   for (int y = ry + ay; y <= ry + rh - g.bh + ay; y++) for (int x = rx + ax; x <= rx + rw - g.bw + ax; x++) {
    int t = read(x, y); if (t < 0) return false; if (std::abs(t - av) > 40) continue;
    int ox = x - ax, oy = y - ay; if (used(ox, oy)) continue; long diff = 0; int missing = 0;
    for (int yy = 0; yy < g.bh; yy++) for (int xx = 0; xx < g.bw; xx++) { int a = g.cov[(size_t)yy * g.bw + xx], b = read(ox + xx, oy + yy); if (b < 0) return false; diff += std::abs(a - b); if (a > 96 && b < 32) missing++; }
    if (diff <= 20L * g.bw * g.bh && missing * 10 <= g.ink) { fx = ox; fy = oy; return true; }
   }
   // not there with its ink: the engine may have received the blank of MeguLitFont (whose hook ran after ours)
  }
  // blank glyph with a mark pixel at its top-left (coverage 1..48), nothing else inside its box
  else if (g.cov[0] == 0) return false;
  for (int y = ry; y <= ry + rh - g.bh; y++) for (int x = rx; x <= rx + rw - g.bw; x++) {
   int t = read(x, y); if (t < 0) return false; if (t < 1 || t > 48 || used(x, y)) continue; bool empty = true;
   for (int yy = 0; yy < g.bh && empty; yy++) for (int xx = 0; xx < g.bw; xx++) { if (!xx && !yy) continue; int b = read(x + xx, y + yy); if (b < 0 || b > 2) { empty = false; break; } }
   if (empty) { fx = x; fy = y; return true; }
  }
  return false;
 }
 // 2. Texels (x, y, w, h) of texture tex were written; read(x, y) gives the written coverage (0..255) or -1.
 template <class R> void Write(void *tex, int x, int y, int w, int h, bool whole, const R &read, unsigned now) {
  Expire(now); if (pending.empty() || w <= 0 || h <= 0) return;
  if (!whole) for (size_t i = 0; i < pending.size(); i++) { const GtGlyph &g = pending[i];
   // one glyph's upload: as big as the glyph's box at least, at most its cell plus a margin
   if (w + 1 < g.bw || h + 1 < g.bh || w > g.cell + Pad(g.cell) || h > g.cell + Pad(g.cell)) continue;
   GtCell c{ x, y, w, h, g.u, g.ord }; int fx, fy; if (g.ink >= 3 && Find(g, read, x, y, w, h, fx, fy)) c = GtCell{ fx, fy, g.bw, g.bh, g.u, g.ord };
   Keep(tex, c); if (log) log("glyph trace: U+%04X ord=%u -> tex %p texels %d,%d %dx%d (upload)", g.u, g.ord, tex, c.x, c.y, c.w, c.h);
   pending.erase(pending.begin(), pending.begin() + i + 1); return; }
  if ((long long)w * h > 4LL * 1024 * 1024) return;
  std::vector<GtCell> taken;
  for (size_t i = 0; i < pending.size();) { const GtGlyph &g = pending[i]; int fx, fy;
   if (Find(g, read, x, y, w, h, fx, fy, &taken)) { taken.push_back(GtCell{ fx, fy, g.bw, g.bh, g.u, g.ord }); Keep(tex, taken.back()); if (log) log("glyph trace: U+%04X ord=%u -> tex %p texels %d,%d %dx%d (content)", g.u, g.ord, tex, fx, fy, g.bw, g.bh); pending.erase(pending.begin() + i); }
   else i++; }
 }
 // A copy of texels (sx, sy, w, h) of src to (dx, dy) of dst (UpdateSurface / UpdateTexture / CopySubresourceRegion).
 void Copy(void *src, void *dst, int sx, int sy, int w, int h, int dx, int dy) {
  auto it = cells.find(src); if (it == cells.end() || src == dst) return; std::vector<GtCell> add;
  for (const GtCell &c : it->second) if (c.x >= sx && c.y >= sy && c.x + c.w <= sx + w && c.y + c.h <= sy + h) add.push_back(GtCell{ c.x - sx + dx, c.y - sy + dy, c.w, c.h, c.u, c.ord });
  for (auto &c : add) Keep(dst, c);
 }
 void Line(unsigned s, unsigned now) {
  seq = s; lineAt = now; drawn.clear(); order = 0; dirty = false;
 }
 void Off() { seq = 0; drawn.clear(); }
 // 3. One draw of quads from texture tex (tw x th); toBack maps a render-target rect to back-buffer pixels (false = not yet).
 template <class M> void Draw(void *tex, unsigned tw, unsigned th, const std::vector<Q> &q, const M &toBack, unsigned now) {
  if (!seq || !tw || !th) return; auto it = cells.find(tex); if (it == cells.end()) return; const auto &cv = it->second;
  for (const Q &d : q) {
   float cx = (d.u0 + d.u1) * 0.5f * tw, cy = (d.v0 + d.v1) * 0.5f * th, uw = std::fabs(d.u1 - d.u0) * tw, vh = std::fabs(d.v1 - d.v0) * th;
   const GtCell *hit = nullptr; for (const GtCell &c : cv) if (cx >= c.x - 1 && cx <= c.x + c.w + 1 && cy >= c.y - 1 && cy <= c.y + c.h + 1 && uw <= c.w * 2 + 4 && vh <= c.h * 2 + 4) { hit = &c; break; }
   if (!hit) continue;
   float r[4] = { (std::min)(d.x0, d.x1), (std::min)(d.y0, d.y1), (std::max)(d.x0, d.x1), (std::max)(d.y0, d.y1) }; if (!toBack(r)) continue;
   float w = r[2] - r[0], h = r[3] - r[1]; if (w < 1 || h < 1) continue;
   bool dup = false; for (const Pos &p : drawn) if (p.u == hit->u && std::fabs(p.x - r[0]) < h * 0.4f && std::fabs(p.y - r[1]) < h * 0.4f) { dup = true; break; }
   if (dup || drawn.size() >= 400) continue;
   drawn.push_back(Pos{ hit->u, r[0], r[1], w, h, ++order }); dirty = true;
  }
 }
 void Frame(unsigned now, unsigned bbW, unsigned bbH) {
  if (!dirty || !emit || (int)(now - lastEmit) < 120) return; dirty = false; lastEmit = now;
  std::string l = "ToMe_GLYPHPOS line=" + std::to_string(seq) + " sw=" + std::to_string(bbW) + " sh=" + std::to_string(bbH) + " n=" + std::to_string(drawn.size()) + " list=";
  for (size_t i = 0; i < drawn.size(); i++) { char b[80]; snprintf(b, sizeof b, "%s%X,%.0f,%.0f,%.0f,%.0f", i ? ";" : "", drawn[i].u, drawn[i].x, drawn[i].y, drawn[i].w, drawn[i].h); l += b; }
  emit(l);
 }
};

// Coverage 0..255 of one texel of a locked surface in the formats glyph uploads use (-1: other formats).
static inline int GtTexel(const unsigned char *row, int x, int fmt) {
 switch (fmt) {
  case 21: case 32: { const unsigned char *p = row + x * 4; return p[3]; }                       // A8R8G8B8, A8B8G8R8: alpha
  case 22: case 33: { const unsigned char *p = row + x * 4; return (std::max)(p[0], (std::max)(p[1], p[2])); } // X8: brightest channel
  case 28: case 50: return row[x];                                                                  // A8, L8
  case 51: return row[x * 2 + 1];                                                                   // A8L8: alpha
  case 26: return (row[x * 2 + 1] >> 4) * 17;                                                       // A4R4G4B4: alpha
  default: return -1;
 }
}
// GetGlyphOutline bitmap -> coverage 0..255 (rows are DWORD aligned; mono 1 bit, gray 0..4 / 0..16 / 0..64).
static inline bool GtCoverage(unsigned format, const unsigned char *buf, unsigned size, int bw, int bh, std::vector<uint8_t> &out) {
 format &= 0x0F; if (bw <= 0 || bh <= 0) return false; int levels = format == 4 ? 4 : format == 5 ? 16 : format == 6 ? 64 : format == 1 ? 1 : 0; if (!levels) return false;
 unsigned pitch = format == 1 ? ((bw + 31) / 32) * 4 : (bw + 3) & ~3u; if ((unsigned long long)pitch * bh > size) return false; out.assign((size_t)bw * bh, 0);
 for (int y = 0; y < bh; y++) for (int x = 0; x < bw; x++) { int v = format == 1 ? ((buf[y * pitch + x / 8] >> (7 - x % 8)) & 1) : buf[y * pitch + x]; out[(size_t)y * bw + x] = (uint8_t)((std::min)(v, levels) * 255 / levels); }
 return true;
}
