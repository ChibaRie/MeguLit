// SPDX-License-Identifier: GPL-3.0-or-later
// Synthetic-frame test of DotFinder.h: 1920x1080 frames with a textured scene, a gradient text box, UI distractors and
// glyph dots drawn the way part ① draws them (solid square, glyph colour and alpha, sub-pixel position → antialiased
// edges). Each scenario checks, frame by frame, that exactly the revealed dots are found, in reading order, within
// 1.5 px, and that inpainting brings the dot pixels back to the clean frame. Prints one JSON line per scenario and a
// summary; exit code 0 only when every scenario passes.
#include "../DotFinder.h"
#include <chrono>
#include <cstdio>
#include <functional>
#include <random>

using namespace megu;

// Centre of the dot. w > 0: a spec-1 dot (①, docs/text-architecture.md): solid w x h block, no antialiasing, top-left
// at (x - w/2, y - h/2) on whole pixels.
struct Glyph { float x, y; int w = 0, h = 0; };

struct Canvas {
  int w = 1920, h = 1080; std::vector<uint8_t> px;
  Canvas() : px(size_t(w) * h * 4) {}
  Image img() { return { px.data(), w, h, w * 4 }; }
  void blend(int x, int y, Rgb c, float a) {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
    uint8_t *p = &px[(size_t(y) * w + x) * 4];
    p[0] = uint8_t(p[0] + (c.b - p[0]) * a + .5f); p[1] = uint8_t(p[1] + (c.g - p[1]) * a + .5f); p[2] = uint8_t(p[2] + (c.r - p[2]) * a + .5f);
  }
};

static void Scene(Canvas &cv, int seed, Box textBox) {
  std::mt19937 rng(seed); std::uniform_int_distribution<int> n(-6, 6);
  for (int y = 0; y < cv.h; ++y) for (int x = 0; x < cv.w; ++x) {
    uint8_t *p = &cv.px[(size_t(y) * cv.w + x) * 4];
    const int r = 90 + x * 80 / cv.w + int(20 * std::sin(y * .02)), g = 120 + y * 60 / cv.h, b = 150 + int(30 * std::sin((x + y) * .01));
    p[0] = uint8_t(std::clamp(b + n(rng), 0, 255)); p[1] = uint8_t(std::clamp(g + n(rng), 0, 255)); p[2] = uint8_t(std::clamp(r + n(rng), 0, 255)); p[3] = 255;
  }
  // Text box: dark, half transparent, vertical gradient; seed 11: a 2-pixel dither instead (ダストマニア's box).
  for (int y = textBox.y0; y < textBox.y1; ++y) for (int x = textBox.x0; x < textBox.x1; ++x) {
    if (seed == 11) { uint8_t *p = &cv.px[(size_t(y) * cv.w + x) * 4]; const bool on = ((x + y) & 1) == 0; p[0] = on ? 41 : 0; p[1] = on ? 29 : 0; p[2] = on ? 52 : 0; }
    else cv.blend(x, y, { 10, 14, 30 }, .62f + .2f * (y - textBox.y0) / std::max(1, textBox.h()));
  }
  // UI distractors: cyan bullets (dot-shaped, wrong colour) and a white frame line.
  for (int i = 0; i < 6; ++i) for (int y = 0; y < 5; ++y) for (int x = 0; x < 5; ++x) cv.blend(textBox.x1 - 40 - i * 22 + x, textBox.y1 - 20 + y, { 40, 230, 240 }, 1);
  for (int x = textBox.x0; x < textBox.x1; ++x) { cv.blend(x, textBox.y0, { 240, 240, 240 }, 1); cv.blend(x, textBox.y0 + 1, { 240, 240, 240 }, 1); }
}

// Solid square of side s centred at (cx,cy), sub-pixel position → coverage-weighted edges.
static void DrawDot(Canvas &cv, float cx, float cy, float s, Rgb c, float a) {
  const float x0 = cx - s / 2, y0 = cy - s / 2, x1 = cx + s / 2, y1 = cy + s / 2;
  for (int y = int(std::floor(y0)); y < int(std::ceil(y1)); ++y) for (int x = int(std::floor(x0)); x < int(std::ceil(x1)); ++x) {
    const float cov = std::max(0.f, std::min(x1, x + 1.f) - std::max(x0, float(x))) * std::max(0.f, std::min(y1, y + 1.f) - std::max(y0, float(y)));
    cv.blend(x, y, c, a * cov);
  }
}

static void DrawRect(Canvas &cv, int x0, int y0, int w, int h, Rgb c, float a) { for (int y = y0; y < y0 + h; ++y) for (int x = x0; x < x0 + w; ++x) cv.blend(x, y, c, a); }
static void Draw(Canvas &cv, const Glyph &g, float dx, float dy, float s, Rgb c, float a, bool shadow) {
  if (!g.w) { if (shadow) DrawDot(cv, g.x + dx + 2, g.y + dy + 2, s, { 20, 20, 24 }, a); DrawDot(cv, g.x + dx, g.y + dy, s, c, a); return; }
  const int x0 = int(std::lround(g.x - g.w / 2.f + dx)), y0 = int(std::lround(g.y - g.h / 2.f + dy));
  if (shadow) DrawRect(cv, x0 + 2, y0 + 2, g.w, g.h, { 20, 20, 24 }, a);
  DrawRect(cv, x0, y0, g.w, g.h, c, a);
}

// Spec-1 layout: the dot is the top-left of each glyph's black box, s = 3 (2 under 12 px); black boxes start at varying
// offsets inside the cell, 。 and 、 sit low, thin glyphs (ー) clip the dot to 3x1.
static std::vector<Glyph> Spec1Layout(int count, int em, int x0, int y0, int perRow, bool centred = false, int areaW = 0, int side = 0) {
  std::vector<Glyph> g; const int s = side ? side : em >= 12 ? 3 : 2; const int step = int(em * 1.45f);
  for (int i = 0; i < count; ++i) {
    const int row = i / perRow, col = i % perRow, inRow = std::min(perRow, count - row * perRow);
    const int off = centred ? (areaW - inRow * em) / 2 : 0;
    const int cx = x0 + off + col * em, cy = y0 + row * step;
    int bx = 1 + (i * 7) % std::max(1, em / 4), by = 1 + (i * 5) % std::max(1, em / 5), w = s, h = s;
    if (i % 9 == 8) { bx = em / 8; by = int(em * .62f); }       // 。
    if (i % 13 == 6) { by = em / 2; h = 1; }                       // ー: black box 1 px high
    if (i % 17 == 10) { w = 2; }                                   // narrow glyph clips the width
    g.push_back({ cx + bx + w / 2.f, cy + by + h / 2.f, w, h });
  }
  return g;
}

static std::vector<Glyph> Layout(int count, float em, float x0, float y0, int perRow, bool vertical, bool centred, float areaW) {
  std::vector<Glyph> g;
  const float step = em * 1.45f;
  for (int i = 0; i < count; ++i) {
    const int row = i / perRow, col = i % perRow;
    const int inRow = std::min(perRow, count - row * perRow);
    float off = centred ? (areaW - inRow * em) / 2 : 0;
    if (!vertical) g.push_back({ x0 + off + col * em + em / 2, y0 + row * step + em / 2 });
    else g.push_back({ x0 - row * step - em / 2, y0 + col * em + em / 2 });
  }
  return g;
}

struct Stats { int frames = 0, ok = 0; double maxErr = 0, ms = 0, inpaintMax = 0, inpaintMean = 0; long inpaintN = 0; std::string fail; };

struct Step { std::vector<Glyph> cur; std::vector<std::vector<Glyph>> kept; float alpha = 1; float dx = 0, dy = 0; int expectFound = -1; bool shadow = false; std::vector<Glyph> extra, soft; };

static bool Check(const TrackResult &r, const std::vector<Glyph> &truth, float dx, float dy, Stats &st, int frame, bool checkPos) {
  if (r.dots.size() != truth.size()) { if (st.fail.empty()) st.fail = "frame " + std::to_string(frame) + ": found " + std::to_string(r.dots.size()) + " want " + std::to_string(truth.size()); return false; }
  if (!checkPos) return true;
  for (size_t i = 0; i < truth.size(); ++i) {
    const double e = std::hypot(r.dots[i].cx - (truth[i].x + dx), r.dots[i].cy - (truth[i].y + dy));
    st.maxErr = std::max(st.maxErr, e);
    if (e > 1.5) { if (st.fail.empty()) st.fail = "frame " + std::to_string(frame) + ": dot " + std::to_string(i) + " off by " + std::to_string(e); return false; }
  }
  return true;
}

// Runs one scenario: steps() yields per frame the visible dots; a new line starts when lineStart(frame) is true.
static int SceneSeed = 7;
static Stats Scenario(const char *name, int frames, Box textBox, float em, Rgb color, LineSpec base, std::function<Step(int)> step, std::function<int(int)> lineStart, bool checkPos = true, bool inpaintCheck = true) {
  Stats st; Canvas clean; Scene(clean, SceneSeed, textBox);
  DotTracker tr; Canvas cv; const float s = std::max(2.f, std::round(em / 6));
  for (int f = 0; f < frames; ++f) {
    const Step sp = step(f);
    const int ls = lineStart(f);
    if (ls >= 0) { LineSpec spec = base; spec.id = ls; spec.expected = base.expected; tr.BeginLine(spec); }
    // Shake / scroll move the whole frame content.
    Canvas bg; if (sp.dx != 0 || sp.dy != 0) { Scene(bg, SceneSeed, { textBox.x0 + int(sp.dx), textBox.y0 + int(sp.dy), textBox.x1 + int(sp.dx), textBox.y1 + int(sp.dy) }); } else bg = clean;
    cv = bg;
    for (auto &l : sp.kept) for (auto &g : l) Draw(cv, g, sp.dx, sp.dy, s, color, 1, sp.shadow);
    for (auto &g : sp.extra) Draw(cv, g, sp.dx, sp.dy, s, color, 1, false);
    for (auto &g : sp.soft) DrawDot(cv, g.x + .25f + sp.dx, g.y + .25f + sp.dy, 3.f, color, 1); // quarter-pixel offset → soft edges
    for (auto &g : sp.cur) Draw(cv, g, sp.dx, sp.dy, s, color, sp.alpha, sp.shadow);
    Image im = cv.img();
    const auto t0 = std::chrono::steady_clock::now();
    const TrackResult &r = tr.Update(im);
    for (auto &d : r.dots) Inpaint(im, EraseBox(im, d.box));
    for (auto &l : r.kept) for (auto &d : l.dots) Inpaint(im, EraseBox(im, d.box));
    st.ms += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    ++st.frames;
    const bool visible = sp.alpha >= .25f || sp.cur.empty();
    bool good = visible ? Check(r, sp.cur, sp.dx, sp.dy, st, f, checkPos) : true;
    if (good && sp.kept.size() != r.kept.size() && !sp.kept.empty()) { good = false; if (st.fail.empty()) st.fail = "frame " + std::to_string(f) + ": kept lines " + std::to_string(r.kept.size()); }
    if (good) ++st.ok;
    if (inpaintCheck && visible && good) {
      for (auto *lst : { &sp.cur }) for (auto &g : *lst) {
        for (int y = int(g.y + sp.dy - s); y <= int(g.y + sp.dy + s + 2); ++y) for (int x = int(g.x + sp.dx - s); x <= int(g.x + sp.dx + s + 2); ++x) {
          const uint8_t *a = im.at(x, y), *b = &bg.px[(size_t(y) * bg.w + x) * 4];
          const int d = std::max({ std::abs(a[0] - b[0]), std::abs(a[1] - b[1]), std::abs(a[2] - b[2]) });
          st.inpaintMax = std::max(st.inpaintMax, double(d)); st.inpaintMean += d; ++st.inpaintN;
        }
      }
    }
  }
  if (st.inpaintN) st.inpaintMean /= st.inpaintN;
  std::printf("{\"scenario\":\"%s\",\"frames\":%d,\"ok\":%d,\"rate\":%.4f,\"maxErrPx\":%.2f,\"msPerFrame\":%.3f,\"inpaintMaxDiff\":%.0f,\"inpaintMeanDiff\":%.2f,\"fail\":\"%s\"}\n",
    name, st.frames, st.ok, double(st.ok) / st.frames, st.maxErr, st.ms / st.frames, st.inpaintMax, st.inpaintMean, st.fail.c_str());
  return st;
}

int main() {
  int failed = 0; double rateSum = 0; int n = 0; double msMax = 0;
  auto account = [&](const Stats &s, double minRate, double maxInpaintMean) {
    const double rate = double(s.ok) / s.frames; rateSum += rate; ++n; msMax = std::max(msMax, s.ms / s.frames);
    if (rate < minRate || s.inpaintMean > maxInpaintMean) ++failed;
  };
  const Box adv{ 160, 780, 1760, 1040 };
  const Rgb white{ 250, 250, 250 };

  { // 1. ADV, horizontal, wrapped to 2 rows, typewriter 1 dot / frame, colour unknown (learned from the dots)
    const auto g = Layout(52, 32, 220, 830, 40, false, false, 0);
    LineSpec b; b.expected = 52; b.em = 32;
    account(Scenario("adv-typewriter-learn", 70, adv, 32, white, b, [&](int f) { Step s; s.cur.assign(g.begin(), g.begin() + std::min<int>(52, f + 1)); return s; }, [](int f) { return f == 0 ? 1 : -1; }), .95, 3);
  }
  { // 2. Centred rows, colour reported by the hook
    const auto g = Layout(30, 28, 220, 830, 18, false, true, 1480);
    LineSpec b; b.expected = 30; b.colorKnown = true; b.color = { 255, 230, 160 };
    account(Scenario("centred-known-colour", 40, adv, 28, { 255, 230, 160 }, b, [&](int f) { Step s; s.cur.assign(g.begin(), g.begin() + std::min<int>(30, f + 1)); return s; }, [](int f) { return f == 0 ? 1 : -1; }), .97, 3);
  }
  { // 3. Vertical NVL, full screen: line 1 stays while line 2 types in (columns right→left)
    const Box full{ 0, 0, 1920, 1080 };
    const auto l1 = Layout(24, 30, 1700, 120, 24, true, false, 0), l2 = Layout(40, 30, 1700 - 2 * 30 * 1.45f, 120, 24, true, false, 0);
    LineSpec b; b.expected = -1; b.vertical = -1; b.colorKnown = true; b.color = white;
    int line = 0;
    account(Scenario("vertical-nvl-keep", 80, full, 30, white, b, [&](int f) {
      Step s; if (f < 30) s.cur.assign(l1.begin(), l1.begin() + std::min<int>(24, f + 1)); else { s.kept = { l1 }; s.cur.assign(l2.begin(), l2.begin() + std::min<int>(40, f - 30 + 1)); } return s; },
      [&](int f) { return f == 0 ? (line = 1) : f == 30 ? (line = 2) : -1; }), .97, 3);
  }
  { // 4. Fade out after full reveal: alpha 1 → 0 over 12 frames; dots keep their places with falling alpha
    const auto g = Layout(20, 32, 220, 830, 40, false, false, 0);
    LineSpec b; b.expected = 20; b.colorKnown = true; b.color = white;
    account(Scenario("fade-out", 40, adv, 32, white, b, [&](int f) { Step s; s.cur = g; s.alpha = f < 20 ? 1.f : std::max(0.f, 1.f - (f - 19) / 12.f); if (s.alpha <= 0) s.cur.clear(); return s; }, [](int f) { return f == 0 ? 1 : -1; }), .95, 4);
  }
  { // 5. Shake: whole screen jitters ±8 px every frame
    const auto g = Layout(36, 30, 220, 830, 30, false, false, 0);
    LineSpec b; b.expected = 36; b.colorKnown = true; b.color = white;
    std::mt19937 rng(3); std::uniform_int_distribution<int> j(-8, 8);
    std::vector<std::pair<int, int>> off(60); for (auto &o : off) o = { j(rng), j(rng) };
    account(Scenario("shake", 60, adv, 30, white, b, [&](int f) { Step s; s.cur = g; s.dx = float(off[f].first); s.dy = float(off[f].second); return s; }, [](int f) { return f == 0 ? 1 : -1; }), .97, 4);
  }
  { // 6. Scroll: text box slides up 4 px / frame (backlog-style scroll)
    const auto g = Layout(36, 30, 220, 830, 30, false, false, 0);
    LineSpec b; b.expected = 36; b.colorKnown = true; b.color = white;
    account(Scenario("scroll", 60, adv, 30, white, b, [&](int f) { Step s; s.cur = g; s.dy = -4.f * f; return s; }, [](int f) { return f == 0 ? 1 : -1; }), .97, 4);
  }
  { // 7. ADV next line at the same place: the old line must not be kept
    const auto l1 = Layout(18, 32, 220, 830, 40, false, false, 0), l2 = Layout(26, 32, 220, 830, 40, false, false, 0);
    LineSpec b; b.expected = -1; b.colorKnown = true; b.color = white;
    account(Scenario("adv-next-line", 60, adv, 32, white, b, [&](int f) { Step s; if (f < 25) s.cur.assign(l1.begin(), l1.begin() + std::min<int>(18, f + 1)); else if (f < 27) {} else s.cur.assign(l2.begin(), l2.begin() + std::min<int>(26, f - 26)); return s; },
      [](int f) { return f == 0 ? 1 : f == 25 ? 2 : -1; }), .97, 3);
  }
  { // 8. Big font (em 64 → 11 px antialiased dots: a game that scales its own frame); small fonts: spec1-small-2px
    LineSpec b; b.expected = 20; b.colorKnown = true; b.color = white;
    const auto gb = Layout(20, 64, 220, 820, 20, false, false, 0);
    account(Scenario("big-em64", 20, adv, 64, white, b, [&](int) { Step s; s.cur = gb; return s; }, [](int f) { return f == 0 ? 1 : -1; }), .97, 6);
  }
  { // 9. Fade in from zero (alpha rises over 10 frames) — faint dots found by shape + alpha once the area is known
    const auto g1 = Layout(12, 32, 220, 830, 40, false, false, 0), g = Layout(22, 32, 220, 830, 40, false, false, 0);
    LineSpec b; b.expected = -1; b.colorKnown = true; b.color = white;
    account(Scenario("fade-in", 40, adv, 32, white, b, [&](int f) { Step s; if (f < 10) s.cur = g1; else if (f < 12) {} else { s.cur = g; s.alpha = std::min(1.f, (f - 11) / 10.f); } return s; },
      [](int f) { return f == 0 ? 1 : f == 10 ? 2 : -1; }), .9, 6);
  }
  { // 12. Spec-1 dots (3 px at black-box top-left, 。 low, ー clipped to 3x1), typewriter, colour learned
    const auto g = Spec1Layout(54, 28, 220, 830, 44);
    LineSpec b; b.expected = 54;
    account(Scenario("spec1-adv-learn", 70, adv, 28, white, b, [&](int f) { Step s; s.cur.assign(g.begin(), g.begin() + std::min<int>(54, f + 1)); return s; }, [](int f) { return f == 0 ? 1 : -1; }), .95, 3);
  }
  { // 13. Spec-1 dots with a shadow copy (+2,+2, dark) drawn under each: shadow erased with the dot
    const auto g = Spec1Layout(40, 28, 220, 830, 30, true, 1480);
    LineSpec b; b.expected = 40; b.colorKnown = true; b.color = white;
    account(Scenario("spec1-shadow-centred", 50, adv, 28, white, b, [&](int f) { Step s; s.shadow = true; s.cur.assign(g.begin(), g.begin() + std::min<int>(40, f + 1)); return s; }, [](int f) { return f == 0 ? 1 : -1; }), .97, 4);
  }
  { // 14. Spec-1 small font: cell under 12 px → 2 px dots, three rows
    const auto g = Spec1Layout(90, 11, 220, 830, 40);
    LineSpec b; b.expected = 90; b.colorKnown = true; b.color = { 250, 240, 200 };
    account(Scenario("spec1-small-2px", 20, adv, 11, { 250, 240, 200 }, b, [&](int) { Step s; s.cur = g; return s; }, [](int f) { return f == 0 ? 1 : -1; }), .97, 3);
  }
  { // 15. Spec-1 NVL page: three lines kept while the fourth types, then a page break (all cleared)
    const Box full{ 0, 0, 1920, 1080 };
    std::vector<std::vector<Glyph>> L; for (int k = 0; k < 4; ++k) L.push_back(Spec1Layout(16 + k * 2, 30, 200, 120 + k * 2 * 44, 40));
    LineSpec b; b.colorKnown = true; b.color = white;
    account(Scenario("spec1-nvl-page", 110, full, 30, white, b, [&](int f) {
      Step s; const int line = std::min(3, f / 25), t = f - line * 25;
      if (f >= 100) return s; // page break
      for (int k = 0; k < line; ++k) s.kept.push_back(L[k]);
      s.cur.assign(L[line].begin(), L[line].begin() + std::min<int>(int(L[line].size()), t + 1)); return s; },
      [](int f) { return f % 25 == 0 && f < 100 ? f / 25 + 1 : -1; }), .97, 3);
  }
  { // 19. Spec 2: side max(3, round(h/10)) → 42 px cells give 4 px dots (CLANNAD), shadow copy, clipped ー (4x1)
    const auto g = Spec1Layout(30, 42, 220, 790, 30, false, 0, 4);
    LineSpec b; b.expected = 30; b.colorKnown = true; b.color = white;
    account(Scenario("spec2-4px-shadow", 40, adv, 42, white, b, [&](int f) { Step s; s.shadow = true; s.cur.assign(g.begin(), g.begin() + std::min<int>(30, f + 1)); return s; }, [](int f) { return f == 0 ? 1 : -1; }), .97, 4);
  }
  { // 18. Spec-1 dots on a 2-pixel dither box (ダストマニア): patch inpaint keeps the dither phase → near-zero error
    SceneSeed = 11;
    const auto g = Spec1Layout(37, 28, 220, 830, 24);
    LineSpec b; b.expected = 37; b.colorKnown = true; b.color = white;
    account(Scenario("spec1-dither-box", 50, adv, 28, white, b, [&](int f) { Step s; s.cur.assign(g.begin(), g.begin() + std::min<int>(37, f + 1)); return s; }, [](int f) { return f == 0 ? 1 : -1; }), .97, 1);
    SceneSeed = 7;
  }
  { // 17. ADV, the box-clear frame is never seen: the new line starts on the old line's places, 3 dots already shown
    // when its message arrives; the old (short) line must not be kept. Then a NVL page: line 2 on the next row keeps line 1.
    const auto l1 = Spec1Layout(4, 28, 220, 830, 40), l2 = Spec1Layout(30, 28, 220, 830, 40);
    LineSpec b; b.expected = -1; b.colorKnown = true; b.color = white;
    std::vector<int> exp = { 4, 30 };
    account(Scenario("adv-overwrite-no-clear", 50, adv, 28, white, b, [&](int f) { Step s; if (f < 10) s.cur = l1; else s.cur.assign(l2.begin(), l2.begin() + std::min<int>(30, f - 10 + 3)); return s; },
      [](int f) { return f == 0 ? 1 : f == 10 ? 2 : -1; }), .9, 3);
  }
  { // 16. Distractors in the text colour: an antialiased "・" fragment near the line and a static UI "…" (hard-edged,
    // on screen before the line starts) must not count as dots.
    const auto g = Spec1Layout(30, 28, 220, 830, 40);
    LineSpec b; b.expected = 30; b.colorKnown = true; b.color = white;
    account(Scenario("spec1-distractors", 40, adv, 28, white, b, [&](int f) {
      Step s; if (f >= 2) s.cur.assign(g.begin(), g.begin() + std::min<int>(30, f - 1));
      s.extra = { { 1500.f, 800.f, 3, 3 }, { 1510.f, 800.f, 3, 3 }, { 1520.f, 800.f, 3, 3 } };   // static "…" (hard)
      s.soft = { { 900.f, 1000.f } };                                                            // AA "・"
      return s; }, [](int f) { return f == 2 ? 1 : -1; }), .97, 3);
  }
  { // 10. Choices: three runs, one highlighted in another colour; SplitRuns gives three boxes, highlight readable
    Canvas cv; const Box full{ 0, 0, 1920, 1080 }; Scene(cv, 9, { 0, 0, 0, 0 });
    std::vector<std::vector<Glyph>> runs = { Layout(8, 30, 760, 380, 30, false, false, 0), Layout(11, 30, 715, 480, 30, false, false, 0), Layout(6, 30, 790, 580, 30, false, false, 0) };
    const Rgb hl{ 255, 200, 80 };
    for (size_t r = 0; r < runs.size(); ++r) for (auto &g : runs[r]) DrawDot(cv, g.x, g.y, 5, r == 1 ? hl : white, 1);
    // Choice dots come in two colours: find each colour with its own tracker, then merge and split into runs.
    std::vector<Dot> all;
    for (Rgb c : { white, hl }) { DotTracker t; LineSpec s; s.colorKnown = true; s.color = c; t.BeginLine(s); Image im = cv.img(); auto &r = t.Update(im); all.insert(all.end(), r.dots.begin(), r.dots.end()); }
    const float p = Pitch(all); ReadingOrder(all, false, p);
    auto rs = SplitRuns(all, false, p);
    const bool ok = rs.size() == 3 && rs[0].dots.size() == 8 && rs[1].dots.size() == 11 && rs[2].dots.size() == 6 && ColorDist(rs[1].color, hl) < 40 && ColorDist(rs[0].color, white) < 40;
    // Same screen through ChoiceTracker: first frame all white, then item 2 highlighted (colour learned from the change),
    // then the hover moves to item 3.
    ChoiceTracker ct; ct.Begin({ 8, 11, 6 }, { white });
    Canvas c2; Scene(c2, 9, { 0, 0, 0, 0 });
    for (size_t r = 0; r < runs.size(); ++r) for (auto &g : runs[r]) DrawDot(c2, g.x, g.y, 5, white, 1);
    Image i2 = c2.img(); ct.Update(i2);
    Image i1 = cv.img(); ct.Update(i1); auto co = ct.Update(i1);
    const bool ok2 = co.ok && co.items.size() == 3 && co.items[1].highlighted && !co.items[0].highlighted && !co.items[2].highlighted;
    Canvas c3; Scene(c3, 9, { 0, 0, 0, 0 });
    for (size_t r = 0; r < runs.size(); ++r) for (auto &g : runs[r]) DrawDot(c3, g.x, g.y, 5, r == 2 ? hl : white, 1);
    Image i3 = c3.img(); auto co3 = ct.Update(i3);
    const bool ok3 = co3.ok && co3.items.size() == 3 && co3.items[2].highlighted && !co3.items[1].highlighted;
    std::printf("{\"scenario\":\"choice-hover\",\"frames\":3,\"ok\":%d,\"rate\":%d}\n", int(ok2) + int(ok3), ok2 && ok3 ? 1 : 0);
    rateSum += (ok2 && ok3); ++n; if (!(ok2 && ok3)) ++failed;
    std::printf("{\"scenario\":\"choices-runs\",\"frames\":1,\"ok\":%d,\"rate\":%d,\"runs\":%zu}\n", ok ? 1 : 0, ok ? 1 : 0, rs.size());
    rateSum += ok; ++n; if (!ok) ++failed;
  }
  { // 10b. Choices with cached glyphs (Siglus): item 1 has 10 characters but only 6 dots, item 2 all 5 -> one item per
    // row, item 1 widened by the 4 missing characters; a wrong row count is still rejected.
    Canvas cv; Scene(cv, 9, { 0, 0, 0, 0 });
    const auto r1 = Layout(10, 30, 700, 400, 30, false, false, 0), r2 = Layout(5, 30, 700, 470, 30, false, false, 0);
    // The items are dim grey (unselected) and already on screen: only the line's white is known, nothing changes.
    const Rgb dim{ 188, 188, 190 };
    for (int i : { 0, 2, 3, 4, 5, 7 }) DrawDot(cv, r1[i].x, r1[i].y, 5, dim, 1);
    for (auto &g : r2) DrawDot(cv, g.x, g.y, 5, dim, 1);
    ChoiceTracker ct; ct.Begin({ 10, 5 }, { white }); Image im = cv.img(); ct.Update(im); ct.Update(im); auto co = ct.Update(im);
    const bool ok = co.ok && co.items.size() == 2 && co.items[0].missing == 4 && co.items[1].missing == 0 && co.items[0].box.x1 - co.items[0].box.x0 >= 9 * 30;
    ChoiceTracker bad; bad.Begin({ 10, 5, 4 }, { dim }); Image im2 = cv.img(); const bool ok2 = !bad.Update(im2).ok;
    std::printf("{\"scenario\":\"choices-cached-glyphs\",\"frames\":1,\"ok\":%d,\"rate\":%d}\n", int(ok) + int(ok2), ok && ok2 ? 1 : 0);
    rateSum += (ok && ok2); ++n; if (!(ok && ok2)) ++failed;
  }
  { // 10c. NVL page drawn before its text arrived: two earlier rows (never followed) and the current row are all in the
    // base frame; with ①'s count for the current line (hint 9) the tracker takes the last 9 dots as the line and offers
    // the earlier rows' dots as orphans (reading order) for the caller to give to those lines.
    Canvas cv; Scene(cv, 7, adv);
    const auto r1 = Layout(12, 32, 220, 840, 40, false, false, 0), r2 = Layout(10, 32, 220, 900, 40, false, false, 0), r3 = Layout(9, 32, 220, 960, 40, false, false, 0);
    for (auto *r : { &r1, &r2, &r3 }) for (auto &g : *r) DrawDot(cv, g.x, g.y, 5, white, 1);
    DotTracker t; LineSpec s; s.colorKnown = true; s.color = white; s.hint = 9; Image im = cv.img();
    t.Update(im); t.BeginLine(s); t.Update(im); const auto &r = t.Update(im); // first frame seen before the line (colour still unknown): the page is in the base
    const bool ok = r.dots.size() == 9 && r.orphans.size() == 22 && r.orphans.front().cy < r.orphans.back().cy;
    std::printf("{\"scenario\":\"nvl-page-orphans\",\"frames\":3,\"ok\":%d,\"rate\":%d,\"line\":%zu,\"orphans\":%zu}\n", int(ok), int(ok), r.dots.size(), r.orphans.size());
    rateSum += ok; ++n; if (!ok) ++failed;
  }
  { // 11. Timing at 1080p: colour learning on a full frame, then tracking in the learned area
    Canvas cv; Scene(cv, 7, adv); const auto g = Layout(52, 32, 220, 830, 40, false, false, 0);
    for (auto &x : g) DrawDot(cv, x.x, x.y, 5, white, 1);
    DotTracker t; LineSpec s; s.expected = 52; t.BeginLine(s); Image im = cv.img();
    auto t0 = std::chrono::steady_clock::now(); t.Update(im); const double learn = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    t0 = std::chrono::steady_clock::now(); for (int i = 0; i < 50; ++i) t.Update(im); const double track = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count() / 50;
    t0 = std::chrono::steady_clock::now(); DotTracker full; LineSpec k; k.colorKnown = true; k.color = white; full.BeginLine(k); for (int i = 0; i < 20; ++i) full.Update(im); const double fullScan = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count() / 20;
    std::printf("{\"timing\":{\"learnFullFrameMs\":%.2f,\"learnNoChangeFrameMs\":%.3f,\"trackFirstFullFrameMs\":%.2f}}\n", learn, track, fullScan);
  }
  std::printf("{\"summary\":{\"scenarios\":%d,\"failed\":%d,\"meanRate\":%.4f,\"worstMsPerFrame\":%.3f}}\n", n, failed, rateSum / n, msMax);
  return failed ? 1 : 0;
}
