# Text architecture: MeguLit draws the game's text

Agreed with the owner on 2026-11-14. MeguLit draws every line of dialogue itself, in the place and size where the game
would have drawn it. Three parts, each with its own section below:

1. **Glyph dots** (`feat/glyph-dots`): wherever a game asks Windows for a glyph or draws a string, a dialogue character
   becomes a small dot with the original metrics, so layout, wrapping and pacing stay the game's own.
2. **Capture compositor** (`feat/capture-compositor`): captures the game window, finds the dots, erases them, draws
   MeguLit's text at their positions and shows the result in MeguLit's own window.
   Details: docs/text-architecture-compositor.md.
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
too, send `{"type":"glyphMode","mode":"dot","all":true}` (or `MEGULIT_GLYPH_ALL=1`): the selected write-back stream's
embed callback then pushes the line to the DLL first and hands the text back unchanged, so the line is known before the
game draws it (the plain text output arrives after the glyphs are drawn, e.g. BGI: ~180 ms late).

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
| 素晴らしき日々（BGI） | GetGlyphOutline rasterisation (MS Gothic 136 bold) | yes in principle, but the plain text output arrives ~180 ms after the glyphs; needs `all:true` (line pushed from the embed callback). Live run blocked: the opening movie (MoleBox) hangs on this machine with replacement on, also in blank mode |
| CLANNAD（SiglusEngine, Steam build） | GetGlyphOutline rasterisation, ~36 px (scaled to the window), **once per character** (glyph cache) | **yes, live** with `all:true` on the `EmbedSiglus` stream: every character rasterised during a pushed line became a dot with the game's own shadow, at the right cell, advance unchanged (shot H:\MeguLit-Work\glyph-dots\live\clannad-siglus-dots*.png). Characters already in Siglus' cache are drawn as before, and a dotted character stays a dot wherever it is reused (also outside the dialogue) |
| Not run: 月姫/PLUS+DISC, AIR (avg32), 女装山脈, サイコロジック・ラブコメディ, Under The Moon, 涙 | TextOutA / GetGlyphOutline imports | candidates for the next live run |

Only Siglus shows real dialogue dots so far (limited by its glyph cache; ② drew 16 of 17 CLANNAD lines on the game's cells from these dots). For caching engines dot mode must be on and the stream selected before the first dialogue glyph is rasterised (MODE dot at connect + the remembered stream pre-armed at start), otherwise the characters cached earlier stay real for the whole process; the cases above are what decides ①'s reach. The x86/x64 self-test hosts
remain the proof that every covered API produces exact dots.
