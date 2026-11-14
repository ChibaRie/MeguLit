# Text marks: the second mark type (game draws 「・」)

Part of docs/text-architecture.md (owner 2026-11-14). Glyph dots (①) turn each glyph into a small square at the
glyph's top-left. Text marks do it one step earlier, at the text hook: every visible character of the line is replaced
by a mark character before the game lays the line out, so **the game itself draws a row of marks** with its own font,
colour, effects, wrapping and pacing. The capture compositor finds the marks the same way it finds dots.

## Mark shape (for the compositor)

| Original character | Mark | Shape the game draws |
|--------------------|------|----------------------|
| full-width (kana, kanji, full-width letters and punctuation) | 「・」 U+30FB (cp932 `81 45`, UTF-8 `E3 83 BB`) | a **centred middle dot** in a full-width cell: horizontally centred in the advance, vertically at about the middle of the em box, size about 1/6–1/5 of the font height |
| half-width (ASCII, half-width katakana) | 「･」 U+FF65 (cp932 `A5`, UTF-8 `EF BD A5`) | the same dot centred in a half-width cell |

- Not a top-left square: the character's cell is the mark's centre ± half the advance; for a full-width font the cell
  is about one font height wide, centred on the mark.
- The mark is drawn by the game, so it carries the game's text colour, outline, shadow (several offset copies) and
  gradient, exactly as a glyph would.
- One mark per visible character, in reading order, same count as the original line (`hookTextMarks` `marks`).
- Blanks (U+3000, spaces), line breaks and anything non-printing stay as they were, so the game wraps the marked line
  where it would have wrapped the original (BRUNS, YU-RIS: verified).
- Engine codes and markup stay byte for byte (YU-RIS ruby `＜base／ruby＞`, `\xEF\xF0-F5`, `\x81\x98`): a construct
  that is itself drawn (YU-RIS `／` = `81 5E`) stays visible as the original glyph; ruby readings are marked too and
  drawn small above their base, like the original ruby.

## Where it happens (`MEGULIT_TEXT_MARKS=1` or `{"type":"textMarks","on":true}` on HookBridge stdin)

- Write-back streams (EMBED_ABLE): HookBridge's reply is `EmbedTextPolicy.Mark(text)` instead of `Hide(text)`: the same
  rules (labels, resources, constructs, ruby, skip bursts are left alone exactly as for Hide), every visible character
  becomes a mark. YU-RIS lines with codes are rebuilt in place from the raw bytes in the hook DLL (`Yuris.cpp`
  `BlankInPlace(..., mark)`), so the size table never changes (E463).
- Per-character hooks whose character is a call argument (BRUNS `std::wstring::push_back(wchar_t)`): the hook DLL
  replaces the argument by U+30FB before the original runs (`native/megulithook/MeguLitMarks.h`), while the stream is
  selected and `Local\MeguLitMarks-<pid>` is set. ASCII is left alone (engines keep their codes there, BRUNS `$N`).

## Reports

- HookBridge stdout: `{"type":"hookTextMarks","state":"on"|"off","mark":"middle-dot"}`,
  `{"type":"hookTextMarks","state":"line","path":"embed","text":...,"marks":N,"mark":"middle-dot"}` per written line,
  `{"type":"hookTextMarks","state":"hit","path":"char","mark":"middle-dot"}` when the hook DLL confirms a marked
  per-character line (`MeguLit_MARKS hit char version=1`, once per line).
- The crash canary of layer 4 covers it (`data/gpu-hide/<exe>-<size>.json`): a game that died by an exception
  (0xC0000000–0xCFFFFFFF) while it was on gets it refused next time. A forced kill (0xFFFFFFFF) is not a crash.

## Live (2026-11-14, muted, new game)

- ダストマニア・グロテスク (BRUNS, gameplay.exe): every line after the stream is selected is a row of dots,
  15 chars → 15 marks, 16 → 16, `MeguLit_MARKS hit` per line. The first line of a session is drawn before the stream
  is selected and stays original (as with every write-back).
- サイコロジック・ラブコメディ (YU-RIS, saikoro.exe): lines 33/22/42/50 chars written back as marks with the same byte
  count, wrapped where the original wraps; the line with the date code (`――4031.12.26／392`) keeps `／` and its codes.
  No engine error.
- Not done: name plates (separate stream), choices and UI text (not dialogue streams).
