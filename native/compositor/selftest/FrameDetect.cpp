// SPDX-License-Identifier: GPL-3.0-or-later
// FrameDetect.exe <frame.png> [#rrggbb] [expected] — runs DotTracker on one saved game frame (two Updates: the second
// sees the first as its previous frame) and prints the dots it finds as JSON. For checking real shots offline.
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincodec.h>
#include <cstdio>
#include <vector>
#include "../DotFinder.h"
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "ole32.lib")
using namespace megu;

int wmain(int argc, wchar_t **argv) {
  if (argc < 2) return 2;
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  IWICImagingFactory *f = nullptr; IWICBitmapDecoder *d = nullptr; IWICBitmapFrameDecode *fr = nullptr; IWICFormatConverter *cv = nullptr;
  CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&f));
  if (!f || FAILED(f->CreateDecoderFromFilename(argv[1], nullptr, GENERIC_READ, WICDecodeMetadataCacheOnLoad, &d)) || FAILED(d->GetFrame(0, &fr)) || FAILED(f->CreateFormatConverter(&cv)) ||
      FAILED(cv->Initialize(fr, GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom))) return 3;
  UINT W, H; cv->GetSize(&W, &H); std::vector<uint8_t> px(size_t(W) * H * 4); cv->CopyPixels(nullptr, W * 4, UINT(px.size()), px.data());
  Image im{ px.data(), int(W), int(H), int(W) * 4 };
  if (argc > 3 && !wcscmp(argv[2], L"--choices")) { // FrameDetect.exe <frame.png> --choices 10,5 : ChoiceTracker on a static menu
    std::vector<int> counts; for (wchar_t *p = argv[3]; *p;) { counts.push_back(int(wcstol(p, &p, 10))); if (*p == L',') ++p; }
    ChoiceTracker ct; ct.Begin(counts, { { 255, 255, 255 } }); ct.Update(im); ct.Update(im); const auto o = ct.Update(im);
    std::printf("{\"ok\":%d,\"pitch\":%.1f,\"colors\":%zu,\"items\":[", int(o.ok), o.pitch, ct.Colors().size());
    for (size_t i = 0; i < o.items.size(); ++i) std::printf("%s{\"dots\":%zu,\"missing\":%d,\"box\":[%d,%d,%d,%d]}", i ? "," : "", o.items[i].dots.size(), o.items[i].missing, o.items[i].box.x0, o.items[i].box.y0, o.items[i].box.x1, o.items[i].box.y1);
    std::printf("]}\n"); return 0;
  }
  LineSpec s; s.expected = argc > 3 ? _wtoi(argv[3]) : -1; s.hint = s.expected > 0 ? s.expected : 0; // like ①'s reported count
  if (argc > 2 && wcslen(argv[2]) == 7) { const unsigned long v = wcstoul(argv[2] + 1, nullptr, 16); s.colorKnown = true; s.color = { int(v >> 16 & 255), int(v >> 8 & 255), int(v & 255) }; }
  DotTracker t; t.BeginLine(s); t.Update(im); const TrackResult &r = t.Update(im);
  std::printf("{\"size\":[%u,%u],\"color\":\"#%02x%02x%02x\",\"status\":\"%s\",\"dots\":[", W, H, t.Color().r, t.Color().g, t.Color().b, StatusName(r.status));
  for (size_t i = 0; i < r.dots.size(); ++i) std::printf("%s[%.1f,%.1f,%d,%d,\"#%02x%02x%02x\"]", i ? "," : "", r.dots[i].cx, r.dots[i].cy, r.dots[i].box.w(), r.dots[i].box.h(), r.dots[i].color.r, r.dots[i].color.g, r.dots[i].color.b);
  std::printf("]}\n");
  return 0;
}
