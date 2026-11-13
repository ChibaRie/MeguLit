# ② Capture compositor

Part ② of the text architecture (`docs/text-architecture.md`, owner 2026-11-14: MeguLit draws all game text itself).
Part ① (`feat/glyph-dots`) makes the game draw a 3 px dot instead of each glyph of the current line, with the original
metrics. ② captures the game window, finds those dots, erases them, draws MeguLit's own text in their place and
presents the result in MeguLit's own window over the game. This file is ②'s section; it follows ①'s **dot spec 1**.

| Piece | Code |
|-------|------|
| Compositor (capture, track, erase, draw, present, input) | `native/compositor/Compositor.cpp` → `native/MeguLitCompositor.exe` (x64, one build for 32- and 64-bit games) |
| Dot finding / tracking / inpainting (portable C++, no Windows types) | `native/compositor/DotFinder.h` |
| Forced borderless fullscreen | `native/borderless/Borderless.cpp` → `MeguLitBorderless32/64.dll`, `Launch.cpp` → `MeguLitLaunch32/64.exe` |
| MeguLit side (spawn, ① events → commands, events back) | `services/capture-compositor.cjs` (not wired into `runtime.cjs` yet) |
| Tests | `native/compositor/selftest/DotSelfTest.cpp`, `selftest/replay.cjs` + `FramePlayer.cpp`, `native/borderless/selftest/bltest.cpp`, `validation/capture-compositor.test.cjs` |

## Pipeline (one game frame)

1. **Capture** — Windows.Graphics.Capture of the game HWND, as Magpie v0.13 does it (`GraphicsCaptureFrameSource`):
   item from the window (retry with `WS_EX_APPWINDOW` for windows outside Alt+Tab, e.g. owned by a zero-size window),
   free-threaded frame pool, `IsCursorCaptureEnabled(false)`, `IsBorderRequired(false)` (no yellow border on Win11),
   `MinUpdateInterval(1 ms)`; the client area is cut out of the frame with the extended frame bounds. Always the latest
   frame (older ones are dropped).
2. **Read back** the client area (one staging copy) and run `DotTracker::Update` on it (CPU, SSE2 colour scan).
3. **Erase** every dot of the current line, of kept NVL lines and of matched choices: the erase box grows over the dot's
   shadow/outline copies (`EraseBox`), then `PatchInpaint` copies a same-sized patch from right next to it, shifted by
   an even amount so 2-pixel dithers keep their phase (exact on flat, dithered and regular textures); when no neighbour
   matches, a distance-weighted bilinear fill from the box border. Only the changed rectangles go back to the GPU.
4. **Compose** — 1:1 copy (overlay mode) or Magpie's Lanczos (scale mode, `Effects/Lanczos.hlsl` as plain HLSL), then
   Direct2D/DirectWrite text on the same D3D11 device and texture.
5. **Present** — flip-discard swap chain, frame latency 1, tearing allowed when supported.

### Why Direct2D/DirectWrite in the compositor, not an offscreen WebView2

WebView2 has no offscreen rendering API: its pixels only reach a texture through a DirectComposition visual (composed
by Chromium's own compositor on its own clock, at least one frame later and never in step with the captured frame) or
through `CapturePreview` (PNG encode, tens of ms). Text that must appear in the same frame as the erased dots (no
blank frame, no doubled text) has to be drawn on the frame itself. D2D on the capture device does that in
0.3–1 ms. The reader's typesetting is reused where it belongs: its settings (fonts, colours, furigana on/off, mode,
translation placement) come in as `style`; its translation and furigana as `annotate`; the geometry — where each glyph
goes — comes from the game itself (① metrics + dot positions), which the web reader never knew.

Measured on the owner's PC (Windows 11 24H2, this branch):

| | 800×600 game, 1:1 | 800×600 → 1440×1080 Lanczos | 1920×1080 game, 1:1 |
|---|---|---|---|
| processing per frame (capture → present), median / p95 | 2.9 / 3.5 ms | 2.9 / 3.6 ms | 6.4 / 7.7 ms |
| added latency (capture time → Present returned), mean / p95 | 3.4 / 4.9 ms | 3.7 / 5.0 ms | 8.6 / 11.9 ms |
| tracking alone | 0.7 ms | 0.7 ms | 3.1 ms |

So ≥ 130 fps of headroom at 1080p and < 1 frame (16.7 ms) added at 60 Hz. The replay source ran at ~31 fps (its own
GDI blit); a live 800×600 DirectDraw game delivered 58 fps through the same path.

## Dot finding (`DotFinder.h`)

- **Shape** (spec 1): solid squares of side 3 (2 under 12 px cells), clipped to the glyph's black box (3×1, 1×3 …),
  never antialiased. Larger dot-shaped blobs (≤ 14 px, ≥ 75 % filled) are accepted too, for games that scale their own
  frame.
- **Colour**: the hook may report it; otherwise it is learned: dot-shaped plateaus in the region that changed since
  the previous frame (a typewriter dot appearing; static UI never qualifies), at most 8 candidate colours per frame,
  each checked with a full-frame colour scan — it wins when equal-sized dots of it line up at one pitch. Colours that
  give > 200 dot-shaped blobs (dither, noise) are textures, not text.
- **Tracking**, every frame, whole frame (≈ 0.6 ms colour scan at 1080p, SSE2): blobs of the text colour → dots;
  1-px-thin ones only next to a full dot; `Isolated` rejects fragments of real glyphs (nothing else in the text colour
  within 7 px — a dakuten or a stroke tip always has its glyph next to it; works also when the game scales its frame and
  the dot loses its hard edge, as Siglus does); a lone dot or pair away from the line's cluster (click-wait animation)
  is dropped; `Static` drops dot-like things already present, unchanged, in the frame from before
  the line message (a UI "・" or "…" in the text colour) unless they continue the line's own rows.
- **Mapping with ① reports**: when ① reported which characters became dots (`glyphs`, k d/c), dot *k* in reading
  order is character *k* of the reported span, extended over glyphs the game took from its cache (a dot with no new
  report — ① doc) inside, after, then before the span. This also copes with streams that carry more than the game
  shows (Siglus: variable names before the line). Complete = the span is covered; more dots than can be placed =
  mismatch → undot.
- **Reading order**: rows clustered at 0.75 pitch (black-box tops vary by up to ~0.7 em inside a row: 。、ー sit low),
  left→right; vertical text: columns right→left, top→bottom. Dot *i* in order = character *i* of ①'s blank-stripped
  text.
- **Typewriter**: dots appear one by one; the status is `revealing` until the count equals the expected count
  (`complete`). **Fades**: fewer full-colour dots than before → alpha read at the known places
  (projection of pixel − background on text − background); fade-in → alpha against the frame before the line.
  **Shake / scroll**: the whole frame is searched every frame, so any movement is followed.
- **NVL vs ADV**: the previous line is kept (NVL) only if ≥ 90 % of its dots stay and the first dot on a new place is
  not right after its last dot on the same row; a new ADV line drawn over the old places (the box-clear frame may never
  be seen: the line message can overtake the frame) is told apart that way, or by the counts once the reveal stops.
- **Choices**: `ChoiceTracker` searches every known colour, learns the highlight colour from the region that changed
  (hover), splits the dots into runs and assigns runs to menu items by their dot counts (an item may wrap); the item
  whose colour differs from the rest is the highlighted one.

## Drawing

- **Japanese**: each glyph on the game's own cell: with ①'s metrics (`h b a x y`) the cell's top-left is the dot's
  top-left − (x, y) and the baseline is cell top + b — exactly the game's; the glyph is centred in the advance. Without
  metrics: the row's highest dot ≈ cell top + 0.06 em. Colour = each dot's own colour (coloured names stay coloured),
  alpha = the dot's alpha (fades follow the game), light shadow.
- **Furigana**: centred over the span's cells once the whole span is shown (indices into ①'s text; the bridge re-indexes
  the reader's spans).
- **Translation beside the text** (owner rule: beside, not inside the game's box): above the measured text area (below
  if there is no room), on a soft plate, once the line is complete.
- **Translation only**: Chinese in the Japanese's area at the game's font size, wrapped inside the measured area (the
  page's text area; for the first line: the start cell to the projected end of the line), the game's line spacing,
  revealed in step with the game (share of dots shown → share of characters shown).
- **Choices**: one box per item; Japanese on its cells and the translation under it, or the translation alone centred
  in the box; the highlighted item keeps the game's highlight colour and gets a border.
- **Look-up**: the window is click-through (`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE`, never focused, so
  keyboard and mouse go to the game). A `WH_MOUSE_LL` hook on its own thread takes only left clicks on MeguLit's glyph
  cells (game client coordinates) and reports `lookup {id, index}`; everything else passes.
- **Scale mode** (Magpie `CursorManager`, reduced): the real cursor stays on the game window at the source position,
  clipped to its client area while the game is in front; the system cursor is hidden (`MagShowSystemCursor`) and drawn
  at the scaled position. Leaving needs Alt+Tab (Magpie's edge release is not ported).

## Protocol (`MeguLitCompositor.exe --hwnd <h> [--scale]`, one JSON object per line)

Commands (stdin):

```
{"t":"line","id":7,"text":"<①'s blank-stripped text>","expected":8,"tl":"…","ruby":[[s,e,"よみ"]],"color":"#ffffff","page":false}
{"t":"glyphs","id":7,"glyphs":[{"i":0,"h":28,"b":24,"a":28,"x":1,"y":2,"k":"d"},…]}     ① dots records (k d/c)
{"t":"annotate","id":7,"tl":"…","ruby":[[s,e,"よみ"]]}                                    later translation / furigana
{"t":"choices","items":[{"text":"…","tl":"…"}],"color":"#ffffff"}  {"t":"choicesEnd"}
{"t":"style","mode":"bilingual|jp|translation","jpFont":"…","tlFont":"…","rubyFont":"…","ruby":true,"shadow":true,"plate":true,"tlPlace":"above|below","tlScale":0.8,"tlColor":"#…","jpColor":"#…"}
{"t":"undot","id":7}  {"t":"clear"}  {"t":"lookup","on":true}  {"t":"shot","path":"…"}  {"t":"quit"}
```

Events (stdout): `ready {version, game, window, mode, src}`, `line {id, status, found, expected}` on every change
(`waiting revealing complete fading mismatch lost`), `undot {id|choices, reason}`, `lookup {id, index, x, y}`,
`stats {fps, latencyMs, latencyP95Ms, processMs, processP95Ms, trackMs, dots, status, color}` every 2 s,
`fallback {reason}` (capture could not start), `exit {reason}`.

Test aids: `--headless` (no window), `--demo` (the compositor paints spec-1 dots for the line's `cells` itself),
`--auto-lines`, `--frames N`, `--shots dir --shot-every N`, `--window-alpha N`, `--at x y`.

## Fallbacks (never double or misplace text)

- Capture cannot start (window not capturable, exclusive fullscreen) → `fallback`; MeguLit keeps the old overlay window.
- A line with more dots than characters (`mismatch`), or a reveal stuck short of the full line for 3 s → `undot`: the
  compositor stops erasing and drawing that line at once. The caller then shows that line the old way (overlay) and
  can switch ① to `blank` / off for the following lines. ① has no per-line "draw the glyphs again", so a line already
  rasterised as dots stays dots until the game redraws it — it is never shown wrong, at worst as dots.
- Choices that do not line up within 1.5 s → `undot {choices:true}`.
- Lines are drawn only from dots that were found: nothing is drawn where no dot is.

## Forced borderless fullscreen (`native/borderless`)

`MeguLitLaunch<bits>.exe <MeguLitBorderless<bits>.dll> <game.exe> [args]` starts the game suspended, loads the DLL,
resumes it — the hooks must be in place before the game creates its renderer. When the game asks for exclusive
fullscreen it stays windowed and its window becomes borderless:

- Direct3D 9: `CreateDevice` / `CreateDeviceEx` / `Reset` / `ResetEx`: `Windowed` FALSE → TRUE, refresh 0, presentation
  interval limited to the windowed ones, no fullscreen display mode;
- DXGI: `CreateSwapChain`, `CreateSwapChainForHwnd`, `D3D11CreateDeviceAndSwapChain`: windowed; `SetFullscreenState(TRUE)`
  → FALSE;
- DirectDraw: `SetCooperativeLevel` exclusive → normal, `SetDisplayMode` answered without changing the mode (a game that
  then builds a flipping primary chain needs DxWnd-style surface emulation: not done);
- `ChangeDisplaySettings(Ex)A/W` resolution changes answered `DISP_CHANGE_SUCCESSFUL`, the desktop keeps its mode.

`MEGULIT_BORDERLESS=fill` (default: monitor-sized, the game's Present stretches) or `native` (back-buffer-sized and
centred; `MeguLitCompositor --scale` scales it with Lanczos — sharper, and the dots stay 3 px). The window is found from
the device / swap chain / cooperative-level window. `MEGULIT_BORDERLESS_LOG=<file>` logs each intercepted request.

## Tests and numbers

- `native/compositor/build.cmd` builds the compositor, `DotSelfTest.exe` and `FramePlayer.exe`;
  `selftest/run.cmd` runs DotSelfTest: 18 synthetic 1920×1080 scenarios (typewriter with colour learning, centred
  rows, vertical NVL with a kept line, fade-out, fade-in, ±8 px shake, scroll, ADV next line, 64 px dots, spec-1 with
  low 。/clipped ー, shadow copies, 2 px dots, NVL page break, distractors, ADV overwrite without a clear frame, dither
  box, choices + hover). All pass; mean per-frame detection 99.8 % (the misses are the first frame before the colour is
  learned); inpaint error mean ≤ 0.9/255 on a noisy gradient, 0 on the dither box; ≤ 4.1 ms per 1080p frame.
- `native/borderless/build.cmd` builds and runs `bltest` x86 + x64: 17 checks each on fake COM objects (the same hook
  code as the real path) — never a real fullscreen mode.
- `native/compositor/selftest/replay.cjs <frame.png> <out> [--scale] [--hd]`: end-to-end off screen. FramePlayer shows a
  real game frame with the dialogue rows cleaned and spec-1 dots where the game's glyphs were (ダストマニア・グロテスク
  layout: 28 px cells, 24 per row), MeguLitCompositor captures it with WGC and draws. 7 lines / 166 dots incl. a
  shadowed and a shaking line: **7/7 lines, 100 % dots** in overlay, scale and 1080p runs.
- **Live, CLANNAD HD (SiglusEngine, 1243×933 client, on screen, muted)** with ①'s HookBridge + MeguLitFont v3 (dot mode,
  stream EmbedSiglus), compositor fed through `services/capture-compositor.cjs` (`H:\MeguLit-Work\capture-comp\live-dots.cjs`):
  17 dialogue lines from a new game, **16 complete (dots found, erased, MeguLit's text drawn on the game's cells), 1
  handed back** (mismatch → undot, nothing drawn wrong). The game presents at ~320 fps and the compositor keeps up:
  2.9 ms per frame (median), 1.9 ms added latency (p95 3.9 ms), tracking 1.7 ms. Siglus scales its frame, so the dots
  arrive blurred (core 2×2 + rim) — handled by `Isolated`. Caveat from ①: glyphs Siglus rasterised before dot mode
  stay real for the whole process (its glyph cache); such lines are handed back.
- Live, ダストマニア・グロテスク (BRUNS, DirectDraw): capture works (58 fps), but its dialogue comes from a bitmap font
  (no TextOut / GetGlyphOutline), so ① cannot dot it — the generic layer has nothing to replace there.
- Off-screen testing note: WGC delivers **no frames for a window entirely outside the desktop**, and a normal window
  keeps no content for its off-screen part. The test window is therefore a per-pixel-alpha layered window with 1 px on
  the screen edge at alpha 0 (invisible, fully captured). A constant low alpha does not work (DWM stores layered windows
  premultiplied: alpha 1/255 leaves 1 bit per channel). DirectDraw games blit to the screen and are clipped there, so
  their picture can only be captured while on screen (normal use: the game sits under MeguLit's window).

## Open (next steps)

- Wire `services/capture-compositor.cjs` into `services/runtime.cjs` behind a setting (default off) once ① is merged:
  forward `hookGlyphDots` events, reader translations/furigana (`annotate`), reader style, choices; on `undot` switch
  that line to the overlay; on `fallback` keep the overlay mode.
- ① dots in BRUNS (and a live per-game detection rate).
- Magpie's cursor edge release in scale mode; DXGI flip-model games with their own HDR formats (capture is BGRA8).
