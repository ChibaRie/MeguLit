// SPDX-License-Identifier: GPL-3.0-or-later
// MeguLit text marks (docs/text-architecture.md, "Marks"): the game draws its own line as a row of 「・」 (U+30FB), so the
// capture compositor can find every character's place from the marks and draw MeguLit's text there.
// Streams that write back (EMBED_ABLE) get their marks from the host (HookBridge returns the line with every visible
// character replaced, constructs kept, same character count). This file covers the per-character hooks that cannot
// write back but read the character from a call argument (BRUNS: std::wstring::push_back(wchar_t)): while the host has
// the stream switched on and the marks event (Local\MeguLitMarks-<pid>) is set, a visible non-ASCII character in that
// argument is replaced by U+30FB before the original function runs. ASCII (where engines keep their control codes, e.g.
// BRUNS "$N"), blanks, line breaks and anything non-printing go through unchanged, so the count and every code stay.
// The first marked character of a line is reported as "MeguLit_MARKS hit" so the host can confirm the line.
#pragma once
namespace MeguLitMarks
{
  inline HANDLE Event = NULL;
  inline DWORD LastHit = 0, LastMark = 0;
  inline bool On()
  {
    if (!Event)
    {
      wchar_t name[64];
      swprintf_s(name, L"Local\\MeguLitMarks-%lu", GetCurrentProcessId());
      Event = OpenEventW(SYNCHRONIZE, FALSE, name);
      if (!Event)
        return false;
    }
    return WaitForSingleObject(Event, 0) == WAIT_OBJECT_0;
  }
  // A visible glyph outside ASCII: kana, kanji, full-width letters and punctuation (not U+3000 and not a control code).
  inline bool Visible(wchar_t c)
  {
    if (c < 0x80 || c == 0x3000 || c == 0x30FB || (c >= 0xD800 && c <= 0xDFFF) || c == 0xFEFF || (c >= 0x2000 && c <= 0x200F) || (c >= 0xE000 && c <= 0xF8FF))
      return false;
    return true;
  }
  // Called for a per-character hook whose character is the argument slot itself (no indirection).
  inline void Mark(const HookParam &hp, uintptr_t *slot)
  {
    if (!slot || !(hp.type & CODEC_UTF16) || (hp.type & (DATA_INDIRECT | USING_STRING | EMBED_ABLE)) || hp.text_fun || hp.jittype != JITTYPE::PC || !On())
      return;
    wchar_t c = (wchar_t)(*slot & 0xffff);
    if (!Visible(c))
      return;
    *slot = (*slot & ~(uintptr_t)0xffff) | 0x30FB;
    DWORD now = GetTickCount();
    if (now - LastMark > 400 || !LastHit)
    {
      if (now - LastHit > 400)
        Msg::Log("MeguLit_MARKS hit char version=1");
      LastHit = now;
    }
    LastMark = now;
  }
}
