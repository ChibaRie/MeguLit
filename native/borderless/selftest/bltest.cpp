// SPDX-License-Identifier: GPL-3.0-or-later
// MeguLitBorderless self-test (x86 and x64). Never asks Windows for a real fullscreen mode: the hooks are installed on
// fake COM objects (MeguLitBorderlessHook — the same code path the real Direct3DCreate9/CreateDXGIFactory/DirectDrawCreate
// hooks use) whose methods only record what reaches them; ChangeDisplaySettingsExW is called for a display that does not
// exist; the real d3d9.dll is only checked for the hook being in place (no device is created). Exit 0 = all passed.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <d3d9.h>
#include <dxgi1_2.h>
#include <ddraw.h>
#include <cstdio>

typedef void(__cdecl *HookFn)(int, void *);
typedef LONG(__cdecl *CountFn)(int);
static int Fails = 0;
#define CHECK(c, what) do { if (c) std::printf("ok   %s\n", what); else { std::printf("FAIL %s\n", what); ++Fails; } } while (0)

static HWND Wnd;
static D3DPRESENT_PARAMETERS SeenPP; static void *SeenMode = (void *)1; static BOOL SeenFull = -1; static DWORD SeenCoop; static int ModeCalls; static DXGI_SWAP_CHAIN_DESC SeenDesc; static DXGI_SWAP_CHAIN_FULLSCREEN_DESC SeenFsDesc;
static int Tag[16];
// Distinct bodies so the linker never folds them into one function (the hooks patch each one's code).
static HRESULT STDMETHODCALLTYPE QI(void *s, REFIID, void **o) { Tag[0]++; *o = s; return S_OK; }
static ULONG STDMETHODCALLTYPE AddRef(void *) { Tag[1]++; return 2; }
static ULONG STDMETHODCALLTYPE Release(void *) { Tag[2]++; return 1; }
static HRESULT STDMETHODCALLTYPE Stub(void *) { Tag[3]++; return E_NOTIMPL; }
static HRESULT STDMETHODCALLTYPE CreateDevice(void *, UINT, D3DDEVTYPE, HWND, DWORD, D3DPRESENT_PARAMETERS *pp, void **out) { Tag[4]++; SeenPP = *pp; *out = nullptr; return E_FAIL; }
static HRESULT STDMETHODCALLTYPE CreateDeviceEx(void *, UINT, D3DDEVTYPE, HWND, DWORD, D3DPRESENT_PARAMETERS *pp, D3DDISPLAYMODEEX *m, void **out) { Tag[5]++; SeenPP = *pp; SeenMode = m; *out = nullptr; return E_FAIL; }
static HRESULT STDMETHODCALLTYPE GetCreationParameters(void *, D3DDEVICE_CREATION_PARAMETERS *p) { Tag[6]++; p->hFocusWindow = Wnd; return S_OK; }
static HRESULT STDMETHODCALLTYPE Reset(void *, D3DPRESENT_PARAMETERS *pp) { Tag[7]++; SeenPP = *pp; return S_OK; }
static HRESULT STDMETHODCALLTYPE ResetEx(void *, D3DPRESENT_PARAMETERS *pp, D3DDISPLAYMODEEX *m) { Tag[8]++; SeenPP = *pp; SeenMode = m; return S_OK; }
static HRESULT STDMETHODCALLTYPE SetFullscreen(void *, BOOL f, void *) { Tag[9]++; SeenFull = f; return S_OK; }
static HRESULT STDMETHODCALLTYPE GetDesc(void *, DXGI_SWAP_CHAIN_DESC *d) { Tag[10]++; *d = {}; d->OutputWindow = Wnd; d->BufferDesc.Width = 640; d->BufferDesc.Height = 480; return S_OK; }
static HRESULT STDMETHODCALLTYPE CreateSwapChain(void *, IUnknown *, DXGI_SWAP_CHAIN_DESC *d, void **o) { Tag[11]++; SeenDesc = *d; *o = nullptr; return E_FAIL; }
static HRESULT STDMETHODCALLTYPE CreateSwapChainForHwnd(void *, IUnknown *, HWND, const DXGI_SWAP_CHAIN_DESC1 *, const DXGI_SWAP_CHAIN_FULLSCREEN_DESC *fs, void *, void **o) { Tag[12]++; SeenFsDesc = *fs; *o = nullptr; return E_FAIL; }
static HRESULT STDMETHODCALLTYPE SetCoop(void *, HWND, DWORD f) { Tag[13]++; SeenCoop = f; return DD_OK; }
static HRESULT STDMETHODCALLTYPE SetMode(void *, DWORD, DWORD, DWORD) { Tag[14]++; ++ModeCalls; return DDERR_GENERIC; }

struct Fake { void **vt; void *table[140]; Fake() { vt = table; for (auto &p : table) p = reinterpret_cast<void *>(&Stub); table[0] = reinterpret_cast<void *>(&QI); table[1] = reinterpret_cast<void *>(&AddRef); table[2] = reinterpret_cast<void *>(&Release); } };
template <class F> F Slot(Fake &f, int i) { return reinterpret_cast<F>(f.vt[i]); }

int main(int argc, char **argv) {
  const char *dllPath = argc > 1 ? argv[1] : (sizeof(void *) == 8 ? "MeguLitBorderless64.dll" : "MeguLitBorderless32.dll");
  SetEnvironmentVariableW(L"MEGULIT_BORDERLESS", L"keep");
  // Baseline: without the DLL a mode change for a display that does not exist is refused.
  DEVMODEW dm{}; dm.dmSize = sizeof dm; dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT; dm.dmPelsWidth = 640; dm.dmPelsHeight = 480;
  const LONG before = ChangeDisplaySettingsExW(L"\\\\.\\DISPLAY99", &dm, nullptr, CDS_FULLSCREEN, nullptr);
  CHECK(before != DISP_CHANGE_SUCCESSFUL, "baseline: bogus display mode change refused");
  HMODULE m = LoadLibraryA(dllPath); CHECK(m != nullptr, "DLL loads");
  if (!m) return 1;
  auto hook = reinterpret_cast<HookFn>(GetProcAddress(m, "MeguLitBorderlessHook")); auto count = reinterpret_cast<CountFn>(GetProcAddress(m, "MeguLitBorderlessCount"));
  WNDCLASSW wc{}; wc.lpfnWndProc = DefWindowProcW; wc.hInstance = GetModuleHandleW(nullptr); wc.lpszClassName = L"bltest"; RegisterClassW(&wc);
  Wnd = CreateWindowExW(0, wc.lpszClassName, L"bltest", WS_OVERLAPPEDWINDOW, -30000, -30000, 300, 200, nullptr, nullptr, wc.hInstance, nullptr);

  // D3D9 CreateDevice / CreateDeviceEx
  Fake d3d; d3d.table[16] = reinterpret_cast<void *>(&CreateDevice); d3d.table[20] = reinterpret_cast<void *>(&CreateDeviceEx);
  hook(0, &d3d);
  D3DPRESENT_PARAMETERS pp{}; pp.Windowed = FALSE; pp.BackBufferWidth = 800; pp.BackBufferHeight = 600; pp.FullScreen_RefreshRateInHz = 60; pp.PresentationInterval = D3DPRESENT_INTERVAL_TWO; pp.hDeviceWindow = Wnd;
  void *dev = nullptr;
  Slot<HRESULT(STDMETHODCALLTYPE *)(void *, UINT, D3DDEVTYPE, HWND, DWORD, D3DPRESENT_PARAMETERS *, void **)>(d3d, 16)(&d3d, 0, D3DDEVTYPE_HAL, Wnd, 0, &pp, &dev);
  CHECK(SeenPP.Windowed == TRUE && SeenPP.FullScreen_RefreshRateInHz == 0 && SeenPP.PresentationInterval == D3DPRESENT_INTERVAL_ONE, "d3d9 CreateDevice: Windowed FALSE -> TRUE, refresh 0, interval one");
  const LONG_PTR st = GetWindowLongPtrW(Wnd, GWL_STYLE); RECT r; GetWindowRect(Wnd, &r);
  CHECK(!(st & WS_CAPTION) && !(st & WS_THICKFRAME) && (st & WS_POPUP), "window made borderless (no caption/frame, WS_POPUP)");
  CHECK(r.right - r.left == 800 && r.bottom - r.top == 600, "window sized to the back buffer (keep mode)");
  pp.Windowed = FALSE; D3DDISPLAYMODEEX mode{ sizeof mode };
  Slot<HRESULT(STDMETHODCALLTYPE *)(void *, UINT, D3DDEVTYPE, HWND, DWORD, D3DPRESENT_PARAMETERS *, D3DDISPLAYMODEEX *, void **)>(d3d, 20)(&d3d, 0, D3DDEVTYPE_HAL, Wnd, 0, &pp, &mode, &dev);
  CHECK(SeenPP.Windowed == TRUE && SeenMode == nullptr, "d3d9 CreateDeviceEx: windowed, no fullscreen display mode");
  // Device Reset / ResetEx
  Fake devf; devf.table[9] = reinterpret_cast<void *>(&GetCreationParameters); devf.table[16] = reinterpret_cast<void *>(&Reset); devf.table[132] = reinterpret_cast<void *>(&ResetEx);
  hook(1, &devf);
  pp.Windowed = FALSE; Slot<HRESULT(STDMETHODCALLTYPE *)(void *, D3DPRESENT_PARAMETERS *)>(devf, 16)(&devf, &pp);
  CHECK(SeenPP.Windowed == TRUE, "d3d9 Reset: windowed");
  pp.Windowed = FALSE; SeenMode = (void *)1; Slot<HRESULT(STDMETHODCALLTYPE *)(void *, D3DPRESENT_PARAMETERS *, D3DDISPLAYMODEEX *)>(devf, 132)(&devf, &pp, &mode);
  CHECK(SeenPP.Windowed == TRUE && SeenMode == nullptr, "d3d9 ResetEx: windowed, no display mode");
  pp.Windowed = TRUE; pp.PresentationInterval = D3DPRESENT_INTERVAL_TWO; Slot<HRESULT(STDMETHODCALLTYPE *)(void *, D3DPRESENT_PARAMETERS *)>(devf, 16)(&devf, &pp);
  CHECK(SeenPP.PresentationInterval == D3DPRESENT_INTERVAL_TWO, "d3d9 Reset: already windowed calls pass unchanged");

  // DXGI: SetFullscreenState, CreateSwapChain, CreateSwapChainForHwnd
  Fake sc; sc.table[10] = reinterpret_cast<void *>(&SetFullscreen); sc.table[12] = reinterpret_cast<void *>(&GetDesc);
  hook(2, &sc);
  Slot<HRESULT(STDMETHODCALLTYPE *)(void *, BOOL, void *)>(sc, 10)(&sc, TRUE, nullptr);
  CHECK(SeenFull == FALSE, "dxgi SetFullscreenState(TRUE) -> FALSE");
  Fake fac; fac.table[10] = reinterpret_cast<void *>(&CreateSwapChain); fac.table[15] = reinterpret_cast<void *>(&CreateSwapChainForHwnd);
  hook(4, &fac);
  DXGI_SWAP_CHAIN_DESC sd{}; sd.Windowed = FALSE; sd.OutputWindow = Wnd; sd.BufferDesc.Width = 1024; sd.BufferDesc.Height = 768; void *out = nullptr;
  Slot<HRESULT(STDMETHODCALLTYPE *)(void *, IUnknown *, DXGI_SWAP_CHAIN_DESC *, void **)>(fac, 10)(&fac, nullptr, &sd, &out);
  CHECK(SeenDesc.Windowed == TRUE, "dxgi CreateSwapChain: Windowed FALSE -> TRUE");
  DXGI_SWAP_CHAIN_DESC1 d1{}; d1.Width = 1024; d1.Height = 768; DXGI_SWAP_CHAIN_FULLSCREEN_DESC fs{}; fs.Windowed = FALSE;
  Slot<HRESULT(STDMETHODCALLTYPE *)(void *, IUnknown *, HWND, const DXGI_SWAP_CHAIN_DESC1 *, const DXGI_SWAP_CHAIN_FULLSCREEN_DESC *, void *, void **)>(fac, 15)(&fac, nullptr, Wnd, &d1, &fs, nullptr, &out);
  CHECK(SeenFsDesc.Windowed == TRUE, "dxgi CreateSwapChainForHwnd: fullscreen desc -> windowed");

  // DirectDraw
  Fake dd; dd.table[20] = reinterpret_cast<void *>(&SetCoop); dd.table[21] = reinterpret_cast<void *>(&SetMode);
  hook(3, &dd);
  Slot<HRESULT(STDMETHODCALLTYPE *)(void *, HWND, DWORD)>(dd, 20)(&dd, Wnd, DDSCL_EXCLUSIVE | DDSCL_FULLSCREEN | DDSCL_ALLOWREBOOT);
  CHECK((SeenCoop & DDSCL_NORMAL) && !(SeenCoop & (DDSCL_EXCLUSIVE | DDSCL_FULLSCREEN)), "ddraw SetCooperativeLevel exclusive -> normal");
  const HRESULT mr = Slot<HRESULT(STDMETHODCALLTYPE *)(void *, DWORD, DWORD, DWORD)>(dd, 21)(&dd, 640, 480, 16);
  CHECK(mr == DD_OK && ModeCalls == 0, "ddraw SetDisplayMode answered without changing the mode");

  // ChangeDisplaySettings
  const LONG after = ChangeDisplaySettingsExW(L"\\\\.\\DISPLAY99", &dm, nullptr, CDS_FULLSCREEN, nullptr);
  CHECK(after == DISP_CHANGE_SUCCESSFUL && count(6) >= 1, "ChangeDisplaySettingsExW resolution change answered, not applied");
  dm.dmPelsWidth = 99999; const LONG test = ChangeDisplaySettingsExW(L"\\\\.\\DISPLAY99", &dm, nullptr, CDS_TEST, nullptr);
  CHECK(test != DISP_CHANGE_SUCCESSFUL, "CDS_TEST queries pass through");

  // Real d3d9.dll loaded after the DLL: Direct3DCreate9 hooked, and the object's CreateDevice code patched (no device made)
  HMODULE d9 = LoadLibraryW(L"d3d9.dll");
  auto create9 = reinterpret_cast<IDirect3D9 *(WINAPI *)(UINT)>(GetProcAddress(d9, "Direct3DCreate9"));
  IDirect3D9 *real = create9 ? create9(D3D_SDK_VERSION) : nullptr;
  bool patched = false;
  if (real) { const unsigned char *code = static_cast<const unsigned char *>((*reinterpret_cast<void ***>(real))[16]); patched = code[0] == 0xE9 || (code[0] == 0xFF && code[1] == 0x25); real->Release(); }
  if (real || patched) CHECK(patched, "real d3d9: Direct3DCreate9 hooked on load, CreateDevice patched");
  else std::printf("skip real d3d9: no Direct3D 9 on this machine\n");
  std::printf("counts d3d9=%ld reset=%ld dxgiCreate=%ld dxgiFull=%ld coop=%ld mode=%ld cds=%ld borderless=%ld\n", count(0), count(1), count(2), count(3), count(4), count(5), count(6), count(7));
  DestroyWindow(Wnd);
  std::printf("%s (%d-bit)\n", Fails ? "FAILED" : "MeguLitBorderless selftest passed", int(sizeof(void *) * 8));
  return Fails ? 1 : 0;
}
