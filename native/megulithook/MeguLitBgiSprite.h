#pragma once
/* MeguLit 2026-11-19 (素晴らしき日々, BGI): text that BGI draws outside the message window, the black-screen quotes at the
   start of a chapter, is script "sprite text". It never passes the message function EmbedBGI hooks, so no stream carried it.
   BGI draws such a string with a function of its own: it walks the zero-terminated SJIS string byte by byte and calls the
   glyph function for every character (素晴らしき日々: 0x403eb0, string in arg3, glyph wrapper 0x434a10 -> cache 0x434970 ->
   GetGlyphOutlineA caller 0x4342b0). Addresses differ between BGI builds, so the function is found by its shape:
   - start at the function that calls GetGlyphOutlineA and walk up its direct callers (call rel32), at most three levels;
   - a call site belongs to a string walker when, after the call, the loop ends with "cmp byte ptr [reg], 0; jne back"
     (80 38+reg 00 75 rel8, jumping back before the call), the same compare guards the loop before the call, and the
     function loads that register from one of its stack arguments (8B 45+reg*8 disp8) before the loop;
   - the function must start with push ebp; mov ebp, esp on a 16-byte boundary after padding.
   Header only: the hook (BGI.cpp) and the replay self-test (selftest/bgisprite.cpp) run the same scanner. 32-bit only. */
#include <windows.h>
#include <vector>
#include <set>

namespace MeguLitBgiSprite
{
  struct Image
  {
    const BYTE *bytes; /* the module's bytes as they are in memory */
    uintptr_t va;      /* the address of bytes[0] in the process that runs the code */
    size_t size;
    bool has(uintptr_t a, size_t n) const { return a >= va && a + n <= va + size; }
    BYTE at(uintptr_t a) const { return bytes[a - va]; }
  };

  struct Walker
  {
    uintptr_t function;
    int arg; /* 1-based stack argument holding the string */
  };

  /* every "call rel32" in the image that lands on target */
  inline std::vector<uintptr_t> Callers(const Image &img, uintptr_t target, size_t limit = 32)
  {
    std::vector<uintptr_t> out;
    for (size_t o = 0; o + 5 <= img.size && out.size() < limit; o++)
    {
      if (img.bytes[o] != 0xE8)
        continue;
      INT32 rel = *(const INT32 *)(img.bytes + o + 1);
      if ((uintptr_t)(img.va + o + 5 + (intptr_t)rel) == target)
        out.push_back(img.va + o);
    }
    return out;
  }

  /* push ebp; mov ebp, esp on a 16-byte boundary right after padding (int3, nop) or a ret, at most 0x1000 bytes back */
  inline uintptr_t Enclosing(const Image &img, uintptr_t a)
  {
    for (uintptr_t f = a & ~(uintptr_t)15; f + 0x1000 > a && img.has(f - 1, 4); f -= 16)
    {
      BYTE before = img.at(f - 1);
      if (img.at(f) == 0x55 && img.at(f + 1) == 0x8B && img.at(f + 2) == 0xEC && (before == 0xCC || before == 0x90 || before == 0xC3))
        return f;
    }
    return 0;
  }

  /* cmp byte ptr [reg], 0 (reg is not esp/ebp) */
  inline int CmpZero(const Image &img, uintptr_t x)
  {
    if (!img.has(x, 3) || img.at(x) != 0x80 || img.at(x + 2) != 0)
      return -1;
    BYTE m = img.at(x + 1);
    if ((m & 0xF8) != 0x38 || (m & 7) == 4 || (m & 7) == 5)
      return -1;
    return m & 7;
  }

  /* the stack argument a string walker reads its string from, 0 when the site is not inside one */
  inline int WalkerArg(const Image &img, uintptr_t function, uintptr_t site)
  {
    for (uintptr_t x = site + 5; x < site + 0x50; x++)
    {
      int reg = CmpZero(img, x);
      if (reg < 0 || !img.has(x, 5) || img.at(x + 3) != 0x75 || img.at(x + 4) < 0x80)
        continue;
      if (x + 5 + (INT8)img.at(x + 4) > site)
        continue;
      uintptr_t guard = 0;
      for (uintptr_t y = function; y < site && !guard; y++)
        if (CmpZero(img, y) == reg)
          guard = y;
      if (!guard)
        continue;
      for (uintptr_t y = function; y + 3 <= guard; y++)
      {
        BYTE d = img.at(y + 2);
        if (img.at(y) == 0x8B && img.at(y + 1) == (BYTE)(0x45 | (reg << 3)) && d >= 8 && d < 0x40 && d % 4 == 0)
          return (d - 8) / 4 + 1;
      }
    }
    return 0;
  }

  /* string walkers above the glyph function; skip: functions another hook already owns (the message function) */
  inline std::vector<Walker> Find(const Image &img, uintptr_t glyphFunction, const std::set<uintptr_t> &skip, size_t limit = 4)
  {
    std::vector<Walker> found;
    std::set<uintptr_t> seen{glyphFunction};
    std::vector<uintptr_t> level{glyphFunction};
    for (int depth = 0; depth < 3 && !level.empty(); depth++)
    {
      std::vector<uintptr_t> next;
      for (uintptr_t f : level)
        for (uintptr_t site : Callers(img, f))
        {
          uintptr_t function = Enclosing(img, site);
          if (!function || seen.count(function))
            continue;
          seen.insert(function);
          int arg = WalkerArg(img, function, site);
          if (arg && !skip.count(function))
          {
            if (found.size() < limit)
              found.push_back(Walker{function, arg});
          }
          else if (!arg)
            next.push_back(function);
        }
      level = next;
    }
    return found;
  }
}
