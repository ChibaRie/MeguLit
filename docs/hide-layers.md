# Hide layers

MeguLit draws the game's dialogue itself (owner, 2026-11-14). For that the game must stop drawing the current line,
without any change to the game's logic or data: WA2 (Leaf) crashed when its whole memory string was blanked, because
the string carries control codes, name variables and voice ids. Each layer below hides at a different place; the hide
orchestrator (`feat/hide-orchestrator`) picks one per game. Every layer switches a stream to hide-only only after the
game side confirmed a hidden draw (a "hit").

| Layer | Where | Code | Hit report |
|-------|-------|------|------------|
| 1 | Write-back embed through LunaHook (blank or translated text written into the engine's buffer) | `native/megulithook`, LunaHook embed hooks | engine embed callback |
| 2 | Engine-specific DLLs (KiriKiri, Ren'Py, ...) | `native/krkrtext`, `native/renpytext`, `native/MeguLitRenpy.py` | `ToMe_CHARS hidden=1` |
| 3 | Windows glyph layer: GDI / GDI+ / Direct2D glyphs and strings (E578, E667) | `native/megulithook/MeguLitGdiHide.h`, `native/fontprobe` | `MeguLit_GDIHIDE hit`, `ToMe_GLYPHHIDE hit` |
| 4 | "Fake GPU": glyph quads of Direct3D 9 draws and glyph blits of GDI software renderers | `native/gpuhide` (MeguLitGpu32/64.dll), `native/GpuHideLayer.cs` | `ToMe_GPUHIDE hit` |

## Layer 4: fake GPU (`MeguLitGpu32.dll`, `MeguLitGpu64.dll`)

For engines that rasterise their own text and draw it from a glyph atlas: bitmap font sheets, glyph textures, Unity
non-TMP `UI.Text`, Live2D-style engines, software renderers that copy glyph cells with `BitBlt`. They never ask Windows
for a glyph, so layer 3 sees nothing.

### How it hides

- **Loaded by HookBridge** into the bound game (same loader and `HookInjector` allowlist as the font probe), 32- and
  64-bit. It changes nothing in the game folder.
- **Direct3D 9.** Windows 10/11 give every device its own copy of the interface table, so the functions those tables
  point at (inside `d3d9.dll`, shared by all devices) are hooked in place with MinHook, found through throwaway devices
  created in the game process (software / hardware / pure / mixed vertex processing, with and without
  `D3DCREATE_MULTITHREADED`). This also covers devices created before the DLL arrived. Hooked: `Present`, `Reset`,
  `SetRenderTarget`, `SetTransform`, `SetViewport`, `SetTexture`, `SetFVF`, `SetVertexDeclaration`, `SetVertexShader`,
  `SetStreamSource`, `SetIndices`, the four `Draw*Primitive*` calls, and `Lock` / `Unlock` of vertex and index buffers
  (read-only shadow copies of what the game wrote, taken at `Unlock`).
- **GDI blits.** `BitBlt`, `StretchBlt`, `GdiTransparentBlt`, `GdiAlphaBlend`, `StretchDIBits`, `SetDIBitsToDevice`. The
  source bitmap (or DIB memory) is the atlas, the destination bitmap the render target; a back-buffer bitmap copied to
  the window maps its glyphs to the screen.
- **Quads.** Every draw is split into quads (triangle lists: two triangles each; strips / fans of two triangles), with
  the screen rectangle (pre-transformed `XYZRHW`, or `XYZ` through world × view × projection and the viewport) and the
  texture-coordinate rectangle. Vertex shaders, declarations and unknown layouts are not decoded: nothing is hidden there.
- **Glyph-like quad:** 4–160 px each way, aspect within 1:5, a sub-rectangle of at most 1/24 of a texture of at least
  64 × 64, drawn at 0.4–6 × its texel size.
- **Learning (read-only).** HookBridge pushes each line of the selected stream (`LINE <text>`). Per (render target, atlas)
  the DLL counts distinct glyph positions in the last frame and glyph keys (position + atlas cell) first drawn since the
  line started; offset copies (shadow, outline) closer than 40 % of the glyph height are one character; the largest row
  cluster is kept (names and menus elsewhere fall out). When a count equals the line's non-blank characters, the text
  area (the cluster's box, grown by one glyph height up / left, 8 to the right, 2 down) and the atlases that drew inside
  it are learned. Learning hides nothing.
- **Hiding.** From the next frame on, while a line is armed (60 s after the last `LINE`, until `OFF` or the control pipe
  closes), glyph-like quads from the learned atlases whose centre lies inside the text area are left out: the draw call
  is re-issued for the other quads only (sub-ranges of the same buffers; nothing is written to any game buffer or
  texture), or a blit is simply not made. Menus, names and anything outside the area are never touched. If the DLL is
  unsure (no learned area, undecodable draw), it does not hide.
- **Rectangles for the compositor.** Whenever the glyph count of the current line matches its characters, the DLL sends
  one `ToMe_CHARS engine=gpu` record (`docs/text-architecture.md`, ③ record): one rectangle per non-blank character in
  reading order, in back-buffer pixels, `hidden=1` once the line's glyphs are being left out.

### Protocol

Report pipe `\\.\pipe\MeguLitGpu-<pid>` (DLL → HookBridge, UTF-8 lines):

```
ToMe_GPUHIDE ready version=1 apis=d3d9,gdi
ToMe_GPUHIDE status gdi hooked=6 | status d3d9 hooked gdi=6 | status no d3d9 gdi=6
ToMe_GPUHIDE learn seq=N area=x,y,w,h atlas=WxH glyphs=K chars=C atlases=A
ToMe_GPUHIDE hit seq=N quads=Q chars=C
ToMe_CHARS engine=gpu line=N hidden=0|1 sw=W sh=H vx=0 vy=0 vw=W vh=H n=K rects=x,y,w,h;... text=<line without blanks>
```

Control pipe `\\.\pipe\MeguLitGpuCtl-<pid>` (HookBridge → DLL): `LINE <text>`, `OFF`, `MODE read` (learn and report
rectangles, never hide), `MODE hide` (default), `QUIT`.

HookBridge events (stdout JSON): `{"type":"hookGpuHide","state":"ready|learn|hit",...}` and `ToMe_CHARS` passed on as
`{"type":"hookChars","line":"ToMe_CHARS ..."}` (the ③ transport). A hit on the selected stream marks it hide-only through
the same path as the GDI hide (`GdiHideHit`).

### Interface for the orchestrator (`native/GpuHideLayer.cs`, partial class `HookBridge`)

| Member | Meaning |
|--------|---------|
| `string[] GpuCapabilities()` | APIs hooked in this game (`d3d9`, `gdi`); empty until the DLL reported `ready`. |
| `void GpuArm(string streamId, string line)` | Hide that line of that stream from now on (60 s, renewed by every call). Learns first; never hides when unsure. |
| `void GpuDisarm()` | Stop hiding at once (`OFF`). |
| `void GpuReadOnly(bool on)` | Learn and report rectangles only. |
| `event Action<string,int,int,int> GpuHit` | First hidden draw of a line: stream, line number, quads left out, characters. |

Today HookBridge arms it by itself for the streams layer 3 serves (selected stream without write-back, replacement on or
probing; `GlyphLine` → `GpuLine`, `GlyphOff` → `GpuDisarm`). The orchestrator can take that over.

### Self-test

`native/gpuhide/selftest/run.cmd [dll folder]`: x86 and x64 hosts render a scene quad, a 3-glyph name and an
8-glyph line from one atlas through Direct3D 9 (`DrawPrimitiveUP`; a dynamic vertex buffer through an orthographic
projection; indexed buffers) and through GDI (`BitBlt` from an atlas DIB into a back-buffer DIB, then to the window),
load the DLL after the device exists, and act as HookBridge over the real pipes. Asserted: learning reports the text
area and 8 rectangles at the drawn places with `hidden=0`; from then on the 8 glyphs are left out (pixels), the name
and the scene unchanged, `hit` and `ToMe_CHARS hidden=1` with the same rectangles for the next line; after `OFF` the
line is drawn again. Built and run by `Build.ps1` and CI through `native/native-builds.json` (marker
`MeguLitGpu version=1`, checked by `tools/native-stale.cjs` and `Release.ps1`).

### Live checks (2026-11-14)

- ダストマニア・グロテスク（BRUNS, 32-bit, Direct3D 9）: the DLL hooks the game's device (all draws seen), but the
  engine composes the whole frame (background, characters, text window, glyphs) on the CPU into one 1024 × 1024 texture
  and draws one full-screen quad per frame. No glyph ever reaches Direct3D or GDI as its own draw, so this layer cannot
  hide it. It needs the engine's own path (the LunaHook BRUNS `push_back` hook, or a hook on the engine's glyph copy).
- いろとりどりのヒカリHD (FVP, 32-bit, Direct3D 9, Chinese patch): hooked, all draws seen (into a 2048 × 2048 render
  target, then composited). FVP rasterises each whole line on the CPU into one image and draws it as 256 × 256 tile
  quads (4 quads for one line, the glow box included), so there are no per-glyph quads either. A "line texture" mode
  (hide the tile quads that appeared with the line in the text band) would be the next step for this family; it is
  not built because it cannot tell text tiles from other new tiles as safely as glyph quads.
- Not covered yet: Direct3D 11 / DXGI and OpenGL (same learner, `GlyphQuads.h`, needs the API side), vertex shaders /
  declarations, engines that bake the whole text into one texture per line (one quad per line, not per glyph).
