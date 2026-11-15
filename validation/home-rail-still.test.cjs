const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'home-tv.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'home-tv.css'), 'utf8');

/* 2026-11-15 (user: 别让他动 … 最多10张): the strip is still, shows at most 10 games once, picking dissolves the upper block */
test('the hand strip shows at most 10 games, once, and never slides', () => {
  assert.ok(src.includes('list.slice(0,10)'));
  assert.ok(!src.includes('centerRail'));
  assert.ok(!src.includes('[0,1,2].map(c=>list.map'));
});
test('picking a card dissolves the upper block with opacity only', () => {
  assert.ok(src.includes('function fadeEls'));
  assert.ok(src.includes("mode==='fade'"));
  assert.ok(/\.tv-rail-in\{[^}]*transform:none!important/.test(css));
  assert.ok(/\.tv-chip\.on\{transform:translateY\(-10px\)/.test(css));
});
