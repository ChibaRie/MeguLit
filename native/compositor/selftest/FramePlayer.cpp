// SPDX-License-Identifier: GPL-3.0-or-later
// FramePlayer.exe — replay window for the capture-compositor live test (record once, replay off screen): shows a real
// game frame (PNG, e.g. a PrintWindow shot) with the dialogue rows cleaned, and draws part ①'s spec-1 dots where the
// game's glyphs were, line by line with a typewriter reveal, the way a game with MeguLitFont in dot mode looks. GDI
// window off screen, never activated. Prints one JSON line per line start (before its first dot, like ①'s "line"
// report) so a driver can feed MeguLitCompositor in step.
//   FramePlayer.exe <frame.png> <script.json> [x y]
// script.json: {"crop":[3,26,800,600],"clean":{"from":[530,560],"rows":[440,525],"x":[44,762]},
//   "lines":[{"text":"…","color":"#ffffff","revealMs":30,"holdMs":1500,"shadow":false,"shake":0,
//            "cells":[[x,y,a,h,bx,by,w,hh],...]}]}   (cell top-left, advance, height, dot offset in the cell, dot size)
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincodec.h>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>
#include "../Json.h"
struct Rgb { int r = 0, g = 0, b = 0; };
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
using megu::Json; using megu::JsonEscape;

static std::vector<uint8_t> Load(const wchar_t *path, int &w, int &h) {
  IWICImagingFactory *f = nullptr; IWICBitmapDecoder *d = nullptr; IWICBitmapFrameDecode *fr = nullptr; IWICFormatConverter *cv = nullptr;
  std::vector<uint8_t> px;
  CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&f));
  if (f && SUCCEEDED(f->CreateDecoderFromFilename(path, nullptr, GENERIC_READ, WICDecodeMetadataCacheOnLoad, &d)) && SUCCEEDED(d->GetFrame(0, &fr)) && SUCCEEDED(f->CreateFormatConverter(&cv)) &&
      SUCCEEDED(cv->Initialize(fr, GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom))) {
    UINT W, H; cv->GetSize(&W, &H); w = int(W); h = int(H); px.resize(size_t(w) * h * 4); cv->CopyPixels(nullptr, w * 4, UINT(px.size()), px.data());
  }
  if (cv) cv->Release(); if (fr) fr->Release(); if (d) d->Release(); if (f) f->Release();
  return px;
}

static double NowMs() { LARGE_INTEGER f, c; QueryPerformanceFrequency(&f); QueryPerformanceCounter(&c); return double(c.QuadPart) * 1000.0 / double(f.QuadPart); }

int wmain(int argc, wchar_t **argv) {
  if (argc < 3) { std::fprintf(stderr, "FramePlayer <frame.png> <script.json> [x y]\n"); return 2; }
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  int fw = 0, fh = 0; std::vector<uint8_t> frame = Load(argv[1], fw, fh);
  std::ifstream in(argv[2], std::ios::binary); std::stringstream ss; ss << in.rdbuf(); const Json js = Json::Parse(ss.str());
  if (frame.empty() || js.kind != Json::Obj) { std::fprintf(stderr, "bad input\n"); return 2; }
  const int cx = int(js["crop"][0].num()), cy = int(js["crop"][1].num()), W = int(js["crop"][2].num(800)), H = int(js["crop"][3].num(600));
  std::vector<uint8_t> bg(size_t(W) * H * 4);
  for (int y = 0; y < H; ++y) memcpy(&bg[size_t(y) * W * 4], &frame[(size_t(y + cy) * fw + cx) * 4], size_t(W) * 4);
  // Clean the dialogue rows: tile an empty band of the text box over them (even period keeps a dither pattern intact).
  const Json &cl = js["clean"];
  if (cl.kind == Json::Obj) {
    const int f0 = int(cl["from"][0].num()), f1 = int(cl["from"][1].num()), r0 = int(cl["rows"][0].num()), r1 = int(cl["rows"][1].num()), x0 = int(cl["x"][0].num()), x1 = int(cl["x"][1].num());
    const int period = ((f1 - f0) / 2) * 2;
    for (int y = r0; y < r1; ++y) { const int sy = f0 + ((y - r0) % period); memcpy(&bg[(size_t(y) * W + x0) * 4], &bg[(size_t(sy) * W + x0) * 4], size_t(x1 - x0) * 4); }
  }
  // Placement: x y, or "ghost" (default): Windows.Graphics.Capture gets no frames for a window entirely outside the
  // desktop, and a normal window keeps no content for its off-screen part. So: a per-pixel-alpha layered window
  // (UpdateLayeredWindow) with 1 px column on the left screen edge, at the bottom of the z-order and click-through; the
  // frame is opaque (alpha 255, no precision lost — a constant low alpha would leave DWM 1 bit per channel) except the
  // one on-screen column, alpha 0: composited by DWM, captured in full, invisible to the user.
  const bool ghost = argc < 5;
  const int px = ghost ? 1 - W : _wtoi(argv[3]), py = ghost ? 200 : _wtoi(argv[4]);
  WNDCLASSW wc{}; wc.lpfnWndProc = DefWindowProcW; wc.hInstance = GetModuleHandleW(nullptr); wc.lpszClassName = L"MeguLitFramePlayer"; RegisterClassW(&wc);
  HWND hwnd = CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | (ghost ? WS_EX_LAYERED | WS_EX_TRANSPARENT : 0), wc.lpszClassName, L"FramePlayer", WS_POPUP, px, py, W, H, nullptr, nullptr, wc.hInstance, nullptr);
  if (ghost) { SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }
  ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  std::printf("{\"e\":\"ready\",\"hwnd\":%llu,\"pid\":%lu}\n", (unsigned long long)(uintptr_t)hwnd, GetCurrentProcessId()); std::fflush(stdout);
  // Wait for "go" on stdin so the compositor is attached before the first line.
  char go[64]; if (!std::fgets(go, sizeof go, stdin)) return 0;
  BITMAPINFO bi{}; bi.bmiHeader = { sizeof(BITMAPINFOHEADER), W, -H, 1, 32, BI_RGB };
  std::vector<uint8_t> buf(bg.size());
  auto pump = [&]() { MSG m; while (PeekMessageW(&m, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&m); DispatchMessageW(&m); } };
  HDC screen = GetDC(nullptr), mem = CreateCompatibleDC(screen); void *bits = nullptr;
  HBITMAP dib = CreateDIBSection(screen, &bi, DIB_RGB_COLORS, &bits, nullptr, 0); SelectObject(mem, dib);
  auto present = [&]() {
    if (!ghost) { HDC dc = GetDC(hwnd); SetDIBitsToDevice(dc, 0, 0, W, H, 0, 0, 0, H, buf.data(), &bi, DIB_RGB_COLORS); ReleaseDC(hwnd, dc); GdiFlush(); return; }
    uint8_t *d = static_cast<uint8_t *>(bits);
    for (int y = 0; y < H; ++y) { memcpy(d + size_t(y) * W * 4, &buf[size_t(y) * W * 4], size_t(W) * 4); for (int x = 0; x < W; ++x) d[(size_t(y) * W + x) * 4 + 3] = x == W - 1 ? 0 : 255; uint8_t *e = d + (size_t(y) * W + W - 1) * 4; e[0] = e[1] = e[2] = 0; }
    POINT src{ 0, 0 }, dst{ px, py }; SIZE sz{ W, H }; BLENDFUNCTION bf{ AC_SRC_OVER, 0, 255, AC_SRC_ALPHA };
    UpdateLayeredWindow(hwnd, screen, &dst, &sz, mem, &src, 0, &bf, ULW_ALPHA);
  };
  const Json &lines = js["lines"];
  for (size_t li = 0; li < lines.size(); ++li) {
    const Json &l = lines[li];
    Rgb c{ 255, 255, 255 }; { const std::string s = l["color"].str(); if (s.size() == 7) { const unsigned long v = std::strtoul(s.c_str() + 1, nullptr, 16); c = { int(v >> 16 & 255), int(v >> 8 & 255), int(v & 255) }; } }
    const double reveal = l["revealMs"].num(30), hold = l["holdMs"].num(1500); const bool shadow = l["shadow"].truthy(); const int shake = int(l["shake"].num(0));
    const size_t n = l["cells"].size();
    // ①'s "line" report comes before the first dot; glyph metrics as in its "dots" records (i,h,b,a,x,y).
    std::string g = "[";
    for (size_t k = 0; k < n; ++k) { const Json &e = l["cells"][k]; char b[160]; std::snprintf(b, sizeof b, "%s{\"i\":%zu,\"h\":%d,\"b\":%d,\"a\":%d,\"x\":%d,\"y\":%d,\"k\":\"d\"}", k ? "," : "", k, int(e[3].num()), int(e[3].num() * .88), int(e[2].num()), int(e[4].num()), int(e[5].num())); g += b; }
    g += "]";
    std::printf("{\"e\":\"line\",\"n\":%zu,\"text\":\"%s\",\"glyphs\":%s,\"expected\":%zu}\n", li, JsonEscape(l["text"].str()).c_str(), g.c_str(), n); std::fflush(stdout);
    const double t0 = NowMs(); unsigned frameNo = 0;
    for (;;) {
      const double t = NowMs() - t0; if (t > n * reveal + hold) break;
      const size_t shown = std::min(n, size_t(t / reveal) + 1);
      const int ox = shake ? int((frameNo * 7919) % (2 * shake + 1)) - shake : 0, oy = shake ? int((frameNo * 104729) % (2 * shake + 1)) - shake : 0;
      for (int y = 0; y < H; ++y) { const int sy = std::clamp(y - oy, 0, H - 1); for (int x = 0; x < W; ++x) { const int sx = std::clamp(x - ox, 0, W - 1); memcpy(&buf[(size_t(y) * W + x) * 4], &bg[(size_t(sy) * W + sx) * 4], 4); } }
      for (size_t k = 0; k < shown; ++k) {
        const Json &e = l["cells"][k];
        const int x0 = int(e[0].num() + e[4].num()) + ox, y0 = int(e[1].num() + e[5].num()) + oy, w = int(e[6].num(3)), h = int(e[7].num(3));
        auto put = [&](int x, int y, Rgb col) { if (x >= 0 && y >= 0 && x < W && y < H) { uint8_t *p = &buf[(size_t(y) * W + x) * 4]; p[0] = uint8_t(col.b); p[1] = uint8_t(col.g); p[2] = uint8_t(col.r); } };
        if (shadow) for (int y = 0; y < h; ++y) for (int x = 0; x < w; ++x) put(x0 + x + 2, y0 + y + 2, { 16, 16, 20 });
        for (int y = 0; y < h; ++y) for (int x = 0; x < w; ++x) put(x0 + x, y0 + y, c);
      }
      present(); pump(); ++frameNo;
      Sleep(15);
    }
    // Between lines the box is empty for a few frames (ADV page change).
    buf = bg; for (int i = 0; i < 4; ++i) { present(); pump(); Sleep(15); }
  }
  std::printf("{\"e\":\"done\"}\n"); std::fflush(stdout);
  DestroyWindow(hwnd);
  return 0;
}
