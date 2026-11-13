// SPDX-License-Identifier: GPL-3.0-or-later
// MeguLitLaunch32/64.exe <dll> <game.exe> [args...] — starts the game suspended, loads <dll> (MeguLitBorderless) into
// it before any game code runs, then lets it go. Same bitness as the game. Prints the game's pid; exit code 0 = started.
// The DLL must be in place before the game creates its renderer, which is why it cannot be injected later.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdio>
#include <string>

// Build marker shared with the DLL (tools/native-stale.cjs checks every output of the borderless entry for it).
static const char Marker[] = "MeguLitBorderless ready mode=launcher";

int wmain(int argc, wchar_t **argv) {
  if (argc < 3) { std::fprintf(stderr, "%s\nMeguLitLaunch <dll> <game.exe> [args...]\n", Marker); return 2; }
  wchar_t dll[MAX_PATH]; if (!GetFullPathNameW(argv[1], MAX_PATH, dll, nullptr) || GetFileAttributesW(dll) == INVALID_FILE_ATTRIBUTES) { std::fwprintf(stderr, L"no dll\n"); return 2; }
  std::wstring cmd = L"\"" + std::wstring(argv[2]) + L"\"";
  for (int i = 3; i < argc; ++i) cmd += L" \"" + std::wstring(argv[i]) + L"\"";
  std::wstring dir = argv[2]; const size_t slash = dir.find_last_of(L"\\/"); dir = slash == std::wstring::npos ? L"." : dir.substr(0, slash);
  STARTUPINFOW si{ sizeof si }; PROCESS_INFORMATION pi{};
  if (!CreateProcessW(argv[2], &cmd[0], nullptr, nullptr, FALSE, CREATE_SUSPENDED, nullptr, dir.c_str(), &si, &pi)) { std::fwprintf(stderr, L"start failed %lu\n", GetLastError()); return 1; }
  const SIZE_T bytes = (wcslen(dll) + 1) * sizeof(wchar_t);
  void *remote = VirtualAllocEx(pi.hProcess, nullptr, bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  bool ok = remote && WriteProcessMemory(pi.hProcess, remote, dll, bytes, nullptr);
  if (ok) {
    // kernel32 sits at the same address in every process of one bitness, so the launcher's own LoadLibraryW is the game's.
    auto load = reinterpret_cast<LPTHREAD_START_ROUTINE>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW"));
    HANDLE t = CreateRemoteThread(pi.hProcess, nullptr, 0, load, remote, 0, nullptr);
    ok = t && WaitForSingleObject(t, 15000) == WAIT_OBJECT_0;
    DWORD code = 0; if (t) { GetExitCodeThread(t, &code); CloseHandle(t); }
    ok = ok && code != 0;
  }
  if (remote) VirtualFreeEx(pi.hProcess, remote, 0, MEM_RELEASE);
  // Without the DLL the game still starts: it just keeps its own fullscreen behaviour.
  ResumeThread(pi.hThread);
  std::printf("%lu %s\n", pi.dwProcessId, ok ? "loaded" : "not-loaded");
  CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
  return 0;
}
