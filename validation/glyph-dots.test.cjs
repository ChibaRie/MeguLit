// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Text architecture part 1, glyph dots (2026-11-14, docs/text-architecture.md): MeguLit draws every dialogue line itself.
   MeguLitFont<bit>.dll serves, in MODE dot, a dot glyph with the original metrics for every matched dialogue character
   (a 3x3 / 2x2 full-coverage square at the black box top-left) and reports each served dot once per line, so the capture
   compositor can find, erase and replace them. MODE blank (version 2) stays the default and the fallback.
   Native self-tests: native/fontprobe/selftest/run-dots.cmd (x86 + x64, PNG per API, exact dot count and positions). */
const test=require('node:test'),assert=require('node:assert'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('spec: docs/text-architecture.md publishes the dot geometry, records, events and a change log',()=>{
 const d=read('docs/text-architecture.md');
 for(const s of ['## ① Glyph dots','## Changes to this document','| 1    | 2026-11-14 |','ToMe_GLYPHDOT line seq=<n> text=<line>','ToMe_GLYPHDOT dots seq=<n> path=<ggo|text|gdip|d2d|run> list=<dot>;<dot>;...','`<dot>` = `i:u:h:b:a:x:y:s:k`','ToMe_GLYPHDOT cache seq=<n>','"type":"hookGlyphDots"','{"type":"glyphMode","mode":"dot"}','"all":true','MEGULIT_GLYPH_ALL=1','MEGULIT_GLYPH_MODE=dot','run-dots.cmd'])assert.ok(d.includes(s),s);
 assert.match(d,/\*\*Side\*\* `s` \(spec 2\) = 2 px when the cell height/);});

test('DLL: dot mode keeps metrics, draws one square per character, reports every dot; blank mode unchanged',()=>{
 const c=read('native/fontprobe/FontProbe.cpp');
 assert.match(c,/#define MEGULIT_FONT_VERSION 3/);assert.ok(c.includes('MeguLitFontVersionTag[] = "MeguLitFont version=3"'));
 assert.ok(c.includes('else if (l == "MODE dot" || l == "MODE blank" || l == "MODE dot-blind") { bool dot = l != "MODE blank", blind = l == "MODE dot-blind"; Hide.StopOnCache = !dot;'),'MODE command; cache stops only blank mode');
 assert.ok(c.includes('" modes=blank,dot"'),'ready answers the modes');
 assert.ok(c.includes('int DotSide(int cellHeight) { return cellHeight < 12 ? 2 : (std::max)(3, (cellHeight + 5) / 10); }'),'dot side as in the spec (2)');
 assert.match(c,/if \(!b \|\| !n \|\| \(f & 0x0f\) == GGO_METRICS\) return r;/,'size queries and metrics untouched in dot mode');
 assert.match(c,/BYTE full = kind == GGO_GRAY2_BITMAP \? 4 : kind == GGO_GRAY4_BITMAP \? 16 : 64;/,'full coverage per gray format');
 assert.match(c,/h->dwType = TT_POLYGON_TYPE; h->pfxStart = pt\(x0, y0\);/,'outline: square contour from the black box top-left');
 assert.ok(c.includes('return DotMode ? Dotted(dc, x, y, o, r, text, glyphs, n, dx, sv, seq) : Skipped(dc, x, y, o, r, text, glyphs, n);'),'strings: dots or left out');
 assert.ok(c.includes('if (lf.lfEscapement || lf.lfOrientation || lf.lfFaceName[0] == L\'@\''),'vertical fonts fall back to blank');
 assert.ok(c.includes('run = HookAt(vt[29], (void *)&HDrawGlyphRun, (void **)&ODrawGlyphRun);'),'ID2D1RenderTarget::DrawGlyphRun hooked');
 assert.ok(c.includes('Gp.SetSmoothing(g, 3 /* SmoothingModeNone */);'),'GDI+ dots are crisp squares');
 assert.ok(c.includes('l == "MODE dot-blind"')&&c.includes('if (!r && BlindMode && BlindChar(ch) && (ch || index) && Hide.DialogueKey(KeyOf(f))) { r = true; if (sv) *sv = GlyphHide::Served{-1, \'b\'}; }'),'blind dots: dialogue font only, kind b');
 assert.ok(c.includes('rt->SetAntialiasMode(D2D1_ANTIALIAS_MODE_ALIASED);'),'Direct2D dots are crisp squares');
 assert.match(c,/Send\("ToMe_GLYPHDOT line seq=" \+ std::to_string\(seq\) \+ " text=" \+ Utf8\(text\)\)/);
 assert.match(c,/Send\("ToMe_GLYPHDOT dots seq=" \+ std::to_string\(DotSeq\) \+ " path=" \+ DotPath \+ " list=" \+ DotBuf\)/);
 assert.ok(c.includes('sprintf_s(e, "%s%d:%04x:%d:%d:%d:%d:%d:%d:%c"'),'dot record i:u:h:b:a:x:y:s:k');
 assert.ok(c.includes('if (DotSeen.size() < 1024 && DotSeen.insert(key).second)'),'each dot once per line');
 assert.doesNotMatch(c,/kirikiri|krkr|siglus|yuris|bruns|renpy|clannad/i,'no engine or game names');
 const g=read('native/fontprobe/GlyphMatch.h');
 assert.ok(g.includes('Report("ToMe_GLYPHDOT cache seq="'),'dot mode reports a glyph cache and goes on');
 assert.ok(g.includes('inline std::vector<int> Locate('));
 const m=read('native/fontprobe/selftest/match.cpp');
 for(const s of ['dots: per-glyph walk serves index i, kind d','dots: a whole string maps each character to its index in the line','dots: a glyph cache is reported (ToMe_GLYPHDOT cache) and dots go on'])assert.ok(m.includes(s),s);
 const h=read('native/fontprobe/selftest/dothost.cpp');
 for(const s of ['"ggo-gray8"','"ggo-native"','"ggo-bezier"','"ggo-mono"','Dots("textouta-sjis"','Dots("exttextoutw-glyphindex"','Dots("drawtextw"','Dots("gdip-drawstring"','Dots("gdip-drawdriverstring"','Dots("d2d-drawtext"','Dots("d2d-drawtextlayout"','Dots("d2d-drawglyphrun"','dot glyph keeps the original metrics and buffer size','nothing else','every index once','Dots("blind-ggo"','blind: the same text in another size is drawn normally'])assert.ok(h.includes(s),s);
 assert.doesNotMatch(h,/CreateWindow/,'self-test never opens a window');
 const nb=JSON.parse(read('native/native-builds.json')).find(e=>e.name==='fontprobe');
 assert.ok(nb.selftests.includes('native/fontprobe/selftest/run-dots.cmd'),'run-dots wired into Build.ps1 and CI');assert.equal(nb.marker,'MeguLitFont version=3');assert.equal(nb.ci,true);});

test('HookBridge: MODE on connect and on change, LunaHook GDI hide off for dot streams, dots forwarded',()=>{
 const b=read('native/HookBridge.cs');
 assert.ok(b.includes('w.WriteLine(GlyphModeLine());')&&b.includes('static string GlyphModeLine(){return GlyphMode=="dot"&&GlyphBlind?"MODE dot-blind":"MODE "+GlyphMode;}'),'mode sent on every control connection');
 assert.ok(b.includes('static string GlyphMode=Environment.GetEnvironmentVariable("MEGULIT_GLYPH_MODE")=="dot"?"dot":"blank";'),'blank by default');
 assert.ok(b.includes('else if(type=="glyphMode"){object mv,av,bv;GlyphAll=d.TryGetValue("all",out av)&&Convert.ToBoolean(av);GlyphBlind=d.TryGetValue("blind",out bv)&&Convert.ToBoolean(bv);GlyphModeSet('));
 assert.ok(b.includes('static bool DotsOwn(Candidate c){return GlyphMode=="dot"&&c!=null&&c.gdiProbe;}')&&b.includes('if(GlyphMode=="dot"&&GlyphAll&&Selected!=""&&tp.Key()==Selected){GlyphLine(text);Thread.Sleep(8);try{Luna_EmbedCallback(tp,text,text);}')&&b.includes('lock(Gate){ReceivedText=true;ReplacementCallback=true;}RememberStream();'));
 assert.ok(b.includes('on=(ReplacementEnabled||ProbeWanted)&&!DotsOwn(c);'),'probe never arms the GDI hide in dot mode');
 assert.ok(b.includes('&&!DotsOwn(Candidates[Selected]))Luna_UseEmbed(Candidates[Selected].tp,true);'),'nor does a reconnect');
 assert.ok(b.includes('else if(line.StartsWith("ToMe_GLYPHDOT ",StringComparison.Ordinal))GlyphDots(line.Substring(14));'));
 assert.ok(b.includes('Emit(new{type="hookGlyphDots",state="dots",seq='));});

test('front end: hookGlyphDots builds the current line table per seq and is re-emitted',()=>{
 const {HookNative}=require('../core/hook-native.cjs');const h=Object.create(HookNative.prototype);const out=[],sent=[];
 Object.assign(h,{state:{},trace(){},emit:m=>out.push(m),send:m=>sent.push(m)});
 h.glyphDots({type:'hookGlyphDots',state:'line',seq:3,text:'吾輩は猫'});
 h.glyphDots({type:'hookGlyphDots',state:'dots',seq:3,path:'ggo',dots:[{i:0,ch:'吾',h:28,b:24,a:28,x:1,y:2,s:3,k:'d'},{i:1,ch:'輩',h:28,b:24,a:28,x:1,y:1,s:3,k:'d'}]});
 h.glyphDots({type:'hookGlyphDots',state:'dots',seq:3,path:'ggo',dots:[{i:1,ch:'輩',h:28,b:24,a:28,x:1,y:1,s:3,k:'d'},{i:2,ch:'は',h:28,b:24,a:28,x:3,y:2,s:3,k:'d'}]});
 assert.equal(h.state.hookGlyphDots.text,'吾輩は猫');assert.deepEqual(h.state.hookGlyphDots.dots.map(d=>d.i),[0,1,2],'merged, no duplicates');
 h.glyphDots({type:'hookGlyphDots',state:'dots',seq:4,path:'text',dots:[{i:0,ch:'次',h:28,b:24,a:28,x:0,y:0,s:3,k:'d'}]});
 assert.equal(h.state.hookGlyphDots.seq,4);assert.deepEqual(h.state.hookGlyphDots.dots.map(d=>d.ch),['次'],'a new seq starts a new table');
 h.glyphDots({type:'hookGlyphDots',state:'cached'});assert.equal(h.state.hookGlyphDots.cached,true);
 h.glyphDots({type:'hookGlyphDots',state:'dots',seq:4,dots:[{i:'x',ch:1,k:'z'}]});assert.equal(h.state.hookGlyphDots.dots.length,1,'malformed dots ignored');
 assert.equal(out.filter(m=>m.type==='hookGlyphDots').length,6,'every event re-emitted');
 h.setGlyphMode('dot');h.setGlyphMode('weird');assert.deepEqual(sent,[{type:'glyphMode',mode:'dot'},{type:'glyphMode',mode:'blank'}]);});
