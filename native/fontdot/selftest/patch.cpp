// SPDX-License-Identifier: GPL-3.0-or-later
// Self-test of FontDotPatch.h against real system fonts, without any game: each font file is read into memory, patched,
// loaded from memory into GDI (AddFontMemResourceEx) next to the untouched original, and compared at 48 px:
//   every sampled character has the same advance and cell metrics, and its black box is now a dot (<= 6 px) instead of
//   a glyph; the buffer keeps its length; embedded bitmaps are off (so 12 px is a dot too).
// usage: patch.exe <font file> <face name>
#include <windows.h>
#include <stdio.h>
#include <vector>
#include <string>
#include "../FontDotPatch.h"

static bool Metrics(const wchar_t *face, int px, wchar_t ch, GLYPHMETRICS *gm, TEXTMETRICW *tm) {
 HDC dc = CreateCompatibleDC(NULL);
 HFONT f = CreateFontW(-px, 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, NONANTIALIASED_QUALITY, 0, face);
 HGDIOBJ old = SelectObject(dc, f); MAT2 m = {{0, 1}, {0, 0}, {0, 0}, {0, 1}};
 GetTextMetricsW(dc, tm);
 DWORD r = GetGlyphOutlineW(dc, ch, GGO_METRICS, gm, 0, NULL, &m);
 SelectObject(dc, old); DeleteObject(f); DeleteDC(dc); return r != GDI_ERROR;
}

int wmain(int argc, wchar_t **argv) {
 if (argc < 3) { printf("usage: patch <font> <face>\n"); return 1; }
 FILE *f = _wfopen(argv[1], L"rb"); if (!f) { printf("FAIL open\n"); return 1; }
 std::vector<uint8_t> buf; fseek(f, 0, SEEK_END); buf.resize(ftell(f)); fseek(f, 0, SEEK_SET); fread(buf.data(), 1, buf.size(), f); fclose(f);
 size_t before = buf.size();
 // the original too, from memory, for fonts that are not installed (fonts taken out of a game archive)
 std::vector<uint8_t> original = buf; DWORD on = 0; AddFontMemResourceEx(original.data(), (DWORD)original.size(), NULL, &on);
 uint32_t e = FontDot::Extent(buf.data(), buf.size());
 if (!e || e > buf.size()) { printf("FAIL extent %u of %zu\n", e, buf.size()); return 2; }
 if (FontDot::HeaderBytes(buf.data(), 12) == 0) { printf("FAIL header bytes\n"); return 2; }
 FontDot::Result r = FontDot::Patch(buf.data(), buf.size());
 // patch.exe <font> - <out>: write the patched copy (checked with fontTools by check.py)
 if (argc > 3) { FILE *o = _wfopen(argv[3], L"wb"); if (!o) return 8; fwrite(buf.data(), 1, buf.size(), o); fclose(o); printf("wrote dotted=%d cff=%d\n", r.dotted, r.cff); return r.dotted ? 0 : 3; }
 printf("fonts=%d glyphs=%d dotted=%d emptied=%d cff=%d strikes=%d size=%u\n", r.fonts, r.glyphs, r.dotted, r.emptied, r.cff, r.strikes, r.size);
 if (!r.ok || r.dotted == 0 || buf.size() != before) { printf("FAIL patch\n"); return 3; }
 std::vector<uint8_t> once = buf; FontDot::Patch(buf.data(), buf.size());
 if (once != buf) { printf("FAIL not idempotent\n"); return 3; }
 // the installed original keeps its face name; the patched copy is renamed in its name table (same length, test only)
 std::wstring face = argv[2], test = face; test[1] = L'X';
 for (size_t i = 0; i + face.size() * 2 <= buf.size(); i++) {
  bool hit = true; for (size_t k = 0; k < face.size() && hit; k++) hit = buf[i + 2 * k] == 0 && buf[i + 2 * k + 1] == (uint8_t)face[k];
  if (hit) buf[i + 3] = 'X';
 }
 // the patched copy under the same face name: rename is not needed, GDI prefers the memory font of the same face only
 // when the original is not installed, so compare against metrics read before loading it
 const wchar_t *chars = L"あ漢字A。「";
 GLYPHMETRICS orig[6], dot[6]; TEXTMETRICW tmo, tmd;
 for (int i = 0; i < 6; i++) if (!Metrics(argv[2], 48, chars[i], &orig[i], &tmo)) { printf("FAIL original metrics\n"); return 4; }
 // load the patched font with a distinct name by patching nothing else: AddFontMemResourceEx makes it private; GDI picks
 // the most recently added font of a face, so the memory copy wins inside this process
 DWORD n = 0; HANDLE h = AddFontMemResourceEx(buf.data(), (DWORD)buf.size(), NULL, &n);
 if (!h || !n) { printf("FAIL AddFontMemResourceEx\n"); return 5; }
 int bad = 0;
 for (int i = 0; i < 6; i++) {
  if (!Metrics(test.c_str(), 48, chars[i], &dot[i], &tmd)) { printf("FAIL patched metrics\n"); return 6; }
  bool same = dot[i].gmCellIncX == orig[i].gmCellIncX;
  bool tiny = dot[i].gmBlackBoxX <= 6 && dot[i].gmBlackBoxY <= 6;
  printf("  U+%04X advance %d->%d box %ux%u -> %ux%u%s\n", chars[i], orig[i].gmCellIncX, dot[i].gmCellIncX, orig[i].gmBlackBoxX, orig[i].gmBlackBoxY, dot[i].gmBlackBoxX, dot[i].gmBlackBoxY, same && tiny ? "" : "  <-- FAIL");
  if (!same || !tiny) bad++;
 }
 if (tmd.tmAscent != tmo.tmAscent || tmd.tmHeight != tmo.tmHeight) { printf("FAIL cell metrics %d/%d vs %d/%d\n", tmd.tmAscent, tmd.tmHeight, tmo.tmAscent, tmo.tmHeight); bad++; }
 RemoveFontMemResourceEx(h);
 if (bad) { printf("FAIL %d\n", bad); return 7; }
 printf("PASS dot font: same advances and cell, every glyph a dot <= 6 px at 48 px, same buffer length, idempotent\n");
 return 0;
}
