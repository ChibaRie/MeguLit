// SPDX-License-Identifier: GPL-3.0-or-later
// MeguLitFontDot32/64.dll: "dot the font at its source" (docs/text-architecture.md). Engines that rasterise their own
// text with FreeType or a similar library (Artemis, Ren'Py, many newer engines) never ask Windows for a glyph, so ① cannot
// put dots there; they do read the font file themselves. This DLL makes every TrueType font such a game loads draw a
// dot per glyph (FontDotPatch.h: same cmap, advances, metrics and sizes, only the outlines become squares at the glyph's
// top-left), so the engine lays out exactly as before and the compositor finds each character's place in the frame.
//   - File reads (ReadFile): a read whose data starts a font (sfnt / ttcf magic) registers that byte range of that file
//     (volume + file id): the DLL reads the whole font once through its own handle, patches the copy, and from then on
//     every read overlapping the range gets the patched bytes. Works for loose font files and for plain archives
//     (Ren'Py .rpa) where the member starts the read.
//   - Fonts already in memory (an engine that decrypts its archive, e.g. Artemis .pfs): a background scan finds sfnt
//     tables in writable memory (head.magicNumber checked) and patches them in place, every 2 s for the first minute,
//     then every 10 s.
// Nothing on disk changes: the file stays as it is, only the bytes handed to the game differ. Load it before the game
// reads its fonts (MeguLitLaunch<bit>.exe starts the game suspended and loads it first; the "MeguLitFontReady-<pid>"
// event tells the launcher the hooks are in). MEGULIT_FONTDOT_OFF=1 in the game's environment: nothing is hooked.
// Reports (best effort) to \\.\pipe\MeguLitFontDot-<pid>: ToMe_FONTDOT ready | patched src=file|mem size= fonts= dotted= cff=
#include <windows.h>
#include <stdio.h>
#include <vector>
#include <string>
#include <mutex>
#include <psapi.h>
#pragma comment(lib, "psapi.lib")
#include "MinHook.h"
#include "FontDotPatch.h"

namespace {
typedef BOOL(WINAPI *ReadFileFn)(HANDLE, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
ReadFileFn ORead;
std::mutex Gate;
struct Range { DWORD vol; ULONGLONG id; ULONGLONG at; std::vector<uint8_t> data; };
std::vector<Range> Ranges;
std::vector<std::pair<ULONGLONG, ULONGLONG>> Checked;  // (file key hash, offset) already looked at
std::vector<uintptr_t> MemDone;
thread_local bool Inside;
HANDLE Pipe = INVALID_HANDLE_VALUE;
DWORD PipeTried;

std::vector<std::string> Backlog; // reports wait here until the listener is up (fonts load before anyone listens)
void Report(const std::string &line) {
 std::lock_guard<std::mutex> g(Gate);
 if (!line.empty()) { if (Backlog.size() > 4000) Backlog.erase(Backlog.begin()); Backlog.push_back(line); }
 if (Pipe == INVALID_HANDLE_VALUE) {
  DWORD now = GetTickCount(); if (now - PipeTried < 2000) return; PipeTried = now;
  char name[64]; sprintf_s(name, "\\\\.\\pipe\\MeguLitFontDot-%lu", GetCurrentProcessId());
  Pipe = CreateFileA(name, GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  if (Pipe == INVALID_HANDLE_VALUE) return;
 }
 while (!Backlog.empty()) {
  std::string s = Backlog.front() + "\n"; DWORD w;
  if (!WriteFile(Pipe, s.data(), (DWORD)s.size(), &w, NULL)) { CloseHandle(Pipe); Pipe = INVALID_HANDLE_VALUE; return; }
  Backlog.erase(Backlog.begin());
 }
}
std::string Stat(const char *src, const FontDot::Result &r) {
 char b[200]; sprintf_s(b, "ToMe_FONTDOT patched src=%s size=%u fonts=%d dotted=%d emptied=%d cff=%d strikes=%d", src, r.size, r.fonts, r.dotted, r.emptied, r.cff, r.strikes);
 return b;
}
bool Magic(const uint8_t *p, DWORD n) {
 if (n < 4) return false; uint32_t v = FontDot::U32(p);
 return v == FontDot::SFNT || v == FontDot::TAG_TRUE || v == FontDot::TAG_TTCF || v == FontDot::TAG_OTTO;
}
bool Key(HANDLE h, DWORD *vol, ULONGLONG *id) {
 BY_HANDLE_FILE_INFORMATION fi;
 if (GetFileType(h) != FILE_TYPE_DISK || !GetFileInformationByHandle(h, &fi)) return false;
 *vol = fi.dwVolumeSerialNumber; *id = (ULONGLONG)fi.nFileIndexHigh << 32 | fi.nFileIndexLow; return true;
}
bool ReadAt(HANDLE own, ULONGLONG at, uint8_t *buf, DWORD n) {
 OVERLAPPED o{}; o.Offset = (DWORD)at; o.OffsetHigh = (DWORD)(at >> 32); DWORD got = 0;
 return ORead(own, buf, n, &got, &o) && got == n;
}
// A read that starts a font: read it whole through our own handle, patch the copy, keep it for every later read.
void Register(HANDLE h, DWORD vol, ULONGLONG id, ULONGLONG at) {
 wchar_t path[MAX_PATH * 2]; if (!GetFinalPathNameByHandleW(h, path, MAX_PATH * 2, FILE_NAME_NORMALIZED)) return;
 HANDLE own = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING, 0, NULL);
 if (own == INVALID_HANDLE_VALUE) { Report("ToMe_FONTDOT skipped: cannot reopen the file"); return; }
 bool registered = false;
 std::vector<uint8_t> head(65536); LARGE_INTEGER size; GetFileSizeEx(own, &size);
 DWORD hn = (DWORD)min((ULONGLONG)head.size(), (ULONGLONG)size.QuadPart - at);
 if (hn >= 12 && ReadAt(own, at, head.data(), hn)) {
  uint32_t need = FontDot::HeaderBytes(head.data(), hn), ext = need && need <= hn ? FontDot::Extent(head.data(), hn) : 0;
  if (ext >= 1024 && at + ext <= (ULONGLONG)size.QuadPart && ext < (256u << 20)) {
   std::vector<uint8_t> data(ext);
   if (ReadAt(own, at, data.data(), ext)) {
    FontDot::Result r = FontDot::Patch(data.data(), data.size());
    if (r.ok) { { std::lock_guard<std::mutex> g(Gate); Ranges.push_back(Range{vol, id, at, std::move(data)}); } registered = true; Report(Stat("file", r)); }
   }
  }
 }
 CloseHandle(own);
 { char m[700]; char u[520] = ""; WideCharToMultiByte(CP_UTF8, 0, path, -1, u, sizeof u, NULL, NULL);
   sprintf_s(m, "ToMe_FONTDOT %s file offset=%llu header=%lu path=%s", registered ? "registered" : "skipped", at, hn, u); Report(m); }
}
int Traced; bool Trace;
void After(HANDLE h, LPVOID buf, DWORD len, LARGE_INTEGER pos) {
  if (Trace && Traced < 3000) { wchar_t pth[400]; char u[600] = "?"; if (GetFinalPathNameByHandleW(h, pth, 400, 0)) WideCharToMultiByte(CP_UTF8, 0, pth, -1, u, sizeof u, NULL, NULL);
   const uint8_t *q = (const uint8_t *)buf; char m[800]; sprintf_s(m, "ToMe_FONTDOT trace off=%lld len=%lu head=%02x%02x%02x%02x %s", pos.QuadPart, len, q[0], len > 1 ? q[1] : 0, len > 2 ? q[2] : 0, len > 3 ? q[3] : 0, u); if (strstr(u, ".rpa") || strstr(u, ".ttf") || strstr(u, ".otf") || strstr(u, ".pfs")) { Traced++; Report(m); } }
  DWORD vol = 0; ULONGLONG id = 0; bool keyed = false;
  bool any; { std::lock_guard<std::mutex> g(Gate); any = !Ranges.empty(); }
  if (Magic((const uint8_t *)buf, len)) {
   keyed = Key(h, &vol, &id);
   if (keyed) {
    ULONGLONG k = id ^ ((ULONGLONG)vol << 40); bool seen = false;
    { std::lock_guard<std::mutex> g(Gate); for (auto &c : Checked) if (c.first == k && c.second == (ULONGLONG)pos.QuadPart) { seen = true; break; } if (!seen) Checked.push_back({k, (ULONGLONG)pos.QuadPart}); }
    if (!seen) { Register(h, vol, id, (ULONGLONG)pos.QuadPart); any = true; }
   }
  }
  if (any && (keyed || Key(h, &vol, &id))) {
   std::lock_guard<std::mutex> g(Gate);
   ULONGLONG a = (ULONGLONG)pos.QuadPart, b = a + len;
   for (auto &r : Ranges) {
    if (r.vol != vol || r.id != id) continue;
    ULONGLONG ra = r.at, rb = r.at + r.data.size(); ULONGLONG s = max(a, ra), e = min(b, rb);
    if (s < e) memcpy((uint8_t *)buf + (s - a), r.data.data() + (s - ra), (size_t)(e - s));
   }
  }
}
// no C++ objects here, so a fault in the game's buffer or our code never escapes into the game's read
void AfterGuarded(HANDLE h, LPVOID buf, DWORD len, LARGE_INTEGER pos) { __try { After(h, buf, len, pos); } __except (EXCEPTION_EXECUTE_HANDLER) {} }
BOOL WINAPI HRead(HANDLE h, LPVOID buf, DWORD n, LPDWORD got, LPOVERLAPPED ov) {
 if (Inside) return ORead(h, buf, n, got, ov);
 LARGE_INTEGER pos; pos.QuadPart = 0; bool known = false;
 if (ov) { pos.LowPart = ov->Offset; pos.HighPart = (LONG)ov->OffsetHigh; known = true; }
 else { LARGE_INTEGER z; z.QuadPart = 0; known = SetFilePointerEx(h, z, &pos, FILE_CURRENT) != 0; }
 BOOL ok = ORead(h, buf, n, got, ov);
 if (!ok || !known || !buf) return ok;
 DWORD len = got ? *got : 0; if (!len) return ok;
 Inside = true; AfterGuarded(h, buf, len, pos); Inside = false;
 return ok;
}

// ---- fonts already in memory ----------------------------------------------------------------------------------------
int ScanRegion(uint8_t *base, size_t size);
int ScanRegionGuarded(uint8_t *base, size_t size) { __try { return ScanRegion(base, size); } __except (EXCEPTION_EXECUTE_HANDLER) { return 0; } }
int ScanOnce() {
 int found = 0; SYSTEM_INFO si; GetSystemInfo(&si);
 uint8_t *p = (uint8_t *)si.lpMinimumApplicationAddress, *end = (uint8_t *)si.lpMaximumApplicationAddress;
 HMODULE self = NULL; GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, (LPCWSTR)&ScanOnce, &self);
 MEMORY_BASIC_INFORMATION m;
 while (p < end && VirtualQuery(p, &m, sizeof m)) {
  uint8_t *base = (uint8_t *)m.BaseAddress; size_t size = m.RegionSize;
  bool rw = m.State == MEM_COMMIT && !(m.Protect & (PAGE_GUARD | PAGE_NOACCESS)) && (m.Protect & (PAGE_READWRITE | PAGE_EXECUTE_READWRITE)) && m.Type == MEM_PRIVATE;
  if (rw && size >= 4096) found += ScanRegionGuarded(base, size);
  p = base + size;
 }
 return found;
}
int ScanRegion(uint8_t *base, size_t size) {
 int found = 0;
    for (size_t i = 0; i + 64 <= size; i += 16) {
     if (!Magic(base + i, 4)) continue;
     uint32_t ext = FontDot::Extent(base + i, size - i);
     if (ext < 1024 || ext > size - i) continue;
     uintptr_t at = (uintptr_t)(base + i); bool done = false;
     for (auto d : MemDone) if (d == at) { done = true; break; }
     if (done) { i += ext & ~15u; continue; }
     FontDot::Result r = FontDot::Patch(base + i, size - i);
     MemDone.push_back(at);
     if (r.ok) { found++; Report(Stat("mem", r)); }
     i += ext & ~15u;
    }
 return found;
}
// trace only: name every mapped view once (is the font archive memory-mapped?)
void TraceMapped() {
 SYSTEM_INFO si; GetSystemInfo(&si); uint8_t *p = (uint8_t *)si.lpMinimumApplicationAddress; MEMORY_BASIC_INFORMATION m;
 while (p < (uint8_t *)si.lpMaximumApplicationAddress && VirtualQuery(p, &m, sizeof m)) {
  if (m.State == MEM_COMMIT && m.Type == MEM_MAPPED && m.BaseAddress == m.AllocationBase) { wchar_t n[400]; char u[600];
   if (GetMappedFileNameW(GetCurrentProcess(), m.BaseAddress, n, 400)) { WideCharToMultiByte(CP_UTF8, 0, n, -1, u, sizeof u, NULL, NULL);
    if (strstr(u, ".rpa") || strstr(u, ".ttf") || strstr(u, ".otf") || strstr(u, ".pfs")) { char r[800]; sprintf_s(r, "ToMe_FONTDOT mapped %p size=%zu protect=%lx %s", m.BaseAddress, m.RegionSize, m.Protect, u); Report(r); } } }
  p = (uint8_t *)m.BaseAddress + m.RegionSize; }
}
DWORD WINAPI Scanner(void *) {
 for (int i = 0; i < 30; i++) { ScanOnce(); if (Trace && (i % 5) == 4) TraceMapped(); Report(""); Sleep(2000); }
 for (;;) { ScanOnce(); Report(""); Sleep(10000); }
}

DWORD WINAPI Start(void *) {
 MH_Initialize();
 HMODULE kb = GetModuleHandleW(L"kernelbase.dll"); if (!kb) kb = GetModuleHandleW(L"kernel32.dll");
 void *target = kb ? (void *)GetProcAddress(kb, "ReadFile") : NULL;
 bool hooked = target && MH_CreateHook(target, (void *)&HRead, (void **)&ORead) == MH_OK && MH_EnableHook(target) == MH_OK;
 wchar_t ready[64]; swprintf_s(ready, L"MeguLitFontReady-%lu", GetCurrentProcessId());
 HANDLE ev = OpenEventW(EVENT_MODIFY_STATE, FALSE, ready); if (ev) { SetEvent(ev); CloseHandle(ev); }
 Report(std::string("ToMe_FONTDOT ready version=1 readfile=") + (hooked ? "1" : "0"));
 CreateThread(NULL, 0, Scanner, NULL, 0, NULL);
 return 0;
}
}

BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, void *) {
 if (reason == DLL_PROCESS_ATTACH) {
  DisableThreadLibraryCalls(h);
  char off[8]; if (GetEnvironmentVariableA("MEGULIT_FONTDOT_OFF", off, sizeof off) && off[0] == '1') return TRUE;
  { char t[8]; Trace = GetEnvironmentVariableA("MEGULIT_FONTDOT_TRACE", t, sizeof t) && t[0] == '1'; }
  HMODULE pin; GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN, (LPCWSTR)&DllMain, &pin);
  // hooks before the launcher resumes the game: installed on this (loader) thread's helper, waited for by the launcher
  HANDLE t = CreateThread(NULL, 0, Start, NULL, 0, NULL); if (t) CloseHandle(t);
 }
 return TRUE;
}
extern "C" __declspec(dllexport) const char *MeguLitFontDotVersion() { return "MeguLitFontDot version=1"; }
