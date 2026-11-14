# Open-source projects that do what MTool does (2026-11-14)

What we looked for: tools that take or replace a game's text without per-game setup. Sources were cloned to
H:\MeguLit-Work\oss\ and read, not run. MTool itself is closed source; we did not download it or reverse engineer it.

| Project | Licence | Engines | Where it intercepts text | What MeguLit takes |
|---|---|---|---|---|
| UniversalInjectorFramework (AtomCrafty) | none (all rights reserved) | any Win32 SJIS game | IAT/inline hooks on MultiByteToWideChar, IsDBCSLeadByte(Ex), GetGlyphOutlineA/W, TextOut/ExtTextOut/DrawText(Ex), GetTextExtent*, menus, dialogs, MessageBox, SetWindowText; character substitution + SJIS "tunnel" encoding | **idea only**: the conversion source (MultiByteToWideChar) |
| VNTextPatch + VNTextProxy (arcusmaximus) | MIT | 25+ engines on file level (AdvHD, Artemis, CatSystem, Ethornell/BGI, KiriKiri, Majiro, Musica, Qlie, RealLive, Ren'Py, Softpal, Whale, YU-RIS, …) | VNTextPatch rewrites script files. VNTextProxy is a proxy DLL (d3d9, ddraw, dinput8, msacm32, version, winmm, xinput1_3) that hooks the IAT for GDI text, CreateFont, D2D/DirectWrite (proportionalizer), SJIS tunnelling | proxy-DLL early load (we use MeguLitLaunch instead); script readers are already in services/original-engines |
| KirikiriTools (arcusmaximus) | MIT | KiriKiri 2/Z | version.dll proxy hooks the XP3 storage media (TVPXP3ArchiveStream); files in `unencrypted/` override the archive | idea noted: file-level redirect; not used (rule: no game data changed) |
| LunaHook / LunaTranslator embed (HIllya51) | GPL-3.0 | hundreds of engine hooks | per-engine text functions (H-codes), many with write-back ("embed") | already inside MeguLit (megulithook) |
| Textractor (Artikash) | GPL-3.0 | same family as ITH/LunaHook | engine hooks + generic GDI hooks, read-only | nothing new (LunaHook covers it) |
| XUnity.AutoTranslator (bbepis) | MIT | Unity (Mono / IL2CPP) | Harmony patches on UI text setters (uGUI Text, TextMeshPro, NGUI, IMGUI) | already in ③ unitytext |
| GalTransl (xd2333) | GPL-3.0 | offline, via other tools' extracted scripts | none at runtime | nothing |
| SExtractor (satan53x) | GPL-3.0 | offline script extraction, many engines | file level | already used for engine readers |
| RPG Maker MV/MZ translators (Translator++, mv-trans plugins) | various | RPG Maker MV/MZ | JS: Window_Base.drawText / processCharacter, `$dataXxx` JSON | covered by ③ web path |
| Ren'Py translation (built-in `tl`, renpy-translator) | MIT | Ren'Py | `say` / Text displayable | covered by ③ renpytext |
| TyranoScript translators | MIT | Tyrano (NW.js / Electron) | jQuery DOM text of `.message_inner` | covered by ③ web path |
| Wolf RPG translators (WolfTrans, UberWolf) | MIT / GPL | Wolf RPG | file level (.dat / .mps) | not used (file level) |

## Points MeguLit lacked, ordered by engines unlocked

1. **Conversion source, MultiByteToWideChar** (UIF idea). Engines that keep SJIS/UTF-8 scripts and rasterise with their own
   code convert each line first. Added to MeguLitFont as a third dot source (`path=conv`, mark U+30FB). See
   docs/text-architecture.md. Engines this can reach without other paths: FreeType/atlas engines that convert per line.
2. WideCharToMultiByte / lstrcpy family: not added; in the code we read they matter only for SJIS-only engines,
   which go through TextOutA / GetGlyphOutlineA, and ① already covers those.
3. File-level script redirection (VNTextPatch, KirikiriTools): changes game data, breaks the rule; left out.
4. KiriKiri patch through a proxy DLL: ③ already reaches KiriKiri through its plugin path.
5. LunaHook write-back functions: already used (`MEGULIT_GLYPH_ALL`).

## Finding during the live check

YU-RIS (サイコロジック) is **not** blocked: in dialogue it draws with TextOutA at 100 px, and the existing ① `text` path
turns every character into a dot. The earlier "0 calls" runs never got past the episode menu.
