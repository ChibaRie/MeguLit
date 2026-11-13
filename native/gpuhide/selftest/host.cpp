// SPDX-License-Identifier: GPL-3.0-or-later
// Self-test for MeguLitGpu32/64.dll (hide layer 4). Usage: host.exe <dll> <d3d9-up|d3d9-vb|d3d9-ivb|d3d11|gdi> [png prefix]
// The host plays the game and HookBridge at once: it renders a scene (one full-screen quad), a "name" (3 glyph quads
// above the text box) and an 8-character dialogue line (8 glyph quads in a row) from one glyph atlas, loads the DLL
// after its device exists (like a late injection), and talks to it over the real pipes.
//  1. LINE A: the DLL learns the text area (report "learn", ToMe_CHARS hidden=0 with 8 rects) without hiding, then
//     hides the rest of that line (ToMe_CHARS hidden=1).
//  2. LINE B: the 8 glyph quads are left out (report "hit", ToMe_CHARS hidden=1, rects at the drawn places);
//     scene and name pixels unchanged.
//  3. OFF: the line is drawn again.
#include <windows.h>
#include <d3d9.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <stdio.h>
#include <string>
#include <vector>
#include <mutex>
#include <thread>
#include <atomic>
#include <cmath>

static std::mutex Mu; static std::vector<std::string> Reports; static HANDLE Ctl = INVALID_HANDLE_VALUE; static int Fails;
static void Check(bool ok, const char *what) { printf("%s %s\n", ok ? "PASS" : "FAIL", what); if (!ok) Fails++; }
static bool Has(const char *needle, std::string *out = nullptr) { std::lock_guard<std::mutex> g(Mu); for (auto &r : Reports) if (r.find(needle) != std::string::npos) { if (out) *out = r; return true; } return false; }
static void SendCtl(const std::string &s) { std::string l = s + "\n"; DWORD d; WriteFile(Ctl, l.data(), (DWORD)l.size(), &d, NULL); }
static const int W = 640, H = 480, GX = 60, GY = 400, GS = 24, GA = 26, NY = 300;
static int NameX(int i) { return 200 + i * GA; }
static int TextX(int i) { return GX + i * GA; }

// --------------------------------------------------------------------------------------------------------------- D3D9
struct V { float x, y, z, w, u, v; };
struct V3 { float x, y, z, u, v; };
static IDirect3DDevice9 *Dev; static IDirect3DTexture9 *Atlas, *Scene; static IDirect3DVertexBuffer9 *Vb; static IDirect3DIndexBuffer9 *Ib; static std::string Mode;
static void Cell(int c, float &u0, float &v0, float &u1, float &v1) { int cx = c % 8, cy = c / 8; u0 = cx * 32 / 256.f; v0 = cy * 32 / 256.f; u1 = u0 + 32 / 256.f; v1 = v0 + 32 / 256.f; }
static void QuadList(std::vector<V> &out, float x, float y, float s, int cell) { float u0, v0, u1, v1; Cell(cell, u0, v0, u1, v1); V a = { x, y, 0, 1, u0, v0 }, b = { x + s, y, 0, 1, u1, v0 }, c = { x, y + s, 0, 1, u0, v1 }, d = { x + s, y + s, 0, 1, u1, v1 }; out.insert(out.end(), { a, b, c, b, d, c }); }
static void Glyphs(std::vector<V> &q, int first) { for (int i = 0; i < 3; i++) QuadList(q, (float)NameX(i), (float)NY, GS, 40 + i); for (int i = 0; i < 8; i++) QuadList(q, (float)TextX(i), (float)GY, GS, first + i); }
static void FrameD3D(int first, DWORD *pixels) {
 Dev->Clear(0, NULL, D3DCLEAR_TARGET, 0, 1, 0); Dev->BeginScene();
 Dev->SetRenderState(D3DRS_ALPHABLENDENABLE, TRUE); Dev->SetRenderState(D3DRS_SRCBLEND, D3DBLEND_SRCALPHA); Dev->SetRenderState(D3DRS_DESTBLEND, D3DBLEND_INVSRCALPHA); Dev->SetRenderState(D3DRS_LIGHTING, FALSE); Dev->SetRenderState(D3DRS_CULLMODE, D3DCULL_NONE);
 Dev->SetFVF(D3DFVF_XYZRHW | D3DFVF_TEX1); Dev->SetTexture(0, Scene);
 V s[4] = { { 0, 0, 0, 1, 0, 0 }, { (float)W, 0, 0, 1, 1, 0 }, { 0, (float)H, 0, 1, 0, 1 }, { (float)W, (float)H, 0, 1, 1, 1 } }; Dev->DrawPrimitiveUP(D3DPT_TRIANGLESTRIP, 2, s, sizeof(V));
 std::vector<V> q; Glyphs(q, first); Dev->SetTexture(0, Atlas);
 if (Mode == "d3d9-up") Dev->DrawPrimitiveUP(D3DPT_TRIANGLELIST, (UINT)q.size() / 3, q.data(), sizeof(V));
 else if (Mode == "d3d9-vb") {
  // positions in world units through an orthographic projection (the transform path), from a dynamic vertex buffer
  std::vector<V3> v; for (auto &x : q) v.push_back(V3{ x.x, x.y, 0.5f, x.u, x.v }); void *p; Vb->Lock(0, (UINT)(v.size() * sizeof(V3)), &p, D3DLOCK_DISCARD); memcpy(p, v.data(), v.size() * sizeof(V3)); Vb->Unlock();
  D3DMATRIX id = {}, pr = {}; id._11 = id._22 = id._33 = id._44 = 1; pr._11 = 2.f / W; pr._22 = -2.f / H; pr._33 = 1; pr._41 = -1; pr._42 = 1; pr._44 = 1;
  Dev->SetTransform(D3DTS_WORLD, &id); Dev->SetTransform(D3DTS_VIEW, &id); Dev->SetTransform(D3DTS_PROJECTION, &pr);
  Dev->SetFVF(D3DFVF_XYZ | D3DFVF_TEX1); Dev->SetStreamSource(0, Vb, 0, sizeof(V3)); Dev->DrawPrimitive(D3DPT_TRIANGLELIST, 0, (UINT)q.size() / 3);
 } else {
  // 4 vertices + 6 indices per quad
  std::vector<V> v; std::vector<USHORT> ix; for (size_t i = 0; i < q.size(); i += 6) { USHORT b = (USHORT)v.size(); v.push_back(q[i]); v.push_back(q[i + 1]); v.push_back(q[i + 2]); v.push_back(q[i + 4]); ix.insert(ix.end(), { b, (USHORT)(b + 1), (USHORT)(b + 2), (USHORT)(b + 1), (USHORT)(b + 3), (USHORT)(b + 2) }); }
  void *p; Vb->Lock(0, (UINT)(v.size() * sizeof(V)), &p, D3DLOCK_DISCARD); memcpy(p, v.data(), v.size() * sizeof(V)); Vb->Unlock(); Ib->Lock(0, (UINT)(ix.size() * 2), &p, D3DLOCK_DISCARD); memcpy(p, ix.data(), ix.size() * 2); Ib->Unlock();
  Dev->SetStreamSource(0, Vb, 0, sizeof(V)); Dev->SetIndices(Ib); Dev->DrawIndexedPrimitive(D3DPT_TRIANGLELIST, 0, 0, (UINT)v.size(), 0, (UINT)ix.size() / 3);
 }
 Dev->EndScene();
 if (pixels) { IDirect3DSurface9 *bb, *sys; Dev->GetBackBuffer(0, 0, D3DBACKBUFFER_TYPE_MONO, &bb); D3DSURFACE_DESC d; bb->GetDesc(&d); Dev->CreateOffscreenPlainSurface(W, H, d.Format, D3DPOOL_SYSTEMMEM, &sys, NULL); Dev->GetRenderTargetData(bb, sys); D3DLOCKED_RECT r; sys->LockRect(&r, NULL, D3DLOCK_READONLY); for (int y = 0; y < H; y++) memcpy(pixels + y * W, (char *)r.pBits + y * r.Pitch, W * 4); sys->UnlockRect(); sys->Release(); bb->Release(); }
 Dev->Present(NULL, NULL, NULL, NULL);
}
static IDirect3DTexture9 *MakeTex(int size, bool atlas) {
 IDirect3DTexture9 *t; Dev->CreateTexture(size, size, 1, 0, D3DFMT_A8R8G8B8, D3DPOOL_MANAGED, &t, NULL); D3DLOCKED_RECT r; t->LockRect(0, &r, NULL, 0);
 for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) { DWORD c; if (!atlas) c = 0xFF000080; else { int cx = x % 32, cy = y % 32; c = (cx >= 4 && cx < 28 && cy >= 4 && cy < 28) ? 0xFFFFFFFF : 0x00000000; } ((DWORD *)((char *)r.pBits + y * r.Pitch))[x] = c; }
 t->UnlockRect(0); return t;
}

// ---------------------------------------------------------------------------------------------------------------- GDI
static HDC BackDc, AtlasDc; static DWORD *BackBits; static HWND Win;
static void FrameGdi(int first, DWORD *pixels) {
 RECT all = { 0, 0, W, H }; HBRUSH b = CreateSolidBrush(RGB(0, 0, 128)); FillRect(BackDc, &all, b); DeleteObject(b);
 for (int i = 0; i < 3; i++) { int c = 40 + i; BitBlt(BackDc, NameX(i), NY, GS, GS, AtlasDc, (c % 8) * 32 + 4, (c / 8) * 32 + 4, SRCCOPY); }
 for (int i = 0; i < 8; i++) { int c = first + i; BitBlt(BackDc, TextX(i), GY, GS, GS, AtlasDc, (c % 8) * 32 + 4, (c / 8) * 32 + 4, SRCCOPY); }
 GdiFlush(); if (pixels) memcpy(pixels, BackBits, W * H * 4);
 HDC wd = GetDC(Win); BitBlt(wd, 0, 0, W, H, BackDc, 0, 0, SRCCOPY); ReleaseDC(Win, wd);
}
static HDC Dib(int w, int h, DWORD **bits) { BITMAPINFO bi = {}; bi.bmiHeader.biSize = sizeof bi.bmiHeader; bi.bmiHeader.biWidth = w; bi.bmiHeader.biHeight = -h; bi.bmiHeader.biPlanes = 1; bi.bmiHeader.biBitCount = 32; HBITMAP bm = CreateDIBSection(NULL, &bi, DIB_RGB_COLORS, (void **)bits, NULL, 0); HDC dc = CreateCompatibleDC(NULL); SelectObject(dc, bm); return dc; }


// ------------------------------------------------------------------------------------------------------------- D3D11
// Positions in normalised device coordinates (the DLL maps them through the viewport), a dynamic vertex buffer written
// with Map / Unmap, an input layout made before the DLL arrived (the DLL guesses it: position float2 at 0, texture
// coordinate float2 in the last 8 bytes of the stride).
static ID3D11Device *D11; static ID3D11DeviceContext *C11; static IDXGISwapChain *Sc; static ID3D11RenderTargetView *Rtv; static ID3D11Buffer *Vb11; static ID3D11ShaderResourceView *AtlasV, *SceneV; static ID3D11Texture2D *Stage;
struct V2 { float x, y, u, v; };
static void Q11(std::vector<V2> &o, float x, float y, float w, float h, float u0, float v0, float u1, float v1) { auto nx = [](float p) { return p / W * 2 - 1; }; auto ny = [](float p) { return 1 - p / H * 2; }; V2 a = { nx(x), ny(y), u0, v0 }, b = { nx(x + w), ny(y), u1, v0 }, c = { nx(x), ny(y + h), u0, v1 }, d = { nx(x + w), ny(y + h), u1, v1 }; o.insert(o.end(), { a, b, c, b, d, c }); }
static void Draw11(const std::vector<V2> &v) { D3D11_MAPPED_SUBRESOURCE m; C11->Map(Vb11, 0, D3D11_MAP_WRITE_DISCARD, 0, &m); memcpy(m.pData, v.data(), v.size() * sizeof(V2)); C11->Unmap(Vb11, 0); C11->Draw((UINT)v.size(), 0); }
static void FrameD3D11(int first, DWORD *pixels) {
 float clear[4] = { 0, 0, 0, 1 }; C11->OMSetRenderTargets(1, &Rtv, NULL); C11->ClearRenderTargetView(Rtv, clear);
 D3D11_VIEWPORT vp = { 0, 0, (float)W, (float)H, 0, 1 }; C11->RSSetViewports(1, &vp);
 std::vector<V2> s; Q11(s, 0, 0, W, H, 0, 0, 1, 1); C11->PSSetShaderResources(0, 1, &SceneV); Draw11(s);
 std::vector<V2> g; for (int i = 0; i < 3; i++) { int c = 40 + i; float u0, v0, u1, v1; Cell(c, u0, v0, u1, v1); Q11(g, (float)NameX(i), (float)NY, GS, GS, u0, v0, u1, v1); }
 for (int i = 0; i < 8; i++) { float u0, v0, u1, v1; Cell(first + i, u0, v0, u1, v1); Q11(g, (float)TextX(i), (float)GY, GS, GS, u0, v0, u1, v1); }
 C11->PSSetShaderResources(0, 1, &AtlasV); Draw11(g);
 if (pixels) { ID3D11Texture2D *bb; Sc->GetBuffer(0, __uuidof(ID3D11Texture2D), (void **)&bb); C11->CopyResource(Stage, bb); bb->Release(); D3D11_MAPPED_SUBRESOURCE m; C11->Map(Stage, 0, D3D11_MAP_READ, 0, &m); for (int y = 0; y < H; y++) { const DWORD *r = (const DWORD *)((char *)m.pData + y * m.RowPitch); for (int x = 0; x < W; x++) { DWORD c = r[x]; pixels[y * W + x] = (c & 0xFF00FF00) | ((c & 0xFF) << 16) | ((c >> 16) & 0xFF); } } C11->Unmap(Stage, 0); }
 Sc->Present(0, 0);
}
static ID3D11ShaderResourceView *Tex11(int size, bool atlas) {
 std::vector<DWORD> px(size * size); for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) { int cx = x % 32, cy = y % 32; px[y * size + x] = !atlas ? 0xFF800000 : (cx >= 4 && cx < 28 && cy >= 4 && cy < 28) ? 0xFFFFFFFF : 0; }
 D3D11_TEXTURE2D_DESC d = {}; d.Width = d.Height = size; d.MipLevels = d.ArraySize = 1; d.Format = DXGI_FORMAT_R8G8B8A8_UNORM; d.SampleDesc.Count = 1; d.BindFlags = D3D11_BIND_SHADER_RESOURCE; D3D11_SUBRESOURCE_DATA sd = { px.data(), (UINT)size * 4, 0 };
 ID3D11Texture2D *t; D11->CreateTexture2D(&d, &sd, &t); ID3D11ShaderResourceView *v; D11->CreateShaderResourceView(t, NULL, &v); t->Release(); return v;
}
static bool Init11() {
 DXGI_SWAP_CHAIN_DESC sd = {}; sd.BufferCount = 1; sd.BufferDesc.Width = W; sd.BufferDesc.Height = H; sd.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM; sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT; sd.OutputWindow = Win; sd.SampleDesc.Count = 1; sd.Windowed = TRUE; sd.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
 if (FAILED(D3D11CreateDeviceAndSwapChain(NULL, D3D_DRIVER_TYPE_HARDWARE, NULL, 0, NULL, 0, D3D11_SDK_VERSION, &sd, &Sc, &D11, NULL, &C11)) && FAILED(D3D11CreateDeviceAndSwapChain(NULL, D3D_DRIVER_TYPE_WARP, NULL, 0, NULL, 0, D3D11_SDK_VERSION, &sd, &Sc, &D11, NULL, &C11))) return false;
 ID3D11Texture2D *bb; Sc->GetBuffer(0, __uuidof(ID3D11Texture2D), (void **)&bb); D11->CreateRenderTargetView(bb, NULL, &Rtv); D3D11_TEXTURE2D_DESC bd; bb->GetDesc(&bd); bb->Release(); bd.Usage = D3D11_USAGE_STAGING; bd.BindFlags = 0; bd.CPUAccessFlags = D3D11_CPU_ACCESS_READ; D11->CreateTexture2D(&bd, NULL, &Stage);
 const char *src = "Texture2D t:register(t0);SamplerState s:register(s0);struct V{float4 p:SV_Position;float2 u:TEXCOORD0;};V vs(float2 p:POSITION,float2 u:TEXCOORD0){V o;o.p=float4(p,0,1);o.u=u;return o;}float4 ps(V i):SV_Target{return t.Sample(s,i.u);}";
 ID3DBlob *vb = NULL, *pb = NULL; if (FAILED(D3DCompile(src, strlen(src), NULL, NULL, NULL, "vs", "vs_4_0", 0, 0, &vb, NULL)) || FAILED(D3DCompile(src, strlen(src), NULL, NULL, NULL, "ps", "ps_4_0", 0, 0, &pb, NULL))) return false;
 ID3D11VertexShader *v; ID3D11PixelShader *p; D11->CreateVertexShader(vb->GetBufferPointer(), vb->GetBufferSize(), NULL, &v); D11->CreatePixelShader(pb->GetBufferPointer(), pb->GetBufferSize(), NULL, &p);
 D3D11_INPUT_ELEMENT_DESC e[] = { { "POSITION", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0 }, { "TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 8, D3D11_INPUT_PER_VERTEX_DATA, 0 } };
 ID3D11InputLayout *l; D11->CreateInputLayout(e, 2, vb->GetBufferPointer(), vb->GetBufferSize(), &l);
 D3D11_BUFFER_DESC b = {}; b.ByteWidth = 64 * 6 * sizeof(V2); b.Usage = D3D11_USAGE_DYNAMIC; b.BindFlags = D3D11_BIND_VERTEX_BUFFER; b.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE; D11->CreateBuffer(&b, NULL, &Vb11);
 D3D11_SAMPLER_DESC smp = {}; smp.Filter = D3D11_FILTER_MIN_MAG_MIP_POINT; smp.AddressU = smp.AddressV = smp.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP; smp.MaxLOD = D3D11_FLOAT32_MAX; ID3D11SamplerState *ss; D11->CreateSamplerState(&smp, &ss);
 D3D11_BLEND_DESC bl = {}; bl.RenderTarget[0].BlendEnable = TRUE; bl.RenderTarget[0].SrcBlend = D3D11_BLEND_SRC_ALPHA; bl.RenderTarget[0].DestBlend = D3D11_BLEND_INV_SRC_ALPHA; bl.RenderTarget[0].BlendOp = D3D11_BLEND_OP_ADD; bl.RenderTarget[0].SrcBlendAlpha = D3D11_BLEND_ONE; bl.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_ZERO; bl.RenderTarget[0].BlendOpAlpha = D3D11_BLEND_OP_ADD; bl.RenderTarget[0].RenderTargetWriteMask = 15; ID3D11BlendState *bs; D11->CreateBlendState(&bl, &bs);
 UINT stride = sizeof(V2), off = 0; C11->IASetInputLayout(l); C11->IASetVertexBuffers(0, 1, &Vb11, &stride, &off); C11->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST); C11->VSSetShader(v, NULL, 0); C11->PSSetShader(p, NULL, 0); C11->PSSetSamplers(0, 1, &ss); float f[4] = {}; C11->OMSetBlendState(bs, f, 0xFFFFFFFF);
 AtlasV = Tex11(256, true); SceneV = Tex11(64, false); return true;
}

// ----------------------------------------------------------------------------------------------------------- the test
static void Frame(int first, DWORD *px) { if (Mode == "gdi") { FrameGdi(first, px); Sleep(40); } else if (Mode == "d3d11") { FrameD3D11(first, px); Sleep(16); } else { FrameD3D(first, px); Sleep(16); } }
static bool White(DWORD c) { return (c & 0xFFFFFF) == 0xFFFFFF; }
static bool Blue(DWORD c) { return (c & 0xFFFFFF) == 0x000080; }
static void Pixels(int first, bool textShown, const char *label) {
 std::vector<DWORD> px(W * H); Frame(first, px.data()); int text = 0, name = 0; for (int i = 0; i < 8; i++) text += White(px[(GY + GS / 2) * W + TextX(i) + GS / 2]); for (int i = 0; i < 3; i++) name += White(px[(NY + GS / 2) * W + NameX(i) + GS / 2]);
 bool scene = Blue(px[5 * W + 5]) && Blue(px[(GY + GS / 2) * W + TextX(0) - 4]); char b[200];
 snprintf(b, sizeof b, "%s: dialogue glyphs %s (%d/8 white), name kept (%d/3), scene kept", label, textShown ? "drawn" : "left out", text, name); Check((textShown ? text == 8 : text == 0) && name == 3 && scene, b);
}
static bool WaitFor(const char *needle, int first, int frames, std::string *out = nullptr) { for (int i = 0; i < frames; i++) { if (Has(needle, out)) return true; Frame(first, nullptr); } return Has(needle, out); }
static bool RectsOk(const std::string &r) {
 size_t a = r.find("rects="); if (a == std::string::npos) return false; a += 6; int ok = 0;
 for (int i = 0; i < 8; i++) { float x, y, w, h; if (sscanf_s(r.c_str() + a, "%f,%f,%f,%f", &x, &y, &w, &h) != 4) return false; if (fabsf(x - TextX(i)) <= 2 && fabsf(y - GY) <= 2 && fabsf(w - GS) <= 2 && fabsf(h - GS) <= 2) ok++; a = r.find(';', a); if (i < 7 && a == std::string::npos) return false; a++; }
 return ok == 8;
}
int wmain(int argc, wchar_t **argv) {
 if (argc < 3) { printf("usage: host <dll> <d3d9-up|d3d9-vb|d3d9-ivb|d3d11|gdi>\n"); return 2; }
 char m[32]; WideCharToMultiByte(CP_UTF8, 0, argv[2], -1, m, sizeof m, NULL, NULL); Mode = m; printf("mode %s (%d-bit)\n", m, (int)sizeof(void *) * 8);
 WNDCLASSW wc = {}; wc.lpfnWndProc = DefWindowProcW; wc.hInstance = GetModuleHandleW(NULL); wc.lpszClassName = L"GpuHideTest"; RegisterClassW(&wc);
 Win = CreateWindowExW(WS_EX_TOOLWINDOW, wc.lpszClassName, L"gpu hide test", WS_POPUP, -32000, -32000, W, H, NULL, NULL, wc.hInstance, NULL); // never shown
 if (Mode == "gdi") { DWORD *ab; AtlasDc = Dib(256, 256, &ab); for (int y = 0; y < 256; y++) for (int x = 0; x < 256; x++) { int cx = x % 32, cy = y % 32; ab[y * 256 + x] = (cx >= 4 && cx < 28 && cy >= 4 && cy < 28) ? 0xFFFFFF : 0; } BackDc = Dib(W, H, &BackBits); }
 else if (Mode == "d3d11") { if (!Init11()) { printf("SKIP no Direct3D11 device on this machine\n"); return 0; } }
 else {
  IDirect3D9 *d = Direct3DCreate9(D3D_SDK_VERSION); D3DPRESENT_PARAMETERS pp = {}; pp.Windowed = TRUE; pp.SwapEffect = D3DSWAPEFFECT_DISCARD; pp.hDeviceWindow = Win; pp.BackBufferWidth = W; pp.BackBufferHeight = H; pp.BackBufferFormat = D3DFMT_X8R8G8B8;
  if (!d || FAILED(d->CreateDevice(D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, Win, D3DCREATE_SOFTWARE_VERTEXPROCESSING, &pp, &Dev))) { printf("SKIP no Direct3D9 device on this machine (CI runner without a display adapter)\n"); return 0; }
  Atlas = MakeTex(256, true); Scene = MakeTex(64, false);
  Dev->CreateVertexBuffer(64 * 6 * sizeof(V), D3DUSAGE_DYNAMIC | D3DUSAGE_WRITEONLY, 0, D3DPOOL_DEFAULT, &Vb, NULL); Dev->CreateIndexBuffer(64 * 6 * 2, D3DUSAGE_DYNAMIC | D3DUSAGE_WRITEONLY, D3DFMT_INDEX16, D3DPOOL_DEFAULT, &Ib, NULL);
  Dev->SetSamplerState(0, D3DSAMP_MINFILTER, D3DTEXF_POINT); Dev->SetSamplerState(0, D3DSAMP_MAGFILTER, D3DTEXF_POINT);
 }
 Frame(0, nullptr);
 // HookBridge's side of both pipes
 wchar_t name[64]; swprintf_s(name, L"\\\\.\\pipe\\MeguLitGpu-%lu", GetCurrentProcessId()); HANDLE rep = CreateNamedPipeW(name, PIPE_ACCESS_INBOUND, PIPE_TYPE_BYTE | PIPE_WAIT, 1, 0, 65536, 0, NULL);
 swprintf_s(name, L"\\\\.\\pipe\\MeguLitGpuCtl-%lu", GetCurrentProcessId()); Ctl = CreateNamedPipeW(name, PIPE_ACCESS_OUTBOUND, PIPE_TYPE_BYTE | PIPE_WAIT, 1, 65536, 0, 0, NULL);
 std::thread([rep] { ConnectNamedPipe(rep, NULL); std::string buf; char b[4096]; DWORD got; while (ReadFile(rep, b, sizeof b, &got, NULL) && got) { buf.append(b, got); size_t at; while ((at = buf.find('\n')) != std::string::npos) { std::string l = buf.substr(0, at); buf.erase(0, at + 1); printf("  < %s\n", l.c_str()); std::lock_guard<std::mutex> g(Mu); Reports.push_back(l); } } }).detach();
 std::atomic<bool> ctlUp(false); std::thread([&] { ConnectNamedPipe(Ctl, NULL); ctlUp = true; }).detach();
 if (!LoadLibraryW(argv[1])) { printf("FAIL cannot load %ls (%lu)\n", argv[1], GetLastError()); return 1; }
 Check(WaitFor(Mode == "gdi" ? "status gdi hooked=6" : Mode == "d3d11" ? "status d3d11 hooked" : "status d3d9 hooked", 0, 400), "DLL hooked the API after the device existed");
 for (int i = 0; i < 200 && !ctlUp; i++) Frame(0, nullptr); Check(ctlUp, "control pipe connected");
 Pixels(0, true, "before any line");
 // 1. learn
 SendCtl(u8"LINE 吾輩は猫である。");
 std::string r; Check(WaitFor("ToMe_GPUHIDE learn", 0, 60, &r), "line 1: text area learned"); Check(WaitFor("ToMe_CHARS engine=gpu line=1 hidden=0", 0, 30, &r) && RectsOk(r), "line 1: 8 rects at the drawn places, hidden=0");
 Check(WaitFor("ToMe_CHARS engine=gpu line=1 hidden=1", 0, 30), "line 1: hidden from the frame after it was learned"); Pixels(0, false, "line 1 (after learning)");
 // 2. hide
 SendCtl(u8"LINE 前は　まだ無い。！");
 Check(WaitFor("ToMe_GPUHIDE hit seq=2", 8, 30), "line 2: hit reported"); Check(WaitFor("ToMe_CHARS engine=gpu line=2 hidden=1", 8, 30, &r) && RectsOk(r), "line 2: hidden=1 with 8 rects at the drawn places");
 Pixels(8, false, "line 2 (hidden)");
 // 3. off
 SendCtl("OFF"); for (int i = 0; i < 3; i++) Frame(16, nullptr); Pixels(16, true, "after OFF");
 SendCtl("QUIT"); printf(Fails ? "RESULT FAIL %d\n" : "RESULT PASS\n", Fails); fflush(stdout); TerminateProcess(GetCurrentProcess(), Fails ? 1 : 0); return Fails ? 1 : 0;
}
