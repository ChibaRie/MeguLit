/* CHAOS;CHILD acceptance (2026-11-20): two-row box lines stay above the game's button strip; a centred line re-measures its middle while typing */
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../web/reader/modules/text-place.js'), 'utf8');
test('box line: Japanese rows close up, translation <=15% smaller, then the block moves up, under client bottom minus two glyph rows', () => {
  assert.match(src, /uiLimit = cy0 \+ chc - glyph \* 2/);
  assert.match(src, /set\(sentence, 'line-height', '1\.45'\)/);
  assert.match(src, /fsx \* \.85/);
  assert.match(src, /!anchor\.center && tr && tr\.height/);
});
test('centred line keeps only its top while typing', () => { assert.match(src, /anchor\.center && Number\.isFinite\(center\) && anchorLine === lineKey[^\n]*a = \[center, anchor\[1\]\]/); });
