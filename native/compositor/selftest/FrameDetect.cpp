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
  LineSpec s; s.expected = argc > 3 ? _wtoi(argv[3]) : -1;
  if (argc > 2 && wcslen(argv[2]) == 7) { const unsigned long v = wcstoul(argv[2] + 1, nullptr, 16); s.colorKnown = true; s.color = { int(v >> 16 & 255), int(v >> 8 & 255), int(v & 255) }; }
  DotTracker t; t.BeginLine(s); t.Update(im); const TrackResult &r = t.Update(im);
  std::printf("{\"size\":[%u,%u],\"color\":\"#%02x%02x%02x\",\"status\":\"%s\",\"dots\":[", W, H, t.Color().r, t.Color().g, t.Color().b, StatusName(r.status));
  for (size_t i = 0; i < r.dots.size(); ++i) std::printf("%s[%.1f,%.1f,%d,%d,\"#%02x%02x%02x\"]", i ? "," : "", r.dots[i].cx, r.dots[i].cy, r.dots[i].box.w(), r.dots[i].box.h(), r.dots[i].color.r, r.dots[i].color.g, r.dots[i].color.b);
  std::printf("]}\n");
  return 0;
}
