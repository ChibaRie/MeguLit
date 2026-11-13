// SPDX-License-Identifier: GPL-3.0-or-later
// GlyphQuads.h: the API-independent part of hide layer 4 (MeguLitGpu, see GpuHide.cpp and docs/hide-layers.md).
// Input: textured quads per draw call (screen rect + texture-coordinate rect, the texture's size, the render target).
// It learns which quads are the dialogue's glyphs and where the text area is, and decides which quads to leave out.
//
// Glyph-like quad: 4..160 px on screen each way, aspect 1:5..5:1, sampled from a cell of a sheet (at most half of a
// texture of at least 32x32; at most 1/24 of a texture bigger than 256x256), drawn at 0.4..6x its texel size.
// Per line (LINE <text>, n = non-blank characters):
//  - groups = (render target, atlas size). Two counts per group: (A) distinct glyph positions drawn in the last frame,
//    (B) distinct glyph keys (position + atlas cell) first drawn since the line started (the previous line's glyphs
//    that the game keeps redrawing are older). Shadows and outlines drawn as offset copies are merged: positions closer
//    than 40 % of the glyph height are one character.
//  - a row cluster whose count equals n learns the text area (its bounding box, grown by one glyph height) and the
//    atlas sizes that drew there. Learning hides nothing.
//  - after that, while armed (a LINE in the last 60 s, no OFF), glyph-like quads from the learned atlases whose centre
//    lies in the text area are left out. The first one per line is a "hit".
#pragma once
#include <string>
#include <vector>
#include <map>
#include <set>
#include <algorithm>
#include <functional>
#include <cmath>
#include <stdio.h>

struct Quad { float x0, y0, x1, y1, u0, v0, u1, v1; unsigned first; };

static inline bool GlyphLike(const Quad &q, unsigned tw, unsigned th) {
 if (tw < 32 || th < 32) return false;
 float w = q.x1 - q.x0, h = q.y1 - q.y0; if (w < 4 || h < 4 || w > 160 || h > 160) return false; if (w > h * 5 || h > w * 5) return false;
 float tu = (q.u1 - q.u0) * tw, tv = (q.v1 - q.v0) * th; if (tu < 3 || tv < 3) return false;
 // a cell of a sheet: at most half the texture (a whole-texture sprite is never a glyph); big sheets need small cells
 float area = (q.u1 - q.u0) * (q.v1 - q.v0); if (area > 0.5f || (tw * th > 256 * 256 && area > 1.0f / 24)) return false;
 float scale = w / tu; if (scale < 0.4f || scale > 6) return false;
 return true;
}
static inline bool Blank(wchar_t c) { return c <= 0x20 || c == 0x3000 || c == 0x200B || c == 0xFEFF || c == 0x1F; }

struct GlyphLearner {
 struct Rect { float x0, y0, x1, y1; };
 struct Seen { Rect r; unsigned firstAt, lastFrame; };
 struct Group { void *rt; unsigned tw, th, rtW, rtH; std::map<long long, Seen> keys; std::vector<Rect> frame, prev; unsigned prevFrame; };
 std::function<void(const std::string &)> emit; void (*log)(const char *, ...) = nullptr;
 bool readOnly = false;
 // line
 std::wstring text; unsigned n = 0, seq = 0, lineAt = 0, prevLineAt = 0, armedUntil = 0; bool reported = false, hitSent = false, hiddenSent = false; unsigned hiddenQuads = 0;
 // learned
 bool learned = false; void *areaRt = nullptr; unsigned areaW = 0, areaH = 0; Rect area{}; std::set<long long> atlases; unsigned learnedSeq = 0; float glyphH = 0;
 std::map<long long, Group> groups; unsigned frameNo = 0, bbW = 0, bbH = 0;
 std::map<void *, std::pair<Rect, Rect>> rtMap; // rt texture -> (uv rect, screen rect)

 static long long GroupKey(void *rt, unsigned tw, unsigned th) { return ((long long)(size_t)rt * 1315423911LL) ^ ((long long)tw << 20) ^ th; }
 static long long AtlasKey(void *rt, unsigned tw, unsigned th) { return GroupKey(rt, tw, th); }
 bool Armed(unsigned now) const { return n > 0 && (int)(armedUntil - now) > 0; }

 void Line(const std::wstring &t, unsigned now) {
  std::wstring s; for (wchar_t c : t) if (!Blank(c)) s += c; if (s.empty()) return;
  if (s == text && Armed(now)) { armedUntil = now + 60000; return; } // the same line again (re-read): keep its state
  prevLineAt = lineAt; text = s; n = (unsigned)s.size(); seq++; lineAt = now; armedUntil = now + 60000; reported = hitSent = hiddenSent = false; hiddenQuads = 0;
  if (log) log("LINE seq=%u n=%u", seq, n);
 }
 void Off() { n = 0; armedUntil = 0; if (log) log("OFF"); }

 // A draw onto the back buffer that samples a render-target texture: remember where that texture lands on screen.
 void Composite(void *tex, const std::vector<Quad> &q) {
  if (q.empty()) return; Quad b = q[0]; for (auto &x : q) { b.x0 = (std::min)(b.x0, x.x0); b.y0 = (std::min)(b.y0, x.y0); b.x1 = (std::max)(b.x1, x.x1); b.y1 = (std::max)(b.y1, x.y1); b.u0 = (std::min)(b.u0, x.u0); b.v0 = (std::min)(b.v0, x.v0); b.u1 = (std::max)(b.u1, x.u1); b.v1 = (std::max)(b.v1, x.v1); }
  if (b.u1 - b.u0 < 0.05f || b.v1 - b.v0 < 0.05f) return; rtMap[tex] = std::make_pair(Rect{ b.u0, b.v0, b.u1, b.v1 }, Rect{ b.x0, b.y0, b.x1, b.y1 });
 }
 bool ToScreen(void *rt, unsigned rtW, unsigned rtH, Rect &r) const {
  if (!rt) return true;
  if (rtW && rtW == bbW && rtH == bbH) return true; // a full-screen composition target: same pixels as the back buffer
  auto it = rtMap.find(rt); if (it == rtMap.end() || !rtW || !rtH) return false; const Rect &uv = it->second.first, &sc = it->second.second;
  auto mx = [&](float x) { return sc.x0 + (x / rtW - uv.x0) / (uv.x1 - uv.x0) * (sc.x1 - sc.x0); }; auto my = [&](float y) { return sc.y0 + (y / rtH - uv.y0) / (uv.y1 - uv.y0) * (sc.y1 - sc.y0); };
  r = Rect{ mx(r.x0), my(r.y0), mx(r.x1), my(r.y1) }; return true;
 }

 // One draw call: returns the indices of the quads to leave out.
 std::vector<int> Draw(void *tex, unsigned tw, unsigned th, void *rt, unsigned rtW, unsigned rtH, unsigned backW, unsigned backH, const std::vector<Quad> &q, unsigned now) {
  std::vector<int> drop; (void)tex; bbW = backW; bbH = backH;
  long long gk = GroupKey(rt, tw, th); Group *g = nullptr; bool armed = Armed(now);
  for (size_t i = 0; i < q.size(); i++) {
   const Quad &x = q[i]; if (!GlyphLike(x, tw, th)) continue;
   if (!g) { g = &groups[gk]; g->rt = rt; g->tw = tw; g->th = th; g->rtW = rtW; g->rtH = rtH; if (groups.size() > 64) { groups.clear(); g = &groups[gk]; g->rt = rt; g->tw = tw; g->th = th; g->rtW = rtW; g->rtH = rtH; } }
   Rect r{ x.x0, x.y0, x.x1, x.y1 };
   if (g->prevFrame != frameNo) { g->prev.swap(g->frame); g->frame.clear(); g->prevFrame = frameNo; }
   if (g->frame.size() < 4096) g->frame.push_back(r);
   long long k = ((long long)(int)(x.x0 * 0.5f) << 44) ^ ((long long)(int)(x.y0 * 0.5f) << 30) ^ ((long long)(int)(x.u0 * 4096) << 15) ^ (long long)(int)(x.v0 * 4096);
   auto it = g->keys.find(k); if (it == g->keys.end()) { if (g->keys.size() > 20000) g->keys.clear(); g->keys[k] = Seen{ r, now, frameNo }; } else it->second.lastFrame = frameNo;
   // learned atlas on the learned target; or, for engines that build a small glyph sheet per line (a new texture every
   // line), any glyph quad of the learned glyph height on a target of the learned size (effect buffers drawn twice)
   bool sameAtlas = rt == areaRt && atlases.count(AtlasKey(rt, tw, th)), sheet = rtW == areaW && rtH == areaH && std::fabs((x.y1 - x.y0) - glyphH) <= glyphH * 0.25f;
   if (learned && armed && !readOnly && (sameAtlas || sheet)) {
    float cx = (x.x0 + x.x1) / 2, cy = (x.y0 + x.y1) / 2;
    if (cx >= area.x0 && cx <= area.x1 && cy >= area.y0 && cy <= area.y1) { drop.push_back((int)i); hiddenQuads++; }
   }
  }
  if (!drop.empty() && !hitSent) { hitSent = true; char b[128]; snprintf(b, sizeof b, "ToMe_GPUHIDE hit seq=%u quads=%u chars=%u", seq, (unsigned)drop.size(), n); if (emit) emit(b); }
  return drop;
 }

 // Merge offset copies (shadow / outline) and sort in reading order.
 static std::vector<Rect> Chars(std::vector<Rect> v) {
  std::vector<Rect> out; std::sort(v.begin(), v.end(), [](const Rect &a, const Rect &b) { return a.y0 != b.y0 ? a.y0 < b.y0 : a.x0 < b.x0; });
  for (auto &r : v) { float h = r.y1 - r.y0, tol = h * 0.4f; bool merged = false; for (auto &o : out) if (std::fabs(o.x0 - r.x0) < tol && std::fabs(o.y0 - r.y0) < tol) { o.x0 = (std::min)(o.x0, r.x0); o.y0 = (std::min)(o.y0, r.y0); o.x1 = (std::max)(o.x1, r.x1); o.y1 = (std::max)(o.y1, r.y1); merged = true; break; } if (!merged) out.push_back(r); }
  // rows: a glyph whose vertical centre is within half a height of the row's first glyph belongs to that row
  std::vector<std::vector<Rect>> rows; std::sort(out.begin(), out.end(), [](const Rect &a, const Rect &b) { return a.y0 < b.y0; });
  for (auto &r : out) { float cy = (r.y0 + r.y1) / 2; bool put = false; for (auto &row : rows) { float ry = (row[0].y0 + row[0].y1) / 2; if (std::fabs(cy - ry) < (row[0].y1 - row[0].y0) * 0.5f) { row.push_back(r); put = true; break; } } if (!put) rows.push_back({ r }); }
  std::vector<Rect> res; for (auto &row : rows) { std::sort(row.begin(), row.end(), [](const Rect &a, const Rect &b) { return a.x0 < b.x0; }); res.insert(res.end(), row.begin(), row.end()); }
  return res;
 }
 // Keep only the largest cluster of rows (a text box), dropping isolated glyph quads elsewhere (names, menus).
 static std::vector<Rect> Cluster(const std::vector<Rect> &c) {
  if (c.size() < 2) return c; float h = 0; for (auto &r : c) h += r.y1 - r.y0; h /= c.size();
  std::vector<int> id(c.size(), -1); int best = -1, bestN = 0, next = 0;
  for (size_t i = 0; i < c.size(); i++) { if (id[i] >= 0) continue; std::vector<size_t> st{ i }; id[i] = next; int cnt = 0;
   while (!st.empty()) { size_t a = st.back(); st.pop_back(); cnt++; for (size_t j = 0; j < c.size(); j++) if (id[j] < 0) { float dx = (std::max)(0.f, (std::max)(c[a].x0, c[j].x0) - (std::min)(c[a].x1, c[j].x1)), dy = (std::max)(0.f, (std::max)(c[a].y0, c[j].y0) - (std::min)(c[a].y1, c[j].y1)); if (dx < h * 1.6f && dy < h * 1.2f) { id[j] = next; st.push_back(j); } } }
   if (cnt > bestN) { bestN = cnt; best = next; } next++; }
  std::vector<Rect> out; for (size_t i = 0; i < c.size(); i++) if (id[i] == best) out.push_back(c[i]); return out;
 }

 void Frame(unsigned now, unsigned backW, unsigned backH) {
  frameNo++; bbW = backW; bbH = backH; if (!Armed(now)) return;
  if (reported && hiddenSent == (hitSent && !readOnly)) return;
  unsigned since = prevLineAt && now - prevLineAt < 120000 ? (std::max)(prevLineAt + 200, lineAt - 3000) : lineAt - 3000;
  for (auto &kv : groups) {
   Group &g = kv.second; std::vector<Rect> fresh, live;
   for (auto &s : g.keys) if ((int)(s.second.firstAt - since) >= 0) fresh.push_back(s.second.r);
   const std::vector<Rect> &last = g.prevFrame == frameNo - 1 ? g.frame : g.prev; live = last;
   std::vector<Rect> a = Chars(Cluster(Chars(live))), b = Chars(Cluster(Chars(fresh)));
   if (log && (now / 500) != ((now - 17) / 500)) log("frame %u group rt=%p %ux%u live=%u fresh=%u n=%u", frameNo, g.rt, g.tw, g.th, (unsigned)a.size(), (unsigned)b.size(), n);
   const std::vector<Rect> *hit = a.size() == n ? &a : b.size() == n ? &b : nullptr; if (!hit) continue;
   if (learned && (g.rt != areaRt || !atlases.count(AtlasKey(g.rt, g.tw, g.th)))) continue;
   Report(g, *hit);
   return;
  }
 }
 void Report(Group &g, const std::vector<Rect> &cs) {
  float h = 0; Rect box{ 1e30f, 1e30f, -1e30f, -1e30f }; for (auto &r : cs) { h += r.y1 - r.y0; box.x0 = (std::min)(box.x0, r.x0); box.y0 = (std::min)(box.y0, r.y0); box.x1 = (std::max)(box.x1, r.x1); box.y1 = (std::max)(box.y1, r.y1); } h /= cs.size();
  char b[256];
  if (!learned) {
   learned = true; areaRt = g.rt; areaW = g.rtW; areaH = g.rtH; glyphH = h; learnedSeq = seq; area = Rect{ box.x0 - h, box.y0 - h, box.x1 + h * 8, box.y1 + h * 2 };
   // atlases that drew inside the area during this line (outline / shadow sheets too, at least 3 glyphs)
   for (auto &kv : groups) { if (kv.second.rt != g.rt) continue; int in = 0; for (auto &r : kv.second.frame) { float cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2; if (cx >= area.x0 && cx <= area.x1 && cy >= area.y0 && cy <= area.y1) in++; } if (in >= 3 || &kv.second == &g) atlases.insert(AtlasKey(kv.second.rt, kv.second.tw, kv.second.th)); }
   snprintf(b, sizeof b, "ToMe_GPUHIDE learn seq=%u area=%.0f,%.0f,%.0f,%.0f atlas=%ux%u glyphs=%u chars=%u atlases=%u", seq, area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0, g.tw, g.th, (unsigned)cs.size(), n, (unsigned)atlases.size()); if (emit) emit(b);
  } else {
   // grow the area when a longer line spills over it
   area.x0 = (std::min)(area.x0, box.x0 - h * 0.5f); area.y0 = (std::min)(area.y0, box.y0 - h * 0.5f); area.x1 = (std::max)(area.x1, box.x1 + h * 0.5f); area.y1 = (std::max)(area.y1, box.y1 + h * 0.5f);
  }
  bool hidden = hitSent && !readOnly; std::string rects; bool mapped = true;
  for (auto r : cs) { if (!ToScreen(g.rt, g.rtW, g.rtH, r)) { mapped = false; break; } char x[64]; snprintf(x, sizeof x, "%s%.0f,%.0f,%.0f,%.0f", rects.empty() ? "" : ";", r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); rects += x; }
  if (!mapped) { if (log && frameNo % 60 == 0) log("rects not mapped yet: render target %p not composited", g.rt); return; } // try again next frame
  reported = true; hiddenSent = hidden;
  std::string t;
  { std::string u; for (size_t i = 0; i < text.size(); i++) { unsigned c = text[i]; if (c >= 0xD800 && c < 0xDC00 && i + 1 < text.size()) { c = 0x10000 + ((c - 0xD800) << 10) + (text[++i] - 0xDC00); u += (char)(0xF0 | (c >> 18)); u += (char)(0x80 | ((c >> 12) & 63)); u += (char)(0x80 | ((c >> 6) & 63)); u += (char)(0x80 | (c & 63)); } else if (c < 0x80) u += (char)c; else if (c < 0x800) { u += (char)(0xC0 | (c >> 6)); u += (char)(0x80 | (c & 63)); } else { u += (char)(0xE0 | (c >> 12)); u += (char)(0x80 | ((c >> 6) & 63)); u += (char)(0x80 | (c & 63)); } } t = u; }
  std::string line = "ToMe_CHARS engine=gpu line=" + std::to_string(seq) + " hidden=" + (hidden ? "1" : "0") + " sw=" + std::to_string(bbW) + " sh=" + std::to_string(bbH) + " vx=0 vy=0 vw=" + std::to_string(bbW) + " vh=" + std::to_string(bbH) + " n=" + std::to_string(cs.size()) + " rects=" + rects + " text=" + t;
  if (emit) emit(line);
 }
};
