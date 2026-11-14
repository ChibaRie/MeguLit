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

int wmain(int argc, wchar_t **argv) {
 (void)MeguLitLaunchVersionTag;
 if (argc < 3) { fwprintf(stderr, L"usage: MeguLitLaunch <dll> <exe> [args...]\n"); return 1; }
 std::wstring dll = argv[1], exe = argv[2], cmd = L"\"" + exe + L"\"";
 for (int i = 3; i < argc; i++) { cmd += L" \""; cmd += argv[i]; cmd += L"\""; }
 wchar_t full[MAX_PATH]; if (!GetFullPathNameW(dll.c_str(), MAX_PATH, full, NULL)) return 1; dll = full;
 std::wstring dir = exe.substr(0, exe.find_last_of(L"\\/"));
 STARTUPINFOW si{sizeof si}; PROCESS_INFORMATION pi{};
 if (!CreateProcessW(exe.c_str(), &cmd[0], NULL, NULL, FALSE, CREATE_SUSPENDED, NULL, dir.c_str(), &si, &pi)) { fwprintf(stderr, L"CreateProcess failed %lu\n", GetLastError()); return 1; }
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
 // Text architecture ③ (dot font at the source): more DLLs from MEGULIT_LAUNCH_EXTRA (';'-separated full paths), each
 // loaded the same way while the game is still suspended; they install their hooks inside LoadLibrary (no ready event).
 // A failure here is reported and the game still starts.
 wchar_t extra[4096]; DWORD en = GetEnvironmentVariableW(L"MEGULIT_LAUNCH_EXTRA", extra, 4096);
 if (en && en < 4096) {
  std::wstring list(extra, en); size_t at = 0;
  while (at <= list.size()) {
   size_t end = list.find(L';', at); if (end == std::wstring::npos) end = list.size();
   std::wstring one = list.substr(at, end - at); at = end + 1;
   if (one.empty()) continue;
   size_t nb = (one.size() + 1) * sizeof(wchar_t);
   void *r = VirtualAllocEx(pi.hProcess, NULL, nb, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
   if (r && WriteProcessMemory(pi.hProcess, r, one.c_str(), nb, NULL)) {
    HANDLE t = CreateRemoteThread(pi.hProcess, NULL, 0, (LPTHREAD_START_ROUTINE)GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW"), r, 0, NULL);
    DWORD loaded = 0;
    if (!t || WaitForSingleObject(t, 15000) != WAIT_OBJECT_0 || !GetExitCodeThread(t, &loaded) || !loaded) fwprintf(stderr, L"extra DLL not loaded: %s\n", one.c_str());
    if (t) CloseHandle(t);
   }
   if (r) VirtualFreeEx(pi.hProcess, r, 0, MEM_RELEASE);
  }
 }
 ResumeThread(pi.hThread);
 printf("%lu\n", pi.dwProcessId);
 if (event) CloseHandle(event);
 CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
 return code;
}
