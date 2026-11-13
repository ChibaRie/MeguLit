// SPDX-License-Identifier: GPL-3.0-or-later
// MeguLitGpu32/64.dll: hide layer 4, the "fake GPU" (docs/hide-layers.md, owner 2026-11-14: MeguLit draws all game text).
// For engines that draw their dialogue from bitmap font atlases through Direct3D 9 (glyph textures, prerendered font
// sheets such as BRUNS' font\ff_*.bmp) and never ask Windows for a glyph. Loaded by HookBridge into the bound game.
//
//  - The device and buffer interface tables are found with throwaway devices created inside the game's own d3d9.dll,
//    and only their entries are swapped (vtable patch); every hook calls the game's original function. No game memory,
//    file, buffer or texture is ever written: hiding a glyph means the draw call is issued for the other quads only.
//  - Glyph quads: textured quads, small on screen and a small sub-rectangle of a larger texture (an atlas), laid out in
//    rows. Vertex data comes from DrawPrimitiveUP / DrawIndexedPrimitiveUP or from shadows of the game's own vertex and
//    index buffers taken at Unlock (read-only copies).
//  - Lines: HookBridge pushes the dialogue line its text hook read (LINE <text>) over \\.\pipe\MeguLitGpuCtl-<pid>.
//    The DLL learns where the line is drawn (the text area: a row cluster of glyph quads from one atlas whose count
//    matches the line's characters) without hiding anything; only after that it hides glyph quads of the learned atlas
//    inside the learned text area while a line is armed (60 s after the last LINE, until OFF). Menus, names and
//    anything outside the text area are never touched. Unsure (no match yet, shaders, unknown vertex layout) = no hide.
//  - Reports over \\.\pipe\MeguLitGpu-<pid> (UTF-8 lines):
//      ToMe_GPUHIDE ready version=1 apis=d3d9,gdi
//      ToMe_GPUHIDE learn seq=N area=x,y,w,h atlas=WxH glyphs=K chars=C        (text area learned, read-only)
//      ToMe_GPUHIDE hit seq=N quads=Q chars=C                                   (first hidden draw of a line)
//      ToMe_CHARS engine=gpu line=N hidden=0|1 sw=W sh=H vx=0 vy=0 vw=W vh=H n=K rects=x,y,w,h;... text=<line>
//    Rectangles are in back-buffer pixels, one per non-blank character of the line in reading order (rows top to bottom,
//    left to right), only when the number of glyph positions equals the number of characters.
//  - Control lines: LINE <text>, OFF, MODE hide|read (read = learn and report rectangles, never hide), QUIT.
//  - Diagnostics: a file MeguLitGpu.diag next to the DLL whose first line is a log path turns on a draw log.
#include <windows.h>
#include <d3d9.h>
#include <stdio.h>
#include <share.h>
#include <stdarg.h>
#include <string>
#include <vector>
#include <deque>
#include <map>
#include <algorithm>
#include <cmath>
#include "GlyphQuads.h"
#include "../scncapture/minhook/include/MinHook.h"

static CRITICAL_SECTION Lock;
struct Guard { Guard() { EnterCriticalSection(&Lock); } ~Guard() { LeaveCriticalSection(&Lock); } };
static FILE *Diag; static long DiagBytes;
static std::deque<std::string> Outbox; static HANDLE OutEvent;
static volatile bool Quit;

static void Log(const char *fmt, ...) {
 if (!Diag) return; char b[2048]; va_list a; va_start(a, fmt); int n = _vsnprintf_s(b, sizeof b, _TRUNCATE, fmt, a); va_end(a);
 if (n < 0) n = (int)strlen(b); if (DiagBytes > 40 * 1024 * 1024) return; DiagBytes += n + 1; fputs(b, Diag); fputc('\n', Diag); fflush(Diag);
}
static void Send(const std::string &line) { { Guard g; if (Outbox.size() < 512) Outbox.push_back(line); } Log("SEND %s", line.c_str()); SetEvent(OutEvent); }
static std::string Utf8(const std::wstring &w) { if (w.empty()) return ""; int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), NULL, 0, NULL, NULL); std::string s(n, 0); WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, NULL, NULL); return s; }

// --------------------------------------------------------------------------------------------------------------- hooks
// Windows 10/11 d3d9 gives every device its own copy of the interface table (on the heap), so patching a throwaway
// device's table would miss the game's device. The functions those tables point at live in d3d9.dll and are shared by
// every device, so they are hooked in place (MinHook). One thunk per (slot, target): the multithreaded device classes
// use their own wrappers for a few methods. The thunk hands the hook its own trampoline (CurOrig) before anything else.
static __declspec(thread) void *CurOrig;
#define ORIG(T, self, slot) ((T)CurOrig)
template <int S, int K, typename F> struct Thunk;
template <int S, int K, typename R, typename... A> struct Thunk<S, K, R(WINAPI *)(A...)> {
 static void *tramp; static R(WINAPI *hook)(A...);
 static R WINAPI Run(A... a) { CurOrig = tramp; return hook(a...); }
};
template <int S, int K, typename R, typename... A> void *Thunk<S, K, R(WINAPI *)(A...)>::tramp;
template <int S, int K, typename R, typename... A> R(WINAPI *Thunk<S, K, R(WINAPI *)(A...)>::hook)(A...);
static std::map<int, std::vector<void *>> Hooked; static int HookCount;
template <int S, int K, typename F> static bool Inst(void *target, F hook) {
 typedef Thunk<S, K, F> T; T::hook = hook; if (MH_CreateHook(target, (void *)&T::Run, &T::tramp) != MH_OK) return false; if (MH_EnableHook(target) != MH_OK) return false; HookCount++; return true;
}
template <int S, typename F> static void Hook(void *target, F hook) {
 if (!target) return; auto &v = Hooked[S]; for (void *t : v) if (t == target) return; if (v.size() >= 4) return;
 bool ok = false; switch (v.size()) { case 0: ok = Inst<S, 0>(target, hook); break; case 1: ok = Inst<S, 1>(target, hook); break; case 2: ok = Inst<S, 2>(target, hook); break; default: ok = Inst<S, 3>(target, hook); }
 if (ok) v.push_back(target);
}
// ----------------------------------------------------------------------------------------------------------- device state
struct Shadow { std::vector<unsigned char> data; unsigned stride; bool i32; };
static std::map<void *, Shadow> Buffers; // vertex and index buffer shadows (read-only copies taken at Unlock)
struct PendingLock { void *buf; UINT off, size; void *ptr; };
static std::vector<PendingLock> Pending;
struct TexInfo { UINT w, h; D3DFORMAT fmt; bool rt; };
static std::map<void *, TexInfo> Textures;
struct Dev {
 IDirect3DDevice9 *d; void *tex0; void *rtTex; UINT rtW, rtH; void *vb; UINT vbOff, vbStride; void *ib; DWORD fvf; bool decl, vs;
 D3DMATRIX m[3]; bool mSet[3]; D3DVIEWPORT9 vp; UINT bbW, bbH; bool rtIsBack;
};
static Dev Devs[4]; static int DevCount;
static Dev *DevOf(IDirect3DDevice9 *d) {
 for (int i = 0; i < DevCount; i++) if (Devs[i].d == d) return &Devs[i];
 int i = DevCount < 4 ? DevCount++ : 3; Dev &v = Devs[i]; memset(&v, 0, sizeof v); v.d = d; v.rtIsBack = true;
 for (int k = 0; k < 3; k++) { memset(&v.m[k], 0, sizeof(D3DMATRIX)); v.m[k]._11 = v.m[k]._22 = v.m[k]._33 = v.m[k]._44 = 1; }
 IDirect3DSurface9 *bb = NULL; if (SUCCEEDED(d->GetBackBuffer(0, 0, D3DBACKBUFFER_TYPE_MONO, &bb)) && bb) {
  D3DSURFACE_DESC sd; if (SUCCEEDED(bb->GetDesc(&sd))) { v.bbW = v.rtW = sd.Width; v.bbH = v.rtH = sd.Height; v.vp.Width = sd.Width; v.vp.Height = sd.Height; v.vp.MaxZ = 1; } bb->Release(); }
 return &v;
}

// ------------------------------------------------------------------------------------------------------------ line state
static GlyphLearner Learner;
static unsigned Frame, LastPresent;

// --------------------------------------------------------------------------------------------------------- vertex decode
static bool PosLayout(DWORD fvf, unsigned &posSize, bool &rhw, unsigned &uvOff, unsigned &stride) {
 DWORD pos = fvf & D3DFVF_POSITION_MASK; if (pos == D3DFVF_XYZRHW) { posSize = 16; rhw = true; } else if (pos == D3DFVF_XYZ) { posSize = 12; rhw = false; } else return false;
 unsigned o = posSize; if (fvf & D3DFVF_NORMAL) o += 12; if (fvf & D3DFVF_PSIZE) o += 4; if (fvf & D3DFVF_DIFFUSE) o += 4; if (fvf & D3DFVF_SPECULAR) o += 4;
 unsigned tc = (fvf & D3DFVF_TEXCOUNT_MASK) >> D3DFVF_TEXCOUNT_SHIFT; if (tc < 1) return false; uvOff = o;
 unsigned s = o; for (unsigned i = 0; i < tc; i++) { unsigned f = (fvf >> (16 + i * 2)) & 3; s += f == 0 ? 8 : f == 1 ? 12 : f == 2 ? 16 : 4; }
 if (((fvf >> 16) & 3) == 3) return false; // 1D texture coordinates
 stride = s; return true;
}
static void Project(Dev &v, const float *p, bool rhw, float &sx, float &sy) {
 if (rhw) { sx = p[0]; sy = p[1]; return; }
 float in[4] = { p[0], p[1], p[2], 1 }, t[4];
 for (int k = 0; k < 3; k++) { const float *m = &v.m[k]._11; for (int c = 0; c < 4; c++) t[c] = in[0] * m[c] + in[1] * m[4 + c] + in[2] * m[8 + c] + in[3] * m[12 + c]; memcpy(in, t, sizeof t); }
 float w = in[3] != 0 ? in[3] : 1; sx = v.vp.X + (in[0] / w + 1) * 0.5f * v.vp.Width; sy = v.vp.Y + (1 - in[1] / w) * 0.5f * v.vp.Height;
}
// Turns one draw into quads (two triangles each). Vertex fetch: vtx(i) -> pointer to vertex i of the draw.
template <class F> static bool Quads(Dev &v, D3DPRIMITIVETYPE pt, UINT prims, F vtx, std::vector<Quad> &out) {
 unsigned posSize, uvOff, stride; bool rhw; if (v.decl || v.vs || !PosLayout(v.fvf, posSize, rhw, uvOff, stride)) return false;
 if (!rhw && !(v.mSet[2])) return false; // transforms set before we arrived: positions unknown
 auto corner = [&](UINT i, float &x, float &y, float &u, float &w) -> bool { const unsigned char *p = vtx(i); if (!p) return false; Project(v, (const float *)p, rhw, x, y); u = ((const float *)(p + uvOff))[0]; w = ((const float *)(p + uvOff))[1]; return std::isfinite(x) && std::isfinite(y); };
 auto quad = [&](UINT a, UINT n, UINT first) -> bool {
  Quad q; q.x0 = q.y0 = q.u0 = q.v0 = 1e30f; q.x1 = q.y1 = q.u1 = q.v1 = -1e30f; q.first = first;
  for (UINT i = 0; i < n; i++) { float x, y, u, w; if (!corner(a + i, x, y, u, w)) return false; q.x0 = (std::min)(q.x0, x); q.y0 = (std::min)(q.y0, y); q.x1 = (std::max)(q.x1, x); q.y1 = (std::max)(q.y1, y); q.u0 = (std::min)(q.u0, u); q.v0 = (std::min)(q.v0, w); q.u1 = (std::max)(q.u1, u); q.v1 = (std::max)(q.v1, w); }
  out.push_back(q); return true; };
 if (pt == D3DPT_TRIANGLELIST) { if (prims % 2) return false; for (UINT t = 0; t < prims; t += 2) if (!quad(t * 3, 6, t)) return false; return true; }
 if ((pt == D3DPT_TRIANGLESTRIP || pt == D3DPT_TRIANGLEFAN) && prims == 2) return quad(0, 4, 0);
 return false;
}

// ----------------------------------------------------------------------------------------------------------- draw hooks
typedef HRESULT(WINAPI *DrawP)(IDirect3DDevice9 *, D3DPRIMITIVETYPE, UINT, UINT);
typedef HRESULT(WINAPI *DrawIP)(IDirect3DDevice9 *, D3DPRIMITIVETYPE, INT, UINT, UINT, UINT, UINT);
typedef HRESULT(WINAPI *DrawUP)(IDirect3DDevice9 *, D3DPRIMITIVETYPE, UINT, const void *, UINT);
typedef HRESULT(WINAPI *DrawIUP)(IDirect3DDevice9 *, D3DPRIMITIVETYPE, UINT, UINT, UINT, const void *, D3DFORMAT, const void *, UINT);

static TexInfo TexOf(void *t) { auto it = Textures.find(t); if (it != Textures.end()) return it->second; TexInfo i = { 0, 0, D3DFMT_UNKNOWN, false }; return i; }
static void DiagDraw(Dev &v, const char *kind, D3DPRIMITIVETYPE pt, UINT prims, const std::vector<Quad> &q, bool decoded) {
 if (!Diag) return; bool full = Frame % 30 == 0; int glyphs = 0; TexInfo ti = TexOf(v.tex0);
 for (auto &x : q) if (GlyphLike(x, ti.w, ti.h)) glyphs++;
 if (!full && glyphs == 0) return;
 char b[1600]; int n = _snprintf_s(b, sizeof b, _TRUNCATE, "F%u %s rt=%p(%ux%u%s) tex=%p(%ux%u f%d%s) pt=%d n=%u fvf=%lx%s%s q=%u g=%d", Frame, kind, v.rtTex, v.rtW, v.rtH, v.rtIsBack ? " back" : "", v.tex0, ti.w, ti.h, (int)ti.fmt, ti.rt ? " rt" : "", (int)pt, prims, v.fvf, v.decl ? " decl" : "", v.vs ? " vs" : "", (unsigned)q.size(), glyphs);
 if (!decoded) n += _snprintf_s(b + n, sizeof b - n, _TRUNCATE, " undecoded");
 for (size_t i = 0; i < q.size() && i < 8 && n < 1400; i++) n += _snprintf_s(b + n, sizeof b - n, _TRUNCATE, " [%.0f,%.0f %.0fx%.0f uv %.3f,%.3f %.3fx%.3f]", q[i].x0, q[i].y0, q[i].x1 - q[i].x0, q[i].y1 - q[i].y0, q[i].u0, q[i].v0, q[i].u1 - q[i].u0, q[i].v1 - q[i].v0);
 Log("%s", b);
}
// Decides per quad; returns the quads to leave out (indices into q). Empty = draw as is.
static std::vector<int> Decide(Dev &v, std::vector<Quad> &q) {
 TexInfo ti = TexOf(v.tex0); std::vector<int> drop;
 if (!v.tex0 || ti.w == 0) return drop;
 if (v.rtIsBack && ti.rt) { Learner.Composite(v.tex0, q); return drop; }
 return Learner.Draw(v.tex0, ti.w, ti.h, v.rtIsBack ? NULL : v.rtTex, v.rtW, v.rtH, v.bbW, v.bbH, q, GetTickCount());
}
static HRESULT WINAPI HDrawPrimitive(IDirect3DDevice9 *d, D3DPRIMITIVETYPE pt, UINT start, UINT prims) {
 DrawP o = ORIG(DrawP, d, 81); std::vector<int> drop; std::vector<Quad> q;
 { Guard g; Dev &v = *DevOf(d); auto it = Buffers.find(v.vb); bool ok = false;
  if (it != Buffers.end() && v.vbStride) { const Shadow &s = it->second; ok = Quads(v, pt, prims, [&](UINT i) -> const unsigned char * { size_t at = v.vbOff + (size_t)(start + i) * v.vbStride; return at + v.vbStride <= s.data.size() ? &s.data[at] : NULL; }, q); }
  if (Diag) DiagDraw(v, "DP", pt, prims, q, ok); if (ok) drop = Decide(v, q); }
 if (drop.empty()) return o(d, pt, start, prims);
 // Issue the kept quads as runs of the original draw (triangle lists only: 2 primitives = 6 vertices per quad).
 HRESULT hr = D3D_OK; size_t k = 0; UINT qn = (UINT)q.size(); UINT i = 0;
 while (i < qn) { if (k < drop.size() && (UINT)drop[k] == i) { k++; i++; continue; } UINT j = i; while (j < qn && !(k < drop.size() && (UINT)drop[k] == j)) j++; hr = o(d, pt, start + i * 6, (j - i) * 2); i = j; }
 return hr;
}
static HRESULT WINAPI HDrawIndexedPrimitive(IDirect3DDevice9 *d, D3DPRIMITIVETYPE pt, INT base, UINT minIdx, UINT nv, UINT startIdx, UINT prims) {
 DrawIP o = ORIG(DrawIP, d, 82); std::vector<int> drop; std::vector<Quad> q;
 { Guard g; Dev &v = *DevOf(d); auto vb = Buffers.find(v.vb), ib = Buffers.find(v.ib); bool ok = false;
  if (vb != Buffers.end() && ib != Buffers.end() && v.vbStride) { const Shadow &s = vb->second, &x = ib->second;
   ok = Quads(v, pt, prims, [&](UINT i) -> const unsigned char * { size_t ia = (size_t)(startIdx + i) * (x.i32 ? 4 : 2); if (ia + (x.i32 ? 4 : 2) > x.data.size()) return NULL; UINT idx = x.i32 ? *(const UINT *)&x.data[ia] : *(const USHORT *)&x.data[ia]; size_t at = v.vbOff + ((size_t)base + idx) * v.vbStride; return at + v.vbStride <= s.data.size() ? &s.data[at] : NULL; }, q); }
  if (Diag) DiagDraw(v, "DIP", pt, prims, q, ok); if (ok) drop = Decide(v, q); }
 if (drop.empty()) return o(d, pt, base, minIdx, nv, startIdx, prims);
 HRESULT hr = D3D_OK; size_t k = 0; UINT qn = (UINT)q.size(); UINT i = 0;
 while (i < qn) { if (k < drop.size() && (UINT)drop[k] == i) { k++; i++; continue; } UINT j = i; while (j < qn && !(k < drop.size() && (UINT)drop[k] == j)) j++; hr = o(d, pt, base, minIdx, nv, startIdx + i * 6, (j - i) * 2); i = j; }
 return hr;
}
static HRESULT WINAPI HDrawPrimitiveUP(IDirect3DDevice9 *d, D3DPRIMITIVETYPE pt, UINT prims, const void *data, UINT stride) {
 DrawUP o = ORIG(DrawUP, d, 83); std::vector<int> drop; std::vector<Quad> q; const unsigned char *b = (const unsigned char *)data;
 { Guard g; Dev &v = *DevOf(d); UINT verts = pt == D3DPT_TRIANGLELIST ? prims * 3 : prims + 2; bool ok = false;
  if (data && stride) { unsigned ps, uo, st; bool rhw; if (PosLayout(v.fvf, ps, rhw, uo, st) && st <= stride) ok = Quads(v, pt, prims, [&](UINT i) -> const unsigned char * { return i < verts ? b + (size_t)i * stride : NULL; }, q); }
  if (Diag) DiagDraw(v, "UP", pt, prims, q, ok); if (ok) drop = Decide(v, q); }
 if (drop.empty()) return o(d, pt, prims, data, stride);
 if (pt != D3DPT_TRIANGLELIST) return D3D_OK; // the single quad of a strip/fan is the dropped one
 HRESULT hr = D3D_OK; size_t k = 0; UINT qn = (UINT)q.size(); UINT i = 0;
 while (i < qn) { if (k < drop.size() && (UINT)drop[k] == i) { k++; i++; continue; } UINT j = i; while (j < qn && !(k < drop.size() && (UINT)drop[k] == j)) j++; hr = o(d, pt, (j - i) * 2, b + (size_t)i * 6 * stride, stride); i = j; }
 return hr;
}
static HRESULT WINAPI HDrawIndexedPrimitiveUP(IDirect3DDevice9 *d, D3DPRIMITIVETYPE pt, UINT minIdx, UINT nv, UINT prims, const void *idx, D3DFORMAT fmt, const void *data, UINT stride) {
 DrawIUP o = ORIG(DrawIUP, d, 84); std::vector<int> drop; std::vector<Quad> q; const unsigned char *b = (const unsigned char *)data; bool i32 = fmt == D3DFMT_INDEX32;
 { Guard g; Dev &v = *DevOf(d); UINT n = pt == D3DPT_TRIANGLELIST ? prims * 3 : prims + 2; bool ok = false;
  if (data && idx && stride) { unsigned ps, uo, st; bool rhw; if (PosLayout(v.fvf, ps, rhw, uo, st) && st <= stride) ok = Quads(v, pt, prims, [&](UINT i) -> const unsigned char * { if (i >= n) return NULL; UINT k = i32 ? ((const UINT *)idx)[i] : ((const USHORT *)idx)[i]; return k < minIdx + nv ? b + (size_t)k * stride : NULL; }, q); }
  if (Diag) DiagDraw(v, "IUP", pt, prims, q, ok); if (ok) drop = Decide(v, q); }
 if (drop.empty()) return o(d, pt, minIdx, nv, prims, idx, fmt, data, stride);
 if (pt != D3DPT_TRIANGLELIST) return D3D_OK;
 HRESULT hr = D3D_OK; size_t k = 0; UINT qn = (UINT)q.size(); UINT i = 0; unsigned isz = i32 ? 4 : 2;
 while (i < qn) { if (k < drop.size() && (UINT)drop[k] == i) { k++; i++; continue; } UINT j = i; while (j < qn && !(k < drop.size() && (UINT)drop[k] == j)) j++; hr = o(d, pt, minIdx, nv, (j - i) * 2, (const unsigned char *)idx + (size_t)i * 6 * isz, fmt, data, stride); i = j; }
 return hr;
}

// ---------------------------------------------------------------------------------------------------------- state hooks
static void NoteTexture(void *t) {
 if (!t) return; IDirect3DBaseTexture9 *b = (IDirect3DBaseTexture9 *)t; TexInfo i = { 0, 0, D3DFMT_UNKNOWN, false };
 if (b->GetType() == D3DRTYPE_TEXTURE) { D3DSURFACE_DESC sd; if (SUCCEEDED(((IDirect3DTexture9 *)t)->GetLevelDesc(0, &sd))) { i.w = sd.Width; i.h = sd.Height; i.fmt = sd.Format; i.rt = (sd.Usage & D3DUSAGE_RENDERTARGET) != 0; } }
 Textures[t] = i; if (Textures.size() > 8192) Textures.clear();
}
static HRESULT WINAPI HSetTexture(IDirect3DDevice9 *d, DWORD stage, IDirect3DBaseTexture9 *t) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, DWORD, IDirect3DBaseTexture9 *), d, 65)(d, stage, t);
 if (stage == 0 && SUCCEEDED(hr)) { Guard g; DevOf(d)->tex0 = t; NoteTexture(t); } return hr;
}
static HRESULT WINAPI HSetRenderTarget(IDirect3DDevice9 *d, DWORD index, IDirect3DSurface9 *s) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, DWORD, IDirect3DSurface9 *), d, 37)(d, index, s);
 if (index == 0 && SUCCEEDED(hr) && s) { Guard g; Dev &v = *DevOf(d); D3DSURFACE_DESC sd; void *tex = NULL;
  if (SUCCEEDED(s->GetDesc(&sd))) { v.rtW = sd.Width; v.rtH = sd.Height; v.vp.X = v.vp.Y = 0; v.vp.Width = sd.Width; v.vp.Height = sd.Height; v.vp.MinZ = 0; v.vp.MaxZ = 1; }
  IDirect3DTexture9 *t = NULL; if (SUCCEEDED(s->GetContainer(__uuidof(IDirect3DTexture9), (void **)&t)) && t) { tex = t; t->Release(); }
  v.rtTex = tex; v.rtIsBack = tex == NULL; if (tex) NoteTexture(tex); }
 return hr;
}
static HRESULT WINAPI HSetStreamSource(IDirect3DDevice9 *d, UINT n, IDirect3DVertexBuffer9 *vb, UINT off, UINT stride) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, UINT, IDirect3DVertexBuffer9 *, UINT, UINT), d, 100)(d, n, vb, off, stride);
 if (n == 0 && SUCCEEDED(hr)) { Guard g; Dev &v = *DevOf(d); v.vb = vb; v.vbOff = off; v.vbStride = stride; } return hr;
}
static HRESULT WINAPI HSetIndices(IDirect3DDevice9 *d, IDirect3DIndexBuffer9 *ib) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, IDirect3DIndexBuffer9 *), d, 104)(d, ib); if (SUCCEEDED(hr)) { Guard g; DevOf(d)->ib = ib; } return hr;
}
static HRESULT WINAPI HSetFVF(IDirect3DDevice9 *d, DWORD fvf) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, DWORD), d, 89)(d, fvf); if (SUCCEEDED(hr)) { Guard g; Dev &v = *DevOf(d); v.fvf = fvf; v.decl = false; } return hr;
}
static HRESULT WINAPI HSetVertexDeclaration(IDirect3DDevice9 *d, IDirect3DVertexDeclaration9 *x) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, IDirect3DVertexDeclaration9 *), d, 87)(d, x); if (SUCCEEDED(hr)) { Guard g; Dev &v = *DevOf(d); v.decl = x != NULL; } return hr;
}
static HRESULT WINAPI HSetVertexShader(IDirect3DDevice9 *d, IDirect3DVertexShader9 *x) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, IDirect3DVertexShader9 *), d, 92)(d, x); if (SUCCEEDED(hr)) { Guard g; DevOf(d)->vs = x != NULL; } return hr;
}
static HRESULT WINAPI HSetTransform(IDirect3DDevice9 *d, D3DTRANSFORMSTATETYPE s, const D3DMATRIX *m) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, D3DTRANSFORMSTATETYPE, const D3DMATRIX *), d, 44)(d, s, m);
 if (SUCCEEDED(hr) && m) { int k = s == D3DTS_WORLD ? 0 : s == D3DTS_VIEW ? 1 : s == D3DTS_PROJECTION ? 2 : -1; if (k >= 0) { Guard g; Dev &v = *DevOf(d); v.m[k] = *m; v.mSet[k] = true; } } return hr;
}
static HRESULT WINAPI HSetViewport(IDirect3DDevice9 *d, const D3DVIEWPORT9 *p) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, const D3DVIEWPORT9 *), d, 47)(d, p); if (SUCCEEDED(hr) && p) { Guard g; DevOf(d)->vp = *p; } return hr;
}
static HRESULT WINAPI HPresent(IDirect3DDevice9 *d, const RECT *a, const RECT *b, HWND w, const RGNDATA *r) {
 auto o = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, const RECT *, const RECT *, HWND, const RGNDATA *), d, 17);
 { Guard g; Frame++; LastPresent = GetTickCount(); Dev &v = *DevOf(d); Learner.Frame(LastPresent, v.bbW, v.bbH); }
 return o(d, a, b, w, r);
}
static HRESULT WINAPI HReset(IDirect3DDevice9 *d, D3DPRESENT_PARAMETERS *p) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(IDirect3DDevice9 *, D3DPRESENT_PARAMETERS *), d, 16)(d, p);
 if (SUCCEEDED(hr) && p) { Guard g; Dev &v = *DevOf(d); v.bbW = v.rtW = p->BackBufferWidth; v.bbH = v.rtH = p->BackBufferHeight; v.rtTex = NULL; v.rtIsBack = true; v.vp.X = v.vp.Y = 0; v.vp.Width = v.bbW; v.vp.Height = v.bbH; v.vp.MaxZ = 1; Buffers.clear(); Textures.clear(); }
 return hr;
}
// Buffers: Lock records where the game writes, Unlock copies what it wrote into the shadow.
static HRESULT WINAPI HBufLock(void *buf, UINT off, UINT size, void **pp, DWORD flags) {
 HRESULT hr = ORIG(HRESULT(WINAPI *)(void *, UINT, UINT, void **, DWORD), buf, 11)(buf, off, size, pp, flags);
 if (SUCCEEDED(hr) && pp && *pp && !(flags & D3DLOCK_READONLY)) { Guard g; for (auto &p : Pending) if (p.buf == buf) { p = PendingLock{ buf, off, size, *pp }; return hr; } if (Pending.size() < 64) Pending.push_back(PendingLock{ buf, off, size, *pp }); }
 return hr;
}
static bool SafeCopy(void *to, const void *from, size_t n) { __try { memcpy(to, from, n); return true; } __except (EXCEPTION_EXECUTE_HANDLER) { return false; } }
static void Unlocked(void *buf, bool index) {
 Guard g; for (size_t i = 0; i < Pending.size(); i++) if (Pending[i].buf == buf) {
  PendingLock p = Pending[i]; Pending.erase(Pending.begin() + i); UINT total = 0; bool i32 = false;
  if (index) { D3DINDEXBUFFER_DESC dd; if (FAILED(((IDirect3DIndexBuffer9 *)buf)->GetDesc(&dd))) return; total = dd.Size; i32 = dd.Format == D3DFMT_INDEX32; }
  else { D3DVERTEXBUFFER_DESC dd; if (FAILED(((IDirect3DVertexBuffer9 *)buf)->GetDesc(&dd))) return; total = dd.Size; }
  if (total == 0 || total > 8 * 1024 * 1024) return; UINT size = p.size ? p.size : total - p.off; if (p.off >= total) return; if (p.off + size > total) size = total - p.off;
  Shadow &s = Buffers[buf]; if (s.data.size() != total) s.data.assign(total, 0); s.i32 = i32;
  if (!SafeCopy(&s.data[p.off], p.ptr, size)) Buffers.erase(buf);
  if (Buffers.size() > 4096) Buffers.clear(); return; }
}
static HRESULT WINAPI HVbUnlock(void *buf) { auto o = ORIG(HRESULT(WINAPI *)(void *), buf, 12); Unlocked(buf, false); return o(buf); }
static HRESULT WINAPI HIbUnlock(void *buf) { auto o = ORIG(HRESULT(WINAPI *)(void *), buf, 12); Unlocked(buf, true); return o(buf); }

// ------------------------------------------------------------------------------------------------------------- GDI blits
// Software engines that keep their font sheet in a bitmap and copy one glyph cell per character into a back-buffer
// bitmap (or straight into the window): BitBlt / StretchBlt / TransparentBlt / AlphaBlend from a memory DC, or
// StretchDIBits / SetDIBitsToDevice from a DIB in memory. The source bitmap is the "texture", the destination bitmap
// the "render target" (the window = the back buffer); a back-buffer bitmap copied to the window maps its glyphs to the
// screen. A dropped blit is simply not made (the call reports success).
static volatile LONG GdiSeen; static unsigned GdiW, GdiH;
static bool BitmapOf(HDC dc, void *&key, unsigned &w, unsigned &h) {
 HGDIOBJ b = GetCurrentObject(dc, OBJ_BITMAP); BITMAP bm; if (!b || GetObjectW(b, sizeof bm, &bm) != sizeof bm) return false; key = b; w = bm.bmWidth; h = bm.bmHeight < 0 ? -bm.bmHeight : bm.bmHeight; return w > 1 && h > 1;
}
static void *TargetOf(HDC dc, unsigned &w, unsigned &h) {
 HWND win = WindowFromDC(dc); if (win) { RECT r; GetClientRect(win, &r); w = r.right; h = r.bottom; GdiW = w; GdiH = h; return NULL; }
 void *k; if (!BitmapOf(dc, k, w, h)) { w = h = 0; return (void *)-1; } return k;
}
// One blit as a quad; returns true when it should be left out.
static bool GdiBlit(HDC dst, int x, int y, int w, int h, void *src, unsigned sw, unsigned sh, int sx, int sy, int sW, int sH) {
 if (w <= 0 || h <= 0 || !src || sw < 64 || sh < 64) return false;
 unsigned tw, th; void *rt = TargetOf(dst, tw, th); if (rt == (void *)-1) return false;
 POINT o = { 0, 0 }; if (!rt) GetViewportOrgEx(dst, &o);
 std::vector<Quad> q(1); Quad &x0 = q[0]; x0.x0 = (float)x + o.x; x0.y0 = (float)y + o.y; x0.x1 = x0.x0 + w; x0.y1 = x0.y0 + h; x0.u0 = (float)sx / sw; x0.v0 = (float)sy / sh; x0.u1 = (float)(sx + sW) / sw; x0.v1 = (float)(sy + sH) / sh; x0.first = 0;
 InterlockedExchange(&GdiSeen, 1);
 Guard g;
 if (!rt) { auto it = Textures.find(src); if (it != Textures.end() && it->second.rt) { Learner.Composite(src, q); return false; } }
 if (rt) { TexInfo ti = { tw, th, D3DFMT_UNKNOWN, true }; Textures[rt] = ti; }
 if (Diag && GlyphLike(x0, sw, sh)) Log("GDI blit dst=%p(%ux%u) src=%p(%ux%u) [%d,%d %dx%d from %d,%d %dx%d]", rt, tw, th, src, sw, sh, x, y, w, h, sx, sy, sW, sH);
 std::vector<int> drop = Learner.Draw(src, sw, sh, rt, tw, th, rt ? GdiW : tw, rt ? GdiH : th, q, GetTickCount());
 return !drop.empty();
}
typedef BOOL(WINAPI *BitBltF)(HDC, int, int, int, int, HDC, int, int, DWORD);
typedef BOOL(WINAPI *StretchBltF)(HDC, int, int, int, int, HDC, int, int, int, int, DWORD);
typedef BOOL(WINAPI *TransparentBltF)(HDC, int, int, int, int, HDC, int, int, int, int, UINT);
typedef BOOL(WINAPI *AlphaBlendF)(HDC, int, int, int, int, HDC, int, int, int, int, BLENDFUNCTION);
typedef int(WINAPI *StretchDIBitsF)(HDC, int, int, int, int, int, int, int, int, const void *, const BITMAPINFO *, UINT, DWORD);
typedef int(WINAPI *SetDIBitsToDeviceF)(HDC, int, int, DWORD, DWORD, int, int, UINT, UINT, const void *, const BITMAPINFO *, UINT);
static BitBltF OBitBlt; static StretchBltF OStretchBlt; static TransparentBltF OTransparentBlt; static AlphaBlendF OAlphaBlend; static StretchDIBitsF OStretchDIBits; static SetDIBitsToDeviceF OSetDIBitsToDevice;
static bool SrcBlit(HDC dst, int x, int y, int w, int h, HDC src, int sx, int sy, int sW, int sH) { void *k; unsigned sw, sh; if (!src || !BitmapOf(src, k, sw, sh)) return false; return GdiBlit(dst, x, y, w, h, k, sw, sh, sx, sy, sW, sH); }
static bool SrcRop(DWORD rop) { return rop == SRCCOPY || rop == SRCPAINT || rop == SRCAND || rop == SRCINVERT; }
static BOOL WINAPI HBitBlt(HDC d, int x, int y, int w, int h, HDC s, int sx, int sy, DWORD rop) { if (SrcRop(rop) && SrcBlit(d, x, y, w, h, s, sx, sy, w, h)) return TRUE; return OBitBlt(d, x, y, w, h, s, sx, sy, rop); }
static BOOL WINAPI HStretchBlt(HDC d, int x, int y, int w, int h, HDC s, int sx, int sy, int sw, int sh, DWORD rop) { if (SrcRop(rop) && SrcBlit(d, x, y, w, h, s, sx, sy, sw, sh)) return TRUE; return OStretchBlt(d, x, y, w, h, s, sx, sy, sw, sh, rop); }
static BOOL WINAPI HTransparentBlt(HDC d, int x, int y, int w, int h, HDC s, int sx, int sy, int sw, int sh, UINT key) { if (SrcBlit(d, x, y, w, h, s, sx, sy, sw, sh)) return TRUE; return OTransparentBlt(d, x, y, w, h, s, sx, sy, sw, sh, key); }
static BOOL WINAPI HAlphaBlend(HDC d, int x, int y, int w, int h, HDC s, int sx, int sy, int sw, int sh, BLENDFUNCTION f) { if (SrcBlit(d, x, y, w, h, s, sx, sy, sw, sh)) return TRUE; return OAlphaBlend(d, x, y, w, h, s, sx, sy, sw, sh, f); }
static unsigned DibH(const BITMAPINFO *b) { return b ? (unsigned)(b->bmiHeader.biHeight < 0 ? -b->bmiHeader.biHeight : b->bmiHeader.biHeight) : 0; }
static int WINAPI HStretchDIBits(HDC d, int x, int y, int w, int h, int sx, int sy, int sw, int sh, const void *bits, const BITMAPINFO *b, UINT u, DWORD rop) {
 if (b && bits && SrcRop(rop)) { unsigned bh = DibH(b); int top = b->bmiHeader.biHeight > 0 ? (int)bh - sy - sh : sy; if (GdiBlit(d, x, y, w, h, (void *)bits, (unsigned)b->bmiHeader.biWidth, bh, sx, top, sw, sh)) return sh; }
 return OStretchDIBits(d, x, y, w, h, sx, sy, sw, sh, bits, b, u, rop);
}
static int WINAPI HSetDIBitsToDevice(HDC d, int x, int y, DWORD w, DWORD h, int sx, int sy, UINT start, UINT lines, const void *bits, const BITMAPINFO *b, UINT u) {
 if (b && bits && start == 0 && lines >= DibH(b)) { unsigned bh = DibH(b); int top = b->bmiHeader.biHeight > 0 ? (int)bh - sy - (int)h : sy; if (GdiBlit(d, x, y, (int)w, (int)h, (void *)bits, (unsigned)b->bmiHeader.biWidth, bh, sx, top, (int)w, (int)h)) return (int)lines; }
 return OSetDIBitsToDevice(d, x, y, w, h, sx, sy, start, lines, bits, b, u);
}
static int InstallGdi() {
 int n = 0; HMODULE g = GetModuleHandleW(L"gdi32.dll"); if (!g) return 0;
 auto h = [&](const char *name, void *hook, void **orig) { void *t = GetProcAddress(g, name); if (t && MH_CreateHook(t, hook, orig) == MH_OK && MH_EnableHook(t) == MH_OK) n++; };
 h("BitBlt", (void *)HBitBlt, (void **)&OBitBlt); h("StretchBlt", (void *)HStretchBlt, (void **)&OStretchBlt); h("GdiTransparentBlt", (void *)HTransparentBlt, (void **)&OTransparentBlt); h("GdiAlphaBlend", (void *)HAlphaBlend, (void **)&OAlphaBlend);
 h("StretchDIBits", (void *)HStretchDIBits, (void **)&OStretchDIBits); h("SetDIBitsToDevice", (void *)HSetDIBitsToDevice, (void **)&OSetDIBitsToDevice);
 return n;
}
// GDI engines have no Present: a frame is whatever was drawn in the last 33 ms.
static DWORD WINAPI GdiTicker(void *) { while (!Quit) { Sleep(33); if (!GdiSeen) continue; unsigned now = GetTickCount(); Guard g; if (now - LastPresent > 300) Learner.Frame(now, GdiW, GdiH); } return 0; }
// ------------------------------------------------------------------------------------------------------------- install
static LRESULT CALLBACK DummyProc(HWND h, UINT m, WPARAM w, LPARAM l) { return DefWindowProcW(h, m, w, l); }
static int Install(HMODULE d3d9) {
 typedef IDirect3D9 *(WINAPI *Create9)(UINT); Create9 create = (Create9)GetProcAddress(d3d9, "Direct3DCreate9"); if (!create) return 0;
 WNDCLASSW wc = {}; wc.lpfnWndProc = DummyProc; wc.hInstance = GetModuleHandleW(NULL); wc.lpszClassName = L"MeguLitGpuDummy"; RegisterClassW(&wc);
 HWND w = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, wc.lpszClassName, L"", WS_POPUP, -32000, -32000, 8, 8, NULL, NULL, wc.hInstance, NULL); if (!w) return 0;
 IDirect3D9 *d = create(D3D_SDK_VERSION); int devices = 0;
 if (d) {
  // Software, hardware, pure and mixed vertex processing, each with and without D3DCREATE_MULTITHREADED, use their own
  // device classes (the multithreaded ones wrap every call in a lock).
  DWORD flagsList[] = { D3DCREATE_SOFTWARE_VERTEXPROCESSING, D3DCREATE_HARDWARE_VERTEXPROCESSING, D3DCREATE_HARDWARE_VERTEXPROCESSING | D3DCREATE_PUREDEVICE, D3DCREATE_MIXED_VERTEXPROCESSING };
  for (int mt = 0; mt < 2; mt++) for (DWORD flags : flagsList) {
   D3DPRESENT_PARAMETERS pp = {}; pp.Windowed = TRUE; pp.SwapEffect = D3DSWAPEFFECT_DISCARD; pp.hDeviceWindow = w; pp.BackBufferWidth = 8; pp.BackBufferHeight = 8; pp.BackBufferFormat = D3DFMT_UNKNOWN;
   IDirect3DDevice9 *dev = NULL; if (FAILED(d->CreateDevice(D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, w, flags | (mt ? D3DCREATE_MULTITHREADED : 0), &pp, &dev)) || !dev) continue;
   devices++; void **vt = *(void ***)dev;
   Hook<16>(vt[16], HReset); Hook<17>(vt[17], HPresent); Hook<37>(vt[37], HSetRenderTarget); Hook<44>(vt[44], HSetTransform); Hook<47>(vt[47], HSetViewport);
   Hook<65>(vt[65], HSetTexture); Hook<81>(vt[81], HDrawPrimitive); Hook<82>(vt[82], HDrawIndexedPrimitive); Hook<83>(vt[83], HDrawPrimitiveUP); Hook<84>(vt[84], HDrawIndexedPrimitiveUP);
   Hook<87>(vt[87], HSetVertexDeclaration); Hook<89>(vt[89], HSetFVF); Hook<92>(vt[92], HSetVertexShader); Hook<100>(vt[100], HSetStreamSource); Hook<104>(vt[104], HSetIndices);
   struct { UINT usage; D3DPOOL pool; } kinds[] = { { D3DUSAGE_DYNAMIC | D3DUSAGE_WRITEONLY, D3DPOOL_DEFAULT }, { D3DUSAGE_WRITEONLY, D3DPOOL_DEFAULT }, { 0, D3DPOOL_MANAGED }, { 0, D3DPOOL_SYSTEMMEM }, { D3DUSAGE_DYNAMIC, D3DPOOL_DEFAULT } };
   for (auto &k : kinds) {
    IDirect3DVertexBuffer9 *vb = NULL; if (SUCCEEDED(dev->CreateVertexBuffer(96, k.usage, D3DFVF_XYZRHW | D3DFVF_TEX1, k.pool, &vb, NULL)) && vb) { void **bt = *(void ***)vb; Hook<211>(bt[11], HBufLock); Hook<212>(bt[12], HVbUnlock); vb->Release(); }
    IDirect3DIndexBuffer9 *ib = NULL; if (SUCCEEDED(dev->CreateIndexBuffer(96, k.usage, D3DFMT_INDEX16, k.pool, &ib, NULL)) && ib) { void **bt = *(void ***)ib; Hook<311>(bt[11], HBufLock); Hook<312>(bt[12], HIbUnlock); ib->Release(); }
   }
   dev->Release();
  }
  d->Release();
 }
 DestroyWindow(w); UnregisterClassW(wc.lpszClassName, wc.hInstance);
 return devices;
}

// --------------------------------------------------------------------------------------------------------------- pipes
static DWORD WINAPI Sender(void *) {
 wchar_t name[64]; swprintf_s(name, L"\\\\.\\pipe\\MeguLitGpu-%lu", GetCurrentProcessId()); HANDLE pipe = INVALID_HANDLE_VALUE;
 while (!Quit) {
  WaitForSingleObject(OutEvent, 1000);
  if (pipe == INVALID_HANDLE_VALUE) { pipe = CreateFileW(name, GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL); if (pipe == INVALID_HANDLE_VALUE) continue; Send("ToMe_GPUHIDE ready version=1 apis=d3d9,gdi"); }
  for (;;) { std::string s; { Guard g; if (Outbox.empty()) break; s = Outbox.front(); Outbox.pop_front(); } s += "\n"; DWORD done; if (!WriteFile(pipe, s.data(), (DWORD)s.size(), &done, NULL)) { CloseHandle(pipe); pipe = INVALID_HANDLE_VALUE; break; } }
 }
 return 0;
}
static void Command(const std::string &line) {
 Log("CTL %s", line.c_str());
 if (line.compare(0, 5, "LINE ") == 0) { int n = MultiByteToWideChar(CP_UTF8, 0, line.c_str() + 5, -1, NULL, 0); std::wstring w(n > 0 ? n - 1 : 0, 0); if (n > 1) MultiByteToWideChar(CP_UTF8, 0, line.c_str() + 5, -1, &w[0], n); Guard g; Learner.Line(w, GetTickCount()); }
 else if (line == "OFF") { Guard g; Learner.Off(); }
 else if (line == "MODE read") { Guard g; Learner.readOnly = true; } else if (line == "MODE hide") { Guard g; Learner.readOnly = false; }
}
static DWORD WINAPI Control(void *) {
 wchar_t name[64]; swprintf_s(name, L"\\\\.\\pipe\\MeguLitGpuCtl-%lu", GetCurrentProcessId());
 while (!Quit) {
  HANDLE p = CreateFileW(name, GENERIC_READ, 0, NULL, OPEN_EXISTING, 0, NULL); if (p == INVALID_HANDLE_VALUE) { Sleep(1000); continue; }
  std::string buf; char b[4096]; DWORD got;
  while (ReadFile(p, b, sizeof b, &got, NULL) && got) { buf.append(b, got); size_t at; while ((at = buf.find('\n')) != std::string::npos) { std::string l = buf.substr(0, at); buf.erase(0, at + 1); if (!l.empty() && l.back() == '\r') l.pop_back(); if (l == "QUIT") { CloseHandle(p); return 0; } Command(l); } }
  CloseHandle(p); { Guard g; Learner.Off(); } // MeguLit gone: stop hiding at once
 }
 return 0;
}
static void Emit(const std::string &s) { Send(s); }
static DWORD WINAPI Start(void *module) {
 wchar_t path[MAX_PATH]; GetModuleFileNameW((HMODULE)module, path, MAX_PATH); wchar_t *slash = wcsrchr(path, L'\\'); if (slash) wcscpy_s(slash + 1, MAX_PATH - (slash + 1 - path), L"MeguLitGpu.diag");
 FILE *f = NULL; if (_wfopen_s(&f, path, L"r, ccs=UTF-8") == 0 && f) { wchar_t log[MAX_PATH] = {}; if (fgetws(log, MAX_PATH, f)) { size_t n = wcslen(log); while (n && (log[n - 1] == L'\n' || log[n - 1] == L'\r' || log[n - 1] == L' ')) log[--n] = 0; wchar_t full[MAX_PATH]; swprintf_s(full, L"%s.%lu.log", log, GetCurrentProcessId()); Diag = _wfsopen(full, L"w", _SH_DENYNO); } fclose(f); }
 Learner.emit = Emit; Learner.log = Diag ? Log : NULL;
 CreateThread(NULL, 0, Sender, NULL, 0, NULL); CreateThread(NULL, 0, Control, NULL, 0, NULL);
 MH_Initialize(); int gdi = InstallGdi(); CreateThread(NULL, 0, GdiTicker, NULL, 0, NULL); Log("installed gdi hooks=%d", gdi); Send("ToMe_GPUHIDE status gdi hooked=" + std::to_string(gdi));
 // Wait for the game's d3d9.dll (games often load it after their first window), then hook it once.
 for (int i = 0; i < 600 && !Quit; i++) { HMODULE d = GetModuleHandleW(L"d3d9.dll"); if (d) { int n = Install(d); n = n && HookCount >= 15 ? n : 0; Log("installed d3d9 devices=%d hooks=%d", n, HookCount); Send(std::string(n ? "ToMe_GPUHIDE status d3d9 hooked gdi=" : "ToMe_GPUHIDE status d3d9 no device gdi=") + std::to_string(gdi)); return 0; } Sleep(500); }
 Send("ToMe_GPUHIDE status no d3d9 gdi=" + std::to_string(gdi)); return 0;
}
BOOL WINAPI DllMain(HINSTANCE h, DWORD reason, void *) {
 if (reason == DLL_PROCESS_ATTACH) {
  DisableThreadLibraryCalls(h); HMODULE pin; GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN, (LPCWSTR)&DllMain, &pin);
  InitializeCriticalSection(&Lock); OutEvent = CreateEventW(NULL, FALSE, FALSE, NULL); CreateThread(NULL, 0, Start, h, 0, NULL);
 }
 return TRUE;
}
// Marker for tools/native-stale.cjs: MeguLitGpu version=1
extern "C" __declspec(dllexport) const char *MeguLitGpuVersion() { return "MeguLitGpu version=1"; }
