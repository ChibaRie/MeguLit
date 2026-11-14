// SPDX-License-Identifier: GPL-3.0-or-later
// MeguLitCompositor.exe — part ② of docs/text-architecture.md (owner, 2026-11-14: MeguLit draws all game text itself).
// Captures the game window with Windows.Graphics.Capture, finds the glyph dots part ① makes the game draw instead of the
// current line's glyphs, inpaints them, draws MeguLit's own Japanese (furigana), translation (beside the text by
// default) or translation-only text and choice boxes with Direct2D/DirectWrite on the same D3D11 device, and presents
// the frame in MeguLit's own window over the game. The window is click-through and never takes focus, so keyboard and
// mouse go to the game; a low-level mouse hook takes only clicks that land on MeguLit's glyph boxes (look-up).
//
// Capture, cursor mapping and the Lanczos scaler are taken from Magpie v0.13 (https://github.com/Blinue/Magpie,
// GPL-3.0, see THIRD-PARTY.md): GraphicsCaptureFrameSource (item creation incl. the WS_EX_APPWINDOW retry for
// Kirikiri-style owned windows, frame box from the extended frame bounds, cursor capture and the yellow border off,
// MinUpdateInterval 1 ms), CursorManager (SrcToScaling / ScalingToSrc, ReliableSetCursorPos, MagShowSystemCursor) and
// Effects/Lanczos.hlsl.
//
// Protocol: one JSON object per line on stdin (commands) and stdout (events); see docs/text-architecture.md.
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <dwmapi.h>
#include <d3d11_4.h>
#include <dxgi1_6.h>
#include <d2d1_3.h>
#include <dwrite_3.h>
#include <d3dcompiler.h>
#include <wincodec.h>
#include <unknwn.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Metadata.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include "DotFinder.h"
#include "Json.h"

using winrt::com_ptr;
namespace wgc = winrt::Windows::Graphics::Capture;
namespace wdx = winrt::Windows::Graphics::DirectX;
namespace wd3d = winrt::Windows::Graphics::DirectX::Direct3D11;
using namespace megu;
static const char Marker[] = "MeguLitCompositor version=1"; // checked by tools/native-stale.cjs

// ---------------------------------------------------------------- small helpers
static std::wstring Wide(const std::string &s) { if (s.empty()) return {}; int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), nullptr, 0); std::wstring w(n, 0); MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), w.data(), n); return w; }
static std::string Utf8(const std::wstring &w) { if (w.empty()) return {}; int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), int(w.size()), nullptr, 0, nullptr, nullptr); std::string s(n, 0); WideCharToMultiByte(CP_UTF8, 0, w.data(), int(w.size()), s.data(), n, nullptr, nullptr); return s; }
static std::u32string U32(const std::wstring &w) { std::u32string o; for (size_t i = 0; i < w.size(); ++i) { char32_t c = w[i]; if (c >= 0xD800 && c < 0xDC00 && i + 1 < w.size()) { c = 0x10000 + ((c - 0xD800) << 10) + (w[i + 1] - 0xDC00); ++i; } o += c; } return o; }
static std::wstring W16(char32_t c) { std::wstring w; if (c >= 0x10000) { c -= 0x10000; w += wchar_t(0xD800 + (c >> 10)); w += wchar_t(0xDC00 + (c & 0x3FF)); } else w += wchar_t(c); return w; }
static std::wstring W16(const std::u32string &s) { std::wstring w; for (char32_t c : s) w += W16(c); return w; }
static double NowMs() { static LARGE_INTEGER f = [] { LARGE_INTEGER x; QueryPerformanceFrequency(&x); return x; }(); LARGE_INTEGER c; QueryPerformanceCounter(&c); return double(c.QuadPart) * 1000.0 / double(f.QuadPart); }
static bool ParseColor(const std::string &s, Rgb &c, float *alpha = nullptr) {
  if (s.size() < 7 || s[0] != '#') return false;
  const unsigned long v = std::strtoul(s.c_str() + 1, nullptr, 16);
  if (s.size() >= 9) { c = { int((v >> 24) & 255), int((v >> 16) & 255), int((v >> 8) & 255) }; if (alpha) *alpha = (v & 255) / 255.f; }
  else { c = { int((v >> 16) & 255), int((v >> 8) & 255), int(v & 255) }; if (alpha) *alpha = 1; }
  return true;
}
static std::mutex OutLock;
static void Emit(const std::string &json) { std::lock_guard<std::mutex> g(OutLock); std::fwrite(json.data(), 1, json.size(), stdout); std::fputc('\n', stdout); std::fflush(stdout); }

// ---------------------------------------------------------------- protocol state
struct Ruby { int start = 0, end = 0; std::wstring text; };
// ① spec-1 metrics of one character (index into the blank-stripped line): cell height, ascent, advance, and the dot's
// offset from the cell's top-left.
struct CharMetric { bool known = false; float h = 0, b = 0, a = 0, x = 0, y = 0; };
struct ChoiceText { std::u32string text; std::wstring tl; };
struct LineMsg {
  int id = 0; std::u32string text; std::vector<Ruby> ruby; std::wstring tl; std::vector<int> dotChar;
  int vertical = -1; float em = 0; bool colorKnown = false; Rgb color; std::vector<Box> cells;
  std::vector<CharMetric> metric; // by dot index (= index into ①'s blank-stripped text)
  // Characters ① reported as drawn as dots in this line (k d/c), sorted. When there are any, dot k in reading order is
  // character rec[k]: a stream may carry more than the game shows (Siglus: variable names before the line), and a glyph
  // cache keeps some characters real, so "dot i = character i" only holds when nothing was reported.
  std::vector<int> rec;
  // ③ (engines without glyph dots): the game reports where each character is and draws nothing there itself. No dot
  // search, no erasing: MeguLit's glyphs go straight onto these client rects (one per character of text, blanks too).
  bool rectMode = false; bool rectHidden = false; std::vector<Box> rects;
  bool centered = false;      // ④'s text marks: the mark is the centre of the character's cell (not a top-left dot)
  bool bestFit = false;       // more marks than characters: all erased, the text drawn on the first ones
  bool undot = false;        // fallback chosen: the game draws this line itself, MeguLit neither erases nor draws it
  LineStatus last = LineStatus::Waiting; double lastChange = 0, started = 0; int lastFound = -1; bool complete = false, everDots = false;
  std::vector<Box> demoCells; // --demo: the compositor paints these dots itself (stand-in for part ①)
};
struct Style {
  int mode = 0;               // 0 bilingual (Japanese + translation beside), 1 Japanese only, 2 translation only
  std::wstring jpFont = L"Yu Mincho", tlFont = L"Microsoft YaHei", rubyFont = L"Meiryo";
  bool ruby = true, shadow = true, lookup = true, plate = true;
  int tlPlace = 0;            // 0 above the text area, 1 below
  float tlScale = .8f, rubyScale = .5f;
  bool useGameColor = true; Rgb jpColor{ 255, 255, 255 }; Rgb tlColor{ 255, 236, 190 }; Rgb shadowColor{ 0, 0, 0 }; float shadowAlpha = .6f;
};

// ---------------------------------------------------------------- Lanczos scaler (Magpie Effects/Lanczos.hlsl, GPL-3.0)
static const char *ScaleHlsl = R"(
cbuffer C : register(b0) { float2 inSize; float2 inPt; float arStrength; float3 pad; };
Texture2D INPUT : register(t0); SamplerState sam : register(s0);
struct VO { float4 pos : SV_Position; float2 uv : TEXCOORD0; };
VO VS(uint id : SV_VertexID) { VO o; o.uv = float2((id << 1) & 2, id & 2); o.pos = float4(o.uv * float2(2, -2) + float2(-1, 1), 0, 1); return o; }
#define FIX(c) max(abs(c), 1e-5)
#define PI 3.14159265359
#define min4(a, b, c, d) min(min(a, b), min(c, d))
#define max4(a, b, c, d) max(max(a, b), max(c, d))
float3 weight3(float x) { const float rcpRadius = 1.0f / 3.0f; float3 s = FIX(2.0 * PI * float3(x - 1.5, x - 0.5, x + 0.5)); return sin(s) * sin(s * rcpRadius) * rcp(s * s); }
float4 PS(VO i) : SV_Target {
  float2 pos = i.uv * inSize; float2 inputPt = inPt; uint a, b;
  float2 f = frac(pos.xy + 0.5f);
  float3 linetaps1 = weight3(0.5f - f.x * 0.5f), linetaps2 = weight3(1.0f - f.x * 0.5f);
  float3 columntaps1 = weight3(0.5f - f.y * 0.5f), columntaps2 = weight3(1.0f - f.y * 0.5f);
  float suml = dot(linetaps1, float3(1, 1, 1)) + dot(linetaps2, float3(1, 1, 1));
  float sumc = dot(columntaps1, float3(1, 1, 1)) + dot(columntaps2, float3(1, 1, 1));
  linetaps1 /= suml; linetaps2 /= suml; columntaps1 /= sumc; columntaps2 /= sumc;
  pos -= f + 1.5f;
  float3 src[6][6];
  [unroll] for (a = 0; a <= 4; a += 2) { [unroll] for (b = 0; b <= 4; b += 2) {
    float2 tpos = (pos + uint2(a, b)) * inputPt;
    const float4 sr = INPUT.GatherRed(sam, tpos), sg = INPUT.GatherGreen(sam, tpos), sb = INPUT.GatherBlue(sam, tpos);
    src[a][b] = float3(sr.w, sg.w, sb.w); src[a][b + 1] = float3(sr.x, sg.x, sb.x); src[a + 1][b] = float3(sr.z, sg.z, sb.z); src[a + 1][b + 1] = float3(sr.y, sg.y, sb.y);
  } }
  float3 color = float3(0, 0, 0);
  [unroll] for (a = 0; a <= 4; a += 2) {
    color += (mul(linetaps1, float3x3(src[0][a], src[2][a], src[4][a])) + mul(linetaps2, float3x3(src[1][a], src[3][a], src[5][a]))) * columntaps1[a / 2]
           + (mul(linetaps1, float3x3(src[0][a + 1], src[2][a + 1], src[4][a + 1])) + mul(linetaps2, float3x3(src[1][a + 1], src[3][a + 1], src[5][a + 1]))) * columntaps2[a / 2];
  }
  float3 mn = min4(src[2][2], src[3][2], src[2][3], src[3][3]), mx = max4(src[2][2], src[3][2], src[2][3], src[3][3]);
  color = lerp(color, clamp(color, mn, mx), arStrength);
  return float4(color, 1);
}
)";

// ---------------------------------------------------------------- look-up click gate (own thread, WH_MOUSE_LL)
struct HitBox { RECT r; int line; int index; };
static std::mutex HitLock; static std::vector<HitBox> Hits; static std::atomic<bool> LookupOn{ true };
static HHOOK MouseHook; static bool Swallowing = false;
static LRESULT CALLBACK MouseLL(int code, WPARAM msg, LPARAM lp) {
  if (code == HC_ACTION && LookupOn) {
    const MSLLHOOKSTRUCT *m = reinterpret_cast<MSLLHOOKSTRUCT *>(lp);
    if (msg == WM_LBUTTONDOWN) {
      std::lock_guard<std::mutex> g(HitLock);
      for (const HitBox &h : Hits) if (PtInRect(&h.r, m->pt)) {
        Swallowing = true;
        Emit("{\"e\":\"lookup\",\"id\":" + std::to_string(h.line) + ",\"index\":" + std::to_string(h.index) + ",\"x\":" + std::to_string(m->pt.x) + ",\"y\":" + std::to_string(m->pt.y) + "}");
        return 1;
      }
    } else if (msg == WM_LBUTTONUP && Swallowing) { Swallowing = false; return 1; }
  }
  return CallNextHookEx(nullptr, code, msg, lp);
}
static void MouseThread() {
  MouseHook = SetWindowsHookExW(WH_MOUSE_LL, MouseLL, GetModuleHandleW(nullptr), 0);
  MSG m; while (GetMessageW(&m, nullptr, 0, 0) > 0) { TranslateMessage(&m); DispatchMessageW(&m); }
  if (MouseHook) UnhookWindowsHookEx(MouseHook);
}

// ---------------------------------------------------------------- compositor
// Heartbeat for the glyph-dot DLL (docs/text-architecture.md, "Heartbeat"): shared memory
// Local\MeguLitCompositorBeat-<game pid>, refreshed every tick (50 ms) while this window shows the game. The DLL keeps dot /
// marker glyphs only while the beat is fresh; a crashed, closed or hidden compositor stops it within a second.
struct CompositorBeat { uint32_t magic, version, compositorPid, presenting; uint64_t tickMs; uint64_t frames; };
constexpr uint32_t BeatMagic = 0x4243474D; // "MGCB"
struct Options {
  HWND game = nullptr; bool scale = false; bool headless = false; bool demo = false; bool trace = false; // --trace: diagnostic events
  int windowAlpha = 255;  // test aid: an invisible (alpha 1) but composited window for off-screen live tests
  bool autoLines = false; // test aid: without line messages, every run of dots between empty frames is a line
  std::wstring shotDir; int shotEvery = 0; int frames = 0; double statsEveryMs = 2000; int at[2] = { 0, 0 }; bool atSet = false;
};

class Compositor {
public:
  Options opt; Style style;
  HANDLE frameEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  bool quit = false;

  bool Init() {
    if (!IsWindow(opt.game)) return Fail("no-window");
    if (!CreateDevice()) return Fail("d3d");
    if (!CreateScaler()) return Fail("shader");
    if (!UpdateGeometry(true)) return Fail("geometry");
    if (!StartCapture()) return Fail("capture");
    if (!opt.headless && !CreateWindowAndSwapChain()) return Fail("window");
    if (!opt.headless) OpenBeat();
    Emit(std::string("{\"e\":\"ready\",\"version\":\"") + Marker + "\",\"game\":" + std::to_string((uintptr_t)opt.game) + ",\"window\":" + std::to_string((uintptr_t)hwnd) + ",\"mode\":\"" + (opt.scale ? "scale" : "overlay") + "\",\"src\":[" + std::to_string(srcW) + "," + std::to_string(srcH) + "]}");
    return true;
  }

  // Commands from MeguLit (stdin thread → queue → here, on the render thread).
  void Command(const Json &j) {
    const std::string t = j["t"].str();
    if (t == "line") {
      // The same line pushed again by the stream (repeated, or the text twice over) while it is still being shown: one line.
      {
        const std::u32string nt = U32(Wide(j["text"].str()));
        if (cur.id && !j["page"].truthy() && !nt.empty() && (nt == cur.text || nt == cur.text + cur.text)) { alias[int(j["id"].num(-1))] = cur.id; return; }
      }
      if (j["page"].truthy()) { tracker.EndPage(); kept.clear(); }
      if (cur.id && !cur.undot) kept[cur.id] = cur;
      cur = LineMsg{}; cur.id = int(j["id"].num(++autoId)); cur.started = NowMs();
      cur.text = U32(Wide(j["text"].str())); cur.tl = Wide(j["tl"].str()); cur.dotChar = DotCharIndex(cur.text);
      for (size_t i = 0; i < j["ruby"].size(); ++i) { const Json &r = j["ruby"][i]; cur.ruby.push_back({ int(r[0].num()), int(r[1].num()), Wide(r[2].str()) }); }
      cur.vertical = j.has("vertical") ? (j["vertical"].truthy() ? 1 : 0) : -1;
      cur.em = float(j["em"].num(0));
      cur.centered = j["marks"].str() == "middle-dot"; if (cur.centered) dotsSeen = true; // ④'s text marks: one centred mark per character, count known
      cur.colorKnown = ParseColor(j["color"].str(), cur.color);
      for (size_t i = 0; i < j["cells"].size(); ++i) { const Json &c = j["cells"][i]; cur.cells.push_back({ int(c[0].num()), int(c[1].num()), int(c[0].num() + c[2].num()), int(c[1].num() + c[3].num()) }); }
      if (opt.demo) cur.demoCells = cur.cells;
      cur.metric.assign(cur.dotChar.size(), {});
      MergeMetrics(cur, j["glyphs"]);
      // ① may report a line's dots before the line itself (engines that draw before their text hook fires)
      for (auto p = earlyGlyphs.find(cur.id); p != earlyGlyphs.end(); p = earlyGlyphs.end()) { for (const Json &g : p->second) MergeMetrics(cur, g); earlyGlyphs.erase(p); }
      if (!cur.rec.empty()) dotsSeen = true;
      cur.lastChange = NowMs();
      LineSpec s; s.id = cur.id; s.expected = !cur.rec.empty() ? -1 : j.has("expected") ? int(j["expected"].num()) : int(cur.dotChar.size()); s.vertical = cur.vertical; s.em = cur.em; s.colorKnown = cur.colorKnown; s.color = cur.color; if (!opt.demo) s.cells = cur.cells;
      s.hint = cur.centered ? std::max(0, s.expected) : int(cur.rec.size()); tracker.BeginLine(s); choicesOn = false; layouts.clear(); recheck = 8;
      if (opt.trace) Emit("{\"e\":\"trace\",\"what\":\"line\",\"id\":" + std::to_string(cur.id) + ",\"hint\":" + std::to_string(s.hint) + ",\"expected\":" + std::to_string(s.expected) + ",\"dotsSeen\":" + (dotsSeen ? "true" : "false") + "}");
    } else if (t == "annotate") { // translation / furigana that arrive after the line: {"t":"annotate","id":7,"tl":"…","ruby":[[s,e,"よみ"],...]}
      const int id = int(j["id"].num());
      LineMsg *l = cur.id == id ? &cur : kept.count(id) ? &kept[id] : nullptr;
      if (l) {
        if (j.has("tl")) l->tl = Wide(j["tl"].str());
        if (j.has("ruby")) { l->ruby.clear(); for (size_t i = 0; i < j["ruby"].size(); ++i) { const Json &r = j["ruby"][i]; l->ruby.push_back({ int(r[0].num()), int(r[1].num()), Wide(r[2].str()) }); } }
      }
    } else if (t == "rects") { // {"t":"rects","id":3,"text":"…","rects":[[x,y,w,h],...],"hidden":true} client px
      const int id = int(j["id"].num());
      if (cur.id != id || !cur.rectMode) {
        if (cur.id && !cur.undot) kept[cur.id] = cur;
        cur = LineMsg{}; cur.id = id; cur.rectMode = true; cur.lastChange = NowMs(); LineSpec sp; tracker.BeginLine(sp); choicesOn = false; layouts.clear();
      }
      cur.text = U32(Wide(j["text"].str())); cur.rects.clear(); cur.dotChar.clear(); cur.metric.clear();
      for (size_t i = 0; i < j["rects"].size() && i < cur.text.size(); ++i) {
        const Json &r = j["rects"][i]; const Box b{ int(r[0].num()), int(r[1].num()), int(r[0].num() + r[2].num()), int(r[1].num() + r[3].num()) };
        cur.rects.push_back(b);
        if (IsDotless(cur.text[i]) || b.w() <= 0 || b.h() <= 0) continue;
        cur.dotChar.push_back(int(i));
        cur.metric.push_back({ true, float(b.h()), .88f * b.h(), float(b.w()), 0, 0 });
      }
      cur.rectHidden = j["hidden"].truthy();
      if (j.has("tl")) cur.tl = Wide(j["tl"].str());
      recheck = 8;
    } else if (t == "glyphs") { recheck = 8; if (alias.count(int(j["id"].num()))) { Json k = j, n; n.kind = Json::Num; n.n = alias[int(j["id"].num())]; k.o["id"] = n; Command(k); return; } // later ① dot records of a line: {"t":"glyphs","id":7,"glyphs":[{"i":0,"h":28,"b":24,"a":28,"x":1,"y":2},...]}
      const int id = int(j["id"].num());
      if (j["glyphs"].size()) dotsSeen = true;
      if (opt.trace) Emit("{\"e\":\"trace\",\"what\":\"glyphs\",\"id\":" + std::to_string(id) + ",\"cur\":" + std::to_string(cur.id) + ",\"n\":" + std::to_string(j["glyphs"].size()) + ",\"rec\":" + std::to_string(cur.rec.size()) + ",\"chars\":" + std::to_string(cur.metric.size()) + "}");
      if (cur.id == id) { MergeMetrics(cur, j["glyphs"]); if (!cur.rec.empty()) { tracker.SetExpected(-1); tracker.SetHint(int(cur.rec.size())); } } // counts judged here (Targets)
      else if (kept.count(id)) MergeMetrics(kept[id], j["glyphs"]);
      else if (id > cur.id) { earlyGlyphs[id].push_back(j["glyphs"]); while (earlyGlyphs.size() > 16) earlyGlyphs.erase(earlyGlyphs.begin()); }
    } else if (t == "choices") {
      std::vector<ChoiceText> next; std::vector<int> counts;
      for (size_t i = 0; i < j["items"].size(); ++i) { ChoiceText c; c.text = U32(Wide(j["items"][i]["text"].str())); c.tl = Wide(j["items"][i]["tl"].str()); next.push_back(c); counts.push_back(int(DotCharIndex(c.text).size())); }
      // Same menu again with translations filled in: keep what was learned, only take the translations.
      bool same = choicesOn && next.size() == choices.size(); for (size_t i = 0; same && i < next.size(); ++i) same = next[i].text == choices[i].text;
      if (same) { for (size_t i = 0; i < next.size(); ++i) if (!next[i].tl.empty()) choices[i].tl = next[i].tl; return; }
      choices = next;
      std::vector<Rgb> known; if (tracker.HasColor()) known.push_back(tracker.Color()); Rgb c; if (ParseColor(j["color"].str(), c)) known.push_back(c);
      choiceTracker.Begin(counts, known); choicesOn = !choices.empty(); choiceUndot = false; choiceStart = NowMs();
    } else if (t == "choicesEnd") { choicesOn = false; }
    else if (t == "clear") { tracker.EndPage(); kept.clear(); cur = LineMsg{}; LineSpec s; tracker.BeginLine(s); choicesOn = false; }
    else if (t == "undot") { const int id = int(j["id"].num()); if (cur.id == id) { cur.undot = true; tracker.DropCurrent(); } kept.erase(id); }
    else if (t == "style") ApplyStyle(j);
    else if (t == "lookup") LookupOn = j["on"].truthy(true);
    else if (t == "shot") shotPath = Wide(j["path"].str());
    else if (t == "quit") quit = true;
  }

  // One captured frame: track → inpaint → compose → present.
  void Frame() {
    wgc::Direct3D11CaptureFrame frame = pool.TryGetNextFrame();
    if (!frame) return;
    while (auto next = pool.TryGetNextFrame()) { frame.Close(); frame = next; ++dropped; }
    const double t0 = NowMs();
    const double arrive = double(frame.SystemRelativeTime().count()) / 10000.0; // QPC-based, 100 ns units
    const auto cs = frame.ContentSize();
    if (cs.Width != poolSize.Width || cs.Height != poolSize.Height) { poolSize = cs; pool.Recreate(wdev, wdx::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, cs); frame.Close(); return; }
    if (!UpdateGeometry(false)) { frame.Close(); return; }
    com_ptr<ID3D11Texture2D> tex;
    { auto access = frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>(); if (FAILED(access->GetInterface(IID_PPV_ARGS(tex.put())))) { frame.Close(); return; } }
    D3D11_BOX box = frameBox; box.right = std::min<UINT>(box.right, UINT(cs.Width)); box.bottom = std::min<UINT>(box.bottom, UINT(cs.Height));
    if (box.right <= box.left || box.bottom <= box.top) { frame.Close(); return; }
    ctx->CopySubresourceRegion(srcTex.get(), 0, 0, 0, 0, tex.get(), 0, &box);
    ctx->CopySubresourceRegion(staging.get(), 0, 0, 0, 0, tex.get(), 0, &box);
    frame.Close();

    lastFrameAt = NowMs(); haveFrame = true;
    D3D11_MAPPED_SUBRESOURCE map{};
    if (SUCCEEDED(ctx->Map(staging.get(), 0, D3D11_MAP_READ_WRITE, 0, &map))) {
      Image im{ static_cast<uint8_t *>(map.pData), srcW, srcH, int(map.RowPitch) };
      if (opt.demo) PaintDemoDots(im);
      const double tt = NowMs();
      Track(im);
      trackMs += NowMs() - tt;
      Erase(im, map);
      ctx->Unmap(staging.get(), 0);
    }
    Compose();
    Present();
    const double done = NowMs();
    lat.push_back(done - arrive); proc.push_back(done - t0);
    ++frames; ++framesWindow;
    if (!opt.shotDir.empty() && opt.shotEvery > 0 && frames % opt.shotEvery == 0) SavePng(opt.shotDir + L"\\frame-" + std::to_wstring(frames) + L".png");
    if (!shotPath.empty()) { SavePng(shotPath); Emit("{\"e\":\"shot\",\"path\":\"" + JsonEscape(Utf8(shotPath)) + "\"}"); shotPath.clear(); }
    if (opt.frames && frames >= opt.frames) quit = true;
  }

  // A still game window delivers no new frames: line data (a line, ① dot records) that arrived after the last frame is
  // tracked against that frame again (what is already erased stays erased).
  void Recheck() {
    D3D11_MAPPED_SUBRESOURCE map{};
    if (FAILED(ctx->Map(staging.get(), 0, D3D11_MAP_READ_WRITE, 0, &map))) return;
    Image im{ static_cast<uint8_t *>(map.pData), srcW, srcH, int(map.RowPitch) };
    Track(im); Erase(im, map);
    ctx->Unmap(staging.get(), 0);
    Compose(); Present();
  }

  void OpenBeat() {
    DWORD pid = 0; GetWindowThreadProcessId(opt.game, &pid); if (!pid) return;
    const std::wstring name = L"Local\\MeguLitCompositorBeat-" + std::to_wstring(pid);
    beatMap = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, sizeof(CompositorBeat), name.c_str());
    if (!beatMap) return;
    beat = static_cast<CompositorBeat *>(MapViewOfFile(beatMap, FILE_MAP_WRITE, 0, 0, sizeof(CompositorBeat)));
    if (beat) { beat->magic = BeatMagic; beat->version = 1; beat->compositorPid = GetCurrentProcessId(); beat->presenting = 0; beat->tickMs = 0; beat->frames = 0; }
  }
  // Fresh only while our window is up and shows the game (a hidden window or a minimised game does not cover the dots).
  void Beat() {
    if (!beat) return;
    const bool showing = hwnd && IsWindowVisible(hwnd) && !IsIconic(opt.game) && haveFrame;
    beat->presenting = showing ? 1 : 0; beat->frames = uint64_t(frames);
    if (showing) beat->tickMs = GetTickCount64();
  }
  void StopBeat() { if (!beat) return; beat->presenting = 0; beat->tickMs = 0; UnmapViewOfFile(beat); beat = nullptr; if (beatMap) CloseHandle(beatMap); beatMap = nullptr; }

  void Tick() {
    Beat();
    if (!IsWindow(opt.game)) { Emit("{\"e\":\"exit\",\"reason\":\"game-closed\"}"); quit = true; return; }
    FollowGame();
    const double now = NowMs();
    if (recheck && haveFrame && now - lastFrameAt > 250 && now - recheckAt > 250) { recheckAt = now; if (--recheck >= 0) Recheck(); }
    if (now - statsAt >= opt.statsEveryMs) { Stats(now); statsAt = now; }
  }

  void Stats(double now) {
    auto pct = [](std::vector<double> v, double q) { if (v.empty()) return 0.0; std::sort(v.begin(), v.end()); return v[std::min(v.size() - 1, size_t(q * v.size()))]; };
    double mean = 0; for (double x : lat) mean += x; if (!lat.empty()) mean /= lat.size();
    double pm = 0; for (double x : proc) pm += x; if (!proc.empty()) pm /= proc.size();
    const double fps = framesWindow * 1000.0 / std::max(1.0, now - statsAt);
    char b[512];
    std::snprintf(b, sizeof b, "{\"e\":\"stats\",\"fps\":%.1f,\"frames\":%d,\"dropped\":%d,\"latencyMs\":%.2f,\"latencyP95Ms\":%.2f,\"processMs\":%.2f,\"processP95Ms\":%.2f,\"trackMs\":%.2f,\"src\":[%d,%d],\"dst\":[%d,%d],\"dots\":%d,\"status\":\"%s\",\"color\":\"#%02x%02x%02x\"}",
      fps, frames, dropped, mean, pct(lat, .95), pm, pct(proc, .95), framesWindow ? trackMs / framesWindow : 0, srcW, srcH, outW, outH, int(lastResult.dots.size()), StatusName(lastResult.status), tracker.Color().r, tracker.Color().g, tracker.Color().b);
    Emit(b);
    lat.clear(); proc.clear(); framesWindow = 0; trackMs = 0;
  }

private:
  // device + capture
  com_ptr<ID3D11Device> dev; com_ptr<ID3D11DeviceContext> ctx; com_ptr<IDXGIFactory2> factory;
  wd3d::IDirect3DDevice wdev{ nullptr }; wgc::GraphicsCaptureItem item{ nullptr }; wgc::Direct3D11CaptureFramePool pool{ nullptr }; wgc::GraphicsCaptureSession session{ nullptr };
  winrt::Windows::Graphics::SizeInt32 poolSize{ 0, 0 };
  D3D11_BOX frameBox{}; RECT client{}; int srcW = 0, srcH = 0;
  com_ptr<ID3D11Texture2D> srcTex, staging, outTex, shotTex; com_ptr<ID3D11ShaderResourceView> srcSrv; com_ptr<ID3D11RenderTargetView> outRtv;
  com_ptr<ID3D11VertexShader> vs; com_ptr<ID3D11PixelShader> ps; com_ptr<ID3D11SamplerState> sampler; com_ptr<ID3D11Buffer> cbuf;
  // output
  HWND hwnd = nullptr; com_ptr<IDXGISwapChain1> swap; bool tearing = false; int outW = 0, outH = 0; RECT dest{}; RECT outScreen{};
  com_ptr<ID2D1Factory3> d2f; com_ptr<ID2D1Device2> d2dev; com_ptr<ID2D1DeviceContext2> d2; com_ptr<ID2D1Bitmap1> d2target; com_ptr<ID2D1SolidColorBrush> brush;
  com_ptr<IDWriteFactory3> dw; std::map<std::wstring, com_ptr<IDWriteTextFormat>> formats;
  struct Glyph { com_ptr<IDWriteTextLayout> layout; float w = 0, h = 0, baseline = 0; };
  std::map<uint64_t, Glyph> layouts;
  // tracking
  double lastFrameAt = 0, recheckAt = 0; bool haveFrame = false; int recheck = 0; // Recheck(): passes left over the last frame
  std::map<int, std::vector<Json>> earlyGlyphs; std::map<int, int> alias; /* repeated line id → the line it repeats */ std::vector<Dot> menuMarks; CompositorBeat *beat = nullptr; HANDLE beatMap = nullptr; int flood = 0; double starveSince = 0; DotTracker tracker; ChoiceTracker choiceTracker; TrackResult lastResult; ChoiceTracker::Out lastChoices;
  bool dotsSeen = false; // ① reported at least one dot in this game session
  LineMsg cur; std::map<int, LineMsg> kept; int autoId = 0, autoMax = 0, autoEmpty = 0;
  std::vector<ChoiceText> choices; bool choicesOn = false, choiceUndot = false; double choiceStart = 0;
  // cursor (scale mode)
  bool cursorCaptured = false, systemCursorHidden = false; std::map<HCURSOR, com_ptr<ID2D1Bitmap>> cursors; std::map<HCURSOR, POINT> hotspots;
  // stats
  std::vector<double> lat, proc; int frames = 0, framesWindow = 0, dropped = 0; double statsAt = NowMs(), trackMs = 0;
  std::wstring shotPath;

  bool Fail(const char *why) { Emit(std::string("{\"e\":\"fallback\",\"reason\":\"") + why + "\"}"); return false; }

  bool CreateDevice() {
    const D3D_FEATURE_LEVEL levels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1 };
    if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, 3, D3D11_SDK_VERSION, dev.put(), nullptr, ctx.put()))) return false;
    com_ptr<IDXGIDevice> dxgi = dev.as<IDXGIDevice>(); com_ptr<IDXGIAdapter> ad; dxgi->GetAdapter(ad.put()); ad->GetParent(IID_PPV_ARGS(factory.put()));
    if (auto f5 = factory.try_as<IDXGIFactory5>()) { BOOL t = FALSE; if (SUCCEEDED(f5->CheckFeatureSupport(DXGI_FEATURE_PRESENT_ALLOW_TEARING, &t, sizeof t))) tearing = t; }
    com_ptr<::IInspectable> insp;
    if (FAILED(CreateDirect3D11DeviceFromDXGIDevice(dxgi.get(), insp.put()))) return false;
    wdev = insp.as<wd3d::IDirect3DDevice>();
    D2D1_FACTORY_OPTIONS fo{};
    if (FAILED(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, __uuidof(ID2D1Factory3), &fo, d2f.put_void()))) return false;
    if (FAILED(d2f->CreateDevice(dxgi.get(), d2dev.put())) || FAILED(d2dev->CreateDeviceContext(D2D1_DEVICE_CONTEXT_OPTIONS_NONE, d2.put()))) return false;
    d2->SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
    d2->CreateSolidColorBrush(D2D1::ColorF(1, 1, 1, 1), brush.put());
    return SUCCEEDED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory3), reinterpret_cast<IUnknown **>(dw.put())));
  }

  bool CreateScaler() {
    com_ptr<ID3DBlob> vb, pb, err;
    if (FAILED(D3DCompile(ScaleHlsl, strlen(ScaleHlsl), "scale", nullptr, nullptr, "VS", "vs_5_0", D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, vb.put(), err.put()))) return false;
    if (FAILED(D3DCompile(ScaleHlsl, strlen(ScaleHlsl), "scale", nullptr, nullptr, "PS", "ps_5_0", D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, pb.put(), err.put()))) { if (err) Emit("{\"e\":\"log\",\"msg\":\"" + JsonEscape(static_cast<const char *>(err->GetBufferPointer())) + "\"}"); return false; }
    dev->CreateVertexShader(vb->GetBufferPointer(), vb->GetBufferSize(), nullptr, vs.put());
    dev->CreatePixelShader(pb->GetBufferPointer(), pb->GetBufferSize(), nullptr, ps.put());
    D3D11_SAMPLER_DESC sd{}; sd.Filter = D3D11_FILTER_MIN_MAG_MIP_POINT; sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP; sd.MaxLOD = D3D11_FLOAT32_MAX;
    dev->CreateSamplerState(&sd, sampler.put());
    D3D11_BUFFER_DESC bd{}; bd.ByteWidth = 32; bd.Usage = D3D11_USAGE_DYNAMIC; bd.BindFlags = D3D11_BIND_CONSTANT_BUFFER; bd.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    return SUCCEEDED(dev->CreateBuffer(&bd, nullptr, cbuf.put()));
  }

  // Magpie CalcWindowCapturedFrameBounds: on Win10 and Win11 24H2+ the captured frame is the extended frame bounds; the
  // client area inside it is the part we use.
  bool UpdateGeometry(bool first) {
    RECT cr; if (!GetClientRect(opt.game, &cr)) return false;
    POINT o{ 0, 0 }; ClientToScreen(opt.game, &o);
    RECT c{ o.x, o.y, o.x + cr.right, o.y + cr.bottom };
    if (c.right - c.left < 16 || c.bottom - c.top < 16) return false;
    RECT fb{}; if (FAILED(DwmGetWindowAttribute(opt.game, DWMWA_EXTENDED_FRAME_BOUNDS, &fb, sizeof fb))) GetWindowRect(opt.game, &fb);
    if (c.left < fb.left || c.top < fb.top) { fb.left = std::min(fb.left, c.left); fb.top = std::min(fb.top, c.top); }
    frameBox = { UINT(c.left - fb.left), UINT(c.top - fb.top), 0, UINT(c.right - fb.left), UINT(c.bottom - fb.top), 1 };
    const int w = c.right - c.left, h = c.bottom - c.top;
    client = c;
    if (first || w != srcW || h != srcH) { srcW = w; srcH = h; if (!CreateTargets()) return false; }
    return true;
  }

  bool CreateTargets() {
    srcTex = nullptr; staging = nullptr; srcSrv = nullptr;
    D3D11_TEXTURE2D_DESC d{}; d.Width = srcW; d.Height = srcH; d.MipLevels = 1; d.ArraySize = 1; d.Format = DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count = 1;
    d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(dev->CreateTexture2D(&d, nullptr, srcTex.put()))) return false;
    dev->CreateShaderResourceView(srcTex.get(), nullptr, srcSrv.put());
    d.Usage = D3D11_USAGE_STAGING; d.BindFlags = 0; d.CPUAccessFlags = D3D11_CPU_ACCESS_READ | D3D11_CPU_ACCESS_WRITE;
    if (FAILED(dev->CreateTexture2D(&d, nullptr, staging.put()))) return false;
    return ResizeOutput();
  }

  // Output size: overlay = the game client 1:1; scale = the monitor (Magpie-style fit, aspect kept, centred).
  bool ResizeOutput() {
    RECT screen = client;
    if (opt.scale) {
      MONITORINFO mi{ sizeof mi }; GetMonitorInfoW(MonitorFromWindow(opt.game, MONITOR_DEFAULTTONEAREST), &mi); screen = mi.rcMonitor;
      if (opt.atSet) OffsetRect(&screen, opt.at[0] - screen.left, opt.at[1] - screen.top);
    }
    const int w = screen.right - screen.left, h = screen.bottom - screen.top;
    outScreen = screen;
    const double s = opt.scale ? std::min(double(w) / srcW, double(h) / srcH) : 1.0;
    const int dw = int(srcW * s + .5), dh = int(srcH * s + .5);
    dest = { (w - dw) / 2, (h - dh) / 2, (w - dw) / 2 + dw, (h - dh) / 2 + dh };
    if (w == outW && h == outH && outTex) return true;
    outW = w; outH = h;
    d2->SetTarget(nullptr); d2target = nullptr; outTex = nullptr; outRtv = nullptr; shotTex = nullptr;
    D3D11_TEXTURE2D_DESC d{}; d.Width = w; d.Height = h; d.MipLevels = 1; d.ArraySize = 1; d.Format = DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count = 1;
    d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(dev->CreateTexture2D(&d, nullptr, outTex.put()))) return false;
    dev->CreateRenderTargetView(outTex.get(), nullptr, outRtv.put());
    com_ptr<IDXGISurface> surf = outTex.as<IDXGISurface>();
    const D2D1_BITMAP_PROPERTIES1 bp = D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_TARGET | D2D1_BITMAP_OPTIONS_CANNOT_DRAW, D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
    if (FAILED(d2->CreateBitmapFromDxgiSurface(surf.get(), &bp, d2target.put()))) return false;
    if (swap) { swap->ResizeBuffers(0, w, h, DXGI_FORMAT_UNKNOWN, tearing ? DXGI_SWAP_CHAIN_FLAG_ALLOW_TEARING : 0); if (hwnd) SetWindowPos(hwnd, nullptr, screen.left, screen.top, w, h, SWP_NOZORDER | SWP_NOACTIVATE); }
    layouts.clear();
    return true;
  }

  bool StartCapture() {
    try {
      if (!wgc::GraphicsCaptureSession::IsSupported()) return false;
      auto interop = winrt::get_activation_factory<wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
      HRESULT hr = interop->CreateForWindow(opt.game, winrt::guid_of<wgc::GraphicsCaptureItem>(), winrt::put_abi(item));
      if (FAILED(hr)) { // Magpie: windows outside the Alt+Tab list (e.g. owned by a zero-size window) need WS_EX_APPWINDOW
        const LONG_PTR ex = GetWindowLongPtrW(opt.game, GWL_EXSTYLE);
        SetWindowLongPtrW(opt.game, GWL_EXSTYLE, ex | WS_EX_APPWINDOW); styleChanged = true;
        hr = interop->CreateForWindow(opt.game, winrt::guid_of<wgc::GraphicsCaptureItem>(), winrt::put_abi(item));
        if (FAILED(hr)) { SetWindowLongPtrW(opt.game, GWL_EXSTYLE, ex); styleChanged = false; return false; }
      }
      poolSize = item.Size();
      pool = wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(wdev, wdx::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, poolSize);
      pool.FrameArrived([ev = frameEvent](auto &&, auto &&) { SetEvent(ev); });
      session = pool.CreateCaptureSession(item);
      using winrt::Windows::Foundation::Metadata::ApiInformation;
      const auto cls = winrt::name_of<wgc::GraphicsCaptureSession>();
      if (ApiInformation::IsPropertyPresent(cls, L"IsCursorCaptureEnabled")) session.IsCursorCaptureEnabled(false);
      if (ApiInformation::IsPropertyPresent(cls, L"IsBorderRequired")) session.IsBorderRequired(false);
      if (ApiInformation::IsPropertyPresent(cls, L"MinUpdateInterval")) session.MinUpdateInterval(std::chrono::milliseconds(1));
      session.StartCapture();
    } catch (const winrt::hresult_error &e) {
      Emit("{\"e\":\"log\",\"msg\":\"capture: " + JsonEscape(Utf8(std::wstring(e.message()))) + "\"}");
      return false;
    }
    return true;
  }
  bool styleChanged = false;

public:
  ~Compositor() {
    if (session) session.Close(); if (pool) pool.Close();
    if (styleChanged) SetWindowLongPtrW(opt.game, GWL_EXSTYLE, GetWindowLongPtrW(opt.game, GWL_EXSTYLE) & ~WS_EX_APPWINDOW);
    ReleaseCursor();
    if (hwnd) DestroyWindow(hwnd);
  }

private:
  static LRESULT CALLBACK WndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
    if (m == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
    if (m == WM_NCHITTEST) return HTTRANSPARENT;
    return DefWindowProcW(h, m, w, l);
  }

  // Magpie ScalingWindow: WS_EX_NOREDIRECTIONBITMAP | WS_EX_LAYERED | WS_EX_TRANSPARENT (click-through) | WS_EX_NOACTIVATE.
  bool CreateWindowAndSwapChain() {
    WNDCLASSEXW wc{ sizeof wc }; wc.lpfnWndProc = WndProc; wc.hInstance = GetModuleHandleW(nullptr); wc.lpszClassName = L"MeguLitCompositor"; wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassExW(&wc);
    hwnd = CreateWindowExW(WS_EX_NOREDIRECTIONBITMAP | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, wc.lpszClassName, L"MeguLit", WS_POPUP,
      outScreen.left, outScreen.top, outW, outH, nullptr, nullptr, wc.hInstance, nullptr);
    if (!hwnd) return false;
    SetLayeredWindowAttributes(hwnd, 0, BYTE(opt.windowAlpha), LWA_ALPHA);
    DXGI_SWAP_CHAIN_DESC1 sd{}; sd.Width = outW; sd.Height = outH; sd.Format = DXGI_FORMAT_B8G8R8A8_UNORM; sd.SampleDesc.Count = 1; sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.BufferCount = 2; sd.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD; sd.AlphaMode = DXGI_ALPHA_MODE_IGNORE; sd.Flags = tearing ? DXGI_SWAP_CHAIN_FLAG_ALLOW_TEARING : 0;
    if (FAILED(factory->CreateSwapChainForHwnd(dev.get(), hwnd, &sd, nullptr, nullptr, swap.put()))) return false;
    factory->MakeWindowAssociation(hwnd, DXGI_MWA_NO_ALT_ENTER);
    if (auto s2 = swap.try_as<IDXGISwapChain2>()) s2->SetMaximumFrameLatency(1);
    ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    FollowGame();
    return true;
  }

  // Keep the window over the game client (overlay) or the game's monitor (scale), right above the game in z-order,
  // hidden while the game is minimised.
  void FollowGame() {
    if (!hwnd) return;
    if (IsIconic(opt.game)) { if (IsWindowVisible(hwnd)) ShowWindow(hwnd, SW_HIDE); ReleaseCursor(); return; }
    if (!IsWindowVisible(hwnd)) ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    RECT r; GetWindowRect(hwnd, &r);
    if (!opt.scale && (r.left != client.left || r.top != client.top || r.right - r.left != srcW || r.bottom - r.top != srcH)) SetWindowPos(hwnd, nullptr, client.left, client.top, srcW, srcH, SWP_NOZORDER | SWP_NOACTIVATE);
    const bool fg = GetForegroundWindow() == opt.game;
    if (opt.scale && fg) { if (!(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST)) SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }
    else {
      if (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST) SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      HWND above = GetWindow(opt.game, GW_HWNDPREV);
      if (above != hwnd) SetWindowPos(hwnd, above ? above : HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    if (opt.scale) UpdateCursor(fg);
  }

  // ---------------- cursor (scale mode; Magpie CursorManager, reduced): the real cursor stays on the game window at
  // the source position, clipped to the client while the game is in front; MeguLit hides the system cursor and draws it
  // at the scaled position.
  POINT SrcToScaling(POINT p) const {
    POINT r; const double sx = double(dest.right - dest.left - 1) / std::max(1, srcW - 1), sy = double(dest.bottom - dest.top - 1) / std::max(1, srcH - 1);
    r.x = outScreen.left + dest.left + LONG(std::lround((p.x - client.left) * sx)); r.y = outScreen.top + dest.top + LONG(std::lround((p.y - client.top) * sy)); return r;
  }
  POINT ScalingToSrc(POINT p) const {
    POINT r; const double sx = double(srcW - 1) / std::max<LONG>(1, dest.right - dest.left - 1), sy = double(srcH - 1) / std::max<LONG>(1, dest.bottom - dest.top - 1);
    r.x = client.left + LONG(std::lround(std::clamp<LONG>(p.x - outScreen.left - dest.left, 0, dest.right - dest.left - 1) * sx));
    r.y = client.top + LONG(std::lround(std::clamp<LONG>(p.y - outScreen.top - dest.top, 0, dest.bottom - dest.top - 1) * sy)); return r;
  }
  static void ReliableSetCursorPos(POINT p) { RECT old; GetClipCursor(&old); RECT c{ p.x, p.y, p.x + 1, p.y + 1 }; ClipCursor(&c); SetCursorPos(p.x, p.y); ClipCursor(&old); }
  static void ShowSystemCursor(bool show) {
    using MagInit = BOOL(WINAPI *)(); using MagShow = BOOL(WINAPI *)(BOOL);
    static HMODULE mag = LoadLibraryW(L"Magnification.dll"); static MagShow showFn = nullptr;
    static bool init = [] { if (!mag) return false; auto i = reinterpret_cast<MagInit>(GetProcAddress(mag, "MagInitialize")); showFn = reinterpret_cast<MagShow>(GetProcAddress(mag, "MagShowSystemCursor")); return i && i(); }();
    if (init && showFn) showFn(show);
  }
  void UpdateCursor(bool fg) {
    if (!fg) { ReleaseCursor(); return; }
    POINT p; GetCursorPos(&p);
    if (!cursorCaptured) {
      if (!PtInRect(&outScreen, p)) return;
      cursorCaptured = true; ClipCursor(&client); ReliableSetCursorPos(PtInRect(&client, p) ? p : ScalingToSrc(p));
      ShowSystemCursor(false); systemCursorHidden = true;
    }
  }
  void ReleaseCursor() {
    if (!cursorCaptured) return;
    cursorCaptured = false; POINT p; GetCursorPos(&p); ClipCursor(nullptr); ReliableSetCursorPos(SrcToScaling(p));
    if (systemCursorHidden) { ShowSystemCursor(true); systemCursorHidden = false; }
  }
  void DrawCursor() {
    if (!cursorCaptured) return;
    CURSORINFO ci{ sizeof ci }; if (!GetCursorInfo(&ci) || !(ci.flags & CURSOR_SHOWING) || !ci.hCursor) return;
    com_ptr<ID2D1Bitmap> &bmp = cursors[ci.hCursor];
    if (!bmp) {
      // Draw the cursor on black and on white: alpha = 255 − (white − black), colour = black result / alpha.
      const int n = GetSystemMetrics(SM_CXCURSOR);
      BITMAPINFO bi{}; bi.bmiHeader = { sizeof(BITMAPINFOHEADER), n, -n, 1, 32, BI_RGB };
      void *pb = nullptr, *pw = nullptr; HDC dc = CreateCompatibleDC(nullptr);
      HBITMAP b = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &pb, nullptr, 0), w = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &pw, nullptr, 0);
      HGDIOBJ old = SelectObject(dc, b); PatBlt(dc, 0, 0, n, n, BLACKNESS); DrawIconEx(dc, 0, 0, ci.hCursor, n, n, 0, nullptr, DI_NORMAL);
      SelectObject(dc, w); PatBlt(dc, 0, 0, n, n, WHITENESS); DrawIconEx(dc, 0, 0, ci.hCursor, n, n, 0, nullptr, DI_NORMAL); SelectObject(dc, old);
      std::vector<uint8_t> px(size_t(n) * n * 4); const uint8_t *B = static_cast<uint8_t *>(pb), *Wt = static_cast<uint8_t *>(pw);
      for (int i = 0; i < n * n; ++i) { const int a = 255 - (Wt[i * 4 + 1] - B[i * 4 + 1]); for (int c = 0; c < 3; ++c) px[i * 4 + c] = uint8_t(std::min(B[i * 4 + c], uint8_t(a))); px[i * 4 + 3] = uint8_t(std::clamp(a, 0, 255)); }
      d2->CreateBitmap(D2D1::SizeU(n, n), px.data(), n * 4, D2D1::BitmapProperties(D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED)), bmp.put());
      ICONINFO ii{}; if (GetIconInfo(ci.hCursor, &ii)) { hotspots[ci.hCursor] = { LONG(ii.xHotspot), LONG(ii.yHotspot) }; if (ii.hbmColor) DeleteObject(ii.hbmColor); if (ii.hbmMask) DeleteObject(ii.hbmMask); }
      DeleteObject(b); DeleteObject(w); DeleteDC(dc);
    }
    if (!bmp) return;
    const POINT s = SrcToScaling(ci.ptScreenPos); const POINT hs = hotspots[ci.hCursor]; const D2D1_SIZE_F z = bmp->GetSize();
    const float x = float(s.x - outScreen.left - hs.x), y = float(s.y - outScreen.top - hs.y);
    d2->DrawBitmap(bmp.get(), D2D1::RectF(x, y, x + z.width, y + z.height));
  }

  // ---------------- tracking
  void PaintDemoDots(Image &im) {
    // Stand-in for part ① (test aid, --demo): reveal one cell every 33 ms as a spec-1 dot — solid square of 3 px (2 under
    // 12 px cells) in the line colour at the glyph black box's top-left (cell + 1/10 advance, + 1/8 height).
    if (cur.demoCells.empty() || cur.undot) return;
    const int n = std::min<int>(int(cur.demoCells.size()), int((NowMs() - cur.lastChange) / 33.0) + 1);
    const Rgb c = cur.colorKnown ? cur.color : Rgb{ 255, 255, 255 };
    for (int i = 0; i < n; ++i) {
      const Box &b = cur.demoCells[i]; const int h = b.y1 - b.y0, a = b.x1 - b.x0, s = h >= 12 ? 3 : 2;
      const int x0 = b.x0 + std::max(1, a / 10), y0 = b.y0 + std::max(1, h / 8);
      for (int y = y0; y < y0 + s; ++y) for (int x = x0; x < x0 + s; ++x) if (x >= 0 && y >= 0 && x < im.w && y < im.h) { uint8_t *p = im.at(x, y); p[0] = uint8_t(c.b); p[1] = uint8_t(c.g); p[2] = uint8_t(c.r); }
      if (i < int(cur.metric.size()) && !cur.metric[i].known) cur.metric[i] = { true, float(h), .88f * h, float(a), float(x0 - b.x0), float(y0 - b.y0) };
    }
  }

  // Page view (NVL): dots of earlier lines on this page that were never followed (the colour was learned later, or the
  // line was replaced before its dots showed) go to those lines, newest line first, each taking as many dots as ① drew
  // for it (or its characters), from the end of the page's reading order. They are then followed and drawn like kept lines.
  void AssignOrphans(std::vector<Dot> left) {
    int taken = 0;
    for (auto it = kept.rbegin(); it != kept.rend() && !left.empty() && taken < 8; ++it) {
      LineMsg &l = it->second;
      if (l.id >= cur.id || l.undot || tracker.IsKept(l.id)) continue;
      const int want = !l.rec.empty() ? int(l.rec.size()) : int(l.dotChar.size());
      if (want <= 0) continue;
      const int n = std::min<int>(want, int(left.size()));
      std::vector<Dot> d(left.end() - n, left.end()); left.erase(left.end() - n, left.end());
      l.complete = true; tracker.AddKept(l.id, d); ++taken;
      if (opt.trace) Emit("{\"e\":\"trace\",\"what\":\"orphans\",\"line\":" + std::to_string(l.id) + ",\"dots\":" + std::to_string(n) + ",\"want\":" + std::to_string(want) + "}");
    }
    if (taken) recheck = std::max(recheck, 2);
  }

  void Track(const Image &im) {
    if (choicesOn) {
      lastChoices = choiceTracker.Update(im);
      // Choices whose dots never all line up within 1.5 s fall back to the game's own drawing.
      if (!lastChoices.ok && !choiceUndot && NowMs() - choiceStart > 1500) { choiceUndot = true; Emit("{\"e\":\"undot\",\"choices\":true,\"reason\":\"choices-unmatched\"}"); }
      // Owner rule: never show marks. An unmatched menu still has its marks erased and its items drawn as a list there.
      menuMarks = (!lastChoices.ok && choiceUndot) ? choiceTracker.MenuMarks(im) : std::vector<Dot>{};
      if (lastChoices.ok) choiceStart = NowMs();
    }
    if (!cur.id && opt.autoLines) { cur = LineMsg{}; cur.id = ++autoId; cur.lastChange = NowMs(); LineSpec s; s.id = cur.id; tracker.BeginLine(s); autoMax = 0; autoEmpty = 0; }
    if (!cur.id) { lastResult = TrackResult{}; return; }
    if (cur.rectMode) {
      // The reported rects are the cells: one synthetic dot per character at the cell's top-left (metrics x = y = 0).
      lastResult = TrackResult{}; lastResult.status = LineStatus::Complete;
      if (cur.rectHidden) for (int i : cur.dotChar) { Dot d; d.box = { cur.rects[i].x0, cur.rects[i].y0, cur.rects[i].x0 + 1, cur.rects[i].y0 + 1 }; d.cx = float(cur.rects[i].x0 + cur.rects[i].x1) / 2; d.cy = float(cur.rects[i].y0 + cur.rects[i].y1) / 2; d.color = { 255, 255, 255 }; lastResult.dots.push_back(d); }
      if (!lastResult.dots.empty()) { lastResult.area = cur.rects[cur.dotChar.front()]; for (int i : cur.dotChar) { const Box &b = cur.rects[i]; lastResult.area.x0 = std::min(lastResult.area.x0, b.x0); lastResult.area.y0 = std::min(lastResult.area.y0, b.y0); lastResult.area.x1 = std::max(lastResult.area.x1, b.x1); lastResult.area.y1 = std::max(lastResult.area.y1, b.y1); } lastResult.pitch = float(cur.rects[cur.dotChar.front()].w()); }
      cur.complete = cur.rectHidden;
      const int f = int(lastResult.dots.size());
      if (f != cur.lastFound) { cur.lastFound = f; Emit("{\"e\":\"line\",\"id\":" + std::to_string(cur.id) + ",\"status\":\"" + (cur.rectHidden ? "complete" : "waiting") + "\",\"found\":" + std::to_string(f) + ",\"expected\":" + std::to_string(cur.dotChar.size()) + ",\"rects\":true}"); }
      return;
    }
    // No dot search before ① has reported a real dot in this game: an engine ① cannot dot (own rasteriser, Unity, web)
    // would only offer false dots (petals, sparkles) to erase and draw over.
    if (!dotsSeen && !opt.demo && !opt.autoLines) { lastResult = TrackResult{}; return; }
    const bool knew = tracker.HasColor();
    lastResult = tracker.Update(im);
    if (opt.trace && tracker.HasColor() != knew) { const Rgb c = tracker.Color(); Emit("{\"e\":\"trace\",\"what\":\"color\",\"known\":" + std::string(tracker.HasColor() ? "true" : "false") + ",\"rgb\":[" + std::to_string(c.r) + "," + std::to_string(c.g) + "," + std::to_string(c.b) + "]}"); }
    if (opt.autoLines && cur.text.empty()) {
      const int f = int(lastResult.dots.size()); autoMax = std::max(autoMax, f);
      autoEmpty = f ? 0 : autoEmpty + 1;
      if (autoMax > 0 && autoEmpty >= 3) { Emit("{\"e\":\"autoLine\",\"id\":" + std::to_string(cur.id) + ",\"dots\":" + std::to_string(autoMax) + "}"); cur = LineMsg{}; }
      return;
    }
    if (!lastResult.orphans.empty()) AssignOrphans(lastResult.orphans);
    const TrackResult &r = lastResult;
    const int found = int(r.dots.size());
    if (found > 0) cur.everDots = true;
    // Far more dots than ① reported for the line, frame after frame: the learned colour is not the text's (artwork in
    // the same colour) — forget it and learn again from the next change.
    if (!cur.complete && !cur.rec.empty() && found > 3 * int(cur.rec.size()) + 5) { if (++flood > 15) { tracker.ForgetColor(); flood = 0; } } else flood = 0;
    // Or far fewer for a while although ① drew them all (the colour of a blinking cursor or UI mark): learn again.
    if (!cur.complete && cur.rec.size() >= 4 && tracker.HasColor() && found * 10 < int(cur.rec.size()) * 3) { if (!starveSince) starveSince = NowMs(); else if (NowMs() - starveSince > 1200) { tracker.ForgetColor(); starveSince = 0; recheck = std::max(recheck, 4); } } else starveSince = 0; // timed: a still screen sends few frames
    LineStatus st = r.status;
    if (!cur.rec.empty() && found > 0 && st != LineStatus::Fading) {
      // With ① reports the tracker does not know the count: complete once the reported span is covered, mismatch when
      // the dots cannot all be placed on characters of the line.
      st = found > int(Targets(cur, found).size()) ? LineStatus::Mismatch : found >= Expected(cur) ? LineStatus::Complete : LineStatus::Revealing;
      lastResult.status = st;
    }
    if (st != cur.last || found != cur.lastFound) {
      cur.last = st; cur.lastFound = found; cur.lastChange = NowMs();
      Emit("{\"e\":\"line\",\"id\":" + std::to_string(cur.id) + ",\"status\":\"" + StatusName(st) + "\",\"found\":" + std::to_string(found) + ",\"expected\":" + std::to_string(Expected(cur)) + "}");
    }
    if (st == LineStatus::Complete) cur.complete = true;
    // A reveal stuck short of the full line (the engine's glyph cache keeps some characters real): the dots that are
    // there stay MeguLit's, the real glyphs stay the game's (same cells), and the line counts as shown (translation).
    if (!cur.undot && !cur.complete && found > 0 && st == LineStatus::Revealing && NowMs() - cur.lastChange > 1500 && !opt.demo) {
      cur.complete = true;
      Emit("{\"e\":\"line\",\"id\":" + std::to_string(cur.id) + ",\"status\":\"complete\",\"partial\":true,\"found\":" + std::to_string(found) + ",\"expected\":" + std::to_string(Expected(cur)) + "}");
    }
    // Fallback (never double or misplace text): more dots than characters → hand the line back to the game and stop
    // erasing/drawing it.
    // An NVL page drawn ahead of its lines: the line is its last dots, the rest belong to earlier lines of the page.
    if (!cur.undot && st == LineStatus::Mismatch && !cur.rec.empty()) {
      const std::vector<Dot> rest = tracker.TrimCurrent(int(cur.rec.size()));
      if (!rest.empty()) {
        lastResult.dots.erase(lastResult.dots.begin(), lastResult.dots.end() - int(cur.rec.size()));
        AssignOrphans(rest); st = LineStatus::Complete; cur.complete = true; lastResult.status = st;
      }
    }
    // Owner rule: the player never sees marks. More marks than characters and nothing to give them to: every mark found
    // is still erased, and the line's stream text is drawn on the marks in reading order (the found cells and the
    // measured pitch are the best fit there is); the surplus marks are erased without a character. Never handed back.
    if (!cur.undot && st == LineStatus::Mismatch) {
      st = LineStatus::Complete; lastResult.status = st; cur.complete = true;
      if (!cur.bestFit) { cur.bestFit = true; Emit("{\"e\":\"line\",\"id\":" + std::to_string(cur.id) + ",\"status\":\"complete\",\"bestFit\":true,\"found\":" + std::to_string(found) + ",\"expected\":" + std::to_string(Expected(cur)) + "}"); }
    }
    if (cur.undot) lastResult.dots.clear();
  }

  void Erase(Image &im, const D3D11_MAPPED_SUBRESOURCE &map) {
    auto patch = [&](const Box &dot, bool whole = false) {
      const Box db = whole ? dot : EraseBox(im, dot);
      Inpaint(im, db);
      D3D11_BOX b{ UINT(std::max(0, db.x0 - 1)), UINT(std::max(0, db.y0 - 1)), 0, UINT(std::min(srcW, db.x1 + 1)), UINT(std::min(srcH, db.y1 + 1)), 1 };
      if (b.right <= b.left || b.bottom <= b.top) return;
      ctx->UpdateSubresource(srcTex.get(), 0, &b, static_cast<uint8_t *>(map.pData) + size_t(b.top) * map.RowPitch + size_t(b.left) * 4, map.RowPitch, 0);
    };
    if (!cur.rectMode) for (const Dot &d : lastResult.dots) patch(d.box); // ③ lines: the game drew nothing to erase
    for (const auto &k : lastResult.kept) if (kept.count(k.id)) for (const Dot &d : k.dots) patch(d.box);
    if (choicesOn && !menuMarks.empty()) for (const Dot &d : menuMarks) patch(d.box);
    if (choicesOn && lastChoices.ok && !choiceUndot) for (const auto &it : lastChoices.items) {
      if (it.missing > 0) { const int p = int(lastChoices.pitch * .3f) + 2; patch(Box{ it.box.x0 - p, it.box.y0 - p, it.box.x1 + p, it.box.y1 + p }, true); } // real cached glyphs too
      else for (const Dot &d : it.dots) patch(d.box);
    }
  }

  // ---------------- composition
  float Sx() const { return float(dest.right - dest.left) / srcW; }
  float Sy() const { return float(dest.bottom - dest.top) / srcH; }
  D2D1_POINT_2F Map(float x, float y) const { return { dest.left + x * Sx(), dest.top + y * Sy() }; }

  void Compose() {
    // Frame: 1:1 copy or Lanczos scale into the output texture.
    if (!opt.scale && srcW == outW && srcH == outH) ctx->CopyResource(outTex.get(), srcTex.get());
    else {
      const float clear[4] = { 0, 0, 0, 1 }; ctx->ClearRenderTargetView(outRtv.get(), clear);
      D3D11_MAPPED_SUBRESOURCE m; if (SUCCEEDED(ctx->Map(cbuf.get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) { float *c = static_cast<float *>(m.pData); c[0] = float(srcW); c[1] = float(srcH); c[2] = 1.f / srcW; c[3] = 1.f / srcH; c[4] = .5f; ctx->Unmap(cbuf.get(), 0); }
      D3D11_VIEWPORT vp{ float(dest.left), float(dest.top), float(dest.right - dest.left), float(dest.bottom - dest.top), 0, 1 };
      ID3D11RenderTargetView *rt = outRtv.get(); ctx->OMSetRenderTargets(1, &rt, nullptr); ctx->RSSetViewports(1, &vp);
      ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST); ctx->IASetInputLayout(nullptr);
      ctx->VSSetShader(vs.get(), nullptr, 0); ctx->PSSetShader(ps.get(), nullptr, 0);
      ID3D11ShaderResourceView *sv = srcSrv.get(); ctx->PSSetShaderResources(0, 1, &sv); ID3D11SamplerState *sm = sampler.get(); ctx->PSSetSamplers(0, 1, &sm); ID3D11Buffer *cb = cbuf.get(); ctx->PSSetConstantBuffers(0, 1, &cb);
      ctx->Draw(3, 0);
      ID3D11ShaderResourceView *none = nullptr; ctx->PSSetShaderResources(0, 1, &none); ctx->OMSetRenderTargets(0, nullptr, nullptr);
    }
    // Text.
    d2->SetTarget(d2target.get());
    d2->BeginDraw();
    std::vector<HitBox> hits;
    for (const auto &k : lastResult.kept) { auto it = kept.find(k.id); if (it != kept.end()) DrawLine(it->second, k.dots, true, hits); }
    if (cur.id && !cur.undot) DrawLine(cur, lastResult.dots, false, hits);
    // A line MeguLit cannot place (no dots, no cells: the game draws it itself, or it was handed back): with the reader
    // overlay off while the compositor owns the game, its translation is shown as a caption above the text area.
    if (cur.id && style.mode != 1 && !cur.tl.empty() && (cur.undot || (!cur.everDots && lastResult.dots.empty())) && NowMs() - cur.started > 1200) DrawCaption(cur.tl);
    if (choicesOn && lastChoices.ok && !choiceUndot) DrawChoices();
    else if (choicesOn && !menuMarks.empty()) DrawMenuList();
    if (opt.scale) DrawCursor();
    d2->EndDraw();
    d2->SetTarget(nullptr);
    { std::lock_guard<std::mutex> g(HitLock); Hits.swap(hits); }
  }

  IDWriteTextFormat *Format(const std::wstring &family, float size, bool vertical) {
    const std::wstring key = family + L"|" + std::to_wstring(int(size * 4)) + (vertical ? L"|v" : L"|h");
    com_ptr<IDWriteTextFormat> &f = formats[key];
    if (!f) {
      dw->CreateTextFormat(family.c_str(), nullptr, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, size, L"ja-jp", f.put());
      if (f && vertical) { f->SetReadingDirection(DWRITE_READING_DIRECTION_TOP_TO_BOTTOM); f->SetFlowDirection(DWRITE_FLOW_DIRECTION_RIGHT_TO_LEFT); }
      if (f) f->SetWordWrapping(DWRITE_WORD_WRAPPING_CHARACTER);
    }
    return f.get();
  }
  const Glyph &GlyphFor(char32_t c, float size, bool vertical) {
    const uint64_t key = (uint64_t(c) << 32) | (uint64_t(int(size * 4)) << 1) | (vertical ? 1 : 0);
    Glyph &g = layouts[key];
    if (!g.layout) {
      const std::wstring s = W16(c);
      dw->CreateTextLayout(s.c_str(), UINT32(s.size()), Format(style.jpFont, size, vertical), 4096, 4096, g.layout.put());
      DWRITE_TEXT_METRICS m{}; g.layout->GetMetrics(&m); g.w = m.widthIncludingTrailingWhitespace; g.h = m.height;
      DWRITE_LINE_METRICS lm{}; UINT32 n = 0; g.layout->GetLineMetrics(&lm, 1, &n); g.baseline = lm.baseline;
    }
    return g;
  }
  void Text(IDWriteTextLayout *l, D2D1_POINT_2F at, Rgb c, float alpha) {
    if (style.shadow) { const float o = 1.5f; brush->SetColor(D2D1::ColorF(style.shadowColor.r / 255.f, style.shadowColor.g / 255.f, style.shadowColor.b / 255.f, style.shadowAlpha * alpha)); d2->DrawTextLayout({ at.x + o, at.y + o }, l, brush.get(), D2D1_DRAW_TEXT_OPTIONS_ENABLE_COLOR_FONT); }
    brush->SetColor(D2D1::ColorF(c.r / 255.f, c.g / 255.f, c.b / 255.f, alpha));
    d2->DrawTextLayout(at, l, brush.get(), D2D1_DRAW_TEXT_OPTIONS_ENABLE_COLOR_FONT);
  }

  // A line: Japanese glyphs on the game's own glyph cells (from the dots), furigana over each fully shown ruby span,
  // the translation beside the measured text area; or the translation alone inside the area, revealed with the game.
  void DrawLine(const LineMsg &l, const std::vector<Dot> &dots, bool isKept, std::vector<HitBox> &hits) {
    if (dots.empty()) return;
    const bool vertical = lastResult.vertical;
    const float emSrc = l.em > 0 ? l.em : std::max(8.f, lastResult.pitch > 0 ? lastResult.pitch : 24.f);
    const float em = emSrc * Sy();
    Box area = dots[0].box; for (const Dot &d : dots) { area.x0 = std::min(area.x0, d.box.x0); area.y0 = std::min(area.y0, d.box.y0); area.x1 = std::max(area.x1, d.box.x1); area.y1 = std::max(area.y1, d.box.y1); }
    const std::vector<int> tg = Targets(l, int(dots.size()));
    const int n = std::min<int>(int(dots.size()), int(tg.size()));
    // Translation only replaces the whole line: only when every character of it is a dot (reported characters without
    // gaps; a glyph cache leaves some real, then the bilingual drawing is used for this line).
    const bool whole = l.rec.empty() || l.rec.back() - l.rec.front() + 1 == int(l.rec.size());
    if (style.mode == 2 && !l.tl.empty() && whole) { DrawTranslationOnly(l, dots, emSrc, vertical); return; }
    // Cells. With ①'s metrics: cell top-left = dot top-left − (x, y), baseline = cell top + ascent, exactly the game's.
    // Without: the dot is the black-box top-left; the row's highest dot ≈ cell top + 0.06 em, the cell starts ≈ 0.06 em
    // left of the dot.
    std::vector<float> rowTop(n, 0.f);
    for (int i = 0, start = 0; i <= n; ++i) {
      const bool brk = i == n || (i > start && (vertical ? dots[i].cy < dots[i - 1].cy : dots[i].cx < dots[i - 1].cx));
      if (!brk) continue;
      float top = 1e9f; for (int k = start; k < i; ++k) top = std::min(top, vertical ? -float(dots[k].box.x1) : float(dots[k].box.y0));
      for (int k = start; k < i; ++k) rowTop[k] = top; start = i;
    }
    std::vector<D2D1_POINT_2F> cellTop(n), cellEnd(n); // per glyph, output px: top-left and right/bottom of the cell
    // ①'s metrics are in the engine's raster pixels; an engine that rasterises large and scales its frame down (e.g. at
    // 136 px for a 28 px line) shows them smaller: scale = measured dot pitch / reported advance when clearly smaller.
    float rs = 1.f;
    {
      std::vector<float> adv; for (int i = 0; i < n; ++i) { const int mi = l.rec.empty() ? i : tg[i]; if (mi < int(l.metric.size()) && l.metric[mi].known && l.metric[mi].a > l.metric[mi].h * .8f) adv.push_back(l.metric[mi].a); }
      if (!adv.empty() && lastResult.pitch > 0) { std::nth_element(adv.begin(), adv.begin() + adv.size() / 2, adv.end()); const float a = adv[adv.size() / 2]; if (lastResult.pitch < a * .8f) rs = lastResult.pitch / a; }
    }
    for (int i = 0; i < n; ++i) {
      const Dot &d = dots[i]; const char32_t ch = l.text[tg[i]];
      const int mi = l.rec.empty() ? i : tg[i];
      CharMetric m = mi < int(l.metric.size()) ? l.metric[mi] : CharMetric{};
      if (rs != 1.f) { m.h *= rs; m.b *= rs; m.a *= rs; m.x *= rs; m.y *= rs; }
      float cellX, cellY, adv, base, size = em;
      const bool half = ch < 0x80 || (ch >= 0xFF61 && ch <= 0xFF9F); // 「･」 marks a half-width character
      if (l.centered && !m.known) {
        // Cell centred on the mark: a full-width cell is one em, a half-width one half of it.
        adv = half ? emSrc * .5f : emSrc; base = .88f * emSrc;
        if (!vertical) { cellX = d.cx - adv / 2; cellY = d.cy - emSrc / 2; }
        else { cellX = d.cx - emSrc / 2; cellY = d.cy - adv / 2; }
      } else if (m.known && !vertical) {
        cellX = d.box.x0 - m.x; cellY = d.box.y0 - m.y; adv = m.a; base = m.b;
        if (m.a > m.h * .8f) size = m.a * Sy(); // full-width advance = the game's em
      } else if (!vertical) { cellX = d.box.x0 - .06f * emSrc; cellY = rowTop[i] - .06f * emSrc; adv = emSrc; base = .88f * emSrc; }
      else { cellX = -rowTop[i] - emSrc * .94f; cellY = d.box.y0 - .06f * emSrc; adv = emSrc; base = .88f * emSrc; }
      const Glyph &g = GlyphFor(ch, size, vertical);
      D2D1_POINT_2F at;
      if (!vertical) { const D2D1_POINT_2F c = Map(cellX + adv / 2, cellY + base); at = { c.x - g.w / 2, c.y - g.baseline }; }
      else { const D2D1_POINT_2F c = Map(cellX + emSrc / 2, cellY + emSrc / 2); at = { c.x - g.w / 2, c.y - g.h / 2 }; }
      Text(g.layout.get(), at, style.useGameColor ? d.color : style.jpColor, std::clamp(d.alpha, 0.f, 1.f));
      cellTop[i] = Map(cellX, cellY); cellEnd[i] = Map(cellX + adv, cellY + (m.known ? m.h : emSrc));
      hits.push_back({ { LONG(client.left + cellX), LONG(client.top + cellY), LONG(client.left + cellX + adv), LONG(client.top + cellY + (m.known ? m.h : emSrc)) }, l.id, tg[i] });
    }
    if (style.ruby) for (const Ruby &r : l.ruby) {
      // Shown once every base character of the span is on screen.
      int first = -1, last = -1;
      int inSpan = 0;
      for (int i = 0; i < n; ++i) { if (tg[i] >= r.start && tg[i] < r.end) { if (first < 0) first = i; last = i; ++inSpan; } }
      if (first < 0 || inSpan < r.end - r.start || r.text.empty()) continue; // every base character drawn by MeguLit
      const float rs = em * style.rubyScale;
      com_ptr<IDWriteTextLayout> rl; dw->CreateTextLayout(r.text.c_str(), UINT32(r.text.size()), Format(style.rubyFont, rs, vertical), 4096, 4096, rl.put());
      DWRITE_TEXT_METRICS m{}; rl->GetMetrics(&m);
      // Centred over the span's cells, sitting on the cells' top (right of the column when vertical).
      const D2D1_POINT_2F a = cellTop[first], b = cellEnd[last];
      const D2D1_POINT_2F at = vertical ? D2D1_POINT_2F{ b.x, (a.y + b.y) / 2 - m.height / 2 } : D2D1_POINT_2F{ (a.x + b.x) / 2 - m.width / 2, a.y - m.height * .9f };
      Text(rl.get(), at, style.useGameColor ? dots[first].color : style.jpColor, dots[first].alpha);
    }
    // Translation beside the text (owner rule: beside, not inside the game's box), once the line is fully shown.
    if (style.mode == 0 && !isKept && !l.tl.empty() && l.complete) {
      const D2D1_POINT_2F a = Map(float(area.x0), float(area.y0)), b = Map(float(area.x1), float(area.y1));
      const float ts = em * style.tlScale, maxW = std::max(b.x - a.x + em, float(outW) * .45f);
      com_ptr<IDWriteTextLayout> tl; dw->CreateTextLayout(l.tl.c_str(), UINT32(l.tl.size()), Format(style.tlFont, ts, false), maxW, 4096, tl.put());
      DWRITE_TEXT_METRICS m{}; tl->GetMetrics(&m);
      const float pad = ts * .35f, rubyRoom = style.ruby ? em * style.rubyScale * 1.2f : 0;
      float y = style.tlPlace == 0 ? a.y - em * .5f - rubyRoom - pad * 2 - m.height : b.y + em * .5f + pad;
      if (y < 0) y = b.y + em * .5f + pad; if (y + m.height > outH) y = std::max(0.f, a.y - rubyRoom - pad * 2 - m.height);
      const float x = std::clamp(a.x, 0.f, std::max(0.f, float(outW) - m.width - pad * 2));
      if (style.plate) { brush->SetColor(D2D1::ColorF(0, 0, 0, .55f)); d2->FillRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(x - pad, y - pad, x + m.width + pad, y + m.height + pad), pad, pad), brush.get()); }
      Text(tl.get(), { x, y }, style.tlColor, 1);
    }
  }

  void DrawCaption(const std::wstring &text) {
    const float ts = std::max(16.f, outH / 30.f), pad = ts * .4f;
    com_ptr<IDWriteTextLayout> tl; dw->CreateTextLayout(text.c_str(), UINT32(text.size()), Format(style.tlFont, ts, false), float(outW) * .8f, 4096, tl.put());
    if (!tl) return;
    tl->SetTextAlignment(DWRITE_TEXT_ALIGNMENT_CENTER);
    DWRITE_TEXT_METRICS m{}; tl->GetMetrics(&m);
    const float x0 = float(outW) * .1f, y = std::max(0.f, float(outH) * .70f - m.height);
    brush->SetColor(D2D1::ColorF(0, 0, 0, .55f));
    d2->FillRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(x0 + m.left - pad, y - pad, x0 + m.left + m.width + pad, y + m.height + pad), pad, pad), brush.get());
    Text(tl.get(), { x0, y }, style.tlColor, 1);
  }
  // Translation only: Chinese in the Japanese's area at the game's font size, wrapped inside the measured area and
  // revealed in step with the game's own reveal (share of dots shown → share of translation characters shown).
  void DrawTranslationOnly(const LineMsg &l, const std::vector<Dot> &dots, float emSrc, bool vertical) {
    const float em = emSrc * Sy();
    const Box page = lastResult.area.empty() ? dots[0].box : lastResult.area;
    const Dot &first = dots[0];
    float x0 = first.cx - emSrc / 2, y0 = first.cy - emSrc / 2;
    float right = float(page.x1), bottom = float(page.y1);
    const int expected = Expected(l);
    const float pitch = lastResult.pitch > 0 ? lastResult.pitch : emSrc;
    if (!vertical) { right = std::max(right, std::min(x0 + expected * pitch, float(srcW) - emSrc)); bottom = std::max(bottom, y0 + emSrc * 3); }
    else { x0 = first.cx + emSrc / 2; bottom = std::max(bottom, std::min(y0 + expected * pitch, float(srcH) - emSrc)); }
    const D2D1_POINT_2F a = Map(vertical ? float(page.x0) : x0, y0), b = Map(right, bottom);
    com_ptr<IDWriteTextLayout> tl;
    dw->CreateTextLayout(l.tl.c_str(), UINT32(l.tl.size()), Format(style.tlFont, em, vertical), std::max(em, b.x - a.x), std::max(em, b.y - a.y), tl.put());
    if (!tl) return;
    if (lastResult.lineStep > 0) tl->SetLineSpacing(DWRITE_LINE_SPACING_METHOD_UNIFORM, lastResult.lineStep * (vertical ? Sx() : Sy()), lastResult.lineStep * (vertical ? Sx() : Sy()) * .8f);
    const float share = expected ? float(dots.size()) / expected : 1.f;
    const UINT32 shown = std::min<UINT32>(UINT32(l.tl.size()), UINT32(std::ceil(l.tl.size() * share)));
    com_ptr<ID2D1SolidColorBrush> clear; d2->CreateSolidColorBrush(D2D1::ColorF(0, 0, 0, 0), clear.put());
    if (shown < l.tl.size()) tl->SetDrawingEffect(clear.get(), { shown, UINT32(l.tl.size()) - shown });
    Text(tl.get(), vertical ? D2D1_POINT_2F{ a.x, a.y } : a, style.useGameColor ? first.color : style.jpColor, first.alpha);
  }

  // Choices: one box per choice run; Japanese on the game's cells and the translation under it (bilingual), or the
  // translation alone centred in the box; the highlighted run keeps the game's highlight colour.
  void DrawChoices() {
    const auto &items = lastChoices.items;
    for (size_t i = 0; i < items.size() && i < choices.size(); ++i) {
      const auto &it = items[i]; const ChoiceText &ct = choices[i];
      const float emSrc = lastChoices.pitch > 0 ? lastChoices.pitch : 24.f, em = emSrc * Sy();
      D2D1_POINT_2F a = Map(float(it.box.x0) - emSrc * .4f, float(it.box.y0) - emSrc * .5f), b = Map(float(it.box.x1) + emSrc * .4f, float(it.box.y1) + emSrc * .5f);
      com_ptr<IDWriteTextLayout> tl; DWRITE_TEXT_METRICS m{};
      if (!ct.tl.empty()) { dw->CreateTextLayout(ct.tl.c_str(), UINT32(ct.tl.size()), Format(style.tlFont, style.mode == 2 ? em : em * style.tlScale, false), float(outW) * .8f, 4096, tl.put()); tl->GetMetrics(&m); }
      if (tl && style.mode == 0) b.y += m.height + em * .2f;
      if (tl) { const float cx = (a.x + b.x) / 2, half = std::max((b.x - a.x) / 2, m.width / 2 + em * .4f); a.x = cx - half; b.x = cx + half; }
      brush->SetColor(D2D1::ColorF(0, 0, 0, it.highlighted ? .7f : .5f));
      d2->FillRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(a.x, a.y, b.x, b.y), em * .3f, em * .3f), brush.get());
      if (it.highlighted) { brush->SetColor(D2D1::ColorF(it.color.r / 255.f, it.color.g / 255.f, it.color.b / 255.f, .9f)); d2->DrawRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(a.x, a.y, b.x, b.y), em * .3f, em * .3f), brush.get(), std::max(1.f, em / 16)); }
      if (style.mode != 2 && it.missing > 0) {
        // Not every character has a dot: the Japanese as one run centred on the item's row.
        com_ptr<IDWriteTextLayout> jl; DWRITE_TEXT_METRICS jm{};
        const std::wstring jt = W16(ct.text); dw->CreateTextLayout(jt.c_str(), UINT32(jt.size()), Format(style.jpFont, em, lastChoices.vertical), float(outW), 4096, jl.put()); jl->GetMetrics(&jm);
        const D2D1_POINT_2F c0 = Map((it.box.x0 + it.box.x1) / 2.f, (it.box.y0 + it.box.y1) / 2.f);
        Text(jl.get(), { c0.x - jm.width / 2, c0.y - jm.height / 2 }, it.color, 1);
        if (tl) Text(tl.get(), { (a.x + b.x) / 2 - m.width / 2, Map(0, float(it.box.y1)).y + em * .3f }, it.highlighted ? it.color : style.tlColor, 1);
      } else if (style.mode != 2) {
        const std::vector<int> idx = DotCharIndex(ct.text);
        for (size_t k = 0; k < it.dots.size() && k < idx.size(); ++k) {
          const Dot &d = it.dots[k]; const Glyph &g = GlyphFor(ct.text[idx[k]], em, lastChoices.vertical); const D2D1_POINT_2F c = Map(d.cx, d.cy);
          Text(g.layout.get(), { c.x - g.w / 2, c.y - (g.baseline - .38f * em) }, d.color, 1);
        }
        if (tl) Text(tl.get(), { (a.x + b.x) / 2 - m.width / 2, Map(0, float(it.box.y1)).y + em * .3f }, it.highlighted ? it.color : style.tlColor, 1);
      } else if (tl) Text(tl.get(), { (a.x + b.x) / 2 - m.width / 2, (a.y + b.y) / 2 - m.height / 2 }, it.color, 1);
      else { // translation only, but no translation yet: the item's own text, never an empty plate
        com_ptr<IDWriteTextLayout> jl; DWRITE_TEXT_METRICS jm{}; const std::wstring jt = W16(ct.text);
        dw->CreateTextLayout(jt.c_str(), UINT32(jt.size()), Format(style.jpFont, em, lastChoices.vertical), float(outW), 4096, jl.put()); jl->GetMetrics(&jm);
        Text(jl.get(), { (a.x + b.x) / 2 - jm.width / 2, (a.y + b.y) / 2 - jm.height / 2 }, it.color, 1);
      }
    }
  }

  // Unmatched menu: the items as a list on a plate over the area the menu's marks cover (translation under each item,
  // or only the translation in translation-only mode).
  void DrawMenuList() {
    Box a = menuMarks[0].box; for (const Dot &d : menuMarks) { a.x0 = std::min(a.x0, d.box.x0); a.y0 = std::min(a.y0, d.box.y0); a.x1 = std::max(a.x1, d.box.x1); a.y1 = std::max(a.y1, d.box.y1); }
    const float em = std::max(14.f, (a.h() > 0 && choices.size() ? float(a.h()) / float(choices.size()) * .45f : 20.f) * Sy());
    std::wstring all; for (size_t i = 0; i < choices.size(); ++i) { const ChoiceText &c = choices[i]; if (i) all += L"\n"; all += style.mode == 2 && !c.tl.empty() ? c.tl : W16(c.text); if (style.mode == 0 && !c.tl.empty()) all += L"  " + c.tl; }
    com_ptr<IDWriteTextLayout> tl; dw->CreateTextLayout(all.c_str(), UINT32(all.size()), Format(style.mode == 2 ? style.tlFont : style.jpFont, em, false), float(outW) * .8f, 4096, tl.put()); if (!tl) return;
    DWRITE_TEXT_METRICS m{}; tl->GetMetrics(&m);
    const D2D1_POINT_2F p = Map(float(a.x0), float(a.y0)); const float pad = em * .4f;
    brush->SetColor(D2D1::ColorF(0, 0, 0, .6f)); d2->FillRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(p.x - pad, p.y - pad, p.x + m.width + pad, p.y + m.height + pad), pad, pad), brush.get());
    Text(tl.get(), p, style.tlColor, 1);
  }

  void Present() {
    if (!swap) return;
    com_ptr<ID3D11Texture2D> back; if (FAILED(swap->GetBuffer(0, IID_PPV_ARGS(back.put())))) return;
    ctx->CopyResource(back.get(), outTex.get());
    swap->Present(0, tearing ? DXGI_PRESENT_ALLOW_TEARING : 0);
  }

  void SavePng(const std::wstring &path) {
    if (!shotTex) { D3D11_TEXTURE2D_DESC d; outTex->GetDesc(&d); d.Usage = D3D11_USAGE_STAGING; d.BindFlags = 0; d.CPUAccessFlags = D3D11_CPU_ACCESS_READ; dev->CreateTexture2D(&d, nullptr, shotTex.put()); }
    ctx->CopyResource(shotTex.get(), outTex.get());
    D3D11_MAPPED_SUBRESOURCE m; if (FAILED(ctx->Map(shotTex.get(), 0, D3D11_MAP_READ, 0, &m))) return;
    com_ptr<IWICImagingFactory> wic; CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(wic.put()));
    com_ptr<IWICStream> st; com_ptr<IWICBitmapEncoder> enc; com_ptr<IWICBitmapFrameEncode> fr;
    if (wic && SUCCEEDED(wic->CreateStream(st.put())) && SUCCEEDED(st->InitializeFromFilename(path.c_str(), GENERIC_WRITE)) && SUCCEEDED(wic->CreateEncoder(GUID_ContainerFormatPng, nullptr, enc.put())) && SUCCEEDED(enc->Initialize(st.get(), WICBitmapEncoderNoCache)) && SUCCEEDED(enc->CreateNewFrame(fr.put(), nullptr))) {
      // PNG takes 32bpp BGRA (32bppBGR would be silently changed to 24 bpp); alpha forced opaque.
      fr->Initialize(nullptr); fr->SetSize(outW, outH); WICPixelFormatGUID f = GUID_WICPixelFormat32bppBGRA; fr->SetPixelFormat(&f);
      std::vector<BYTE> px(size_t(outW) * outH * 4);
      for (int y = 0; y < outH; ++y) { memcpy(&px[size_t(y) * outW * 4], static_cast<BYTE *>(m.pData) + size_t(y) * m.RowPitch, size_t(outW) * 4); for (int x = 0; x < outW; ++x) px[(size_t(y) * outW + x) * 4 + 3] = 255; }
      if (f == GUID_WICPixelFormat32bppBGRA) fr->WritePixels(outH, outW * 4, UINT(px.size()), px.data());
      fr->Commit(); enc->Commit();
    }
    ctx->Unmap(shotTex.get(), 0);
  }

  static void MergeMetrics(LineMsg &l, const Json &g) {
    for (size_t k = 0; k < g.size(); ++k) {
      const Json &d = g[k]; const int i = int(d["i"].num(-1)); const std::string kind = d["k"].str();
      if (i < 0 || i >= int(l.metric.size()) || (!kind.empty() && kind != "d" && kind != "c" && kind != "b")) continue; // b: blind dot, mapped to its character
      // path conv (MultiByteToWideChar source): the game draws 「・」 with its own font, the record has no metrics (h = 0):
      // a centred mark, placed like ④'s text marks.
      if (d["h"].num() <= 0) { l.centered = true; if (!std::binary_search(l.rec.begin(), l.rec.end(), i)) l.rec.insert(std::upper_bound(l.rec.begin(), l.rec.end(), i), i); continue; }
      l.metric[i] = { true, float(d["h"].num()), float(d["b"].num()), float(d["a"].num()), float(d["x"].num()), float(d["y"].num()) };
      if (!std::binary_search(l.rec.begin(), l.rec.end(), i)) l.rec.insert(std::upper_bound(l.rec.begin(), l.rec.end(), i), i);
    }
  }
  // Dot k in reading order → character index. With ① reports: the reported span, plus characters whose glyph the game
  // took from its cache (a dot with no new report, ① doc) — they fill gaps inside the span and, when there are more dots
  // than that, extend it after its end, then before its start. Without reports: dot i = character i.
  static std::vector<int> Targets(const LineMsg &l, int n) {
    if (l.rec.empty()) return l.dotChar;
    int a = l.rec.front(), b = l.rec.back(); const int len = int(l.text.size());
    while (b - a + 1 < n && b + 1 < len) ++b;
    while (b - a + 1 < n && a > 0) --a;
    std::vector<int> t; for (int i = a; i <= b; ++i) t.push_back(i); return t;
  }
  int Expected(const LineMsg &l) const { return l.rec.empty() ? int(l.dotChar.size()) : l.rec.back() - l.rec.front() + 1; }

  void ApplyStyle(const Json &j) {
    const std::string m = j["mode"].str(); if (m == "bilingual") style.mode = 0; else if (m == "jp") style.mode = 1; else if (m == "translation") style.mode = 2;
    if (j.has("jpFont")) style.jpFont = Wide(j["jpFont"].str()); if (j.has("tlFont")) style.tlFont = Wide(j["tlFont"].str()); if (j.has("rubyFont")) style.rubyFont = Wide(j["rubyFont"].str());
    if (j.has("ruby")) style.ruby = j["ruby"].truthy(); if (j.has("shadow")) style.shadow = j["shadow"].truthy(); if (j.has("plate")) style.plate = j["plate"].truthy();
    if (j.has("tlPlace")) style.tlPlace = j["tlPlace"].str() == "below" ? 1 : 0;
    if (j.has("tlScale")) style.tlScale = float(j["tlScale"].num(.8)); if (j.has("rubyScale")) style.rubyScale = float(j["rubyScale"].num(.5));
    if (j.has("jpColor")) { style.useGameColor = !ParseColor(j["jpColor"].str(), style.jpColor); }
    if (j.has("tlColor")) ParseColor(j["tlColor"].str(), style.tlColor);
    if (j.has("lookup")) LookupOn = j["lookup"].truthy();
    layouts.clear();
  }
};

// ---------------------------------------------------------------- entry
static HWND FindMainWindow(DWORD pid) {
  struct S { DWORD pid; HWND best; long area; } s{ pid, nullptr, 0 };
  EnumWindows([](HWND h, LPARAM p) -> BOOL { auto *s = reinterpret_cast<S *>(p); DWORD q = 0; GetWindowThreadProcessId(h, &q); if (q != s->pid || !IsWindowVisible(h)) return TRUE; RECT r; GetClientRect(h, &r); const long a = r.right * r.bottom; if (a > s->area) { s->area = a; s->best = h; } return TRUE; }, LPARAM(&s));
  return s.best;
}

int wmain(int argc, wchar_t **argv) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  winrt::init_apartment(winrt::apartment_type::multi_threaded);
  Options o;
  for (int i = 1; i < argc; ++i) {
    const std::wstring a = argv[i]; auto next = [&]() { return i + 1 < argc ? std::wstring(argv[++i]) : std::wstring(); };
    if (a == L"--hwnd") o.game = HWND(uintptr_t(std::wcstoull(next().c_str(), nullptr, 0)));
    else if (a == L"--pid") { const DWORD pid = DWORD(std::wcstoul(next().c_str(), nullptr, 0)); for (int k = 0; k < 100 && !o.game; ++k) { o.game = FindMainWindow(pid); if (!o.game) Sleep(100); } }
    else if (a == L"--scale") o.scale = true;
    else if (a == L"--headless") o.headless = true;
    else if (a == L"--demo") o.demo = true;
    else if (a == L"--auto-lines") o.autoLines = true;
    else if (a == L"--window-alpha") o.windowAlpha = std::clamp(std::stoi(next()), 1, 255);
    else if (a == L"--shots") o.shotDir = next();
    else if (a == L"--shot-every") o.shotEvery = std::stoi(next());
    else if (a == L"--trace") o.trace = true;
    else if (a == L"--frames") o.frames = std::stoi(next());
    else if (a == L"--stats-ms") o.statsEveryMs = std::stod(next());
    else if (a == L"--at") { o.at[0] = std::stoi(next()); o.at[1] = std::stoi(next()); o.atSet = true; }
  }
  Compositor c; c.opt = o;
  if (!c.Init()) return 3;
  std::thread(MouseThread).detach();
  std::mutex qm; std::deque<std::string> queue; std::atomic<bool> eof{ false };
  HANDLE wake = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  std::thread([&] { char buf[1 << 16]; std::string line; while (std::fgets(buf, sizeof buf, stdin)) { line += buf; if (!line.empty() && line.back() == '\n') { { std::lock_guard<std::mutex> g(qm); queue.push_back(line); } line.clear(); SetEvent(wake); } } eof = true; SetEvent(wake); }).detach();
  HANDLE waits[2] = { c.frameEvent, wake };
  while (!c.quit) {
    const DWORD r = MsgWaitForMultipleObjects(2, waits, FALSE, 50, QS_ALLINPUT);
    MSG m; while (PeekMessageW(&m, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&m); DispatchMessageW(&m); }
    std::deque<std::string> todo; { std::lock_guard<std::mutex> g(qm); todo.swap(queue); }
    for (const std::string &l : todo) { const Json j = Json::Parse(l); if (j.kind == Json::Obj) c.Command(j); }
    if (eof && !c.quit) { /* MeguLit closed our stdin: keep running only in --frames test runs */ if (!o.frames) c.quit = true; }
    if (r == WAIT_OBJECT_0) c.Frame();
    c.Tick();
  }
  c.StopBeat(); // the DLL turns real glyphs back on at once
  c.Stats(NowMs());
  Emit("{\"e\":\"exit\"}");
  return 0;
}
