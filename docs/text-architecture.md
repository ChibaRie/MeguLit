# Text architecture: MeguLit draws the game's text

Agreed with the owner on 2026-11-14. MeguLit draws every line of dialogue itself, in the place and size where the game
would have drawn it. Three parts, each with its own section below:

1. **Glyph dots** (`feat/glyph-dots`): wherever a game asks Windows for a glyph or draws a string, a dialogue character
   becomes a small dot with the original metrics, so layout, wrapping and pacing stay the game's own.
2. **Capture compositor** (`feat/capture-compositor`): captures the game window, finds the dots, erases them, draws
   MeguLit's text at their positions and shows the result in MeguLit's own window.
   Details: docs/text-architecture-compositor.md. **Abandoned 2026-11-14** (it stole clicks and exposed marks). Its
   successor is the **reader overlay placement** (`feat/overlay-placement`): the game draws blank glyphs (`MODE blank`)
   and MeguLit's reader overlay draws its text at the cell origins the sources report (see "Placement" below).
3. **Non-dot paths** (`feat/text-paths`): engines that do not take glyphs from Windows (web, Unity, KiriKiri with
   prerendered fonts, Ren'Py) report character rectangles themselves.

Rules for all parts: generic code only (never per game), no OCR masking, no game data is ever modified.

## Changes to this document

The dot spec and protocol below are **stable** as of spec version 2 (MeguLitFont version 3). A change gets a new spec
version, a line in this log, and stays backward compatible where possible (new fields go at the end of a record).

| Spec | Date       | Change |
|------|------------|--------|
| 3    | 2026-11-15 | Compatible addition: locating marks for GetGlyphOutline engines (`MARK on|off`, `glyphMarks`, record `s` = 1 on a marked glyph; core/glyph-locate.cjs). GGO format counts in `ToMe_FONT status ggo`. |
| 3    | 2026-11-15 | Compatible addition: extra lines for the name plate and choices (`EXTRA n|o <text>`, `EXTRA-CLEAR n|o`; records `ToMe_GLYPHDOT extra` / `xdots`; event `hookGlyphExtra`; front end `glyphExtras`). Whole-string draws only. |
| 3    | 2026-11-14 | `MODE blank` now reports records too (blank glyphs + records = placement; `place`/`place-blind` are aliases of `blank`/`blank-blind`), the default for MeguLit's launch flow. Record version 4 (`ready ... records=4`). Compatible addition at the end of every dot record: `:px:py:space`, the cell's top-left on screen; `hookGlyphDots` dots carry `at`. `ready ... modes=blank,dot,place`. Dots stay available on request. |
| 1    | 2026-11-14 | First version: dot geometry, `ToMe_GLYPHDOT` records, `hookGlyphDots` events, `glyphMode` command. |
| 2    | 2026-11-14 | Dot side grows with the cell: max(3, round(h/10)) from 12 px (was a fixed 3). Records unchanged. |
| 2    | 2026-11-14 | Compositor heartbeat gate (dot mode), `status needs-relaunch / paused / live` records. |
| 2    | 2026-11-14 | Compatible addition: `MODE dot-blind` / `blind:true`, record kind `b`. |
| 1    | 2026-11-14 | Compatible addition: `glyphMode` `all:true` (write-back streams on dots too).                    |
| 1    | 2026-11-14 | Compatible addition: in dot mode `ToMe_GLYPHDOT line` is sent when the line is pushed, before any dot. |

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
| `dot-blind` | as `dot`, plus every CJK/kana glyph under the dialogue font becomes a dot **without waiting for the line** (kind `b`, index −1) |
| `blank` (spec 3) | as above **and** every matched character is reported as in `dot` (records with `s` = 0) with its cell origin on screen (spec 3, "Placement") |
| `blank-blind` | as `blank`, with the blind rule of `dot-blind` (kind `b`); blind blanks only while HookBridge is connected or in the first 20 s after load |

Front end → bridge (stdin JSON): `{"type":"glyphMode","mode":"dot"}` or `"blank"`. Add `"blind":true` (or `MEGULIT_GLYPH_BLIND=1`) for `MODE dot-blind`: for engines whose stream text arrives after the glyphs (AdvHD, KiriKiri2 read-only streams). Scope is the dialogue font only (learned, `FONT` seed, or the probe's leading font); the dialogue window is not known at this layer, so a name or menu drawn in the same face and size is dotted too. `HookNative.setGlyphMode(mode)` sends
it. `MEGULIT_GLYPH_MODE=dot` in HookBridge's environment starts in dot mode (tests). Bridge → DLL (control pipe
`\\.\pipe\MeguLitFontCtl-<pid>`): `MODE dot` / `MODE blank`, sent on every connection and on every change.

Scope today: dot mode covers the streams the glyph fallback covers, i.e. selected streams **without** write-back. A
write-back (embed) stream still gets its text replaced in the game, so it never shows dots. To put such a stream on dots
too, send `{"type":"glyphMode","mode":"dot","all":true}` (or `MEGULIT_GLYPH_ALL=1`): the selected write-back stream's
embed callback then pushes the line to the DLL first and hands the text back unchanged, so the line is known before the
game draws it (the plain text output arrives after the glyphs are drawn, e.g. BGI: ~180 ms late).

In dot mode HookBridge does not switch the LunaHook GDI hide (`MeguLitGdiHide.h`) on for the stream: a string it left out
would never reach the dots.

### Dot geometry (spec 1)

- **Side** `s` (spec 2) = 2 px when the cell height (`tmHeight`, or the font's line height for GDI+/Direct2D) is below
  12 px, else max(3, round(height / 10)) px — 3 px up to a 34 px cell, 4 px at 35–44 px, 14 px at 136 px. It grows with
  the cell because some engines rasterise large and scale down (BGI draws its text at 136 px and shows it at ~28 px; a
  fixed 3 px dot became sub-pixel). Spec 1 had a fixed 3 px; `s` is in every record, use it rather than a constant.
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

### Early injection (engines that fill a glyph cache before MeguLit attaches)

HookBridge attaches about a second after the game starts. Engines that rasterise their glyph cache at start-up (YU-RIS)
or once per character (Siglus, BGI) keep real glyphs for everything they cached before that. `MeguLitLaunch<bit>.exe`
(native/, built by `native/fontprobe/build.cmd`, bitness must match the game) starts the game suspended, loads
`MeguLitFont<bit>.dll` into it before the main thread runs, waits for the DLL's `MeguLitFontReady-<pid>` event and then
resumes it; it prints the game's pid.

```
set MEGULIT_GLYPH_MODE=dot-blind          (or dot)
set MEGULIT_GLYPH_FONT=<px> <face>        (the remembered dialogue font, data\glyph-hide\<exe>-<size>.json)
MeguLitLaunch32.exe <path to MeguLitFont32.dll> <game.exe> [args]
```

In MeguLit (core/glyph-dots.cjs) this is automatic when 文字显示 is `compositor` (gal-preferences.json `textRenderer`):
the library's 启动 starts a plain-process game through the launcher with the remembered font, and HookBridge starts with
`MEGULIT_GLYPH_MODE=dot`, `MEGULIT_GLYPH_ALL=1`, `MEGULIT_GLYPH_BLIND=1`.
日文环境 (Locale Emulator): the launcher creates the game through LE's own `LoaderDll!LeCreateProcess` (ja-JP, cp932,
JST; LE's registry redirection is not requested) with `MEGULIT_LAUNCH_LE=<LE folder>`, still suspended, so the dots are
in place before the first glyph too. LoaderDll looks for LocaleEmulator.dll beside the calling process, so MeguLit runs a
copy of MeguLitLaunch32.exe kept in the LE folder (core/glyph-dots.cjs `earlyLocale`); any failure falls back to LEProc
with the late attach. Live: Under The Moon (AdvHD) started this way showed its dialogue fully dotted (live\advhd-le-early-dots.png). Steam direct starts are part ③'s (`steamDirect`, feat/text-paths). Shell-open launches keep the late attach.
Live (2026-11-14): CLANNAD started from MeguLit's launch service went through MeguLitLaunch32; its first line was 8/8 dots from the first glyph (game window only, live\clannad-app-launch-dots.png).

The DLL reads both variables at start (no HookBridge yet) and serves dots from the first glyph. HookBridge attaches
later as usual (the same DLL path is not loaded twice) and takes over with `MODE`/`LINE`. The late attach stays the
fallback for every other launch path (Steam, Locale Emulator, shell open). The first launch of a game has no remembered
font yet unless the line stream taught one; HookBridge stores the probe's dialogue font (`BlindSeed`) for the next one.
Self-test: `run-dots.cmd` starts `earlyhost.exe` through the launcher (x86 and x64); its first glyph must be a dot.

### Placement (`MODE blank`, spec 3)

For the reader overlay (feat/overlay-placement), which draws MeguLit's text over the game window where the game's own
text would be. A matched glyph or string is **blank** (same metrics, no coverage: GetGlyphOutline bitmaps zeroed,
outlines collapsed to a point, strings left out with the opaque background and current position kept), and every matched
character is still reported once per line with `ToMe_GLYPHDOT line` / `dots`, exactly as in dot mode, with `s` = 0 and
the cell origin appended (`px:py:space`, see Reports).

- **Cell origin** = the top-left of the character's line cell: pen position (left edge of its advance) and the top of
  the cell (baseline − ascent). `h`, `b` and `a` give the cell height, the ascent and the advance in the same pixels.
- **Spaces**:
  - `c`: client area of the game's top-level window, in pixels. GDI strings drawn on a window DC (WindowFromDC): the
    logical point goes through `LPtoDP` and the DC origin (`GetDCOrgEx`) to the screen and `ScreenToClient` of the
    window's root (`GetAncestor(GA_ROOT)`). Direct2D window render targets: target pixels mapped from the target's
    window to its root.
  - `m<W>x<H>`: device pixels of a memory surface of that size (the selected bitmap of a memory DC). Most engines draw
    text into a back buffer and blit it later; when `W x H` equals the game's client size the point is already in client
    pixels, otherwise the overlay scales by client/W, client/H.
  - `t<W>x<H>`: pixels of a Direct2D render target that is not a window target (DC, bitmap, DXGI), after the target's
    transform and DPI; scale as for `m`.
  - `g`: GDI+ world units of the game's `Graphics` (layout box or driver-string position); no device mapping known.
  - `-`: not known. GetGlyphOutline returns a glyph bitmap and never says where the engine puts it; the record still
    gives the character, cell height, ascent and advance.
- APIs with origins: TextOut / ExtTextOut (all alignments, `TA_UPDATECP`, `lpDx` incl. `ETO_PDY`, `ETO_GLYPH_INDEX`),
  DrawText (via ExtTextOut), GDI+ DrawString / DrawDriverString (`g`), Direct2D DrawText / DrawTextLayout (hit-test
  boxes) and DrawGlyphRun (run origin + advances + offsets).
- No heartbeat gate: blank glyphs are not marks. A closed control pipe (HookBridge gone) or `OFF` restores real glyphs
  for everything rasterised afterwards, as in `blank`.
- In MeguLit (core/glyph-dots.cjs) `blank` is the mode of the launch flow when 文字显示 places text over the game
  (`textRenderer` `compositor`, or `placed`): the launcher and HookBridge start with `MEGULIT_GLYPH_MODE=blank`
  (HookBridge also `MEGULIT_GLYPH_ALL=1`). Not blind by default: a blind blank in the dialogue font would also erase
  names and menus the overlay never draws. `dot` (dot-blind) stays available with `MEGULIT_CAPTURE_COMPOSITOR=1` or
  `MEGULIT_GLYPH_MODE=dot`.
- Self-test (`run-dots.cmd`, x86/x64): TextOut, ExtTextOut with `lpDx`, baseline alignment, GetGlyphOutline and
  DrawGlyphRun leave no ink; every character is reported once with the expected origin in `m1000x90`, in `c` (a
  hidden, never shown window whose child at (50,30) must map to client (50+x, 30+y) of the top-level window), in
  `t1000x90`, and `-` for GetGlyphOutline; `blank-blind` leaves no ink either.

### Names and choices (extra lines, spec 3)

The name plate and the choices are not part of the dialogue line, so the line matcher never touches them. For
acceptance item (h) they can be pushed as **extra lines**, each blanked and reported on its own:

- Bridge → DLL: `EXTRA n <name>` (replaces the previous name), `EXTRA o <choice>` (one per option on screen),
  `EXTRA-CLEAR n` / `EXTRA-CLEAR o`; `OFF` clears them. At most 16, each valid 60 s, blanks stripped.
- Matched only by whole-string draws (TextOut / ExtTextOut / DrawText, GDI+, Direct2D), which carry a position: the
  stripped string equals the extra or is a part of it with two characters or more, in any font size. Those draws are
  blank (as `MODE blank`) and reported. A per-glyph engine (GetGlyphOutline) gives no position, so its names and
  choices are left alone rather than hidden without a replacement.
- DLL → bridge: `ToMe_GLYPHDOT extra id=<n> kind=<n|o> text=<text>` once per extra, then
  `ToMe_GLYPHDOT xdots id=<n> path=<p> list=<dot>;...` (same 12-field records, kind `n` / `o`, index into the extra's
  text, each index once per id). Ids count on their own, separate from the line `seq`.
- Bridge → front end: `{"type":"hookGlyphExtra","state":"line","id":1,"kind":"n","text":"古河渚"}` and
  `{"type":"hookGlyphExtra","state":"dots","id":1,"path":"text","dots":[...]}`. HookNative keeps them in
  `state.hookGlyphExtras` (a new name replaces the old one).
- Front end → bridge: `{"type":"glyphExtras","names":true,"choices":["…","…"]}` (`HookNative.setGlyphExtras`). `names`
  makes the bridge push every line of the name stream (`role 2`); `choices` replaces the options (`[]` clears).
  **Off by default**: turn it on only when the reader overlay draws names and choices itself, otherwise they would
  disappear. Note for the overlay: the current choice flow finds choice boxes by OCR of the drawn options; once the
  options are blank, their boxes must come from these records instead (`core/glyph-place.cjs extraRects`, which also
  gives each choice a `click` point in client pixels to post to the game window).
- Self-test (`run-dots.cmd`): a pushed name drawn in a 20 px font and a choice leave no ink, an unrelated string is
  drawn, each character is reported once at its cell origin, `EXTRA-CLEAR o` brings the choice back.

### GetGlyphOutline engines: no position (status 2026-11-15)

CLANNAD (Siglus), ISLAND (CatSystem2) and Under The Moon (AdvHD) take each glyph with GetGlyphOutline and place it
themselves (into their own texture or surface). Their records carry the character, cell height, ascent and advance
(`a` = `gmCellIncX`) but `space` `-`. What was looked at:

1. Following the glyph bitmap to where it is drawn. The engines copy the returned buffer into their own memory (a
   locked Direct3D texture or a system-memory surface) with their own code, not through a GDI call, so no GDI hook
   (BitBlt, StretchDIBits, UpdateLayeredWindow) sees it. Catching the copy itself would need a guard page on the
   engine's buffer plus single-stepping its copy loop, or a Direct3D texture/draw tracker that maps an atlas cell to the
   quad that samples it (layer ④'s territory). Neither can be built or checked without running the games; not done.
2. Relative layout from the metrics (`a`, `h`, `b` per character, in reading order) is already in the records. What is
   missing is the origin of the first character and the wrap width. A blank line has nothing to locate on screen; the
   only frame that shows the text is one that is not blanked, which item (d) forbids. Not done.
3. **Locating marks** (2026-11-15, the way chosen): see the next section. Until a game is calibrated, and for engines
   that do not use `GGO_GRAY8_BITMAP`, the fallback below applies.
4. Fallback: the line is still blank in the game, so the original never shows (d), and the records
   tell the overlay it cannot place the line (`glyphRects` returns null for `space` `-`). The overlay then shows the line
   its old way (its own text panel, translation beside, words clickable, clicks elsewhere to the game: (c)(e)). Only (a)
   "in the original place" is not met for these engines.

### Locating marks (`MARK on`, GetGlyphOutline engines)

The origin of a line and the wrap width are the same for every line of a game whose text box does not move. They are
learned from three marks the DLL leaves in blank mode, then every later line is laid out from its records alone.

- **The mark**: with `MARK on`, the `GGO_GRAY8_BITMAP` glyph of the first, second and last character of the pushed line
  keeps one pixel at its black box's top-left with coverage 1 of 64, the weakest a GRAY8 glyph can have. The game
  composites it like any glyph pixel: the pixel moves at most 255/64 ≈ 4 levels of 255 from the background towards the
  text colour (white text on a black box: 0 → 4; dark text on a white box: 255 → 251). One pixel, three per line. Other
  formats get no mark (GRAY4 would be 16 levels, GRAY2 64, mono full), and such games stay on the fallback. The record of
  a marked glyph has `s` = 1. `ToMe_FONT status ggo ... gray8=<n>` tells which format a game uses.
- **Finding it** (reader side, `core/glyph-locate.cjs findMarks`): two captures of the game's client area (PrintWindow /
  Windows.Graphics.Capture), the first taken when the text box is empty at the start of the line, the second when the
  line is complete. Marks = clusters of at most 3x3 pixels changed by 1..12 levels with no larger change within one
  pixel (the game's animations are larger changes and are skipped).
- **Solving it** (`locate`): every pair of marks on one row whose distance matches the first character's advance gives a
  scale (client px per glyph px) and the origin; the last character's mark confirms it on the same row (and refines the
  scale), or on a later row gives the row pitch and the range of wrap widths that put it there (greedy wrap, with or
  without kinsoku). `merge` keeps one calibration per game (same origin: wrap range narrowed; another origin: replaced),
  stored as `data/glyph-place/<exe>-<size>.json` (`saveCalib` / `loadCalib`).
- **Using it** (`layout`): each character's box from its advance, the learned scale, origin, pitch and wrap width; the
  same shape as `glyph-place.glyphRects` with `space` `c`, `located: true`.
- When to run it: on the first lines of a game, again whenever placed text and the game disagree (box moved, animated
  box), then `MARK off`. Turning marks on costs nothing visible.
- Front end: `HookNative.setGlyphMarks(true|false)` → `{"type":"glyphMarks","on":…}` → `MARK on|off` (re-sent on every
  control connection while on).
- Tests: `run-dots.cmd` (exactly three mark pixels at the expected spots, value 252 on white, none in GRAY4, records
  `s` = 1); `validation/glyph-locate.test.cjs` (synthetic captures: dark and light boxes, animation and stray faint
  pixels, scale 1 and 1.25, a wrapped line teaching pitch and wrap width, the next line laid out within 2 px).
- Not verified live: whether a given engine keeps a coverage-1 pixel through its own compositing and scaling (a
  downscaled engine may average it away; then nothing is found and the fallback stays).

### Read-only streams and the flush delay (AdvHD)

A read-only stream's text reached HookBridge only after LunaHook's flush delay of 180 ms, after the game had already
rasterised the line, so its glyphs could not be matched one by one (blind mode, the only workaround, would also blank
names and menus in the same font). While placement covers every stream (`GlyphAll`) and the selected stream cannot
write back, HookBridge now sets the delay to 30 ms (`FlushFit`, logged as `hook flush delay 30 ms`), back to 180 ms
otherwise. Not verified live: whether AdvHD's hook fires before it rasterises, and whether a 30 ms delay splits its
lines.

### Compositor heartbeat (dot mode only)

Owner rule: the player never sees marks. MeguLitFont serves dots only while the capture compositor presents this game:
it reads `Local\MeguLitCompositorBeat-<game pid>` (`magic 0x4243474D 'MGCB'`, `version 1`, `compositorPid`, `presenting`,
`tickMs` = GetTickCount64, `frames`; written by ② every 50 ms). Before any heartbeat was seen, dots are allowed for 20 s
from DLL load (early injection starts before the compositor). Once one was seen: only while `presenting == 1` and
`now − tickMs ≤ 1000 ms`, checked before every glyph/string and by a 250 ms watcher. Otherwise every path answers
"not matched", so the game gets its real glyphs and strings at once (MeguLit, HookBridge or the compositor crashing or
closing all end here). On a lapse the DLL sends once `ToMe_GLYPHDOT status needs-relaunch served=<n>` when dots were
already served (an engine cache may still hold them; MeguLit offers a restart) or `status paused` when none were; when the
heartbeat comes back, `status live`, and only glyphs rasterised from then on become dots. Blank mode is not affected.
Self-test: `run-dots.cmd` (fresh beat → dot, presenting 0 → real at once, needs-relaunch reported, back → dots, stale 5 s → real).

### Reports (DLL → HookBridge, pipe `\\.\pipe\MeguLitFont-<pid>`, UTF-8 lines)

```
ToMe_GLYPHDOT line seq=<n> text=<line>
ToMe_GLYPHDOT dots seq=<n> path=<ggo|text|gdip|d2d|run> list=<dot>;<dot>;...
ToMe_GLYPHDOT cache seq=<n> missing=<a> of <b>
```

- `seq` increases with every new line the bridge pushes; in dot mode `line` is sent as soon as the line is pushed (before the game draws it), so the dot count is known in advance. `text` is that line **with all blanks removed** (U+0000–U+0020,
  U+3000, U+200B, U+FEFF). Character indices below index into this text. `line` comes before the first `dots` of its seq.
- `<dot>` = `i:u:h:b:a:x:y:s:k:px:py:space` (spec 3; spec 1–2 records end after `k`, readers accept both)
  - `i` index into the line text (`-1` unknown), `u` the character as hex UTF-16 code unit,
  - `h` cell height px, `b` ascent px (baseline from the cell top), `a` advance px,
  - `x`,`y` offset of the dot's top-left from the cell's top-left (cell top-left = dot − (x, y)); 0,0 for GDI+/Direct2D,
  - `s` nominal dot side (the drawn square may be clipped to a smaller black box),
  - `k` kind: `d` character of the current line, `c` drawn again after it was matched (index of its last placement),
    `p` character of the previous line (index into the previous line's text), `r` ruby kana over a matched draw (`i`=-1).
  - `px`,`py`,`space` the cell's top-left and the space it is in (`c`, `m<W>x<H>`, `t<W>x<H>`, `g`, `-`; see
    "Placement"). Reported in every mode that reports, dots included; `s` = 0 in `blank` mode (no dot drawn).
  `b` blind dot (`MODE dot-blind`, `MODE blank-blind`): drawn before its line arrived; it carries the seq of the last pushed line and belongs
  to the line pushed next. Map blind dots to that line's characters by reading order. Blind records are deduplicated per
  (character, height) within a seq, so repeated characters appear once in the records but as many times as drawn on screen.
- Every (index, kind) is reported **once per line** (ruby: once per character and height), even when the game redraws the
  line every frame. Records are batched (at most 48 dots, flushed after 25 ms); one line may span several `dots` records.
- `cache`: the engine reuses glyphs it rasterised earlier (two lines in a row left out at least three already matched
  characters). In dot mode this is **acceptable and reported once per run**; dots go on. A reused dot carries no new
  report: it shows up as a dot for which no record arrived in this line. ② may map such dots by reading order
  (dots in order = non-blank characters of the line in order) or treat them as unknown.
- The existing `ToMe_GLYPHHIDE ready|key|hit|line` records are unchanged; `ready` now reads
  `ready version=3 modes=blank,dot,place records=4`.

### Events (HookBridge → front end, stdout JSON)

```
{"type":"hookGlyphDots","state":"line","seq":7,"text":"吾輩は猫である。"}
{"type":"hookGlyphDots","state":"dots","seq":7,"path":"ggo","dots":[{"i":0,"ch":"吾","h":28,"b":24,"a":28,"x":1,"y":2,"s":3,"k":"d"}, ...]}
{"type":"hookGlyphDots","state":"dots","seq":8,"path":"text","dots":[{"i":0,"ch":"次","h":28,"b":24,"a":28,"x":0,"y":0,"s":0,"k":"d","at":{"x":120,"y":440,"space":"c"}}, ...]}
{"type":"hookGlyphDots","state":"cached"}
```

`at` is present when the source knows the cell origin (`space` other than `-`); `core/hook-native.cjs` keeps it.

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

#### Which engines in the E:\GAL import scan draw dialogue through GDI (2026-11-14)

Importing GetGlyphOutline/TextOut is not enough: many engines call GDI only for metrics or menus. Measured live with the
font probe (`ToMe_FONT` counts and the matcher's `placed`/`requested`):

| Game (engine) | GDI calls during dialogue | Dots possible at ① |
|---|---|---|
| ダストマニア（BRUNS） | none: bitmap font sheets `fontf_*.bmp` | no → engine level |
| THE SHELL HD（Artemis, x64） | none: own rasteriser | no → ③ |
| ファタモルガーナの館（KiriKiri Z + addFont TTF） | only Segoe UI 12 px UI text | no → ③ |
| サノバウィッチ（Yuzusoft KiriKiri Z） | GetGlyphOutline **metrics only** (SimSun 48, hundreds of chars placed, 0 rasterised) | no: glyphs rasterised elsewhere → ③ |
| 沙耶の唄（Nitro+ 2003） | GDI rasterisation (ＭＳ Ｐゴシック 24), but each glyph once (cache) and LunaHook finds no dialogue stream | only with a stream; cached dots |
| 素晴らしき日々（BGI） | TextOutA per character at 136 px, scaled to ~28 px; EmbedBGI stream | **yes, live** with spec 2 dots (14 px before scaling, visible after): first line 9/9 incl. 「」, name untouched; later lines reuse cached dots. The START path hangs in the opening movie with or without MeguLit (game side); tested through LOAD (live\bgi-dots.png) |
| CLANNAD（SiglusEngine, Steam build） | GetGlyphOutline rasterisation, ~36 px (scaled to the window), **once per character** (glyph cache) | **yes, live** with `all:true` on the `EmbedSiglus` stream: every character rasterised during a pushed line became a dot with the game's own shadow, at the right cell, advance unchanged (shot H:\MeguLit-Work\glyph-dots\live\clannad-siglus-dots*.png). Characters already in Siglus' cache are drawn as before, and a dotted character stays a dot wherever it is reused (also outside the dialogue) |
| ISLAND（CatSystem2） | GetGlyphOutline rasterisation (ＭＳ ゴシック 28), every line re-rasterised | **yes, live**: every character of every line on the page became a dot (`all:true`, embed stream; live\island-cs2-dots.png) |
| サイコロジック・ラブコメディ（YU-RIS） | TextOutA per character into its glyph cache, once the episode is entered (title and episode menu draw no GDI text) | **yes, live** (oss-universal session, H:\MeguLit-Work\oss\yuris2\l3.png): with early launch + `dot-blind` every dialogue character is a dot (path=text, h=100, s=10), the name plate is untouched. My earlier "no GDI" result never left the episode menu (enter via PRESENT01) |
| 月姫 PLUS+DISC（KiriKiri2, Chinese patch） | GDI rasterisation (宋体 22) | not with its stream: only a non-write-back `KiriKiri1` stream, whose text arrives after the glyphs are drawn (17 rasterised, 0 placed) |
| 女装山脈 | — | did not start (launcher exits; probably needs a Japanese locale) |
| いろとりどりのヒカリ（FAVORITE） | — | reached the title only; stopped because other sessions' game windows covered the screen |
| Under The Moon（AdvHD / Will） | GetGlyphOutline rasterisation (MS Gothic 20); only read-only streams, text arrives after the glyphs | **yes, live with `MODE dot-blind`**: both dialogue lines fully dotted (kind `b`), name box untouched (live\advhd-blind-dots.png). Needed a probe fix: its fonts carry no face name in LOGFONT, now read with GetTextFaceW |
| Not run: AIR (avg32), 涙 | TextOutA / GetGlyphOutline imports | candidates for the next live run |

Rule seen live: dots need the line **before** the glyphs are rasterised, i.e. a write-back (embed) stream with `all:true`; a read-only stream is ~180 ms late. CatSystem2, Siglus, BGI, AdvHD and YU-RIS show real dialogue dots (limited by its glyph cache; ② drew 16 of 17 CLANNAD lines on the game's cells from these dots). For caching engines dot mode must be on and the stream selected before the first dialogue glyph is rasterised (MODE dot at connect + the remembered stream pre-armed at start), otherwise the characters cached earlier stay real for the whole process; HookBridge does both: MODE is sent at connect, the dot passthrough remembers the stream, and with `all:true` a remembered stream is never displaced by another stream that speaks first (title menus). Verified on CLANNAD: fresh process, NEW GAME, the first line 一面、白い世界… = 8 records, 8 dots, no other ink (live\clannad-first-line-dots.png); the cases above are what decides ①'s reach. The x86/x64 self-test hosts
remain the proof that every covered API produces exact dots.
