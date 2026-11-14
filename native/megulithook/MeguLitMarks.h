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
  inline DWORD LastHit = 0, LastMark = 0, LastChar = 0;
  inline bool InName = false;
  // Owner rule "the player never sees marks" (docs/text-architecture.md): marks only while MeguLit's capture compositor
  // presents this game. Heartbeat Local\MeguLitCompositorBeat-<pid> {magic 'MGCB', version 1, compositorPid, presenting,
  // tickMs, frames}: before any beat a 20 s grace from the DLL load (as ① dots); after one was seen, presenting == 1
  // and GetTickCount64() - tickMs <= 1000. A lapse sends "MeguLit_MARKS off" once (the game draws real text again).
#pragma pack(push, 4)
  struct Beat
  {
    DWORD magic, version, compositorPid, presenting;
    unsigned long long tickMs, frames;
  };
#pragma pack(pop)
  inline volatile const Beat *BeatView = nullptr;
  inline ULONGLONG GraceFrom = GetTickCount64();
  inline volatile LONG BeatSeen = 0, Lapsed = 0;
  inline bool BeatFresh()
  {
    if (!BeatView)
    {
      wchar_t name[64];
      swprintf_s(name, L"Local\\MeguLitCompositorBeat-%lu", GetCurrentProcessId());
      if (HANDLE m = OpenFileMappingW(FILE_MAP_READ, FALSE, name))
      {
        void *v = MapViewOfFile(m, FILE_MAP_READ, 0, 0, sizeof(Beat));
        if (!v || InterlockedCompareExchangePointer((PVOID *)&BeatView, v, NULL) != NULL)
        {
          if (v)
            UnmapViewOfFile(v);
          CloseHandle(m);
        }
      }
    }
    ULONGLONG now = GetTickCount64();
    const volatile Beat *b = BeatView;
    if (b && b->magic == 0x4243474D && b->version == 1)
    {
      if (b->tickMs)
        InterlockedExchange(&BeatSeen, 1);
      if (BeatSeen)
        return b->presenting == 1 && b->tickMs && now >= b->tickMs && now - b->tickMs <= 1000;
    }
    if (BeatSeen)
      return false;
    return now - GraceFrom <= 20000;
  }
  inline bool BeatLive()
  {
    bool live = BeatFresh();
    if (!live && !InterlockedExchange(&Lapsed, 1))
      Msg::Log("MeguLit_MARKS off compositor heartbeat stale");
    else if (live && Lapsed && InterlockedExchange(&Lapsed, 0))
      Msg::Log("MeguLit_MARKS live");
    return live;
  }
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
    if (WaitForSingleObject(Event, 0) != WAIT_OBJECT_0)
      return false;
    return BeatLive();
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
    // A name plate at the start of a line ([name], 【name】, ［name］) is the game's own: its frame, colour and place stay,
    // so its characters are not marked (MeguLit takes over the dialogue after it). A new line = a pause of 150 ms+.
    DWORD at = GetTickCount();
    if (at - LastChar > 150)
      InName = c == L'[' || c == 0x3010 || c == 0xFF3B;
    LastChar = at;
    if (InName)
    {
      if (c == L']' || c == 0x3011 || c == 0xFF3D)
        InName = false;
      return;
    }
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
