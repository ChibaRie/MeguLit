// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* The skip key (Ctrl held), 2026-11-15 regression: "fast-forward works once per launch". MeguLit only reads the key
   (GalWindowBridge readerInput.skipHeld); the game keeps it. What has to hold, every time the key goes down, not only the
   first:
     - the host tells the bridge (so its hide layers stand down: HookBridge SetSkipHeld, self-tested in --self-test);
     - the reader layer goes away after 350 ms of holding and may come back after the release;
     - a key that just repeats (same state again) is not sent twice.
   Press, release, press ... three rounds. */
const test = require('node:test'), assert = require('node:assert/strict');
const { HookNative } = require('../core/hook-native.cjs'), { Immersion } = require('../core/immersion.cjs');

test('host: every press and every release of the skip key reaches the bridge, three rounds', t => {
  let now = 1000; const sent = [];
  const hook = new HookNative({ native: __dirname, hook: __dirname, logs: 'Z:/no-fixture-log' }, () => {}, () => {}, () => now);
  hook.trace = () => {}; t.after(() => hook.stop());
  hook.process = {}; hook.send = m => sent.push(m);
  for (let round = 1; round <= 3; round++) {
    hook.skipHeld(true); hook.skipHeld(true); /* the key repeating */
    assert.equal(hook.skipKey, true, 'round ' + round + ': held');
    now += 800; hook.skipHeld(false); hook.skipHeld(false);
    assert.equal(hook.skipKey, false, 'round ' + round + ': released');
    now += 1500;
  }
  hook.process = null;
  assert.deepEqual(sent.filter(m => m.type === 'skipHeld').map(m => m.held), [true, false, true, false, true, false]);
});

test('reader layer: hidden while the key is held, back with the next line, three rounds', () => {
  let now = 1000; const seen = [];
  const im = new Immersion(m => { if (typeof m.dialogVisible === 'boolean') seen.push(m.dialogVisible); }, () => now);
  im.configure({ immersion: true, dialogDetection: 'hook' });
  for (let round = 1; round <= 3; round++) {
    assert.equal(im.visible, true, 'round ' + round + ': shown before the press');
    im.skip(true); now += 100; im.tick(); assert.equal(im.visible, true, 'round ' + round + ': a tap of the key hides nothing');
    now += 300; im.tick(); assert.equal(im.visible, false, 'round ' + round + ': held 350 ms: the layer is away');
    im.skip(true); now += 500; im.tick(); assert.equal(im.visible, false, 'round ' + round + ': still held');
    im.skip(false); assert.equal(im.skipAt, null, 'round ' + round + ': released');
    /* the line the game stopped on */
    now += 400; im.line?.('止まった台詞その' + round + '。'); im.evidence?.(true, 'hook'); im.tick();
    assert.equal(im.visible, true, 'round ' + round + ': the layer is back after the release');
    now += 2000;
  }
});
