/* BGI sprite text scan (2026-11-19, 素晴らしき日々: the black-screen quotes at a chapter start reached no stream): runs the
   scanner of MeguLitBgiSprite.h, the code BGI.cpp uses to find the string walker, on
   1. a built-in fixture with the shape BGI's sprite text function has (a string walker calling the glyph wrapper), a message
      function of the same shape that EmbedBGI owns (skipped), a caller without a string loop and a loop over dwords: exactly
      the walker must be found, with its string argument;
   2. a real BGI executable when one is given (argument or MEGULIT_BGI_EXE; never shipped): the scan starts from the function
      that calls GetGlyphOutlineA, as in the game, and must find at least one walker. Optional: expect=<rva hex>:<arg>.
   Exit code = failures. */
#include "../MeguLitBgiSprite.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

static int Failures = 0;
static void Check(bool ok, const char *what)
{
  printf("%s %s\n", ok ? "PASS" : "FAIL", what);
  if (!ok)
    Failures++;
}

struct Asm
{
  std::vector<BYTE> b;
  uintptr_t va;
  uintptr_t here() const { return va + b.size(); }
  void put(std::initializer_list<int> x)
  {
    for (int v : x)
      b.push_back((BYTE)v);
  }
  void align()
  {
    while (b.size() % 16)
      b.push_back(0xCC);
  }
  void call(uintptr_t target)
  {
    INT32 rel = (INT32)(target - (here() + 5));
    b.push_back(0xE8);
    for (int i = 0; i < 4; i++)
      b.push_back((BYTE)(rel >> (8 * i)));
  }
  void prologue() { put({0x55, 0x8B, 0xEC}); }
};

/* a string walker like 素晴らしき日々 0x403eb0: mov ebx,[ebp+argDisp]; cmp byte ptr [ebx],0; je end; loop: ...; call glyph;
   ...; add ebx,edx; cmp byte ptr [ebx],0; jne loop; end: ret */
static uintptr_t Walker(Asm &a, uintptr_t glyph, BYTE argDisp)
{
  a.align();
  uintptr_t f = a.here();
  a.prologue();
  a.put({0x83, 0xEC, 0x6C, 0x53, 0x8B, 0x5D, argDisp, 0x56, 0x57}); /* sub esp,6c; push ebx; mov ebx,[ebp+d]; push esi; push edi */
  a.put({0x80, 0x3B, 0x00, 0x74, 0x20});                         /* cmp byte ptr [ebx],0; je +0x20 */
  uintptr_t loop = a.here();
  a.put({0x8B, 0xD3, 0x8D, 0x74, 0x24, 0x14}); /* mov edx,ebx; lea esi,[esp+14] */
  a.call(glyph);
  a.put({0x33, 0xD2, 0x85, 0xF6, 0x0F, 0x95, 0xC2, 0x42, 0x03, 0xDA}); /* xor edx,edx; test esi,esi; setne dl; inc edx; add ebx,edx */
  a.put({0x80, 0x3B, 0x00, 0x75});
  a.b.push_back((BYTE)(INT8)(loop - (a.here() + 1)));
  a.put({0x5F, 0x5E, 0x5B, 0x8B, 0xE5, 0x5D, 0xC3});
  return f;
}

static void Fixture()
{
  Asm a{{}, 0x401000};
  a.put({0xC3});
  a.align();
  uintptr_t glyphOutline = a.here(); /* calls GetGlyphOutlineA in the game */
  a.prologue();
  a.put({0x5D, 0xC3});
  a.align();
  uintptr_t cache = a.here(); /* glyph cache */
  a.prologue();
  a.put({0x53, 0x8B, 0x5D, 0x0C});
  a.call(glyphOutline);
  a.put({0x5B, 0x5D, 0xC3});
  a.align();
  uintptr_t wrapper = a.here(); /* thin wrapper */
  a.prologue();
  a.call(cache);
  a.put({0x5D, 0xC2, 0x04, 0x00});
  uintptr_t sprite = Walker(a, wrapper, 0x10);
  uintptr_t message = Walker(a, wrapper, 0x0C);
  a.align();
  uintptr_t plain = a.here(); /* one character, no loop */
  a.prologue();
  a.call(wrapper);
  a.put({0x5D, 0xC3});
  a.align();
  uintptr_t dwords = a.here(); /* a loop over a dword table: cmp dword ptr [ebx],0 is no string walk */
  a.prologue();
  a.put({0x8B, 0x5D, 0x08});
  uintptr_t l2 = a.here();
  a.call(wrapper);
  a.put({0x83, 0xC3, 0x04, 0x83, 0x3B, 0x00, 0x75});
  a.b.push_back((BYTE)(INT8)(l2 - (a.here() + 1)));
  a.put({0x5D, 0xC3});
  a.align();
  MeguLitBgiSprite::Image img{a.b.data(), a.va, a.b.size()};
  auto found = MeguLitBgiSprite::Find(img, glyphOutline, {message});
  Check(found.size() == 1 && found[0].function == sprite && found[0].arg == 3, "fixture: the sprite text walker is found, string in arg3");
  bool other = false;
  for (auto &w : found)
    other |= w.function == message || w.function == plain || w.function == dwords;
  Check(!other, "fixture: the message function (EmbedBGI's), a caller without a loop and a dword loop are not taken");
  auto all = MeguLitBgiSprite::Find(img, glyphOutline, {});
  Check(all.size() == 2, "fixture: without the skip both walkers are found (the skip is what keeps EmbedBGI's function)");
  Asm empty{{}, 0x401000};
  empty.put({0xC3});
  empty.align();
  uintptr_t lone = empty.here();
  empty.prologue();
  empty.put({0x5D, 0xC3});
  MeguLitBgiSprite::Image none{empty.b.data(), empty.va, empty.b.size()};
  Check(MeguLitBgiSprite::Find(none, lone, {}).empty(), "fixture: nothing found, nothing hooked");
}

/* the function that calls GetGlyphOutlineA through the import table (call [iat] or mov reg,[iat]) */
static uintptr_t GlyphOutlineCaller(const BYTE *base, const MeguLitBgiSprite::Image &text, uintptr_t imageBase)
{
  auto nt = (const IMAGE_NT_HEADERS32 *)(base + ((const IMAGE_DOS_HEADER *)base)->e_lfanew);
  auto dir = nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
  for (auto d = (const IMAGE_IMPORT_DESCRIPTOR *)(base + dir.VirtualAddress); d->Name; d++)
  {
    auto names = (const DWORD *)(base + (d->OriginalFirstThunk ? d->OriginalFirstThunk : d->FirstThunk));
    for (int i = 0; names[i]; i++)
    {
      if (names[i] & 0x80000000 || strcmp((const char *)(base + names[i] + 2), "GetGlyphOutlineA"))
        continue;
      DWORD slot = (DWORD)(imageBase + d->FirstThunk + i * 4);
      for (size_t o = 0; o + 6 <= text.size; o++)
        if ((text.bytes[o] == 0xFF && text.bytes[o + 1] == 0x15) || (text.bytes[o] == 0x8B && (text.bytes[o + 1] & 0xC7) == 0x05))
          if (*(const DWORD *)(text.bytes + o + 2) == slot)
            return MeguLitBgiSprite::Enclosing(text, text.va + o);
    }
  }
  return 0;
}

static void RealGame(const wchar_t *path, const wchar_t *expect)
{
  HMODULE m = LoadLibraryExW(path, NULL, LOAD_LIBRARY_AS_IMAGE_RESOURCE);
  if (!m)
  {
    Check(false, "real game: the executable can be read");
    return;
  }
  const BYTE *base = (const BYTE *)((uintptr_t)m & ~(uintptr_t)3);
  auto nt = (const IMAGE_NT_HEADERS32 *)(base + ((const IMAGE_DOS_HEADER *)base)->e_lfanew);
  if (nt->FileHeader.Machine != IMAGE_FILE_MACHINE_I386)
  {
    printf("SKIP real game: not a 32-bit executable\n");
    FreeLibrary(m);
    return;
  }
  uintptr_t imageBase = nt->OptionalHeader.ImageBase;
  auto sec = IMAGE_FIRST_SECTION(nt);
  MeguLitBgiSprite::Image text{nullptr, 0, 0};
  for (int i = 0; i < nt->FileHeader.NumberOfSections; i++)
    if (sec[i].Characteristics & IMAGE_SCN_MEM_EXECUTE)
    {
      text = MeguLitBgiSprite::Image{base + sec[i].VirtualAddress, imageBase + sec[i].VirtualAddress, sec[i].Misc.VirtualSize};
      break;
    }
  uintptr_t glyph = text.bytes ? GlyphOutlineCaller(base, text, imageBase) : 0;
  printf("real game: GetGlyphOutlineA caller %#zx\n", (size_t)glyph);
  if (!glyph)
  {
    printf("SKIP real game: no GetGlyphOutlineA call (packed executable?)\n");
    FreeLibrary(m);
    return;
  }
  auto found = MeguLitBgiSprite::Find(text, glyph, {});
  for (auto &f : found)
    printf("real game: string walker %#zx (rva %#zx), string in arg%d\n", (size_t)f.function, (size_t)(f.function - imageBase), f.arg);
  Check(!found.empty(), "real game: a sprite text walker is found");
  if (expect)
  {
    unsigned rva = 0;
    int arg = 0;
    bool hit = false;
    if (swscanf(expect, L"%x:%d", &rva, &arg) == 2)
      for (auto &f : found)
        hit |= f.function - imageBase == rva && f.arg == arg;
    Check(hit, "real game: the expected walker is among them");
  }
  FreeLibrary(m);
}

int wmain(int argc, wchar_t **argv)
{
  Fixture();
  const wchar_t *path = argc > 1 ? argv[1] : _wgetenv(L"MEGULIT_BGI_EXE");
  const wchar_t *expect = argc > 2 ? argv[2] : _wgetenv(L"MEGULIT_BGI_EXPECT");
  if (path && *path)
    RealGame(path, expect);
  printf("bgi sprite scan: %d failure(s)\n", Failures);
  return Failures;
}
