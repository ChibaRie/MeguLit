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
| 4 | "Fake GPU": glyph quads of Direct3D 9 / 11 and OpenGL draws and glyph blits of GDI software renderers | `native/gpuhide` (MeguLitGpu32/64.dll), `native/GpuHideLayer.cs` | `ToMe_GPUHIDE hit` |

## Layer 4: fake GPU (`MeguLitGpu32.dll`, `MeguLitGpu64.dll`)

For engines that rasterise their own text and draw it from a glyph atlas: bitmap font sheets, glyph textures, Unity
non-TMP `UI.Text`, Live2D-style engines, software renderers that copy glyph cells with `BitBlt`. They never ask Windows
for a glyph, so layer 3 sees nothing.

### How it hides

- **Loaded by HookBridge** into the bound game (same loader and `HookInjector` allowlist as the font probe), 32- and
  64-bit. It changes nothing in the game folder.
- **Direct3D 9.** Windows 10/11 give every device its own copy of the interface table, so the functions those tables
  point at (inside `d3d9.dll`, shared by all devices) are hooked in place with MinHook, found through throwaway devices
  created in the game process through the **system** `d3d9.dll` only (a game may ship its own wrapper `d3d9.dll` that keeps
  the device in globals: WHITE ALBUM2 crashed at its first scene when the throwaway devices went through it) (software / hardware / pure / mixed vertex processing, with and without
  `D3DCREATE_MULTITHREADED`). This also covers devices created before the DLL arrived. Hooked: `Present`, `Reset`,
  `SetRenderTarget`, `SetTransform`, `SetViewport`, `SetTexture`, `SetFVF`, `SetVertexDeclaration`, `SetVertexShader`,
  `SetStreamSource`, `SetIndices`, `IDirect3DSwapChain9::Present`, the four `Draw*Primitive*` calls, and `Lock` / `Unlock` of vertex and index buffers
  (read-only shadow copies of what the game wrote, taken at `Unlock`).
- **Direct3D 11.** `D3D11CreateDeviceAndSwapChain` in the game's own `d3d11.dll` (never imported by the DLL, so a
  Direct3D 9 game does not load it) gives the functions behind `ID3D11DeviceContext::Draw` / `DrawIndexed` / `Map` /
  `Unmap` / `UpdateSubresource`, `ID3D11Device::CreateInputLayout` and `IDXGISwapChain::Present`, hooked in place. The
  pipeline state of each draw is read with the context's own getters (so state set before the DLL arrived counts);
  vertex / index data from read-only shadows taken at `Unmap` / `UpdateSubresource`. Position and texture coordinate
  come from the input layout; a layout made before the DLL arrived is guessed (position float2 at offset 0, texture
  coordinate float2 in the last 8 bytes of the stride) and only ever acts through the count match. Shaders decide the
  real transform: positions that all lie in [-1, 1] are read as normalised device coordinates through the viewport,
  others as pixels. Triangle lists and single-quad strips.
- **OpenGL.** `glDrawArrays` / `glDrawElements` (opengl32) and `SwapBuffers` (gdi32) are hooked in place; the DLL never
  imports opengl32.dll (GL 1.1 calls go through pointers from the game's own copy). Buffer functions come from the driver
  (`wglGetProcAddress`), so on the first draw, in the game's render thread, `glBufferData` / `glBufferSubData` /
  `glMapBuffer(Range)` / `glUnmapBuffer` (and ARB names) are resolved and hooked for read-only shadows. Each draw is read
  with GL's getters: with a GLSL program, the active attribute whose name contains "pos" (vec2–vec4) and the one with
  "tex" / "uv" / "coord" (vec2); fixed function, the vertex and texture-coordinate arrays through projection × modelview.
  Texture: `GL_TEXTURE_BINDING_2D` and its level-0 size; target: the bound framebuffer object (0 = the window). GL's y
  axis points up: NDC positions are flipped through the viewport.
- **GDI blits.** `BitBlt`, `StretchBlt`, `GdiTransparentBlt`, `GdiAlphaBlend`, `StretchDIBits`, `SetDIBitsToDevice`. The
  source bitmap (or DIB memory) is the atlas, the destination bitmap the render target; a back-buffer bitmap copied to
  the window maps its glyphs to the screen.
- **Vertex declarations and shaders (D3D9).** The declaration's `POSITION` / `POSITIONT` and `TEXCOORD0` of stream 0 are
  read with `GetDeclaration` when it is set. With a vertex shader the transform is the shader's: positions that all lie in
  [-1, 1] are read as normalised device coordinates through the viewport, others as pixels.
- **Quads.** Every draw is split into quads (triangle lists: two triangles each; strips / fans of two triangles), with
  the screen rectangle (pre-transformed `XYZRHW` / `POSITIONT`, `XYZ` through world × view × projection and the viewport,
  or shader positions as above) and the texture-coordinate rectangle. Unknown layouts are not decoded: nothing is hidden there.
- **Glyph-like quad:** 4–160 px each way, aspect within 1:5, a cell of a sheet (at most half of a texture of at least
  32 × 32, at most 1/24 of a texture bigger than 256 × 256), drawn at 0.4–6 × its texel size.
- **Learning (read-only).** HookBridge pushes each line of the selected stream (`LINE <text>`). Per (render target, atlas)
  the DLL counts distinct glyph positions in the last frame and glyph keys (position + atlas cell) first drawn since the
  line started; offset copies (shadow, outline) closer than 40 % of the glyph height are one character; the largest row
  cluster is kept (names and menus elsewhere fall out). When a count equals the line's non-blank characters, the text
  area (the cluster's box, grown by one glyph height up / left, 8 to the right, 2 down) and the atlases that drew inside
  it are learned. Glyphs of one line drawn from several atlas pages are counted together per render target; offset copies
  are merged only when closer than 40 % of the glyph's own width (adjacent narrow digits stay two characters). Learning
  hides nothing.
- **Hiding.** From the next frame on, while a line is armed (60 s after the last `LINE`, until `OFF` or the control pipe
  closes), glyph-like quads whose centre lies inside the text area are left out when they come from a learned atlas,
  or (engines that build a small glyph sheet for every line, a new texture each line) when they have the learned glyph
  height (±25 %) on a render target of the learned size (effect buffers that draw the line twice): the draw call
  is re-issued for the other quads only (sub-ranges of the same buffers; nothing is written to any game buffer or
  texture), or a blit is simply not made. Menus, names and anything outside the area are never touched. If the DLL is
  unsure (no learned area, undecodable draw), it does not hide.
- **Rectangles for the compositor.** Whenever the glyph count of the current line matches its characters, the DLL sends
  one `ToMe_CHARS engine=gpu` record (`docs/text-architecture.md`, ③ record): one rectangle per non-blank character in
  reading order, in back-buffer pixels, `hidden=1` once the line's glyphs are being left out.

### Crash canary

Layer 4 must never crash a game. HookBridge keeps `data/gpu-hide/<exe>-<size>.json` per game build (the key of the stream
memory): before the DLL is loaded the file is armed with the game's pid, and a bridge thread waits for the game to end.
An exit by an exception (exit code `0xC0000000` and up: access violation, stack overflow, ...) while the layer was loaded
turns layer 4 **off** for that game (`off`, `reason`); every later launch skips the DLL and emits
`{"type":"hookGpuHide","state":"off","reason":...}`. Any other exit clears the arm. A run whose end the bridge did not see
(MeguLit closed first) is only logged. Turning the layer on again is the user's call: `GpuCanaryReset()`;
`GpuCanaryOff()` returns the reason (empty = allowed).

### Protocol

Report pipe `\\.\pipe\MeguLitGpu-<pid>` (DLL → HookBridge, UTF-8 lines):

```
ToMe_GPUHIDE ready version=1 apis=d3d9,d3d11,opengl,gdi
ToMe_GPUHIDE status gdi hooked=6 | status d3d9 hooked gdi=6 | status d3d11 hooked | status opengl hooked | status no d3d gdi=6
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
| `string[] GpuCapabilities()` | APIs the DLL can hook (`d3d9`, `d3d11`, `opengl`, `gdi`); empty until the DLL reported `ready`. |
| `void GpuArm(string streamId, string line)` | Hide that line of that stream from now on (60 s, renewed by every call). Learns first; never hides when unsure. |
| `void GpuDisarm()` | Stop hiding at once (`OFF`). |
| `void GpuReadOnly(bool on)` | Learn and report rectangles only. |
| `string GpuCanaryOff()` / `void GpuCanaryReset()` | Why the canary turned the layer off for the bound game (empty = allowed) / turn it on again (user's call). |
| `event Action<string,int,int,int> GpuHit` | First hidden draw of a line: stream, line number, quads left out, characters. |

Today HookBridge arms it by itself for the streams layer 3 serves (selected stream without write-back, replacement on or
probing; `GlyphLine` → `GpuLine`, `GlyphOff` → `GpuDisarm`). The orchestrator can take that over.

### Self-test

`native/gpuhide/selftest/run.cmd [dll folder]`: x86 and x64 hosts render a scene quad, a 3-glyph name and an
8-glyph line from one atlas through Direct3D 9 (`DrawPrimitiveUP`; a dynamic vertex buffer through an orthographic
projection; indexed buffers), Direct3D 11 (NDC positions, `Map` / `Unmap`, an input layout made before the DLL loads),
OpenGL (a GLSL program fed by `glBufferData`; fixed function with client arrays and `glOrtho`, both into a framebuffer
object) and through GDI (`BitBlt` from an atlas DIB into a back-buffer DIB, then to the window),
load the DLL after the device exists, and act as HookBridge over the real pipes. Asserted: learning reports the text
area and 8 rectangles at the drawn places with `hidden=0`; from then on the 8 glyphs are left out (pixels), the name
and the scene unchanged, `hit` and `ToMe_CHARS hidden=1` with the same rectangles for the next line; after `OFF` the
line is drawn again. Built and run by `Build.ps1` and CI through `native/native-builds.json` (marker
`MeguLitGpu version=1`, checked by `tools/native-stale.cjs` and `Release.ps1`).

### Live checks (2026-11-14)

- **STEINS;GATE 0 (MAGES, D3D9, Steam): works** (8- and 18-character lines, rectangles, `hidden=1`). The ring-shaped wait
  cursor is a cell of the font atlas at glyph height, so it is hidden with the line.
- **Aoi Tori (CMVS / Purple software, D3D11, Steam English): works.** It draws a blank glyph quad for every space except
  one where the line wraps; the learner walks the line in reading order and drops the blank positions (21 characters,
  24 quads). Its text box is a 9-slice of 28 × 28 tiles from a UI atlas under the text: the first build learned that atlas
  and hid the frame. Now an atlas is learned only when ≥ 60 % of its quads in the area line up with a glyph, groups are
  per texture (two atlases of the same size never mix), per-line sheets must be new and line-sized (not powers of two),
  and only quads of the learned glyph height (± 20 %) are hidden. Frame, corners, cursor and top bar stay.
- eden* (minori, D3D9): presents through `IDirect3DSwapChain9::Present` (now hooked as a frame tick too); its text is
  inside 256-pixel layer tiles, no glyph draws: not hidden.
- Not run: Summer Pockets REFLECTION BLUE (the 64-bit exe exits; the game is SiglusEngine_Steam.exe, Siglus has other
  paths), Danganronpa 1 / 2 (OpenGL: this layer has no OpenGL side yet).

- **CHAOS;CHILD (MAGES, 32-bit, Direct3D 9, Steam): works.** DXT5 atlas pages of 3072 × 4096 and 3072 × 1536, one
  `DrawPrimitiveUP` triangle fan per character, vertex declaration + vertex shader. With the visible page pushed (32
  characters, half-width digits included): `learn` 32 = 32, `ToMe_CHARS hidden=0` with 32 rectangles
  (`360,326,34,34;392,326,34,34;424,326,26,34;…`), `hit`, `hidden=1`; all text gone, the scene and the wait cursor kept;
  after `OFF` the game draws the page again at once.
- WHITE ALBUM2 (Leaf, 32-bit, Direct3D 9): the first build crashed it at the first scene (throwaway devices made through
  the game's own wrapper `d3d9.dll`); fixed (system `d3d9.dll` only), the game then runs normally with the layer loaded.
  The engine draws each line as 128 × 40 tiles of a pre-rendered line texture (like FVP), so nothing is hidden there.
- ダストマニア (BRUNS) and the "transparent font sheet at load time" idea: not done, because it cannot be generic or safe.
  The sheets are encrypted (`EENZ`), so serving a changed file means decoding an engine format; the decoded sheet in
  memory is the engine's own data, and blanking its cells changes game data (the rule this layer exists to keep), for
  every use of the font at once (names, choices, backlog, menus), for the whole run (no per-line arm / disarm), and which
  cell is which character is engine knowledge. Character rectangles are not observable either: the engine copies glyph
  pixels with plain CPU code into its frame buffer, with no API call per character. It needs an engine-level path.

- **みにくいモジカの子 (Nitro+, 32-bit, Direct3D 11): works.** The engine builds a small glyph sheet for each line
  (e.g. 76 × 88 for 「いたい。」) and draws one quad per character, twice (an effect buffer and the 1280 × 720
  composition target). With the line pushed: `learn` (4 glyphs = 4 characters), `ToMe_CHARS engine=gpu hidden=0`, then
  `hit` and `ToMe_CHARS hidden=1` with `rects=572,310,34,40;606,310,34,40;640,310,34,40;674,310,34,40`; the line is gone
  from the frame, the scene stays, and after `OFF` (or 60 s without a push) the game draws it again at once. Tested on
  the opening lines (centred text); the ADV text window was not reached in this run.

- ダストマニア・グロテスク（BRUNS, 32-bit, Direct3D 9）: the DLL hooks the game's device (all draws seen), but the
  engine composes the whole frame (background, characters, text window, glyphs) on the CPU into one 1024 × 1024 texture
  and draws one full-screen quad per frame. No glyph ever reaches Direct3D or GDI as its own draw, so this layer cannot
  hide it. It needs the engine's own path (the LunaHook BRUNS `push_back` hook, or a hook on the engine's glyph copy).
- いろとりどりのヒカリHD (FVP, 32-bit, Direct3D 9, Chinese patch): hooked, all draws seen (into a 2048 × 2048 render
  target, then composited). FVP rasterises each whole line on the CPU into one image and draws it as 256 × 256 tile
  quads (4 quads for one line, the glow box included), so there are no per-glyph quads either. A "line texture" mode
  (hide the tile quads that appeared with the line in the text band) would be the next step for this family; it is
  not built because it cannot tell text tiles from other new tiles as safely as glyph quads.
- Not covered yet: Direct3D 12, OpenGL vertex array objects bound before the DLL arrived with buffers never written again (same learner, `GlyphQuads.h`, needs the API side), Direct3D 9 vertex shaders /
  declarations, Direct3D 11 instanced / indirect draws, engines that bake the whole text into one texture per line (one quad per line, not per glyph).
