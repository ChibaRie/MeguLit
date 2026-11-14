// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Text architecture ② in the running reader (docs/text-architecture-compositor.md). Setting 文字绘制 (textRenderer):
   'overlay' (default) keeps the reader overlay window; 'compositor' starts MeguLitCompositor.exe for the bound game
   window and feeds it:
     - ①'s hookGlyphDots events (line text, per-character metrics) and ③'s hookCharRects (cells of engines without dots),
     - the reader's translation of each line (Reader.message → annotate), the menu choices (choice locate),
     - the 显示内容 setting (display): chinese/english = translation only in the game's text area, japanese = Japanese only.
   While the compositor draws the current line, the reader page hides its own line (compositorDrawing) so text is never
   doubled; a line the compositor hands back ('undot') or a compositor that cannot capture ('fallback', or exit) gives
   the line straight back to the overlay. A game whose capture failed stays on the overlay until it restarts. */
const path = require('node:path');
const { CaptureCompositor, strip } = require('../services/capture-compositor.cjs');

/* ③ records: game-screen px → client px (engine viewport, else aspect fit centred), as core/text-paths.cjs does. */
function rectsToClient(rec, cw, ch) {
  let [vx, vy, vw, vh] = rec.viewport || [0, 0, 0, 0];
  if (!(vw > 0 && vh > 0)) {
    if (rec.sw > 0 && rec.sh > 0 && cw > 0 && ch > 0) { const k = Math.min(cw / rec.sw, ch / rec.sh); vw = rec.sw * k; vh = rec.sh * k; vx = (cw - vw) / 2; vy = (ch - vh) / 2; }
    else { vx = 0; vy = 0; vw = cw || rec.sw; vh = ch || rec.sh; }
  }
  const kx = rec.sw > 0 ? vw / rec.sw : 1, ky = rec.sh > 0 ? vh / rec.sh : 1;
  return (rec.rects || []).map(([x, y, w, h]) => [Math.round(vx + x * kx), Math.round(vy + y * ky), Math.round(w * kx), Math.round(h * ky)]);
}

class CompositorHost {
  constructor({ root, onEvent = () => {}, make } = {}) {
    this.root = root; this.onEvent = onEvent;
    this.make = make || (opts => new CaptureCompositor({ root, ...opts }));
    this.cc = null; this.hwnd = ''; this.failedFor = ''; this.lines = new Map(); this.drawing = false; this.mode = ''; this.recent = new Map(); this.choiceItems = [];
    this.client = [0, 0];
  }
  trace(line) { try { require('node:fs').appendFileSync(path.join(this.root || '.', 'logs', 'compositor.log'), new Date().toISOString() + ' ' + line + '\n'); } catch {} }
  // 文字显示 is one choice for the whole app, not a per-game style: read from the global gal-preferences.json (the per-game
  // style profile merged into the reader's preferences would otherwise bring back the default).
  wanted(preferences) {
    if (this.root) try {
      const fs = require('node:fs'), file = path.join(this.root, 'data', 'config', 'gal-preferences.json'), t = fs.statSync(file).mtimeMs;
      if (t !== this.settingTime) { this.settingTime = t; this.setting = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')).textRenderer; }
      if (this.setting) return this.setting === 'compositor';
    } catch {}
    return preferences?.textRenderer === 'compositor';
  }
  // Called with every preferences/state change of the bound game (GalNative.notify).
  configure(preferences, state) {
    const hwnd = String(state?.gameHwnd || ''), identity = hwnd + '|' + String(state?.gameStarted || '');
    if (state?.clientWidth && state?.clientHeight) this.client = [state.clientWidth, state.clientHeight];
    const want = this.wanted(preferences) && state?.bound === true && /^\d{1,19}$/.test(hwnd) && hwnd !== '0' && this.failedFor !== identity;
    const why = !this.wanted(preferences) ? 'setting overlay' : state?.bound !== true ? 'not bound' : !/^\d{1,19}$/.test(hwnd) || hwnd === '0' ? 'no game window' : this.failedFor === identity ? 'capture failed earlier' : 'on';
    if (why !== this.lastWhy) { this.lastWhy = why; this.trace('configure: ' + why + ' hwnd=' + hwnd); }
    if (this.cc && (!want || identity !== this.identity)) this.stop();
    if (!want) return;
    if (!this.cc) {
      let cc = null; cc = this.make({ onEvent: e => { if (cc && cc === this.cc) this.event(e); } }); // events of a stopped instance are stale
      if (!cc.available()) { this.failedFor = identity; this.onEvent({ type: 'compositorState', state: 'missing' }); return; }
      if (!cc.start({ hwnd: Number(hwnd) })) { this.failedFor = identity; return; }
      this.cc = cc; this.identity = identity; this.hwnd = hwnd; this.mode = '';
    }
    const mode = ['chinese', 'english'].includes(preferences?.display) ? 'translation' : preferences?.display === 'japanese' ? 'jp' : 'bilingual';
    if (mode !== this.mode) { this.mode = mode; this.cc.style({ mode, ruby: preferences?.furigana !== false, lookup: true }); }
  }
  // ① / ③ events from HookBridge (GalNative.hookEvent).
  hook(m) {
    if (!this.cc || !m) return;
    if (m.type === 'hookGlyphDots') {
      if (m.state === 'line') this.remember(Number(m.seq) || 0, String(m.text || ''));
      this.cc.hookGlyphDots(m);
    } else if (m.type === 'hookCharRects') {
      const text = String(m.text || '').replace(/\r?\n/g, ''), id = 100000 + (Number(m.line) || 0);
      this.remember(id, text);
      this.cc.send({ t: 'rects', id, text, rects: rectsToClient(m, this.client[0], this.client[1]), hidden: m.hidden === true });
    }
  }
  remember(id, text) { this.lines.set(id, strip(text).text); if (this.lines.size > 64) this.lines.delete(this.lines.keys().next().value); this.lastId = id; }
  // The reader translated a line: hand the translation to the compositor line that shows it (①'s text may carry more,
  // e.g. variable names before the line; matched on blank-stripped text).
  text(source, translation) {
    if (!this.cc || !translation) return;
    const s = strip(source).text; if (!s) return;
    let id = null;
    for (const [k, v] of [...this.lines.entries()].reverse()) if (v === s || v.includes(s) || (v && s.includes(v))) { id = k; break; }
    if (id !== null) this.cc.annotate({ id, tl: translation });
    // Menu items arrive as text only: their translations come through here like any line (before or after the menu).
    this.recent.set(s, translation); if (this.recent.size > 48) this.recent.delete(this.recent.keys().next().value);
    const item = this.choiceItems.find(x => !x.tl && strip(x.text).text === s);
    if (item) { item.tl = translation; this.cc.choices(this.choiceItems); }
    this.trace('translation ' + (id !== null ? 'for line ' + id : item ? 'for a choice' : 'unmatched: ' + s.slice(0, 24)));
  }
  choices(options) {
    if (!this.cc || !Array.isArray(options) || !options.length) return;
    this.choiceItems = options.map(o => typeof o === 'string' ? { text: o } : { text: String(o?.text || o?.source || ''), tl: String(o?.translation || o?.tl || '') });
    for (const x of this.choiceItems) { const tl = !x.tl && this.recent.get(strip(x.text).text); if (tl) x.tl = tl; }
    this.cc.choices(this.choiceItems);
  }
  event(e) {
    if (e.e !== 'stats' && (e.e !== 'line' || e.status !== this.lastStatus)) this.trace('event ' + JSON.stringify(e).slice(0, 300));
    if (e.e === 'line') this.lastStatus = e.status;
    if (e.e === 'line') { const drawing = e.found > 0 && (e.status === 'complete' || e.status === 'revealing' || e.status === 'fading'); this.setDrawing(drawing || (this.drawing && e.status === 'waiting')); }
    else if (e.e === 'undot') this.setDrawing(false);
    else if (e.e === 'fallback') { this.failedFor = this.identity; this.setDrawing(false); this.onEvent({ type: 'compositorState', state: 'fallback', reason: e.reason }); this.stop(); }
    else if (e.e === 'exit') { this.cc = null; this.setDrawing(false); }
    else if (e.e === 'lookup') this.onEvent({ type: 'compositorLookup', id: e.id, index: e.index, char: e.char, x: e.x, y: e.y });
    else if (e.e === 'ready') this.onEvent({ type: 'compositorState', state: 'running' });
  }
  setDrawing(v) { if (v === this.drawing) return; this.drawing = v; this.onEvent({ compositorDrawing: v }); }
  stop() { const cc = this.cc; this.cc = null; this.lines.clear(); this.setDrawing(false); cc?.stop(); }
}

module.exports = { CompositorHost, rectsToClient };
