// SPDX-License-Identifier: GPL-3.0-or-later
// MeguLit capture compositor, part ② of docs/text-architecture.md: finds the glyph dots that part ① (feat/glyph-dots)
// makes the game draw instead of each glyph of the current line, keeps them tracked frame by frame (typewriter reveal,
// fades, shake/scroll, NVL pages that keep earlier lines), maps them in reading order onto the reported characters, and
// inpaints them away. Plain C++17, no Windows types: the same code runs in the compositor and in the synthetic self-test.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#if defined(_M_X64) || defined(_M_IX86) || defined(__SSE2__)
#include <emmintrin.h>
#define MEGU_SSE2 1
#endif

namespace megu {

struct Rgb { int r = 0, g = 0, b = 0; };
struct Box { int x0 = 0, y0 = 0, x1 = 0, y1 = 0; int w() const { return x1 - x0; } int h() const { return y1 - y0; } bool empty() const { return x1 <= x0 || y1 <= y0; } };

// BGRA8 image view (the D3D11 capture format). Pixels outside [0,w)x[0,h) are never touched.
struct Image {
  uint8_t *px = nullptr; int w = 0, h = 0, stride = 0;
  const uint8_t *at(int x, int y) const { return px + (size_t)y * stride + (size_t)x * 4; }
  uint8_t *at(int x, int y) { return px + (size_t)y * stride + (size_t)x * 4; }
};

struct Dot {
  float cx = 0, cy = 0;   // centre, frame pixels
  Box box;                // pixels covered, x1/y1 exclusive
  float alpha = 1;        // 1 = full text colour, lower while the game fades the line
  Rgb color;              // mean colour of the dot core
  bool cell = false;      // a placed character cell (not a found mark): erased exactly, no flood
};

struct LineSpec {
  int id = 0;
  int expected = -1;          // dots the line will have once fully shown (non-space characters); -1 = unknown
  int hint = 0;               // dots ① reported for the line so far (learning only: a colour with far fewer is not the text's)
  int vertical = -1;          // 1 vertical, 0 horizontal, -1 infer
  float em = 0;               // game font size in frame pixels, 0 = unknown
  bool colorKnown = false; Rgb color;
  std::vector<Box> cells;     // optional glyph cells from the hook (frame pixels): priors only
};

enum class LineStatus { Waiting, Revealing, Complete, Fading, Mismatch, Lost };
inline const char *StatusName(LineStatus s) {
  switch (s) { case LineStatus::Waiting: return "waiting"; case LineStatus::Revealing: return "revealing"; case LineStatus::Complete: return "complete";
    case LineStatus::Fading: return "fading"; case LineStatus::Mismatch: return "mismatch"; default: return "lost"; }
}

struct TrackResult {
  LineStatus status = LineStatus::Waiting;
  std::vector<Dot> dots;                 // current line, reading order: dots[i] is the i-th non-space character
  struct Kept { int id = 0; std::vector<Dot> dots; };
  std::vector<Kept> kept;
  std::vector<Dot> orphans;               // page view: untracked dots of earlier lines on this page, reading order                // earlier lines still on screen (NVL), oldest first, with their line ids
  bool vertical = false;
  float pitch = 0;                       // glyph advance measured from the dots
  float lineStep = 0;                    // distance between wrapped rows / columns
  Box area;                              // union of every dot seen this page: the measured text area
  int learnedFrames = 0;
};

inline int ColorDist(const uint8_t *p, const Rgb &c) { return std::abs(p[2] - c.r) + std::abs(p[1] - c.g) + std::abs(p[0] - c.b); }
inline int ColorDist(const Rgb &a, const Rgb &b) { return std::abs(a.r - b.r) + std::abs(a.g - b.g) + std::abs(a.b - b.b); }

struct Blob { Box box; int area = 0; double sx = 0, sy = 0, sr = 0, sg = 0, sb = 0; float cx() const { return float(sx / area); } float cy() const { return float(sy / area); } Rgb mean() const { return { int(sr / area + .5), int(sg / area + .5), int(sb / area + .5) }; } };

// Shape test shared by both search modes: a dot is a small solid near-square.
inline bool DotShaped(const Blob &b, int smin, int smax) {
  const int w = b.box.w(), h = b.box.h();
  // Spec 1 (docs/text-architecture.md ①): a solid square of side 3 (2 under 12 px), clipped to the glyph's black box,
  // so thin glyphs (ー 一 、) give 3x1, 1x3, 2x1 ... blocks. Those are accepted when completely solid.
  if (w <= 3 && h <= 3 && w >= 1 && h >= 1) return b.area == w * h;
  // Spec 2: the side follows the cell (max(3, h/10), 14 px for a 136 px cell), clipped to the black box like spec 1:
  // any completely solid block up to smax counts when it is not a long thin line (thin only up to 6 px long).
  if (b.area == w * h && w <= smax && h <= smax && (std::min(w, h) >= 2 || std::max(w, h) <= 6)) return true;
  if (w < smin || h < smin || w > smax || h > smax) return false;
  if (std::abs(w - h) > std::max(1, std::max(w, h) / 4)) return false;
  return b.area * 4 >= w * h * 3;
}

// Ring of pixels just outside the box: the local background.
inline bool RingMean(const Image &im, const Box &b, Rgb &out) {
  long r = 0, g = 0, bl = 0, n = 0;
  auto add = [&](int x, int y) { if (x < 0 || y < 0 || x >= im.w || y >= im.h) return; const uint8_t *p = im.at(x, y); bl += p[0]; g += p[1]; r += p[2]; ++n; };
  for (int x = b.x0 - 1; x <= b.x1; ++x) { add(x, b.y0 - 2); add(x, b.y1 + 1); }
  for (int y = b.y0 - 1; y <= b.y1; ++y) { add(b.x0 - 2, y); add(b.x1 + 1, y); }
  if (!n) return false;
  out = { int(r / n), int(g / n), int(bl / n) };
  return true;
}

// Components of pixels passing `in(x,y)` inside roi (4-connected). Seeds are tested on the even grid only: every dot
// is at least 2x2 px, and every 2x2 block holds one even/even pixel, so no dot is missed while the scan touches a quarter
// of the frame. `seen` is a stamp buffer (no clearing per frame).
struct Visit { std::vector<uint32_t> stamp; uint32_t gen = 0; int w = 0, h = 0;
  void begin(int iw, int ih) { if (iw != w || ih != h || gen == 0xffffffffu) { stamp.assign(size_t(iw) * ih, 0); w = iw; h = ih; gen = 0; } ++gen; }
  bool test(int x, int y) { uint32_t &s = stamp[size_t(y) * w + x]; if (s == gen) return true; s = gen; return false; } };
template <class In> void MaskBlobs(const Image &im, Box roi, In in, int smax, std::vector<Blob> &out, Visit &seen, std::vector<int> &stack) {
  out.clear();
  roi.x0 = std::max(roi.x0, 0); roi.y0 = std::max(roi.y0, 0); roi.x1 = std::min(roi.x1, im.w); roi.y1 = std::min(roi.y1, im.h);
  if (roi.empty()) return;
  seen.begin(im.w, im.h);
  for (int y = roi.y0 & ~1; y < roi.y1; y += 2) {
    if (y < roi.y0) continue;
    for (int x = roi.x0 & ~1; x < roi.x1; x += 2) {
      if (x < roi.x0 || seen.stamp[size_t(y) * im.w + x] == seen.gen || !in(x, y)) continue;
      seen.test(x, y);
      Blob b; b.box = { x, y, x + 1, y + 1 }; bool tooBig = false;
      stack.clear(); stack.push_back(y * im.w + x);
      while (!stack.empty()) {
        const int s = stack.back(); stack.pop_back();
        const int gx = s % im.w, gy = s / im.w; const uint8_t *p = im.at(gx, gy);
        ++b.area; b.sx += gx + .5; b.sy += gy + .5; b.sb += p[0]; b.sg += p[1]; b.sr += p[2];
        b.box.x0 = std::min(b.box.x0, gx); b.box.y0 = std::min(b.box.y0, gy); b.box.x1 = std::max(b.box.x1, gx + 1); b.box.y1 = std::max(b.box.y1, gy + 1);
        if (b.box.w() > smax || b.box.h() > smax) { tooBig = true; if (b.area > smax * smax * 4) break; }
        const int nx[4] = { gx - 1, gx + 1, gx, gx }, ny[4] = { gy, gy, gy - 1, gy + 1 };
        for (int k = 0; k < 4; ++k) {
          if (nx[k] < roi.x0 || ny[k] < roi.y0 || nx[k] >= roi.x1 || ny[k] >= roi.y1) continue;
          if (seen.stamp[size_t(ny[k]) * im.w + nx[k]] == seen.gen || !in(nx[k], ny[k])) continue;
          seen.test(nx[k], ny[k]); stack.push_back(ny[k] * im.w + nx[k]);
        }
      }
      if (!tooBig) out.push_back(b);
    }
  }
}
// Colour search over every pixel (clipped dots can be 1 px thin). SSE2 tests 4 pixels per step; matches start a flood
// fill. ~0.6 ms for 1920x1080 when almost nothing matches.
inline void ColorBlobs(const Image &im, Box roi, const Rgb &c, int tol, int smax, std::vector<Blob> &out, Visit &seen, std::vector<int> &stack) {
  out.clear();
  roi.x0 = std::max(roi.x0, 0); roi.y0 = std::max(roi.y0, 0); roi.x1 = std::min(roi.x1, im.w); roi.y1 = std::min(roi.y1, im.h);
  if (roi.empty()) return;
  seen.begin(im.w, im.h);
  auto in = [&](int x, int y) { return ColorDist(im.at(x, y), c) <= tol; };
  auto grow = [&](int x, int y) {
    Blob b; b.box = { x, y, x + 1, y + 1 }; bool tooBig = false;
    seen.test(x, y); stack.clear(); stack.push_back(y * im.w + x);
    while (!stack.empty()) {
      const int s = stack.back(); stack.pop_back();
      const int gx = s % im.w, gy = s / im.w; const uint8_t *p = im.at(gx, gy);
      ++b.area; b.sx += gx + .5; b.sy += gy + .5; b.sb += p[0]; b.sg += p[1]; b.sr += p[2];
      b.box.x0 = std::min(b.box.x0, gx); b.box.y0 = std::min(b.box.y0, gy); b.box.x1 = std::max(b.box.x1, gx + 1); b.box.y1 = std::max(b.box.y1, gy + 1);
      if (b.box.w() > smax || b.box.h() > smax) { tooBig = true; if (b.area > smax * smax * 4) break; }
      const int nx[4] = { gx - 1, gx + 1, gx, gx }, ny[4] = { gy, gy, gy - 1, gy + 1 };
      for (int k = 0; k < 4; ++k) {
        if (nx[k] < roi.x0 || ny[k] < roi.y0 || nx[k] >= roi.x1 || ny[k] >= roi.y1) continue;
        if (seen.stamp[size_t(ny[k]) * im.w + nx[k]] == seen.gen || !in(nx[k], ny[k])) continue;
        seen.test(nx[k], ny[k]); stack.push_back(ny[k] * im.w + nx[k]);
      }
    }
    if (!tooBig) out.push_back(b);
  };
#ifdef MEGU_SSE2
  const __m128i col = _mm_set1_epi32(int((uint32_t(c.r) << 16) | (uint32_t(c.g) << 8) | uint32_t(c.b)));
  const __m128i rgbMask = _mm_set1_epi32(0x00ffffff), lo = _mm_set1_epi32(0xff), lim = _mm_set1_epi32(tol);
#endif
  for (int y = roi.y0; y < roi.y1; ++y) {
    const uint8_t *row = im.at(0, y);
    int x = roi.x0;
#ifdef MEGU_SSE2
    for (; x + 4 <= roi.x1; x += 4) {
      const __m128i px = _mm_and_si128(_mm_loadu_si128(reinterpret_cast<const __m128i *>(row + x * 4)), rgbMask);
      const __m128i d = _mm_or_si128(_mm_subs_epu8(px, col), _mm_subs_epu8(col, px)); // |a-b| per byte
      const __m128i sum = _mm_add_epi32(_mm_add_epi32(_mm_and_si128(d, lo), _mm_and_si128(_mm_srli_epi32(d, 8), lo)), _mm_and_si128(_mm_srli_epi32(d, 16), lo));
      const int m = _mm_movemask_ps(_mm_castsi128_ps(_mm_cmpgt_epi32(_mm_add_epi32(lim, _mm_set1_epi32(1)), sum)));
      if (!m) continue;
      for (int k = 0; k < 4; ++k) if ((m >> k) & 1) { const int xx = x + k; if (seen.stamp[size_t(y) * im.w + xx] != seen.gen) grow(xx, y); }
    }
#endif
    for (; x < roi.x1; ++x) if (seen.stamp[size_t(y) * im.w + x] != seen.gen && in(x, y)) grow(x, y);
  }
}

// Colour-agnostic search used to learn the text colour: components of near-equal neighbouring pixels (union-find),
// kept when dot-shaped and clearly different from their surroundings.
inline void PlateauBlobs(const Image &im, Box roi, int smin, int smax, std::vector<Blob> &out, std::vector<int> &parent, int minContrast = 60) {
  out.clear();
  roi.x0 = std::max(roi.x0, 0); roi.y0 = std::max(roi.y0, 0); roi.x1 = std::min(roi.x1, im.w); roi.y1 = std::min(roi.y1, im.h);
  if (roi.empty()) return;
  const int rw = roi.w(), rh = roi.h(); const int n = rw * rh;
  parent.resize(n);
  for (int i = 0; i < n; ++i) parent[i] = i;
  auto find = [&](int a) { while (parent[a] != a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  auto join = [&](int a, int b) { a = find(a); b = find(b); if (a != b) parent[std::max(a, b)] = std::min(a, b); };
  const int tol = 18;
  for (int y = 0; y < rh; ++y) for (int x = 0; x < rw; ++x) {
    const uint8_t *p = im.at(x + roi.x0, y + roi.y0);
    if (x + 1 < rw) { const uint8_t *q = p + 4; if (std::abs(p[0] - q[0]) + std::abs(p[1] - q[1]) + std::abs(p[2] - q[2]) <= tol) join(y * rw + x, y * rw + x + 1); }
    if (y + 1 < rh) { const uint8_t *q = im.at(x + roi.x0, y + 1 + roi.y0); if (std::abs(p[0] - q[0]) + std::abs(p[1] - q[1]) + std::abs(p[2] - q[2]) <= tol) join(y * rw + x, (y + 1) * rw + x); }
  }
  // Accumulate per root; roots with a too-large box are dropped as soon as they grow past smax.
  std::vector<int> slot(n, -1); std::vector<Blob> all; std::vector<uint8_t> big;
  for (int y = 0; y < rh; ++y) for (int x = 0; x < rw; ++x) {
    const int r = find(y * rw + x);
    int &s = slot[r];
    const int gx = x + roi.x0, gy = y + roi.y0;
    if (s < 0) { s = int(all.size()); Blob b; b.box = { gx, gy, gx + 1, gy + 1 }; all.push_back(b); big.push_back(0); }
    if (big[s]) continue;
    Blob &b = all[s]; const uint8_t *p = im.at(gx, gy);
    ++b.area; b.sx += gx + .5; b.sy += gy + .5; b.sb += p[0]; b.sg += p[1]; b.sr += p[2];
    b.box.x0 = std::min(b.box.x0, gx); b.box.y0 = std::min(b.box.y0, gy); b.box.x1 = std::max(b.box.x1, gx + 1); b.box.y1 = std::max(b.box.y1, gy + 1);
    if (b.box.w() > smax || b.box.h() > smax) big[s] = 1;
  }
  for (size_t i = 0; i < all.size(); ++i) {
    if (big[i] || !DotShaped(all[i], smin, smax)) continue;
    Rgb ring; if (!RingMean(im, all[i].box, ring)) continue;
    if (ColorDist(all[i].mean(), ring) < minContrast) continue;
    out.push_back(all[i]);
  }
}

inline float Median(std::vector<float> v) { if (v.empty()) return 0; std::nth_element(v.begin(), v.begin() + v.size() / 2, v.end()); return v[v.size() / 2]; }

// Nearest-neighbour distance between dot centres: the glyph advance (pitch).
inline float Pitch(const std::vector<Dot> &d) {
  std::vector<float> nn;
  for (size_t i = 0; i < d.size(); ++i) {
    float best = 1e9f;
    for (size_t j = 0; j < d.size(); ++j) if (i != j) best = std::min(best, std::hypot(d[i].cx - d[j].cx, d[i].cy - d[j].cy));
    if (best < 1e9f) nn.push_back(best);
  }
  return Median(nn);
}

inline bool InferVertical(const std::vector<Dot> &d) {
  int v = 0, h = 0;
  for (size_t i = 0; i < d.size(); ++i) {
    float best = 1e9f; float dx = 0, dy = 0;
    for (size_t j = 0; j < d.size(); ++j) if (i != j) { const float e = std::hypot(d[i].cx - d[j].cx, d[i].cy - d[j].cy); if (e < best) { best = e; dx = std::fabs(d[i].cx - d[j].cx); dy = std::fabs(d[i].cy - d[j].cy); } }
    if (best < 1e9f) (dy > dx ? v : h)++;
  }
  return v > h;
}

// Reading order: horizontal = rows top→bottom, left→right; vertical = columns right→left, top→bottom. Rows/columns are
// clustered on the cross axis so centred and ragged lines and slightly jittered dots still order correctly.
inline void ReadingOrder(std::vector<Dot> &d, bool vertical, float pitch, float *lineStep = nullptr) {
  if (d.empty()) return;
  // Spec-1 dots sit at the top-left of each glyph's black box, which varies inside a row by up to ~0.7 em (。、ー sit
  // low), while rows are at least ~1.2 em apart: cluster on the cross axis with 0.75 pitch.
  const float tol = std::max(2.f, pitch > 0 ? pitch * .75f : 8.f);
  auto cross = [&](const Dot &a) { return vertical ? -a.cx : a.cy; };
  auto along = [&](const Dot &a) { return vertical ? a.cy : a.cx; };
  std::sort(d.begin(), d.end(), [&](const Dot &a, const Dot &b) { return cross(a) < cross(b); });
  std::vector<std::vector<Dot>> rows; std::vector<float> rowKey;
  for (const Dot &x : d) {
    if (!rows.empty() && std::fabs(cross(x) - rowKey.back()) <= tol) { rows.back().push_back(x); rowKey.back() = (rowKey.back() * (rows.back().size() - 1) + cross(x)) / rows.back().size(); }
    else { rows.push_back({ x }); rowKey.push_back(cross(x)); }
  }
  d.clear();
  for (auto &r : rows) { std::sort(r.begin(), r.end(), [&](const Dot &a, const Dot &b) { return along(a) < along(b); }); d.insert(d.end(), r.begin(), r.end()); }
  if (lineStep) { std::vector<float> steps; for (size_t i = 1; i < rowKey.size(); ++i) steps.push_back(rowKey[i] - rowKey[i - 1]); *lineStep = Median(steps); }
}

// Alpha of a dot at its known place: projection of (pixel − background) on (text colour − background).
inline float DotAlpha(const Image &im, const Box &b, const Rgb &text) {
  if (b.x0 < 0 || b.y0 < 0 || b.x1 > im.w || b.y1 > im.h || b.empty()) return 0;
  Rgb ring; if (!RingMean(im, b, ring)) return 0;
  // Core: inner pixels only, the edge may be antialiased.
  Box core = b; if (core.w() > 2) { ++core.x0; --core.x1; } if (core.h() > 2) { ++core.y0; --core.y1; }
  double r = 0, g = 0, bl = 0; int n = 0;
  for (int y = core.y0; y < core.y1; ++y) for (int x = core.x0; x < core.x1; ++x) { const uint8_t *p = im.at(x, y); bl += p[0]; g += p[1]; r += p[2]; ++n; }
  r /= n; g /= n; bl /= n;
  const double tr = text.r - ring.r, tg = text.g - ring.g, tb = text.b - ring.b;
  const double den = tr * tr + tg * tg + tb * tb;
  if (den < 900) return ColorDist(Rgb{ int(r), int(g), int(bl) }, text) < 24 ? 1.f : 0.f;
  const double a = ((r - ring.r) * tr + (g - ring.g) * tg + (bl - ring.b) * tb) / den;
  // Reject colours that are far off the background→text line (something else drawn there).
  const double er = r - (ring.r + a * tr), eg = g - (ring.g + a * tg), eb = bl - (ring.b + a * tb);
  if (std::sqrt(er * er + eg * eg + eb * eb) > 40) return 0;
  return float(std::clamp(a, 0.0, 1.0));
}

// Engines that draw a shadow or an outline by drawing the glyph several times leave offset copies of the dot in other
// colours (①: "several dots per character"). The erase box grows over every pixel within 4 px of the dot that clearly
// differs from the background ring at 6 px and is 8-connected to the dot or its copies.
inline Box EraseBox(const Image &im, const Box &dot, int reach = 4) {
  reach = std::max(reach, std::max(dot.w(), dot.h()));
  Box w{ dot.x0 - reach, dot.y0 - reach, dot.x1 + reach, dot.y1 + reach };
  if (w.x0 < 2 || w.y0 < 2 || w.x1 > im.w - 2 || w.y1 > im.h - 2) return dot;
  Rgb bg; { long r = 0, g = 0, b = 0, n = 0; for (int x = w.x0 - 2; x < w.x1 + 2; ++x) for (int y : { w.y0 - 2, w.y1 + 1 }) { const uint8_t *p = im.at(x, y); b += p[0]; g += p[1]; r += p[2]; ++n; }
    for (int y = w.y0; y < w.y1; ++y) for (int x : { w.x0 - 2, w.x1 + 1 }) { const uint8_t *p = im.at(x, y); b += p[0]; g += p[1]; r += p[2]; ++n; } bg = { int(r / n), int(g / n), int(b / n) }; }
  const int W = w.w(), H = w.h();
  std::vector<uint8_t> mark(size_t(W) * H, 0), on(size_t(W) * H, 0);
  for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) on[y * W + x] = ColorDist(im.at(w.x0 + x, w.y0 + y), bg) > 48;
  std::vector<int> st;
  for (int y = dot.y0; y < dot.y1; ++y) for (int x = dot.x0; x < dot.x1; ++x) { const int i = (y - w.y0) * W + (x - w.x0); mark[i] = 1; st.push_back(i); }
  Box out = dot;
  while (!st.empty()) {
    const int i = st.back(); st.pop_back(); const int x = i % W, y = i / W;
    for (int dy = -2; dy <= 2; ++dy) for (int dx = -2; dx <= 2; ++dx) { // bridges a 1 px gap (clipped dot + its copy)
      const int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const int j = ny * W + nx; if (mark[j] || !on[j]) continue;
      mark[j] = 1; st.push_back(j);
      out.x0 = std::min(out.x0, w.x0 + nx); out.y0 = std::min(out.y0, w.y0 + ny); out.x1 = std::max(out.x1, w.x0 + nx + 1); out.y1 = std::max(out.y1, w.y0 + ny + 1);
    }
  }
  return out;
}

// Spec-1 dots have hard edges: the pixels right around a dot are background, not a blend toward the text colour.
// Fragments of real antialiased glyphs (a name label, a menu, an engine that still draws some text itself) fail this.
inline bool HardEdged(const Image &im, const Box &b, const Rgb &text) {
  if (std::max(b.w(), b.h()) > 3) return true; // not a spec-1 size (e.g. the game scaled its frame): edges prove nothing
  if (b.x0 < 3 || b.y0 < 3 || b.x1 > im.w - 3 || b.y1 > im.h - 3) return true;
  Rgb bg; { long r = 0, g = 0, bl = 0, n = 0; auto add = [&](int x, int y) { const uint8_t *p = im.at(x, y); bl += p[0]; g += p[1]; r += p[2]; ++n; };
    for (int x = b.x0 - 3; x < b.x1 + 3; ++x) { add(x, b.y0 - 3); add(x, b.y1 + 2); } for (int y = b.y0 - 2; y < b.y1 + 2; ++y) { add(b.x0 - 3, y); add(b.x1 + 2, y); } bg = { int(r / n), int(g / n), int(bl / n) }; }
  const double tr = text.r - bg.r, tg = text.g - bg.g, tb = text.b - bg.b, den = tr * tr + tg * tg + tb * tb;
  if (den < 900) return true; // text colour ≈ background: nothing to judge by
  int soft = 0; double worst = 0;
  auto test = [&](int x, int y) { const uint8_t *p = im.at(x, y); const double a = ((p[2] - bg.r) * tr + (p[1] - bg.g) * tg + (p[0] - bg.b) * tb) / den; worst = std::max(worst, a); if (a > .3) ++soft; };
  for (int x = b.x0 - 1; x <= b.x1; ++x) { test(x, b.y0 - 1); test(x, b.y1); }
  for (int y = b.y0; y < b.y1; ++y) { test(b.x0 - 1, y); test(b.x1, y); }
  return worst <= .6 && soft < 3;
}

// A dot stands alone in its glyph cell: within 7 px of it (outside its own 1 px rim) there is nothing in the text
// colour. A fragment of a real glyph (a dakuten, the tip of a stroke) always has more of its glyph right next to it —
// also when the game scales its frame and the dot loses its hard edge, so this replaces an edge test.
inline bool Isolated(const Image &im, const Box &b, const Rgb &text, int tol, int reach = 7) {
  reach = std::max(reach, 2 * std::max(b.w(), b.h())); // larger (spec 2) dots carry larger rims and shadow offsets
  int n = 0;
  for (int y = std::max(0, b.y0 - reach); y < std::min(im.h, b.y1 + reach); ++y)
    for (int x = std::max(0, b.x0 - reach); x < std::min(im.w, b.x1 + reach); ++x) {
      if (x >= b.x0 - 1 && x <= b.x1 && y >= b.y0 - 1 && y <= b.y1) continue;
      if (ColorDist(im.at(x, y), text) <= tol * 3 && ++n > 2) return false;
    }
  return true;
}

// Inpaint, first choice: copy a same-sized patch from right next to the box (above, below, left, right, shifted by an
// even amount so 2-pixel dither and other short periodic patterns keep their phase), the one whose 1 px ring matches the
// box's ring best. Exact on flat, dithered and regularly textured boxes; returns false when no neighbour matches well
// (then the bilinear fill below is used).
inline bool PatchInpaint(Image &im, const Box &b) {
  const int w = b.w(), h = b.h(), W2 = (w + 1) & ~1, H2 = (h + 1) & ~1;
  const int sh[4][2] = { { 0, -H2 }, { 0, H2 }, { -W2, 0 }, { W2, 0 } };
  auto ringDiff = [&](int dx, int dy) {
    long d = 0; int n = 0;
    auto cmp = [&](int x, int y) { const uint8_t *p = im.at(x, y), *q = im.at(x + dx, y + dy); d += std::abs(p[0] - q[0]) + std::abs(p[1] - q[1]) + std::abs(p[2] - q[2]); ++n; };
    for (int x = b.x0 - 1; x <= b.x1; ++x) { cmp(x, b.y0 - 1); cmp(x, b.y1); }
    for (int y = b.y0; y < b.y1; ++y) { cmp(b.x0 - 1, y); cmp(b.x1, y); }
    return n ? double(d) / n : 1e9;
  };
  int best = -1; double bd = 1e9;
  for (int k = 0; k < 4; ++k) {
    const int dx = sh[k][0], dy = sh[k][1];
    if (b.x0 - 1 + dx < 0 || b.y0 - 1 + dy < 0 || b.x1 + dx >= im.w || b.y1 + dy >= im.h || b.x0 - 1 < 0 || b.y0 - 1 < 0 || b.x1 >= im.w || b.y1 >= im.h) continue;
    const double d = ringDiff(dx, dy);
    if (d < bd) { bd = d; best = k; }
  }
  if (best < 0 || bd > 18) return false;
  const int dx = sh[best][0], dy = sh[best][1];
  for (int y = b.y0; y < b.y1; ++y) memcpy(im.at(b.x0, y), im.at(b.x0 + dx, y + dy), size_t(w) * 4);
  return true;
}

// Inpaint: every pixel of the (1 px padded) dot box becomes the distance-weighted mix of the four pixels just outside the
// box on its row and column. Dots are a few pixels wide, so this matches flat, gradient and lightly textured boxes.
inline void Inpaint(Image &im, const Box &dotBox, int pad = 1) {
  Box b{ dotBox.x0 - pad, dotBox.y0 - pad, dotBox.x1 + pad, dotBox.y1 + pad };
  b.x0 = std::max(b.x0, 1); b.y0 = std::max(b.y0, 1); b.x1 = std::min(b.x1, im.w - 1); b.y1 = std::min(b.y1, im.h - 1);
  if (b.empty()) return;
  if (PatchInpaint(im, b)) return;
  // Sample the borders first: writing pixels must not feed later samples.
  const int w = b.w(), h = b.h();
  std::vector<uint8_t> L(h * 4), R(h * 4), T(w * 4), B(w * 4);
  for (int y = 0; y < h; ++y) { memcpy(&L[y * 4], im.at(b.x0 - 1, b.y0 + y), 4); memcpy(&R[y * 4], im.at(b.x1, b.y0 + y), 4); }
  for (int x = 0; x < w; ++x) { memcpy(&T[x * 4], im.at(b.x0 + x, b.y0 - 1), 4); memcpy(&B[x * 4], im.at(b.x0 + x, b.y1), 4); }
  for (int y = 0; y < h; ++y) for (int x = 0; x < w; ++x) {
    const float wl = 1.f / (x + 1), wr = 1.f / (w - x), wt = 1.f / (y + 1), wb = 1.f / (h - y), s = wl + wr + wt + wb;
    uint8_t *p = im.at(b.x0 + x, b.y0 + y);
    for (int c = 0; c < 4; ++c) p[c] = uint8_t((L[y * 4 + c] * wl + R[y * 4 + c] * wr + T[x * 4 + c] * wt + B[x * 4 + c] * wb) / s + .5f);
  }
}

// Frame-to-frame state for one game window.
class DotTracker {
public:
  struct Options { int smin = 1, smax = 14, colorTol = 20; float keepRatio = .9f; int lostFrames = 45; };
  explicit DotTracker(Options o = {}) : opt(o) {}

  void BeginLine(const LineSpec &s) {
    // The old line stays a candidate "kept" line (NVL) until the next frame shows whether it is still on screen.
    prevLine = cur.dots;
    if (!cur.dots.empty()) { pendingKeep = cur.dots; pendingId = spec.id; pendingFrames = 0; pendingStable = 0; pendingLastTotal = -1; }
    spec = s; wholeTried = false;
    if (s.colorKnown) { color = s.color; colorKnown = true; }
    if (cur.pitch > 0) lastPitch = cur.pitch;
    const bool vert = cur.vertical;
    cur = TrackResult{}; cur.vertical = vert; cur.pitch = lastPitch; cur.kept = keptLines; cur.area = area; prevCount = 0; missFrames = 0; maxSeen = 0; wantBase = true;
  }
  // ① reports which characters became dots shortly after drawing them: the line's dot count is that, not its length.
  void SetExpected(int n) { spec.expected = n; }
  void SetHint(int n) { spec.hint = n; }
  void EndPage() { keptLines.clear(); pendingKeep.clear(); area = {}; }
  // The caller placed orphan dots on an earlier line of the page: from now on it is followed like any kept line.
  void AddKept(int id, const std::vector<Dot> &d) { for (auto &k : keptLines) if (k.id == id) return; keptLines.push_back({ id, d }); std::sort(keptLines.begin(), keptLines.end(), [](const TrackResult::Kept &a, const TrackResult::Kept &b) { return a.id < b.id; }); cur.kept = keptLines; }
  bool IsKept(int id) const { for (auto &k : keptLines) if (k.id == id) return true; return false; }
  // More dots than the line has (an NVL page drawn ahead): keep the last n in reading order as the line, the rest are
  // earlier lines' dots (returned for the caller to place).
  std::vector<Dot> TrimCurrent(int n) { std::vector<Dot> rest; if (n <= 0 || int(cur.dots.size()) <= n) return rest; rest.assign(cur.dots.begin(), cur.dots.end() - n); cur.dots.erase(cur.dots.begin(), cur.dots.end() - n); return rest; }
  // Fallback for the current line: forget its dots so they are neither kept nor inpainted.
  void DropCurrent() { cur.dots.clear(); pendingKeep.clear(); }
  bool HasColor() const { return colorKnown; }
  void ForgetColor() { colorKnown = false; dotSize = 0; wholeTried = false; }
  Rgb Color() const { return color; }
  const LineSpec &Spec() const { return spec; }

  // One captured frame (BGRA, full client area). Returns the current line's dots in reading order.
  const TrackResult &Update(const Image &im) {
    // Base = the frame before the line message arrived. Without one (first frame ever) there is no base: nothing is
    // treated as static and fade-in detection waits for the next line.
    if (wantBase) { if (lastW == im.w && lastH == im.h) { base.swap(last); baseW = lastW; baseH = lastH; } else { base.clear(); baseW = baseH = 0; } wantBase = false; }
    KeepLast(im);
    if (!colorKnown) Learn(im);
    if (!colorKnown) { cur.status = LineStatus::Waiting; return cur; }
    const Box roi = SearchBox(im);
    ColorBlobs(im, roi, color, opt.colorTol, opt.smax, blobs, seen, stack);
    std::vector<Dot> found;
    for (const Blob &b : blobs) if (DotShaped(b, opt.smin, opt.smax) && SizeOk(b) && Isolated(im, b.box, color, opt.colorTol)) found.push_back(ToDot(b, 1.f));
    if (found.size() > 1500) { cur.dots.clear(); cur.status = LineStatus::Mismatch; return Finish(); } // a texture, not text
    DropLoneThin(found);
    if (dotSize == 0 && !found.empty()) { std::vector<float> s; for (auto &d : found) s.push_back(float(std::max(d.box.w(), d.box.h()))); dotSize = Median(s); }

    // Earlier lines (NVL) vs. a new ADV line on the same places. An ADV game may reuse the old line's cells before we
    // ever see the box empty (the line message can overtake the frame), so one frame is not enough to decide:
    //  - fewer than 90 % of the old dots present → the old line is gone (ADV);
    //  - a dot appears that is not on an old place: right after the old line's last dot on the same row → the new
    //    line is overwriting the old one (ADV); anywhere else → the old line stays (NVL);
    //  - no new place but the reveal stopped: as many dots as the new line has → ADV, that many beyond the old line →
    //    NVL; after 30 frames → ADV.
    // Until decided, the old places stay the old line's (its text is still drawn where it was).
    std::vector<uint8_t> used(found.size(), 0);
    if (!pendingKeep.empty()) {
      std::vector<uint8_t> u(found.size(), 0); int hit = 0;
      for (const Dot &d : pendingKeep) { const int j = Nearest(found, d, u); if (j >= 0) { u[j] = 1; ++hit; } }
      const int N = int(pendingKeep.size()); int decision = 0;
      ++pendingFrames;
      if (hit < int(N * opt.keepRatio + .5f)) decision = -1;
      else {
        std::vector<Dot> fresh; for (size_t j = 0; j < found.size(); ++j) if (!u[j]) fresh.push_back(found[j]);
        const int total = int(found.size());
        if (total != pendingLastTotal) { pendingLastTotal = total; pendingStable = 0; } else ++pendingStable;
        if (!fresh.empty()) { const float pk = cur.pitch > 0 ? cur.pitch : lastPitch > 0 ? lastPitch : Pitch(pendingKeep); ReadingOrder(fresh, cur.vertical, pk); decision = Continues(pendingKeep, fresh[0], pk) ? -1 : 1; }
        else if (pendingStable >= 6 && spec.expected >= 0) decision = total == spec.expected ? -1 : total - N == spec.expected ? 1 : -1;
        else if (pendingFrames > 30) decision = -1;
      }
      if (decision == 1) { keptLines.push_back({ pendingId, pendingKeep }); pendingKeep.clear(); }
      else if (decision == -1) pendingKeep.clear();
      else { used = u; cur.dots.clear(); cur.status = LineStatus::Waiting; Measure(); Finish(); cur.kept.push_back({ pendingId, pendingKeep }); return cur; }
    }
    for (size_t k = 0; k < keptLines.size();) {
      std::vector<Dot> next; int hit = 0;
      for (const Dot &d : keptLines[k].dots) {
        int j = Nearest(found, d, used);
        if (j >= 0) { used[j] = 1; next.push_back(found[j]); ++hit; }
      }
      if (hit * 2 < int(keptLines[k].dots.size())) keptLines.erase(keptLines.begin() + k); else { keptLines[k].dots = next; ++k; }
    }
    std::vector<Dot> mine, still;
    for (size_t j = 0; j < found.size(); ++j) if (!used[j]) (Static(found[j]) ? still : mine).push_back(found[j]);
    // Engines that draw the glyphs before the line's text arrives (the dots are already in the base frame): when ① has
    // reported this line's dots and nothing new appeared, the unchanged dots are the line, not static UI.
    if (mine.empty() && spec.hint > 0 && !still.empty()) {
      mine.swap(still);
      // Earlier lines of the page (NVL) are pre-drawn too: the line is the last `hint` dots in reading order.
      if (int(mine.size()) > spec.hint) { const float pk = lastPitch > 0 ? lastPitch : Pitch(mine); ReadingOrder(mine, cur.vertical, pk); still.assign(mine.begin(), mine.end() - spec.hint); mine.erase(mine.begin(), mine.end() - spec.hint); }
    }
    if (!still.empty() && !mine.empty()) {
      const float pk = cur.pitch > 0 ? cur.pitch : lastPitch > 0 ? lastPitch : Pitch(mine);
      for (bool grew = true; grew && !still.empty();) {
        grew = false;
        for (size_t k = 0; k < still.size(); ++k) {
          bool joins = false;
          for (const Dot &e : mine) {
            const float along = std::fabs(cur.vertical ? still[k].cy - e.cy : still[k].cx - e.cx), cross = std::fabs(cur.vertical ? still[k].cx - e.cx : still[k].cy - e.cy);
            if (cross < pk * .75f && along <= pk * 1.6f) { joins = true; break; }
          }
          if (joins) { mine.push_back(still[k]); still.erase(still.begin() + k); grew = true; break; }
        }
      }
    }
    // Page view (NVL): unchanged dots on the rows before the current line are earlier lines of the page that were never
    // tracked as lines (missed while the colour was still unknown). Offered to the caller, which knows those lines.
    cur.orphans.clear();
    if (spec.hint > 0 && !still.empty() && !mine.empty()) {
      const float pk = cur.pitch > 0 ? cur.pitch : lastPitch > 0 ? lastPitch : Pitch(mine);
      float first = 1e9f; for (const Dot &d : mine) first = std::min(first, cur.vertical ? -d.cx : d.cy);
      for (const Dot &d : still) if ((cur.vertical ? -d.cx : d.cy) < first - pk * .5f) cur.orphans.push_back(d);
      if (!cur.orphans.empty()) ReadingOrder(cur.orphans, cur.vertical, pk);
    }

    // Fade: fewer full-colour dots than last frame at the same places → read alpha where they were.
    if (int(mine.size()) < prevCount && !cur.dots.empty()) {
      std::vector<Dot> faded; std::vector<float> alphas;
      for (const Dot &d : cur.dots) {
        Dot e = d; e.alpha = DotAlpha(im, d.box, color);
        if (e.alpha >= .08f) { faded.push_back(e); alphas.push_back(e.alpha); }
      }
      if (faded.size() >= mine.size() && !faded.empty() && Median(alphas) < .97f) {
        cur.dots = faded; cur.status = LineStatus::Fading; missFrames = 0; Measure(); return Finish();
      }
    }

    DropOutliers(mine);
    cur.vertical = spec.vertical >= 0 ? spec.vertical == 1 : (mine.size() >= 2 ? InferVertical(mine) : cur.vertical);
    const float pitch = mine.size() >= 2 ? Pitch(mine) : cur.pitch;
    float step = 0;
    ReadingOrder(mine, cur.vertical, pitch, &step);
    if (step > 0) cur.lineStep = step;
    if (pitch > 0) cur.pitch = pitch;
    prevCount = int(mine.size());
    maxSeen = std::max(maxSeen, prevCount);
    cur.dots = mine;
    if (mine.empty() && maxSeen == 0) {
      // Fade-in: compare with the frame from the start of the line. Per pixel, alpha = projection of (now − then) on
      // (text colour − then): exact for a static background; only dot-shaped, equal-alpha, lined-up blobs count.
      if (!base.empty() && baseW == im.w && baseH == im.h) {
        const Box roi2{ 0, 0, im.w, im.h };
        auto alphaAt = [&](int x, int y) {
          const uint8_t *p = im.at(x, y), *q = &base[(size_t(y) * im.w + x) * 4];
          const int tr = color.r - q[2], tg = color.g - q[1], tb = color.b - q[0]; const int den = tr * tr + tg * tg + tb * tb;
          if (den < 900) return 0.f;
          return float((p[2] - q[2]) * tr + (p[1] - q[1]) * tg + (p[0] - q[0]) * tb) / den; };
        MaskBlobs(im, roi2, [&](int x, int y) { return alphaAt(x, y) >= .08f; }, opt.smax, blobs, seen, stack);
        std::vector<float> al;
        // The alpha mask also takes the antialiased rim, so a faded dot reads up to 2 px larger than the solid core.
        auto rimOk = [&](const Blob &b) { if (dotSize == 0) return true; const float z = float(std::max(b.box.w(), b.box.h())); return z >= dotSize - 1.5f && z <= dotSize + 2.5f; };
        for (const Blob &b : blobs) if (DotShaped(b, opt.smin, opt.smax) && rimOk(b)) {
          Box core = b.box; if (core.w() > 2) { ++core.x0; --core.x1; } if (core.h() > 2) { ++core.y0; --core.y1; }
          float a = 0; int n = 0; for (int y = core.y0; y < core.y1; ++y) for (int x = core.x0; x < core.x1; ++x) { a += alphaAt(x, y); ++n; }
          Dot d = ToDot(b, std::clamp(a / n, 0.f, 1.f)); mine.push_back(d); al.push_back(d.alpha);
        }
        const float ma = Median(al); bool same = true; for (float a : al) same = same && std::fabs(a - ma) <= .2f;
        const float pk = cur.pitch > 0 ? cur.pitch : lastPitch;
        const float p = mine.size() >= 2 ? Pitch(mine) : 0;
        const bool lined = mine.size() >= 2 && (pk <= 0 || std::fabs(p - pk) <= pk * .3f);
        if (!same || !lined || ma >= .97f || (spec.expected >= 0 && int(mine.size()) > spec.expected)) mine.clear();
        if (!mine.empty()) { ReadingOrder(mine, cur.vertical, pk > 0 ? pk : p); cur.dots = mine; cur.status = LineStatus::Fading; missFrames = 0; Measure(); return Finish(); }
      }
    }
    // Nothing of this line on screen yet and the previous line gone: this frame is the cleaner base (fade-in alpha and
    // static UI are judged against it).
    if (mine.empty() && maxSeen == 0 && lastW == im.w && lastH == im.h) {
      bool prevVisible = false;
      for (const Dot &o : prevLine) { for (const Dot &d : found) if (std::fabs(o.cx - d.cx) < 1.5f && std::fabs(o.cy - d.cy) < 1.5f) { prevVisible = true; break; } if (prevVisible) break; }
      if (!prevVisible) { base = last; baseW = lastW; baseH = lastH; }
    }
    if (mine.empty()) { cur.status = ++missFrames > opt.lostFrames && maxSeen > 0 ? LineStatus::Lost : LineStatus::Waiting; return Finish(); }
    missFrames = 0;
    if (spec.expected >= 0 && int(mine.size()) > spec.expected) cur.status = LineStatus::Mismatch;
    else if (spec.expected >= 0 && int(mine.size()) == spec.expected) cur.status = LineStatus::Complete;
    else cur.status = LineStatus::Revealing;
    Measure();
    return Finish();
  }

private:
  Options opt; LineSpec spec; TrackResult cur; Rgb color; bool colorKnown = false, wholeTried = false; int wholeWait = 0; float dotSize = 0;
  std::vector<TrackResult::Kept> keptLines; std::vector<Dot> pendingKeep, prevLine; int pendingId = 0, pendingFrames = 0, pendingStable = 0, pendingLastTotal = -1; Box area;
  // The dot right after the old line's last one in reading order (same row, next cell).
  bool Continues(const std::vector<Dot> &old, const Dot &f, float pk) const {
    std::vector<Dot> o = old; ReadingOrder(o, cur.vertical, pk); const Dot &l = o.back();
    const float along = cur.vertical ? f.cy - l.cy : f.cx - l.cx, cross = std::fabs(cur.vertical ? f.cx - l.cx : f.cy - l.cy);
    return cross < pk * .75f && along > 0 && along <= pk * 1.6f;
  }
  int prevCount = 0, missFrames = 0, maxSeen = 0;
  std::vector<Blob> blobs; Visit seen; std::vector<int> stack, parent;
  std::vector<uint8_t> base; int baseW = 0, baseH = 0; bool wantBase = false; float lastPitch = 0;

  std::vector<uint8_t> last; int lastW = 0, lastH = 0;
  void KeepLast(const Image &im) { last.resize(size_t(im.w) * im.h * 4); lastW = im.w; lastH = im.h; for (int y = 0; y < im.h; ++y) memcpy(&last[size_t(y) * im.w * 4], im.at(0, y), size_t(im.w) * 4); }
  void SaveBase(const Image &im) { base.resize(size_t(im.w) * im.h * 4); baseW = im.w; baseH = im.h; for (int y = 0; y < im.h; ++y) memcpy(&base[size_t(y) * im.w * 4], im.at(0, y), size_t(im.w) * 4); }
  const TrackResult &Finish() { cur.kept = keptLines; cur.area = area; return cur; }
  void Measure() { for (const Dot &d : cur.dots) Grow(d.box); for (auto &l : keptLines) for (const Dot &d : l.dots) Grow(d.box); }
  void Grow(const Box &b) { if (area.empty()) area = b; else { area.x0 = std::min(area.x0, b.x0); area.y0 = std::min(area.y0, b.y0); area.x1 = std::max(area.x1, b.x1); area.y1 = std::max(area.y1, b.y1); } }
  // A 1-px-thin blob (clipped dot of ー 一 、) counts only next to a full dot of the same text: thin specks of the text
  // colour elsewhere in the scene art are dropped.
  void DropLoneThin(std::vector<Dot> &d) const {
    const float reach = (cur.pitch > 0 ? cur.pitch : lastPitch > 0 ? lastPitch : 40.f) * 2.5f;
    std::vector<Dot> keep;
    for (const Dot &x : d) {
      if (std::min(x.box.w(), x.box.h()) >= 2) { keep.push_back(x); continue; }
      bool close = false;
      for (const Dot &y : d) if (std::min(y.box.w(), y.box.h()) >= 2 && std::hypot(x.cx - y.cx, x.cy - y.cy) <= reach) { close = true; break; }
      if (close) keep.push_back(x);
    }
    d.swap(keep);
  }
  // Something dot-like that was already on screen, unchanged, in the frame from the start of this line and is not one of
  // the previous line's dots (the new line may start where the old one did) is part of the scene or UI (a static
  // "・" or "…" in the text colour), not a dot of this line.
  bool Static(const Dot &d) const {
    if (base.empty() || baseW == 0 || d.box.x1 > baseW || d.box.y1 > baseH) return false;
    for (int y = d.box.y0; y < d.box.y1; ++y) for (int x = d.box.x0; x < d.box.x1; ++x) if (ColorDist(&base[(size_t(y) * baseW + x) * 4], color) > opt.colorTol) return false;
    for (const Dot &o : prevLine) if (std::fabs(o.cx - d.cx) < 1.5f && std::fabs(o.cy - d.cy) < 1.5f) return false;
    return true;
  }
  // The line is one cluster: dots linked by gaps of at most 4 median neighbour distances (rows are ~1.5 em apart, cells
  // 1 em). A lone dot or a pair outside it is not text: a click-wait animation (often a pair of dots), a UI indicator,
  // a speck in the art.
  static void DropOutliers(std::vector<Dot> &d) {
    if (d.size() < 3) return;
    const size_t n = d.size();
    std::vector<float> nn(n, 1e9f);
    for (size_t i = 0; i < n; ++i) for (size_t j = 0; j < n; ++j) if (i != j) nn[i] = std::min(nn[i], std::hypot(d[i].cx - d[j].cx, d[i].cy - d[j].cy));
    const float link = 4 * Median(nn);
    std::vector<int> comp(n, -1), sizes(n, 0); int best = -1, bestSize = 0;
    for (size_t s0 = 0; s0 < n; ++s0) {
      if (comp[s0] >= 0) continue;
      std::vector<size_t> st{ s0 }; comp[s0] = int(s0); int size = 0;
      while (!st.empty()) { const size_t i = st.back(); st.pop_back(); ++size; for (size_t j = 0; j < n; ++j) if (comp[j] < 0 && std::hypot(d[i].cx - d[j].cx, d[i].cy - d[j].cy) <= link) { comp[j] = int(s0); st.push_back(j); } }
      sizes[s0] = size; if (size > bestSize) { bestSize = size; best = int(s0); }
    }
    // Other clusters of 3+ dots stay (separate runs: a menu, a name box); lone dots and pairs away from the line go.
    std::vector<Dot> keep; for (size_t i = 0; i < n; ++i) if (comp[i] == best || sizes[comp[i]] >= 3) keep.push_back(d[i]);
    d.swap(keep);
  }
  bool SizeOk(const Blob &b) const {
    if (std::max(b.box.w(), b.box.h()) <= 3) return true; /* spec-1 dot, maybe clipped */
    if (dotSize == 0) return true; const float s = float(std::max(b.box.w(), b.box.h())); return std::fabs(s - dotSize) <= std::max(1.5f, dotSize * .4f); }
  static Dot ToDot(const Blob &b, float a) { Dot d; d.cx = b.cx(); d.cy = b.cy(); d.box = b.box; d.alpha = a; d.color = b.mean(); return d; }
  // A colour compare over the whole 1080p frame costs ~1.5 ms, so tracking always looks everywhere: typewriter dots may
  // start the next (centred) row anywhere, and scroll/shake can move the line any distance.
  Box SearchBox(const Image &im) const { return { 0, 0, im.w, im.h }; }
  int Nearest(const std::vector<Dot> &found, const Dot &d, const std::vector<uint8_t> &used) const {
    const float lim = std::max(3.f, (cur.pitch > 0 ? cur.pitch : 12.f) * .45f);
    int best = -1; float bd = lim;
    for (size_t j = 0; j < found.size(); ++j) if (!used[j]) { const float e = std::hypot(found[j].cx - d.cx, found[j].cy - d.cy); if (e <= bd) { bd = e; best = int(j); } }
    return best;
  }
  int CountNear(const std::vector<Dot> &old, const std::vector<Dot> &found) const { std::vector<uint8_t> used(found.size(), 0); int n = 0; for (const Dot &d : old) { int j = Nearest(found, d, used); if (j >= 0) { used[j] = 1; ++n; } } return n; }

  // Learn the text colour. Candidates: dot-shaped plateaus in the region that changed since the previous frame (a
  // typewriter dot just appeared; static UI bullets never qualify) or inside the hook's cells. Each candidate colour is
  // then checked with the cheap full-frame colour search: it wins when its equal-sized dots line up at one pitch.
  std::vector<uint8_t> prevFrame; int prevW = 0, prevH = 0;
  Box ChangedBox(const Image &im) {
    Box b{ im.w, im.h, 0, 0 };
    if (prevW == im.w && prevH == im.h) {
      for (int y = 0; y < im.h; y += 1) { const uint8_t *p = im.at(0, y), *q = &prevFrame[size_t(y) * im.w * 4];
        for (int x = 0; x < im.w; ++x, p += 4, q += 4) if (std::abs(p[0] - q[0]) + std::abs(p[1] - q[1]) + std::abs(p[2] - q[2]) > 40) { b.x0 = std::min(b.x0, x); b.y0 = std::min(b.y0, y); b.x1 = std::max(b.x1, x + 1); b.y1 = std::max(b.y1, y + 1); } }
    }
    prevFrame.resize(size_t(im.w) * im.h * 4); prevW = im.w; prevH = im.h;
    for (int y = 0; y < im.h; ++y) memcpy(&prevFrame[size_t(y) * im.w * 4], im.at(0, y), size_t(im.w) * 4);
    return b;
  }
  void Learn(const Image &im) {
    Box roi = ChangedBox(im);
    if (!spec.cells.empty()) { roi = spec.cells[0]; for (auto &c : spec.cells) { roi.x0 = std::min(roi.x0, c.x0); roi.y0 = std::min(roi.y0, c.y0); roi.x1 = std::max(roi.x1, c.x1); roi.y1 = std::max(roi.y1, c.y1); } }
    // Nothing changes (a fully shown line, a colour forgotten as wrong) or everything does (an animated background), but
    // ① reported this line's dots: once per line,
    // the whole frame is searched (the hint keeps out colours with far fewer dots).
    bool whole = false;
    const bool busy = !roi.empty() && spec.cells.empty() && double(roi.w()) * roi.h() > .5 * im.w * im.h; // an animated background
    if ((roi.empty() || busy) && spec.hint >= 4 && (!wholeTried || ++wholeWait >= 30)) { wholeTried = whole = true; wholeWait = 0; roi = { 0, 0, im.w, im.h }; } // again every 30 frames: the line may not be drawn yet
    if (roi.empty()) return;
    // A whole-screen change (scene switch) is not a typewriter step: skip it, the next frames will be calmer.
    if (!whole && spec.cells.empty() && double(roi.w()) * roi.h() > .5 * im.w * im.h) return;
    roi.x0 -= opt.smax; roi.y0 -= opt.smax; roi.x1 += opt.smax; roi.y1 += opt.smax;
    PlateauBlobs(im, roi, opt.smin, opt.smax, blobs, parent);
    // Candidate colours: full (unclipped) dots only, most frequent first, at most 8 per frame — a dithered or noisy
    // region yields thousands of 1 px plateaus, and each colour costs one full-frame search.
    std::vector<std::pair<Rgb, int>> colours;
    for (const Blob &cand : blobs) {
      if (std::min(cand.box.w(), cand.box.h()) < 2) continue;
      if (!DotShaped(cand, opt.smin, opt.smax)) continue; // a text colour comes from dot-shaped plateaus (not from the background's flat areas)
      const Rgb c = cand.mean(); bool hit = false;
      for (auto &t : colours) if (ColorDist(t.first, c) <= 30) { ++t.second; hit = true; break; }
      if (!hit) colours.push_back({ c, 1 });
    }
    std::sort(colours.begin(), colours.end(), [](const auto &a, const auto &b) { return a.second > b.second; });
    if (colours.size() > 8) colours.resize(8);
    double bestScore = 0; Rgb bestColor; float bestSize = 0;
    struct Cand { Rgb c; float size; double score; std::vector<Dot> d; }; std::vector<Cand> scored;
    for (const auto &cc : colours) {
      const Rgb c = cc.first;
      Blob cand; for (const Blob &b : blobs) if (std::min(b.box.w(), b.box.h()) >= 2 && ColorDist(b.mean(), c) <= 30) { cand = b; break; }
      std::vector<Blob> same; ColorBlobs(im, { 0, 0, im.w, im.h }, c, opt.colorTol, opt.smax, same, seen, stack);
      const float size = float(std::max(cand.box.w(), cand.box.h()));
      std::vector<Dot> d;
      // Only lone dots count (as in tracking): specks of the colour inside artwork (eyes, hair lines) are not text.
      for (const Blob &b : same) if (DotShaped(b, opt.smin, opt.smax) && std::fabs(std::max(b.box.w(), b.box.h()) - size) <= 1.5f && Isolated(im, b.box, c, opt.colorTol)) d.push_back(ToDot(b, 1.f));
      // A texture (dither, noise) in this colour gives thousands of dot-shaped blobs: not text, and the pairwise
      // checks below would take seconds.
      if (d.size() > size_t(std::max(200, 3 * spec.expected))) continue;
      const float p = d.size() >= 2 ? Pitch(d) : 0;
      int lined = 0;
      for (size_t a = 0; a < d.size(); ++a) for (size_t b = 0; b < d.size(); ++b) if (a != b) {
        const float dx = std::fabs(d[a].cx - d[b].cx), dy = std::fabs(d[a].cy - d[b].cy);
        if ((dy < 6.f && dx > dy && dx <= p * 1.6f) || (dx < 6.f && dy > dx && dy <= p * 1.6f)) { ++lined; break; } // black-box tops vary a few px
      }
      double score = lined;
      if (d.size() == 1 && spec.expected == 1) score = 1;
      // More dots than the line has: not ours — except in a whole-frame search, where an NVL page keeps earlier lines.
      if (spec.expected > 0 && int(d.size()) > (whole ? spec.expected * 8 + 8 : spec.expected)) score = 0;
      if (spec.hint >= 4 && d.size() * 5 < size_t(spec.hint) * 3) score = 0; // far fewer than ① drew (a blinking cursor, a UI mark)
      if (spec.em > 0 && p > 0 && std::fabs(p - spec.em) > spec.em * .5f) score = 0;
      if (score > 0) scored.push_back({ c, size, score, d });
      if (score > bestScore) { bestScore = score; bestColor = c; bestSize = size; }
    }
    // A drop shadow / lower outline is an offset copy of each mark, 1–4 px down and/or right, in another colour: the
    // marks are the colour whose copy that is (the upper-left one), not the shadow.
    for (const Cand &o : scored) {
      if (ColorDist(o.c, bestColor) <= 30 || o.score < bestScore * .5) continue;
      const Cand *b = nullptr; for (const Cand &x : scored) if (ColorDist(x.c, bestColor) <= 30) b = &x;
      if (!b || b->d.empty()) break;
      int hit = 0;
      for (const Dot &q : b->d) for (const Dot &p : o.d) { const float dx = q.cx - p.cx, dy = q.cy - p.cy; if (dx >= -.5f && dy >= -.5f && dx + dy >= 1.f && dx <= 4.5f && dy <= 4.5f) { ++hit; break; } }
      if (hit * 10 >= int(b->d.size()) * 7) { bestColor = o.c; bestSize = o.size; bestScore = o.score; break; }
    }
    if (bestScore < 2 && !(bestScore >= 1 && spec.expected == 1)) return;
    color = bestColor; colorKnown = true; dotSize = bestSize; prevFrame.clear(); prevFrame.shrink_to_fit(); prevW = prevH = 0;
  }
};

// Choices (and other screens with several independent runs): split dots into runs = rows (or columns) with a gap of more
// than 1.5 pitches between them, each run its own box. Run colour tells which one the game highlights.
struct Run { std::vector<Dot> dots; Box box; Rgb color; };
inline std::vector<Run> SplitRuns(const std::vector<Dot> &ordered, bool vertical, float pitch) {
  std::vector<Run> runs;
  const float gap = std::max(4.f, pitch * 1.6f);
  for (const Dot &d : ordered) {
    bool join = false;
    if (!runs.empty()) {
      const Dot &l = runs.back().dots.back();
      const float along = vertical ? d.cy - l.cy : d.cx - l.cx, cross = vertical ? std::fabs(d.cx - l.cx) : std::fabs(d.cy - l.cy);
      join = cross < pitch * .75f && along > 0 && along <= gap;
    }
    if (!join) runs.push_back({});
    Run &r = runs.back(); r.dots.push_back(d);
    if (r.dots.size() == 1) r.box = d.box; else { r.box.x0 = std::min(r.box.x0, d.box.x0); r.box.y0 = std::min(r.box.y0, d.box.y0); r.box.x1 = std::max(r.box.x1, d.box.x1); r.box.y1 = std::max(r.box.y1, d.box.y1); }
  }
  for (Run &r : runs) { long a = 0, b = 0, c = 0; for (auto &d : r.dots) { a += d.color.r; b += d.color.g; c += d.color.b; } const long n = long(r.dots.size()); r.color = { int(a / n), int(b / n), int(c / n) }; }
  return runs;
}

// Choice screens: several runs, usually one in a highlight colour that follows the mouse. Colours are learned from the
// region that changed (hover), up to four; every frame each known colour is searched, the dots are merged, split into
// runs, and runs are assigned to the menu items in order by their dot counts (an item may wrap into several runs).
class ChoiceTracker {
public:
  // missing > 0: the item has fewer dots than characters (glyphs the engine rasterised before dot mode stay real in its
  // glyph cache): its box is widened over them and erased whole, its text drawn as one run.
  struct Item { std::vector<Dot> dots; Box box; Rgb color; bool highlighted = false; int missing = 0; };
  struct Out { bool ok = false; std::vector<Item> items; bool vertical = false; float pitch = 0; };
  void Begin(const std::vector<int> &itemDots, const std::vector<Rgb> &known) { counts = itemDots; colors = known; prevW = prevH = 0; total = 0; wholeTried = false; for (int c : counts) total += c; }
  Out Update(const Image &im) {
    // Dots of every known colour; matched together (normal + highlight), else each colour alone (a line colour such as
    // white may also hit background texture), else learn a new colour.
    std::vector<std::vector<Dot>> per; for (const Rgb &c : colors) per.push_back(DotsOf(im, c));
    Out o = MatchAll(im, per);
    if (!o.ok && colors.size() < 4 && LearnColor(im)) { per.push_back(DotsOf(im, colors.back())); o = MatchAll(im, per); }
    Remember(im);
    return o;
  }
  const std::vector<Rgb> &Colors() const { return colors; }
  // Unmatched menu: its marks all the same (owner rule: never shown). The largest compact group of the menu colours'
  // lone dots (linked within 5 % of the frame), when it holds at least half of the items' characters.
  std::vector<Dot> MenuMarks(const Image &im) const {
    const size_t n = lastAll.size(); if (n < 2 || n > 1500) return {};
    const float d = .05f * std::max(im.w, im.h), d2 = d * d;
    std::vector<int> up(n); for (size_t i = 0; i < n; ++i) up[i] = int(i);
    auto root = [&](int i) { while (up[i] != i) i = up[i] = up[up[i]]; return i; };
    for (size_t i = 0; i < n; ++i) for (size_t j = i + 1; j < n; ++j) { const float dx = lastAll[i].cx - lastAll[j].cx, dy = lastAll[i].cy - lastAll[j].cy; if (dx * dx + dy * dy <= d2) up[root(int(i))] = root(int(j)); }
    std::vector<std::vector<Dot>> g(n); for (size_t i = 0; i < n; ++i) g[root(int(i))].push_back(lastAll[i]);
    size_t best = 0; for (size_t i = 1; i < n; ++i) if (g[i].size() > g[best].size()) best = i;
    if (int(g[best].size()) * 2 < total || int(g[best].size()) > total * 2 + 4) return {};
    return g[best];
  }
private:
  std::vector<Dot> DotsOf(const Image &im, const Rgb &c) {
    std::vector<Dot> v;
    ColorBlobs(im, { 0, 0, im.w, im.h }, c, 36, 14, blobs, seen, stack);
    for (const Blob &b : blobs) { if (!DotShaped(b, 2, 14) || !Isolated(im, b.box, c, 12)) continue; /* texture in the menu colour is never a lone dot */ Dot d; d.cx = b.cx(); d.cy = b.cy(); d.box = b.box; d.color = b.mean(); v.push_back(d); }
    return v;
  }
  Out MatchAll(const Image &im, const std::vector<std::vector<Dot>> &per) {
    std::vector<Dot> all;
    for (const auto &v : per) for (const Dot &d : v) { bool dup = false; for (auto &x : all) dup = dup || (std::fabs(x.cx - d.cx) < 1.5f && std::fabs(x.cy - d.cy) < 1.5f); if (!dup) all.push_back(d); }
    lastAll = all;
    Out o = Match(im, all);
    if (!o.ok && per.size() > 1) for (const auto &v : per) { o = Match(im, v); if (o.ok) break; }
    if (!o.ok) o = MatchGroups(im, all);
    if (!o.ok && per.size() > 1) for (const auto &v : per) { o = MatchGroups(im, v); if (o.ok) break; }
    return o;
  }
  // A group found among stray dots must look like a menu: most characters dotted, every item one straight row (column)
  // whose dots follow each other at one to three pitches (a gap = characters without a dot).
  bool Rowlike(const Out &o) const {
    if (o.pitch <= 0) return false;
    int got = 0; for (const Item &it : o.items) got += int(it.dots.size());
    if (got * 5 < total * 3) return false; // at least 60 % of the characters carry a dot
    for (const Item &it : o.items) {
      if (it.missing && it.dots.size() < 3) return false; // two dots of an incomplete item: too little to place it
      std::vector<Dot> d = it.dots; float lo = 1e9f, hi = -1e9f;
      for (auto &x : d) { const float c = o.vertical ? x.cx : x.cy; lo = std::min(lo, c); hi = std::max(hi, c); }
      if (hi - lo > o.pitch * .5f) return false;
      std::sort(d.begin(), d.end(), [&](const Dot &a, const Dot &b) { return o.vertical ? a.cy < b.cy : a.cx < b.cx; });
      for (size_t i = 1; i < d.size(); ++i) { const float g = o.vertical ? d[i].cy - d[i - 1].cy : d[i].cx - d[i - 1].cx; if (g < o.pitch * .6f || g > o.pitch * 3.2f) return false; }
    }
    return true;
  }
  // Stray dots of the same colour elsewhere in the picture (texture that happens to look like lone dots): the menu is a
  // compact group, so try each group of dots linked within 3 %, 5 % or 8 % of the frame size that could hold it.
  Out MatchGroups(const Image &im, const std::vector<Dot> &all) const {
    Out o; const size_t n = all.size();
    if (n < 2 || n > 1500) return o;
    for (float f : { .03f, .05f, .08f }) {
      const float d = f * std::max(im.w, im.h), d2 = d * d;
      std::vector<int> up(n); for (size_t i = 0; i < n; ++i) up[i] = int(i);
      auto root = [&](int i) { while (up[i] != i) i = up[i] = up[up[i]]; return i; };
      for (size_t i = 0; i < n; ++i) for (size_t j = i + 1; j < n; ++j) { const float dx = all[i].cx - all[j].cx, dy = all[i].cy - all[j].cy; if (dx * dx + dy * dy <= d2) up[root(int(i))] = root(int(j)); }
      std::vector<std::vector<Dot>> groups(n); for (size_t i = 0; i < n; ++i) groups[root(int(i))].push_back(all[i]);
      std::sort(groups.begin(), groups.end(), [](const std::vector<Dot> &x, const std::vector<Dot> &y) { return x.size() > y.size(); }); // fullest group first
      for (auto &g : groups) if (int(g.size()) * 2 >= total && int(g.size()) <= total && int(g.size()) < int(n)) { o = Match(im, g); if (o.ok && Rowlike(o)) return o; }
    }
    return Out{};
  }
  Out Match(const Image &im, std::vector<Dot> all) const {
    Out o;
    if (all.empty() || all.size() > 1500) return o; // > 1500: a texture in one of the colours, not a menu
    const float p = all.size() >= 2 ? Pitch(all) : 0;
    // A glyph cell is several dot sides wide (dot side <= cell / 10, at least 2 px): a tighter pitch is texture.
    if (all.size() >= 2) { int side = 0; for (auto &d : all) side = std::max(side, std::max(d.box.w(), d.box.h())); if (p < std::max({ 8.f, 3.f * side, .015f * std::min(im.w, im.h) })) return o; }
    o.vertical = all.size() >= 2 && InferVertical(all); o.pitch = p;
    ReadingOrder(all, o.vertical, p);
    const auto runs = SplitRuns(all, o.vertical, p);
    size_t r = 0; bool exact = true;
    for (int want : counts) {
      Item it; int got = 0;
      while (r < runs.size() && got < want) { const Run &x = runs[r++]; it.dots.insert(it.dots.end(), x.dots.begin(), x.dots.end()); got += int(x.dots.size()); }
      if (got != want) { exact = false; break; }
      Finish(it); o.items.push_back(it);
    }
    if (!exact || r != runs.size()) { o.items.clear(); if (!Partial(runs, o, im)) return o; }
    // Highlight = the item whose colour differs from the colour most items share.
    for (auto &it : o.items) { int same = 0; for (auto &x : o.items) same += ColorDist(x.color, it.color) <= 40; it.highlighted = o.items.size() > 1 && same * 2 <= int(o.items.size()); }
    o.ok = true;
    return o;
  }
  static void Finish(Item &it) {
    it.box = it.dots[0].box; long cr = 0, cg = 0, cb = 0;
    for (auto &d : it.dots) { it.box.x0 = std::min(it.box.x0, d.box.x0); it.box.y0 = std::min(it.box.y0, d.box.y0); it.box.x1 = std::max(it.box.x1, d.box.x1); it.box.y1 = std::max(it.box.y1, d.box.y1); cr += d.color.r; cg += d.color.g; cb += d.color.b; }
    const long n = long(it.dots.size()); it.color = { int(cr / n), int(cg / n), int(cb / n) };
  }
  // Counts do not add up (some characters were never dotted): one item per row (column) when the rows match the items
  // and each row holds between half and all of its item's characters. The box grows by the missing characters' pitch
  // on both ends (where they are is unknown), within the frame.
  bool Partial(const std::vector<Run> &runs, Out &o, const Image &im) const {
    if (o.pitch <= 0) return false;
    auto mid = [&](const Box &b) { return o.vertical ? (b.x0 + b.x1) / 2.f : (b.y0 + b.y1) / 2.f; };
    std::vector<std::vector<const Run *>> rows;
    for (const Run &x : runs) { if (!rows.empty() && std::fabs(mid(x.box) - mid(rows.back().back()->box)) < o.pitch * .75f) rows.back().push_back(&x); else rows.push_back({ &x }); }
    if (rows.size() != counts.size()) return false;
    for (size_t i = 0; i < rows.size(); ++i) {
      Item it; for (const Run *x : rows[i]) it.dots.insert(it.dots.end(), x->dots.begin(), x->dots.end());
      const int got = int(it.dots.size()), want = counts[i];
      if (got > want || got * 2 < want) { o.items.clear(); return false; }
      Finish(it); it.missing = want - got;
      o.items.push_back(it);
    }
    // Where the undotted characters are: a row starting where a complete row starts (left aligned) or centred like the
    // complete rows spans want pitches from there; otherwise the box grows by the missing pitches on both ends.
    // Dots sit at the top-left of their cells, so the box also takes one pitch across (the glyphs' height or width).
    const float p = o.pitch;
    auto lo = [&](const Box &b) { return o.vertical ? b.y0 : b.x0; }; auto hi = [&](const Box &b) { return o.vertical ? b.y1 : b.x1; };
    for (size_t i = 0; i < o.items.size(); ++i) {
      Item &it = o.items[i]; if (!it.missing) continue;
      const int want = counts[i]; float a = float(lo(it.box)), b = float(hi(it.box)); bool placed = false;
      for (const Item &c : o.items) if (!c.missing && std::fabs(lo(c.box) - a) < p * .5f) { b = a + want * p; placed = true; break; }
      if (!placed) for (const Item &c : o.items) if (!c.missing) {
        const float cc = (lo(c.box) + hi(c.box)) / 2.f, half = want * p / 2.f;
        if (a >= cc - half - p * .5f && b <= cc + half + p * .5f) { a = cc - half; b = cc + half; placed = true; break; }
      }
      if (!placed) { a -= it.missing * p; b += it.missing * p; }
      const int A = std::max(0, int(a - 2)), B = std::min(o.vertical ? im.h : im.w, int(b + 2));
      if (o.vertical) { it.box.y0 = A; it.box.y1 = B; it.box.x0 = std::max(0, it.box.x0 - 2); it.box.x1 = std::min(im.w, it.box.x0 + int(p) + 2); }
      else { it.box.x0 = A; it.box.x1 = B; it.box.y0 = std::max(0, it.box.y0 - 2); it.box.y1 = std::min(im.h, it.box.y0 + int(p) + 2); }
    }
    return true;
  }
  std::vector<int> counts; std::vector<Rgb> colors; int total = 0; bool wholeTried = false; std::vector<Dot> lastAll;
  std::vector<Blob> blobs; Visit seen; std::vector<int> stack, parent; std::vector<uint8_t> prev; int prevW = 0, prevH = 0;
  void Remember(const Image &im) { prev.resize(size_t(im.w) * im.h * 4); prevW = im.w; prevH = im.h; for (int y = 0; y < im.h; ++y) memcpy(&prev[size_t(y) * im.w * 4], im.at(0, y), size_t(im.w) * 4); }
  // Returns true when a colour was added (the last of colors).
  bool LearnColor(const Image &im) {
    Box b{ im.w, im.h, 0, 0 };
    if (prevW == im.w && prevH == im.h) for (int y = 0; y < im.h; y += 2) {
      const uint8_t *p = im.at(0, y), *q = &prev[size_t(y) * im.w * 4];
      for (int x = 0; x < im.w; x += 2, p += 8, q += 8) if (std::abs(p[0] - q[0]) + std::abs(p[1] - q[1]) + std::abs(p[2] - q[2]) > 40) { b.x0 = std::min(b.x0, x); b.y0 = std::min(b.y0, y); b.x1 = std::max(b.x1, x + 2); b.y1 = std::max(b.y1, y + 2); }
    }
    // A menu already on screen before the choices arrived (no change to learn from, e.g. unselected items in a dim
    // colour): once per menu, every dot-shaped plateau of the whole frame is a candidate.
    bool whole = false;
    if (b.empty()) { if (wholeTried || prevW != im.w || prevH != im.h) return false; wholeTried = whole = true; b = { 0, 0, im.w, im.h }; }
    else if (double(b.w()) * b.h() > .5 * im.w * im.h && !colors.empty()) return false;
    b.x0 -= 14; b.y0 -= 14; b.x1 += 14; b.y1 += 14;
    PlateauBlobs(im, b, 2, 14, blobs, parent);
    const std::vector<Blob> cands = blobs; int tries = 0;
    for (const Blob &c : cands) {
      if (std::min(c.box.w(), c.box.h()) < 2) continue; // 1 px plateaus (dither, noise) are never a colour to learn from
      if (whole && !DotShaped(c, 2, 14)) continue;
      const Rgb m = c.mean(); bool known = false; for (auto &k : colors) known = known || ColorDist(k, m) <= 36;
      if (known) continue;
      if (++tries > (whole ? 40 : 8)) return false;
      if (whole) { const auto v = DotsOf(im, m); if (Match(im, v).ok || MatchGroups(im, v).ok) { colors.push_back(m); return true; } continue; } // only a colour that forms the menu
      std::vector<Blob> same; ColorBlobs(im, { 0, 0, im.w, im.h }, m, 36, 14, same, seen, stack);
      int shaped = 0; for (auto &x : same) shaped += DotShaped(x, 2, 14);
      if (shaped >= 2 && shaped <= total) { colors.push_back(m); return true; }
    }
    return false;
  }
};

// Map dot i to the i-th non-space character of the line (spaces, tabs, line breaks and the ideographic space get no dot).
// Same blank set as ①'s reports (U+0000–U+0020, U+3000, U+200B, U+FEFF): its text has them removed.
inline bool IsDotless(char32_t c) { return c <= 0x20 || c == 0x3000 || c == 0x200B || c == 0xFEFF; }
inline std::vector<int> DotCharIndex(const std::u32string &text) { std::vector<int> v; for (size_t i = 0; i < text.size(); ++i) if (!IsDotless(text[i])) v.push_back(int(i)); return v; }

} // namespace megu
