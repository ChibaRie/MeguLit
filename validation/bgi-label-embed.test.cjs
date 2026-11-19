// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Live 素晴らしき日々 (BGI, 2026-11-19 integration): the selected EmbedBGI stream sent the label 「屋上と」 and the bridge
   switched the stream's embed off (416b2c63). Only the GDI probe is ever switched back on, so every later line went back
   unchanged: the game's text stayed under the reader (glyph hide placed=0 hidden=0, no more "guarded replace").
   A writable stream decides per line in OnEmbed and keeps its embed; only a probe stream is switched off.
   The short all-hiragana piece 「たばこと」 was a label to Hide (left on screen) but a line to the reader: drawn twice.
   Replay of the diagnostic order from that run: replace x7, passthrough たばこと, label 屋上と, then silence. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const bridge=fs.readFileSync(path.join(__dirname,'../native/HookBridge.cs'),'utf8');
const policy=fs.readFileSync(path.join(__dirname,'../native/EmbedTextPolicy.cs'),'utf8');

test('a label on the selected stream switches the embed off only for a probe stream',()=>{
 const label=/if\(selected&&EmbedTextPolicy\.Label\(text\)&&!EmbedTextPolicy\.ShortSpoken\(text\)\)\{([\s\S]*?)Diagnostic\("label not shown/.exec(bridge);
 assert.ok(label,'label branch');
 assert.match(label[1],/probeOnly=LabelStopsEmbed\(lc\)/);
 assert.match(label[1],/if\(probeOnly\)Luna_UseEmbed\(tp,false\)/);
 assert.doesNotMatch(label[1].replace(/if\(probeOnly\)Luna_UseEmbed\(tp,false\)/,''),/Luna_UseEmbed\(tp,false\)/,'no unconditional embed off');
 const rule=/static bool LabelStopsEmbed\(Candidate c\)\{return (.*?);\}/.exec(bridge)[1];
 const stops=c=>Function('c','return '+rule)(c);
 assert.equal(stops({embed:true}),false,'writable EmbedBGI keeps its embed');
 assert.equal(stops({embed:true,gdiProbe:true}),true);
 assert.equal(stops({embed:true,hideOnly:true}),true);
 assert.equal(stops({embed:false}),true);
 assert.equal(stops(null),true);
 assert.match(bridge,/if\(!LabelEmbedSelfTest\(\)\)\{Console\.Error\.WriteLine/,'native self-test wired');
});

test('the reader and the hide use one rule for short all-hiragana pieces',()=>{
 const spoken=new RegExp(/ShortSpoken\(string value\) \{ return Regex\.IsMatch\(\(value \?\? ""\)\.Trim\(\), "(.*?)"\); \}/.exec(policy)[1]);
 for(const t of ['たばこと','なるほど','ふぅ'])assert.ok(spoken.test(t),t);
 for(const t of ['屋上と','ロード','最初から','選択ライン'])assert.ok(!spoken.test(t),t);
 assert.match(bridge,/if\(replacement\.Length==0&&!printer&&!veil&&!\(MarksMode&&MarksLive\(\)\)&&EmbedTextPolicy\.ShortSpoken\(text\)\)replacement=EmbedTextPolicy\.HideSpoken\(text\);/);
 assert.ok(!bridge.includes('Regex.IsMatch(text.Trim(),"^[ぁ-ゖー～っ]+$")'),'the reader side uses the shared rule');
});
