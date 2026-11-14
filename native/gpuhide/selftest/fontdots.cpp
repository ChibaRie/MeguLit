// Font dots offline test: fontdots.exe <in> <out>  (exit 0 = a dotted copy was written)
#include <windows.h>
#include <vector>
#include <algorithm>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#define FONTDOTS_CORE_ONLY
#include "../FontDots.h"
int main(int argc, char **argv) {
 if (argc < 3) return 2; FILE *f = fopen(argv[1], "rb"); if (!f) return 2; std::vector<uint8_t> in; int c; while ((c = fgetc(f)) != EOF) in.push_back((uint8_t)c); fclose(f);
 std::vector<uint8_t> out; fd::Sheet s = {}; if (!fd::Transform(in, out, s)) { printf("no sheet\n"); return 1; }
 printf("cells=%dx%d grid=%dx%d glyphs=%d dot=%d size %zu -> %zu\n", s.cw, s.ch, s.w / s.cw, s.h / s.ch, s.glyphs, s.dot, in.size(), out.size());
 f = fopen(argv[2], "wb"); fwrite(out.data(), 1, out.size(), f); fclose(f); return 0;
}
