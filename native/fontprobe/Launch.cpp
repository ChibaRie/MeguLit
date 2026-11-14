// SPDX-License-Identifier: GPL-3.0-or-later
// MeguLitLaunch32/64.exe: start a game with MeguLitFont<bit>.dll already in place, before the game's main thread runs
// (docs/text-architecture.md, "Early injection"). Engines that rasterise their glyph cache at start-up (YU-RIS) or right
// after the title (Siglus) never call GDI again for a cached character; a late attach misses them for good.
//   MeguLitLaunch<bit>.exe <dll> <game exe> [game arguments...]
// The game is created suspended with MEGULIT_GLYPH_MODE / MEGULIT_GLYPH_FONT (and every other variable) inherited from
// this process, the DLL is loaded by a remote LoadLibraryW, the launcher waits for the DLL's "hooks ready" event
// (MeguLitFontReady-<pid>, 10 s at most), then resumes the main thread. Prints the game's pid on stdout. Exit code 0 on
// success; on any injection failure the game is still resumed (it runs without dots) and the exit code is 2.
// The bitness of the launcher must match the game's (the launcher refuses a mismatch with exit code 3).
#include <windows.h>
#include <stdio.h>
#include <string>
// Same version tag as the DLL it loads (tools/native-stale.cjs checks every fontprobe output for it).
extern "C" __declspec(dllexport) const char MeguLitLaunchVersionTag[] = "MeguLitFont version=3";

// 日文环境 (Japanese locale): with MEGULIT_LAUNCH_LE=<Locale Emulator folder> the game is created through Locale
// Emulator's own LoaderDll!LeCreateProcess (ja-JP, code page 932, Tokyo time) instead of CreateProcessW, still suspended,
// so the dot DLL goes in before the main thread just as without it. Registry redirection is not requested (LEProc's
// profile option); the code page, locale and font charset emulation are. Falls back to a plain suspended start when the
// loader cannot be loaded (the launcher is then 64-bit, or LE is missing) and says so on stderr.
#pragma pack(push, 1)
struct LeTimeFields { WORD Year, Month, Day, Hour, Minute, Second, Milliseconds, Weekday; };
struct LeTimeZone { LONG Bias; WCHAR StandardName[32]; LeTimeFields StandardDate; LONG StandardBias; WCHAR DaylightName[32]; LeTimeFields DaylightDate; LONG DaylightBias; };
struct LeBlock { ULONG AnsiCodePage, OemCodePage, LocaleID, DefaultCharset, HookUILanguageAPI; WCHAR DefaultFaceName[32]; LeTimeZone Timezone; ULONGLONG NumberOfRegistryRedirectionEntries; BYTE Reserved[64]; };
#pragma pack(pop)
typedef DWORD(WINAPI *LeCreateProcessFn)(void *, LPCWSTR, LPWSTR, LPCWSTR, DWORD, LPSTARTUPINFOW, LPPROCESS_INFORMATION, LPVOID, LPVOID, LPVOID, HANDLE);
static bool CreateSuspended(const std::wstring &exe, std::wstring &cmd, const std::wstring &dir, STARTUPINFOW &si, PROCESS_INFORMATION &pi) {
 wchar_t le[MAX_PATH] = {};
 if (GetEnvironmentVariableW(L"MEGULIT_LAUNCH_LE", le, MAX_PATH) && le[0]) {
  // LoaderDll finds LocaleEmulator.dll beside the calling process: run this launcher from a copy in the LE folder
  // (core/glyph-dots.cjs earlyLocale), otherwise LeCreateProcess fails with STATUS_DLL_NOT_FOUND and the plain start is used.
  std::wstring loader = std::wstring(le) + L"\\LoaderDll.dll";
  HMODULE m = LoadLibraryExW(loader.c_str(), NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
  LeCreateProcessFn create = m ? (LeCreateProcessFn)GetProcAddress(m, "LeCreateProcess") : NULL;
  if (create) {
   LeBlock leb{}; leb.AnsiCodePage = 932; leb.OemCodePage = 932; leb.LocaleID = 0x411; leb.DefaultCharset = SHIFTJIS_CHARSET;
   leb.Timezone.Bias = -540; wcscpy_s(leb.Timezone.StandardName, L"Tokyo Standard Time"); wcscpy_s(leb.Timezone.DaylightName, L"Tokyo Daylight Time");
   DWORD status = create(&leb, exe.c_str(), &cmd[0], dir.c_str(), CREATE_SUSPENDED, &si, &pi, NULL, NULL, NULL, NULL);
   if (status == 0 && pi.hProcess) { fwprintf(stderr, L"created through Locale Emulator\n"); return true; }
   fwprintf(stderr, L"LeCreateProcess failed 0x%08lx: plain start\n", status);
  } else fwprintf(stderr, L"Locale Emulator loader not usable here: plain start\n");
 }
 return CreateProcessW(exe.c_str(), &cmd[0], NULL, NULL, FALSE, CREATE_SUSPENDED, NULL, dir.c_str(), &si, &pi) != FALSE;
}

int wmain(int argc, wchar_t **argv) {
 (void)MeguLitLaunchVersionTag;
 if (argc < 3) { fwprintf(stderr, L"usage: MeguLitLaunch <dll> <exe> [args...]\n"); return 1; }
 std::wstring dll = argv[1], exe = argv[2], cmd = L"\"" + exe + L"\"";
 for (int i = 3; i < argc; i++) { cmd += L" \""; cmd += argv[i]; cmd += L"\""; }
 wchar_t full[MAX_PATH]; if (!GetFullPathNameW(dll.c_str(), MAX_PATH, full, NULL)) return 1; dll = full;
 std::wstring dir = exe.substr(0, exe.find_last_of(L"\\/"));
 STARTUPINFOW si{sizeof si}; PROCESS_INFORMATION pi{};
 if (!CreateSuspended(exe, cmd, dir, si, pi)) { fwprintf(stderr, L"CreateProcess failed %lu\n", GetLastError()); return 1; }
 BOOL wowGame = FALSE, wowSelf = FALSE; IsWow64Process(pi.hProcess, &wowGame); IsWow64Process(GetCurrentProcess(), &wowSelf);
 if (wowGame != wowSelf) { ResumeThread(pi.hThread); fwprintf(stderr, L"bitness mismatch: use the other launcher\n"); printf("%lu\n", pi.dwProcessId); return 3; }
 int code = 2;
 wchar_t ready[64]; swprintf_s(ready, L"MeguLitFontReady-%lu", pi.dwProcessId);
 HANDLE event = CreateEventW(NULL, TRUE, FALSE, ready);
 size_t bytes = (dll.size() + 1) * sizeof(wchar_t);
 void *remote = VirtualAllocEx(pi.hProcess, NULL, bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
 if (remote && WriteProcessMemory(pi.hProcess, remote, dll.c_str(), bytes, NULL)) {
  LPTHREAD_START_ROUTINE load = (LPTHREAD_START_ROUTINE)GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW");
  HANDLE t = CreateRemoteThread(pi.hProcess, NULL, 0, load, remote, 0, NULL);
  if (t) {
   DWORD loaded = 0;
   if (WaitForSingleObject(t, 15000) == WAIT_OBJECT_0 && GetExitCodeThread(t, &loaded) && loaded) {
    if (event && WaitForSingleObject(event, 10000) == WAIT_OBJECT_0) code = 0; else fwprintf(stderr, L"hooks-ready event not set\n");
   } else fwprintf(stderr, L"LoadLibraryW failed in the game\n");
   CloseHandle(t);
  }
 }
 if (remote) VirtualFreeEx(pi.hProcess, remote, 0, MEM_RELEASE);
 ResumeThread(pi.hThread);
 printf("%lu\n", pi.dwProcessId);
 if (event) CloseHandle(event);
 CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
 return code;
}
