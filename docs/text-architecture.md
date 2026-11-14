# Text architecture: MeguLit draws the game's text

Agreed with the owner on 2026-11-14. MeguLit draws every line of dialogue itself, in the place and size where the game
would have drawn it. Three parts, each with its own section below:

1. **Glyph dots** (`feat/glyph-dots`): wherever a game asks Windows for a glyph or draws a string, a dialogue character
   becomes a small dot with the original metrics, so layout, wrapping and pacing stay the game's own.
2. **Capture compositor** (`feat/capture-compositor`): captures the game window, finds the dots, erases them, draws
   MeguLit's text at their positions and shows the result in MeguLit's own window.
3. **Non-dot paths** (`feat/text-paths`): engines that do not take glyphs from Windows (web, Unity, KiriKiri with
   prerendered fonts, Ren'Py) report character rectangles themselves.

Rules for all parts: generic code only (never per game), no OCR masking, no game data is ever modified.

## Changes to this document

The dot spec and protocol below are **stable** as of spec version 1 (MeguLitFont version 3). A change gets a new spec
version, a line in this log, and stays backward compatible where possible (new fields go at the end of a record).

| Spec | Date       | Change |
|------|------------|--------|
| 1    | 2026-11-14 | First version: dot geometry, `ToMe_GLYPHDOT` records, `hookGlyphDots` events, `glyphMode` command. |
| 1    | 2026-11-14 | Compatible addition: `glyphMode` `all:true` (write-back streams on dots too).                    |
| 1    | 2026-11-14 | Compatible addition: in dot mode `ToMe_GLYPHDOT line` is sent when the line is pushed, before any dot. |
| ③ 1  | 2026-11-14 | Non-dot paths: `ToMe_CHARS` records, `hookCharRects` events, crash canary (`feat/text-paths`).    |

## ① Glyph dots

Code: `native/fontprobe/FontProbe.cpp` (MeguLitFont32/64.dll, loaded by HookBridge into every bound game),
decisions in `native/fontprobe/GlyphMatch.h`, bridge glue in `native/HookBridge.cs`, front end in
`core/hook-native.cjs`.

### Which draws become dots

The same matcher as the glyph hide (E667) decides; dot mode changes only what a matched draw produces.

- HookBridge pushes every line of the selected dialogue stream (`LINE <text>`) when that stream cannot write back
  (the streams the glyph hide probes, `GdiProbeable`), with replacement on or while the reader probes.
- Per glyph (GetGlyphOutline): the character continues an in-order walk through the current line **and** the font is
  the dialogue font (learned from three in-order glyphs under one face and size, or seeded with `FONT <px> <face>`).
  Menus and names in other sizes, and characters not in the line, are never touched.
- Whole strings (TextOut, ExtTextOut, DrawText, GDI+, Direct2D): the trimmed string is part of the current or
  previous line (at least two characters; under the dialogue font once one is known, or four or more characters).
- Ruby: kana of the line in a clearly smaller font straight after a matched draw.
- A line expires 60 s after it was pushed; `OFF` or a closed control pipe stops everything at once.

### Modes

| Mode    | A matched glyph / string becomes |
|---------|----------------------------------|
| `blank` | nothing: blank glyph with the same metrics, string left out (version 2 behaviour, the **default and fallback**) |
| `dot`   | a dot glyph with the same metrics; strings get one dot per character |

Front end → bridge (stdin JSON): `{"type":"glyphMode","mode":"dot"}` or `"blank"`. `HookNative.setGlyphMode(mode)` sends
it. `MEGULIT_GLYPH_MODE=dot` in HookBridge's environment starts in dot mode (tests). Bridge → DLL (control pipe
`\\.\pipe\MeguLitFontCtl-<pid>`): `MODE dot` / `MODE blank`, sent on every connection and on every change.

Scope today: dot mode covers the streams the glyph fallback covers, i.e. selected streams **without** write-back. A
write-back (embed) stream still gets its text replaced in the game, so it never shows dots. To put such a stream on dots
too, send `{"type":"glyphMode","mode":"dot","all":true}` (or `MEGULIT_GLYPH_ALL=1`): every selected stream then has its
write-back switched off (the game draws its own line, which becomes dots) and its lines are pushed to the DLL.

In dot mode HookBridge does not switch the LunaHook GDI hide (`MeguLitGdiHide.h`) on for the stream: a string it left out
would never reach the dots.

### Dot geometry (spec 1)

- **Side** `s` = 3 px when the cell height (`tmHeight`, or the font's line height for GDI+/Direct2D) is 12 px or more,
  else 2 px.
- **Coverage**: full (opaque text colour), a solid square, no anti-aliasing. GDI glyph bitmaps: 1 (mono), 4 (GRAY2),
  16 (GRAY4), 64 (GRAY8). The game composites it exactly as it would composite its own glyph, so the dot carries the
  game's text colour, and the game's own effects: an engine that draws a shadow or an outline by drawing the glyph
  several times shows several dots per character (offset copies), and a coloured/gradient text gets that colour.
- **Position**:
  - GetGlyphOutline bitmaps and outlines: the top-left corner of the glyph's black box, the square clipped to the black
    box (`min(s, gmBlackBoxX) x min(s, gmBlackBoxY)`). The returned `GLYPHMETRICS`, the return value of size queries and
    the buffer size are the original's; metrics-only calls (`GGO_METRICS`) are unchanged.
  - Outlines (`GGO_NATIVE`, `GGO_BEZIER`): one clockwise square contour of `TT_PRIM_LINE` from
    `(gmptGlyphOrigin.x, gmptGlyphOrigin.y)` to `(+s, -s)` in the glyph's own coordinates (y up from the baseline),
    padded with zero-length points so the parsed size equals the original's (when the size cannot be matched the call
    returns the 44 bytes of the square).
  - TextOut / ExtTextOut (also `ETO_GLYPH_INDEX`, `lpDx`, `TA_UPDATECP`, all `TA_*` alignments) and DrawText (it ends in
    ExtTextOut): the same black-box top-left the glyph would have, from `GGO_METRICS` with an identity matrix, drawn as
    an opaque fill in the DC's text colour; the opaque background (`ETO_OPAQUE`) and the current position behave as in the
    original call. Vertical or rotated fonts (`@face`, escapement) fall back to `blank`.
  - GDI+ `GdipDrawString`: top-left of the character's layout box (`GdipMeasureCharacterRanges` with the game's graphics,
    font, rectangle and format), filled with the game's brush, `SmoothingModeNone`. `GdipDrawDriverString`: at
    `(pos.x, pos.y - cell ascent)`; with `DriverStringOptionsRealizedAdvance` or vertical text the line falls back to
    `blank`.
  - Direct2D `DrawText` / `DrawTextLayout`: top-left of the character's hit-test box (`HitTestTextPosition`), filled with
    the game's brush, aliased, snapped to device pixels. `DrawGlyphRun`: at the pen position (advances and offsets of the
    run) and `baseline - ascent`; right-to-left or sideways runs fall back to `blank`.
- **Erase rule for ②**: everything inside a found dot square is the dot; nothing else of the game's text is drawn for a
  matched character (the rest of the cell shows the game's background).

### Reports (DLL → HookBridge, pipe `\\.\pipe\MeguLitFont-<pid>`, UTF-8 lines)

```
ToMe_GLYPHDOT line seq=<n> text=<line>
ToMe_GLYPHDOT dots seq=<n> path=<ggo|text|gdip|d2d|run> list=<dot>;<dot>;...
ToMe_GLYPHDOT cache seq=<n> missing=<a> of <b>
```

- `seq` increases with every new line the bridge pushes; in dot mode `line` is sent as soon as the line is pushed (before the game draws it), so the dot count is known in advance. `text` is that line **with all blanks removed** (U+0000–U+0020,
  U+3000, U+200B, U+FEFF). Character indices below index into this text. `line` comes before the first `dots` of its seq.
- `<dot>` = `i:u:h:b:a:x:y:s:k`
  - `i` index into the line text (`-1` unknown), `u` the character as hex UTF-16 code unit,
  - `h` cell height px, `b` ascent px (baseline from the cell top), `a` advance px,
  - `x`,`y` offset of the dot's top-left from the cell's top-left (cell top-left = dot − (x, y)); 0,0 for GDI+/Direct2D,
  - `s` nominal dot side (the drawn square may be clipped to a smaller black box),
  - `k` kind: `d` character of the current line, `c` drawn again after it was matched (index of its last placement),
    `p` character of the previous line (index into the previous line's text), `r` ruby kana over a matched draw (`i`=-1).
- Every (index, kind) is reported **once per line** (ruby: once per character and height), even when the game redraws the
  line every frame. Records are batched (at most 48 dots, flushed after 25 ms); one line may span several `dots` records.
- `cache`: the engine reuses glyphs it rasterised earlier (two lines in a row left out at least three already matched
  characters). In dot mode this is **acceptable and reported once per run**; dots go on. A reused dot carries no new
  report: it shows up as a dot for which no record arrived in this line. ② may map such dots by reading order
  (dots in order = non-blank characters of the line in order) or treat them as unknown.
- The existing `ToMe_GLYPHHIDE ready|key|hit|line` records are unchanged; `ready` now reads
  `ready version=3 modes=blank,dot`.

### Events (HookBridge → front end, stdout JSON)

```
{"type":"hookGlyphDots","state":"line","seq":7,"text":"吾輩は猫である。"}
{"type":"hookGlyphDots","state":"dots","seq":7,"path":"ggo","dots":[{"i":0,"ch":"吾","h":28,"b":24,"a":28,"x":1,"y":2,"s":3,"k":"d"}, ...]}
{"type":"hookGlyphDots","state":"cached"}
```

`core/hook-native.cjs` re-emits them unchanged and keeps the current line's table in `state.hookGlyphDots`
(`{seq, text, dots:[...], cached}`, merged per seq, without a UI broadcast).

### Coverage and gaps

Covered: GetGlyphOutlineA/W (all formats, glyph indices), TextOutA/W, ExtTextOutA/W (glyph indices, `lpDx`, `ETO_PDY`),
DrawText/DrawTextEx (through ExtTextOut), GdipDrawString, GdipDrawDriverString (character mode),
ID2D1RenderTarget::DrawText / DrawTextLayout / DrawGlyphRun.

Not covered (left to blank fallback or to ③): ID2D1DeviceContext's own DrawGlyphRun overload, IDWriteTextLayout::Draw
with a game-supplied renderer, IDWriteBitmapRenderTarget, Direct3D/OpenGL text from prebuilt font textures, engines that
blit prerendered font sheets (KiriKiri prerendered fonts, see ③). World transforms and non-`MM_TEXT` mapping modes in GDI
draw the dot in logical units (it scales with the transform).

### Self-tests

- `native/fontprobe/selftest/run-match.cmd`: matcher decisions incl. dot indices.
- `native/fontprobe/selftest/run-hide.cmd`: blank mode (version 2 behaviour) through every path.
- `native/fontprobe/selftest/run-dots.cmd [dll folder] [png folder]`: x86 and x64 hosts draw a known line through
  GetGlyphOutline (GRAY8/4/2, mono, native, bezier), TextOutW, ExtTextOutW with `lpDx`, ETO_GLYPH_INDEX, baseline
  alignment, TextOutA (Shift-JIS), DrawTextW, one TextOutW per character, GdipDrawString, GdipDrawDriverString,
  Direct2D DrawText, DrawTextLayout and DrawGlyphRun into an off-screen DIB, save each as PNG and require exactly one
  solid ≤3×3 dot per character at the expected position (±1 px) and nothing else, unchanged metrics and buffer sizes,
  menu text untouched, every report correct. Wired into Build.ps1 and CI through `native/native-builds.json`
  (marker `MeguLitFont version=3`, checked by `tools/native-stale.cjs`).

### Live checks (2026-11-14)

- MeguLitFont v3 loads in 32- and 64-bit games and answers `ready version=3 modes=blank,dot`; with `all:true` HookBridge
  pushes the lines and announces them (`ToMe_GLYPHDOT line`).
- ダストマニア・グロテスク（BRUNS, 32-bit）: the dialogue is blitted from bitmap font sheets (`font\ff_*.bmp`), with no
  TextOut/GetGlyphOutline calls while a line shows (fix/bruns-embed, live). No dots are possible at the Windows font
  layer; this game needs an engine-level path (③ or a per-character write-back), not ①.
- THE SHELL HD (Artemis, 64-bit, Steam): lines pushed, but no GDI glyph calls at all (the engine rasterises its own
  font). Same conclusion: ③ territory.
- No other 64-bit GDI galgame is available on E: or in the owned Steam library (WITCH ON THE HOLY NIGHT: no license).
  The 64-bit GDI paths are covered by the x64 self-test host.

## ③ Non-dot paths (engines that do not take glyphs from Windows)

Branch `feat/text-paths`. Four engine families draw their text without asking Windows for glyphs, so ① can never put
dots there. Each of them gets an engine-level path that gives ② the same two things: (a) the current line is not drawn,
(b) the place of every character of it. Instead of dots in pixels, the game side **reports rectangles**.

| Path    | Engines                                   | Hides how                                         | Rectangles from |
|---------|-------------------------------------------|---------------------------------------------------|-----------------|
| web     | NW.js / Electron shells: TyranoScript, WebGAL, Monogatari, ink web, any DOM-text engine | one style rule on the message element: `color` / `-webkit-text-fill-color` transparent, no shadow / stroke | `Range.getClientRects` per character, × `devicePixelRatio` |
| unity   | Unity Mono (TextMeshPro, uGUI)            | the dialogue component's alpha 0 (`TMP_Text.alpha`, `Graphic.color.a`) | TMP `textInfo.characterInfo` / `TextGenerator.verts`, through the canvas camera |
| krkr    | KiriKiri 2 / Z KAG message layers (own rasteriser, `.tft` prerendered fonts) | the existing opacity-0 drawing of the message `lineLayer` (E472, `__megulitKrkrHide`) | the TJS `processCh` wrapper: x / y of each character, width from the drawing font |
| renpy   | Ren'Py 7 / 8                              | the say Text's own Render: `Render.alpha` 0 (gl) and the `renpy.alpha` shader with `u_renpy_alpha` 0 (gl2) | the Text's `Layout` glyphs through the render tree's offsets and reverse matrices |

Rules shared by all four (the same as ① and the older layers):

- **Never change game data.** Nothing is written to the game folder, its archives, saves or settings. Web: Chromium
  switches only; Unity: a shadow folder (below); KiriKiri / Ren'Py: wrappers in the running engine that fall back to the
  engine's own function on any error.
- **Hidden is confirmed per line.** A record says `hidden=1` only after the game side really drew that line invisible
  (web: computed colour of every text node transparent; Unity: alpha still 0 at the end of the frame; Ren'Py: the Text's
  Render is drawn with alpha 0 / the alpha shader; KiriKiri: the line's glyphs went through the opacity-0 draw). A game
  that draws its text again (MeguLit gone, switch off, the game animating its own colour) sends `hidden=0` for the same
  line. `core/text-paths.cjs HiddenGate` keeps the latest state per line; ② draws over a line only while it is hidden.
- **Only while MeguLit is there.** Every path follows HookBridge's replacement switch, and the game side drops hiding by
  itself when the connection to MeguLit goes away (pipe / socket / DevTools closed).
- **Crash canary.** `data/text-paths/<exe name>-<exe size>.json` (the key of the stream memory). A path is armed the
  first time it hides, stays armed while the game runs, and is cleared after 20 s or a clean exit (code 0). A game that
  exits with another code while armed, or is found still armed at the next start, gets that path **off** for the game
  (`off.<path>.reason`); switching it on again is the user's call (`Canary.reset`). C#: `native/TextPathCanary.cs`
  (krkr, renpy, in HookBridge); node: `core/text-paths.cjs Canary` (web, unity, at launch).

### Record (spec 1 of ③)

Game side → MeguLit, one UTF-8 line per sentence (sent again whenever its rectangles or its hidden state change):

```
ToMe_CHARS engine=<krkr|renpy|web|unity> line=N hidden=0|1 sw=W sh=H vx=X vy=Y vw=W vh=H n=K rects=x,y,w,h;x,y,w,h;... text=<line>
```

- `text`: the sentence as drawn, a newline (sent as U+001F) where the game started a new row. Blanks and ruby are not
  part of it.
- `rects`: exactly one per character of `text` without its newlines, in order, in **game-screen pixels** (0..sw,
  0..sh), top-left origin, `w`/`h` the character's box (KiriKiri and Ren'Py: advance × line height; web: the glyph's
  client rect; Unity: the glyph quad).
- `vx vy vw vh`: where the game screen sits in the window's client area, in client pixels (web and Unity: the whole
  client, `0 0 sw sh`; Ren'Py: `renpy.display.draw` drawable viewport; KiriKiri: `0 0 0 0` = unknown, aspect fit).
- `line`: increases per sentence; a typewriter that grows the same sentence keeps its number.
- Parser and helpers: `core/text-paths.cjs` (`parseChars`, `formatChars`, `toClient(rec, clientW, clientH)` → client
  pixels, `viewportOf`).

Transport: KiriKiri and Ren'Py send it on their existing pipes (`\\.\pipe\MeguLitKrkr-<pid>`,
`\\.\pipe\MeguLitRenpy-<pid>`); HookBridge passes it on unchanged as `{"type":"hookChars","line":...}`. Web and Unity
records come from node directly (`core/text-paths-web.cjs`, `core/text-paths-unity.cjs`). Both end in
`HookNative.charRects`, which emits the front-end event:

```
{"type":"hookCharRects","engine":"renpy","line":3,"hidden":true,"sw":1280,"sh":720,"viewport":[0,0,1280,720],
 "rects":[[208,563,24,45],...],"text":"…","at":…}
```

For ②: `toClient(event, clientWidth, clientHeight)` gives each character's box in the game window's client area. The
erase rule is simpler than for dots: the game drew nothing for a hidden line, so nothing has to be erased.

### Paths in detail

**Web** (`core/text-paths-web.cjs`). `chromiumShell(exe)`: `icudtl.dat` plus `nw.dll` / `package.nw` (NW.js) or
`resources\app.asar` / `resources\app` (Electron) next to the program. `services/bridge.cjs` adds
`--remote-debugging-port=<free loopback port> --remote-debugging-address=127.0.0.1 --remote-allow-origins=…` to the
start (a Steam game is then started directly with `SteamAppId` in the environment, never through Steam). `WebTextPath`
attaches over the DevTools protocol to every page target, adds `PAGE_SCRIPT` for every new document and evaluates it in
the current one, and talks through the `__megulitReport` binding. The page script finds the message element (known
containers of TyranoScript, Monogatari, WebGAL, ink pages, else the smallest visible element whose text is the hook line
sent with `want()`), toggles `data-megulit-hide` on it, and reports after every DOM change (40 ms debounce). Canvas
engines (RenJS / Phaser, PixiJS text) report `canvas` and stay as they are.

**Unity** (`core/text-paths-unity.cjs`, `native/unitytext/MeguLitUnityText.cs`). Mono games only (IL2CPP: below). The
game is started from a shadow folder `data/unity-shadow/<exe>-<size>`: every folder of the game is a directory junction,
every file a hard link (a copy when the volume differs, mtime kept); MeguLit adds UnityDoorstop (`winhttp.dll`,
`doorstop_config.ini`) and BepInEx 5.4.23.6 with `BepInEx\plugins\MeguLit\MeguLitUnityText.dll`, the control port, and
`steam_appid.txt` for Steam games. Unity finds `<exe>_Data` through the junction; BepInEx writes its config and log in
the shadow only. A game that ships its own BepInEx / doorstop / version.dll proxy is left alone. Rebuilding the shadow
never deletes through a junction (links are removed as links). The plugin hooks nothing: twice a second it picks the
dialogue component among the visible TMP_Text / UI.Text (not faded out by its colour or a CanvasGroup, on screen): the
one whose text is the hook line (`WANT`), else the one with the most kana / kanji that changed last. It reports the
characters' quads from the laid-out mesh, leaves out quads tiny in both directions (markup some games leave as empty
glyphs), and maps uGUI quads to characters by the sequence whose length matches the quad count (rich-text tags,
blanks and line breaks get quads or not depending on the Unity version). Control: loopback TCP (Unity's Mono has no
reliable Windows named pipes), lines `HIDE 0|1`, `WANT <text>` in, `ToMe_CHARS` / `ToMe_UNITY status` out. Pack:
`runtime/unity-text` (`tools/unity-text-pack.cjs` builds it from the BepInEx release archives, SHA-256 pinned, plus the
plugin and LICENSES.txt; marker `runtime/unity-text/MeguLitUnityText.dll` in `core/runtime-packs.cjs`). The
`setup/runtime.json` entry (onDemand, hidden) is added at release with the published zip's size and hash.
XUnity.AutoTranslator was evaluated as the base: its documented plugin API has no per-component callback, and its
translation pipeline is asynchronous and global (it would also blank menus), so the path uses BepInEx + this small
plugin; XUnity's IL2CPP build is the candidate for the IL2CPP case.

**KiriKiri** (`native/krkrtext/script.inc`, `KrkrText.cpp`). The existing KAG wrappers already know where each
character is drawn (`track`, E300) and draw the message `lineLayer` at opacity 0 while `Local\MeguLitKrkrHide-<pid>` is
set (E472). ③ adds the box of each character (x, y, `drawFont.getTextWidth(ch)`, font size) and sends one `ToMe_CHARS`
at the sentence's end (click wait or clear), `hidden=1` when the sentence's glyphs went through the opacity-0 draw and
hiding is still on. The DLL forwards `ToMe_CHARS` lines up to 28000 characters.

**Ren'Py** (`native/MeguLitRenpy.py`). Every sentence, ADV as well as NVL, is located in the render tree (E301); its
glyph boxes go out as `ToMe_CHARS` (width: the glyph's advance, else the distance to the next glyph). A wrapper on
`renpy.text.text.Text.render` draws the say Text (all sentences of the NVL page on screen) invisible while
`Local\MeguLitRenpyHide-<pid>` is set and the pipe to MeguLit is connected; HookBridge sets that event on the same rule
as KiriKiri's. When hiding stops, every Render drawn invisible gets its alpha back and is redrawn at once.

### Launch and wiring

`core/text-paths-launch.cjs prepare()` (called by `services/bridge.cjs` before a direct start) is **off unless
`preferences.ownTextOutput` is true** (the owner's "MeguLit draws all text" switch; ② turns it on with its UI). It
returns the adjusted start (program, arguments, environment, folder) and a session; after the game window is up the
session joins the hook reader (`attach`): records go to `HookNative.charRects`, HookBridge's replacement switch
(`enable` / `disable`) becomes `hide(on)`, and every source line becomes `want(text)`. The game's exit code goes to the
canary. KiriKiri and Ren'Py need nothing at launch (HookBridge loads their DLLs).

### Live checks (2026-11-14, off screen, muted, new game, no saves)

| Path  | Game | Result |
|-------|------|--------|
| web   | TyranoScript's own sample game (MIT, `ShikemokuMK/tyranoscript`) in headless Chrome | **works**: title → Start, 4 lines, hidden while asked (pixels gone), shown again at once, boxes on every character (shots `H:\MeguLit-Work\text-paths\web`). No NW.js / Electron galgame on E: or in Steam to try the launch switches on. |
| unity | 月に寄りそう乙女の作法 (Tsukiniyorisou, Unity 2020.3 Mono, 32-bit, Steam) | **works**: shadow folder (junctions, copies on H:), BepInEx + plugin loaded, Start → NVL page; hidden=1 and the text gone, typewriter records per character, boxes on every glyph, drawn again on HIDE 0; canary refuses hiding after a simulated crash. Found live: Steam restarts the program from its real folder unless `SteamAppId` / `steam_appid.txt` are set; the dialogue was a uGUI Text with rich-text tags. |
| renpy | 夏末盛开的花 (Flowers Blooming at the End of Summer, Ren'Py 8.4, gl2) | **works** after one fix: `Render.alpha` alone is ignored by gl2, the `renpy.alpha` shader hides it. New game, ADV lines located (21 / 20 / 16 / 30 characters), hidden from the first frame of the next line, shown again on reset, boxes on every character. |
| krkr  | ファタモルガーナの館 (KiriKiri 2, on screen, new game, Ctrl skip) | **works**: 45 sentences located, every one hidden=1 while asked (dialogue gone, the name plate is a separate layer), boxes on every character. Two fixes found live: a sentence counts as hidden when each of its characters was drawn while hiding was on (the glyphs stay invisible after the switch, the end record comes at the click wait), and blanks get no box. Not covered: 千恋＊万花 (Yuzusoft, KiriKiri Z) draws through the `textrender.dll` plugin, not KAG `processCh` / `drawText` (draws=0); ATRI needs a running Steam. |

Yuzusoft KiriKiri Z (千恋＊万花, probed live 2026-11-14 with the test-only build `cl /DMEGULIT_KRKR_DEBUG`, which
evaluates `krkrdebug.tjs` placed next to the DLL): the message layer is `CustomMessageLayer`; its text is drawn natively
into `textLayer` (`CustomMessageTextLayer`, a 1920x263 image holding nothing but the text) by the `TextRender` plugin
class (calls seen: `clear`, `setRenderSize`, `done`), never through `processCh` or any `drawText`. Setting
`textLayer.opacity` to 0 hides exactly the dialogue (the name plate stays). **Covered now** (`script.inc` `st.tr*`):
`TextRender.done` is wrapped once on the class (`incontextof null`, so every instance reaches it), followed by
`getCharacters(0, n)` (entries: `text`, `x`, `y`, `cw`, `size` in the render box). Boxes = message layer's absolute
position + `marginL` / `marginT` (+ `PreRenderFontEx.resizePadding` vertically), `cw` × `size`. Hidden = the current
message layer's `textLayer` at opacity 0 while asked (checked every 100 ms with the dialog-visibility timer), the game's
own opacity restored when MeguLit stops; a hidden-state change resends the line's record. Lines are numbered from
100000 so they never collide with KAG `processCh` sentences. Live 2026-11-14 千恋＊万花: 『お客さん』, 「……ぁ？」, … boxes on
every glyph, hidden=1 with the dialogue gone, back on reset.

YU-RIS (サイコロジック・ラブコメディ, 2026-11-14): its only text APIs are CreateFontIndirectA + TextOutA +
CreateDIBSection / GetDIBits / StretchDIBits. TextOutA rasterises each new character once into a DIB glyph cache (31
calls for several lines), and the engine copies cached glyphs into the frame with its own CPU code before uploading it
to Direct3D 9. Character positions exist only inside that internal blit, so neither ① (glyph dots: cached glyphs are
reused), layer 4 (no glyph draw reaches the GPU) nor a ③ API hook applies; it needs reverse engineering of the cache-blit
routine. Artemis (THE SHELL HD, D3D11, 64-bit): no Lua API is exported. Layer 4 checked it (hide-gpu-proxy 9a8a149):
the 64-bit hooks load, but the game stays black on this machine, and its only draw is one unit quad from a static
vertex buffer placed by shader constants, which layer 4 cannot read. Stopped; it needs an engine-level path.

**Unity IL2CPP** (`native/unitytext/MeguLitUnityText.IL2CPP.cs`, `Build-UnityText-IL2CPP.ps1`): the same shadow folder
with BepInEx 6.0.0-be.793's IL2CPP build (its own .NET runtime; the interop assemblies are generated in the shadow on
the first start, ~10 s) from the pack's `il2cpp-x64` / `il2cpp-x86`, and a BasePlugin that registers one MonoBehaviour
in the IL2CPP domain. It compiles against one game's generated interop and binds by type / member name at run time.
Both Unity plugins hide through the **CanvasRenderers** of the dialogue component and its sub-meshes (renderer alpha 0;
text without a CanvasRenderer: its Renderers off; else the component alpha), because a typewriter that rewrites vertex
colours every frame undoes the component's own alpha. TextMeshPro characters in a point size under 0.75 × the line's body
(ruby) are left out. Live 2026-11-14 魔法少女ノ魔女裁判 (Unity 6000.0.48, IL2CPP x64, Steam, Naninovel
`RevealableTextModified`): the plugin loads, records per character while the line types, hidden=1 with the line gone,
drawn again on reset, boxes on every glyph. Mono regression 月に寄りそう乙女の作法 with the renderer hiding: hidden=1, gone.

Not covered yet: canvas web engines (RenJS / Phaser), KiriKiri games with their own message-layer class that use
neither KAG `processCh` nor TextRender, Ren'Py text outside the say screen, YU-RIS and Artemis (see above).
