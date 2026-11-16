const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path');
const {engineMarkup,japaneseTrack}=require('../core/language-tracks.cjs');
test('2026-11-16: engine markup with arguments is stripped before text is shown or translated (all engines)',()=>{
 assert.strictEqual(engineMarkup('然后%p-1;%fMS 哥特;——%p;%fuser;杀人%p-1;%fMS 哥特;————%p;%fuser;。'),'然后——杀人————。');
 assert.strictEqual(japaneseTrack('そして%p-1;%fMS ゴシック;──%p;%fuser;殺人。'),'そして──殺人。');
 assert.strictEqual(engineMarkup(String.raw`\C[2]こんにちは\C[0]`),'こんにちは','RPG Maker escapes');
 assert.strictEqual(engineMarkup('<color=#ff0>赤</color><b>太</b>'),'赤太','rich text tags');
 assert.strictEqual(engineMarkup('行く[r]次[font size=30]だ[l]'),'行く次だ','KAG inline tags');
 assert.strictEqual(engineMarkup('[ルビ]と[1]は 50%です;'),'[ルビ]と[1]は 50%です;','text in brackets and percent signs stay');
});
test('2026-11-16: a patch translation goes through the same markup strip',()=>{
 assert.match(fs.readFileSync(path.join(__dirname,'../core/hook-native.cjs'),'utf8'),/chinese:require\('\.\/language-tracks\.cjs'\)\.engineMarkup\(r\.translation\)/);
});
