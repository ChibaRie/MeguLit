// SPDX-License-Identifier: GPL-3.0-or-later
/* Overlay placement (2026-11-14, core/overlay-placement.cjs). The game draws the current line blank and its sources
   report a box per character (client px). The reader's own line (the hook reader's .sentence-text with its
   .char-token spans, ruby bases and translation row) is laid out on exactly those boxes: same place, a size taken from
   the boxes, the game style's colour / outline / shadow as everywhere else. Interaction is untouched: the tokens stay
   the reader's own (word card, drag-select), the hit regions follow their new boxes, clicks elsewhere reach the game.
   Ruby uses the reader's shared ruby rule (gal.js paint), measured on the placed boxes. Translation sits under the
   last row without a plate; translation-only mode puts it in the Japanese's place. */
(function install() {
  'use strict';
  const b = window.__tomoyoChinese;
  if (!b || !document.body) { document.addEventListener('DOMContentLoaded', install, { once: true }); return; }
  if (b.textPlace) return;
  let on = false, line = null, frame = 0, lastGeom = '';
  const style = document.createElement('style');
  style.textContent = [
    'body.megulit-placed .sentence-window.megulit-place-window{left:0!important;top:0!important;right:auto!important;bottom:auto!important;width:100vw!important;height:100vh!important;max-height:none!important;margin:0!important;padding:0!important;background:none!important;border:0!important;box-shadow:none!important;outline:0!important;backdrop-filter:none!important;overflow:visible!important;transform:none!important;pointer-events:none}',
    'body.megulit-placed .sentence-window.megulit-place-window::before,body.megulit-placed .sentence-window.megulit-place-window::after{display:none!important}',
    'body.megulit-placed .tome-box-deco,body.megulit-placed .sentence-window:not(.megulit-place-window){display:none!important}',
    'body.megulit-placed .megulit-place-window .sentence-text{position:absolute!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;margin:0!important;padding:0!important;transform:none!important;overflow:visible!important}',
    'body.megulit-placed .megulit-place-window .tome-page-lines{display:none!important}',
    'body.megulit-placed .megulit-place-window .megulit-ruby-base{position:absolute!important;display:block!important;margin:0!important;padding:0!important}',
    'body.megulit-placed .megulit-place-window .char-token{position:absolute!important;display:block!important;margin:0!important;padding:0!important;text-align:center!important;white-space:pre!important;letter-spacing:0!important;text-indent:0!important;pointer-events:auto}',
    'body.megulit-placed .megulit-place-window .char-token.megulit-unplaced{display:none!important}',
    /* fallback (the game drew its line blank but said nowhere where): the reader keeps its own place, without any plate */
    'body.megulit-place-fallback .sentence-window.tomoyo-hook-reader,body.megulit-place-fallback .sentence-window.tomoyo-hook-reader .tomoyo-cn-row{background:none!important;border-color:transparent!important;box-shadow:none!important;backdrop-filter:none!important}',
    'body.megulit-place-fallback .sentence-window.tomoyo-hook-reader::before,body.megulit-place-fallback .sentence-window.tomoyo-hook-reader::after,body.megulit-place-fallback .tome-box-deco{display:none!important}',
    '#megulit-place-extras{position:fixed;inset:0;pointer-events:none;z-index:2147483000;background:none}',
    'body.megulit-placed .megulit-place-window .tomoyo-cn-row{position:absolute!important;margin:0!important;padding:0!important;background:none!important;border:0!important;box-shadow:none!important;pointer-events:auto}'
  ].join('\n');
  document.head.append(style);
  const blank = c => /^[\s　​﻿]*$/.test(c);
  const median = list => { const v = list.filter(n => n > 0).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : 0; };
  function target() {
    const own = document.querySelector('.sentence-window.tomoyo-hook-reader');
    return own && own.isConnected ? own : document.querySelector('.sentence-window');
  }
  function release(fallback = false) {
    document.body.classList.remove('megulit-placed');
    document.body.classList.toggle('megulit-place-fallback', fallback === true);
    for (const w of document.querySelectorAll('.megulit-place-window')) {
      w.classList.remove('megulit-place-window');
      for (const n of w.querySelectorAll('.char-token,.megulit-ruby-base,.tomoyo-cn-row')) { n.classList.remove('megulit-unplaced'); for (const p of ['left', 'top', 'width', 'height', 'font-size', 'line-height']) n.style.removeProperty(p); }
    }
    if (lastGeom) { lastGeom = ''; dispatchEvent(new CustomEvent('megulit-reveal-progress', { detail: { typing: false } })); }
  }
  /* record px are game-client px; the reader surface may be larger than the game (galLayoutInfo: client origin and size
     in physical px), CSS px = physical / devicePixelRatio */
  function mapper(client) {
    const info = b.galLayoutInfo?.(), dpr = devicePixelRatio || 1, cw = client?.[0] || innerWidth, ch = client?.[1] || innerHeight;
    const ox = info?.clientWidth ? (info.clientX || 0) / dpr : 0, oy = info?.clientHeight ? (info.clientY || 0) / dpr : 0;
    const k = info?.clientWidth ? info.clientWidth / cw / dpr : innerWidth / cw, ky = info?.clientHeight ? info.clientHeight / ch / dpr : innerHeight / ch;
    /* the game client on the reader surface: nothing is ever drawn outside it (a box with no size, not finite or
       outside the client is no box; the rest is clamped in) */
    const L = ox, T = oy, R = ox + cw * k, B = oy + ch * ky;
    const map = r => {
      if (!Array.isArray(r) || r.length < 4) return null;
      let [x, y, w, h] = [ox + r[0] * k, oy + r[1] * ky, r[2] * k, r[3] * ky];
      if (![x, y, w, h].every(Number.isFinite) || !(w > 0 && h > 0) || x >= R || y >= B || x + w <= L || y + h <= T) return null;
      w = Math.min(w, R - L); h = Math.min(h, B - T);
      return [Math.min(Math.max(x, L), R - w), Math.min(Math.max(y, T), B - h), w, h];
    };
    map.bounds = [L, T, R, B];
    return map;
  }
  /* name plate (n) and choices (o) the game drew blank: drawn character by character on their boxes in the reader's own
     text style, click-through (a click on an option reaches the game's own blank button underneath) */
  let extras = { items: [], client: null }, extraKey = '';
  function drawExtras() {
    let layer = document.getElementById('megulit-place-extras');
    const key = on ? JSON.stringify(extras) + innerWidth + 'x' + innerHeight + JSON.stringify(b.galLayoutInfo?.() || null) : '';
    if (key === extraKey) return; extraKey = key;
    if (!on || !extras.items.length) { if (layer) { layer.remove(); window.__tomoyoHitRegionsRefresh?.(true); } return; }
    if (!layer) { layer = document.createElement('div'); layer.id = 'megulit-place-extras'; layer.setAttribute('aria-hidden', 'true'); document.body.append(layer); }
    const ref = document.querySelector('.sentence-window .char-token'), cs = ref ? getComputedStyle(ref) : null, map = mapper(extras.client);
    layer.replaceChildren();
    for (const item of extras.items) {
      const chars = [...item.text].filter(c => !blank(c)), boxes = item.rects.map(map);
      if (!boxes.length || !boxes.every(Boolean)) continue;
      const size = Math.max(6, median(boxes.map(r => r[2])) || median(boxes.map(r => r[3])));
      const group = document.createElement('div'); group.className = 'megulit-place-extra megulit-place-' + (item.kind === 'n' ? 'name' : 'choice');
      chars.forEach((c, i) => { const r = boxes[i]; if (!r) return; const span = document.createElement('span'); span.textContent = c;
        span.style.cssText = 'position:absolute;left:' + r[0] + 'px;top:' + r[1] + 'px;width:' + r[2] + 'px;height:' + r[3] + 'px;line-height:' + r[3] + 'px;font-size:' + size + 'px;text-align:center;white-space:pre';
        if (cs) for (const p of ['color', 'font-family', 'font-weight', 'text-shadow', '-webkit-text-stroke', 'paint-order']) span.style.setProperty(p, cs.getPropertyValue(p));
        group.append(span); });
      layer.append(group);
    }
    window.__tomoyoHitRegionsRefresh?.(true);
  }
  function set(n, p, v) { if (n.style.getPropertyValue(p) !== v) n.style.setProperty(p, v, 'important'); }
  function apply() {
    frame = 0;
    drawExtras();
    if (!on || !line) { release(); return; }
    if (line.fallback) { release(true); return; }
    const win = target(), sentence = win?.querySelector('.sentence-text');
    if (!sentence) { release(); return; }
    const tokens = [...sentence.querySelectorAll('.char-token')].filter(t => !t.closest('.tome-page-lines'));
    const shown = tokens.filter(t => !t.hasAttribute('data-tomoyo-leading-space') && !blank(t.textContent));
    const readerText = shown.map(t => t.textContent).join(''), placeText = [...line.text].filter(c => !blank(c)).join('');
    /* map the reader's characters onto the record (the record may carry a speaker or more before the reader's text) */
    const placeRects = [], chars = [...line.text];
    chars.forEach((c, i) => { if (!blank(c)) placeRects.push(line.rects[i]); });
    const at = readerText ? placeText.indexOf(readerText) : -1;
    if (at < 0) { release(true); return; }
    /* record px are game-client px; the reader surface may be larger than the game (galLayoutInfo: client origin and size
       in physical px), CSS px = physical / devicePixelRatio */
    const map = mapper(line.client);
    const boxes = shown.map((t, j) => { const r = placeRects[[...placeText.slice(0, at)].length + j]; return r && map(r); });
    const cjk = boxes.filter((r, j) => r && /[^\x00-\x7f｡-ﾟ]/.test(shown[j].textContent)).map(r => r[2]);
    const size = Math.max(6, median(cjk) || median(boxes.filter(Boolean).map(r => r[3])));
    /* no real box for any of the reader's characters (all 0 / null / outside the game): the reader keeps its own place;
       placing would leave the translation row at the surface's top-left corner */
    if (!boxes.some(Boolean)) { release(true); return; }
    document.body.classList.remove('megulit-place-fallback');
    document.body.classList.add('megulit-placed');
    win.classList.add('megulit-place-window');
    for (const w of document.querySelectorAll('.megulit-place-window')) if (w !== win) w.classList.remove('megulit-place-window');
    const geom = [];
    for (const t of tokens) if (!shown.includes(t)) t.classList.add('megulit-unplaced');
    const place = new Map();
    shown.forEach((t, j) => { const r = boxes[j]; if (!r) { t.classList.add('megulit-unplaced'); return; } t.classList.remove('megulit-unplaced'); place.set(t, r); });
    /* ruby bases: absolute at the union of their tokens; tokens inside are placed relative to the base */
    for (const base of sentence.querySelectorAll('.megulit-ruby-base')) {
      const rs = [...base.querySelectorAll('.char-token')].map(t => place.get(t)).filter(Boolean);
      if (!rs.length) continue;
      const x0 = Math.min(...rs.map(r => r[0])), y0 = Math.min(...rs.map(r => r[1])), x1 = Math.max(...rs.map(r => r[0] + r[2])), y1 = Math.max(...rs.map(r => r[1] + r[3]));
      set(base, 'left', x0 + 'px'); set(base, 'top', y0 + 'px'); set(base, 'width', (x1 - x0) + 'px'); set(base, 'height', (y1 - y0) + 'px');
      base.__megulitOrigin = [x0, y0];
    }
    for (const [t, r] of place) {
      const base = t.parentElement?.closest('.megulit-ruby-base'), o = base && sentence.contains(base) && base.__megulitOrigin || [0, 0];
      set(t, 'left', (r[0] - o[0]) + 'px'); set(t, 'top', (r[1] - o[1]) + 'px'); set(t, 'width', r[2] + 'px'); set(t, 'height', r[3] + 'px');
      set(t, 'font-size', size + 'px'); set(t, 'line-height', r[3] + 'px');
      geom.push(r.map(Math.round).join(','));
    }
    /* translation: under the last row, starting at the line's left edge, no plate; translation only: in the Japanese's place */
    const row = win.querySelector('.tomoyo-cn-row'), all = [...place.values()];
    if (row && all.length) {
      const x0 = Math.min(...all.map(r => r[0])), y0 = Math.min(...all.map(r => r[1])), x1 = Math.max(...all.map(r => r[0] + r[2])), y1 = Math.max(...all.map(r => r[1] + r[3]));
      const only = document.body.classList.contains('tomoyo-gal-zh-only');
      const [L, T, R, B] = map.bounds, width = Math.max(1, Math.min(R - x0, Math.max(x1 - x0, Math.min(R - x0 - 8, size * 20))));
      let top = only ? y0 : y1 + size * .25;
      /* kept inside the game client: under the line when it fits, else above it */
      const rh = row.offsetHeight || size * 1.6;
      if (top + rh > B) top = only ? B - rh : Math.max(T, y0 - size * .25 - rh);
      set(row, 'left', Math.min(Math.max(x0, L), Math.max(L, R - width)) + 'px'); set(row, 'top', Math.max(T, top) + 'px');
      set(row, 'width', width + 'px');
      if (only) set(row, 'font-size', size + 'px'); else row.style.removeProperty('font-size');
    }
    const key = geom.join(';');
    if (key !== lastGeom) { lastGeom = key; dispatchEvent(new CustomEvent('megulit-reveal-progress', { detail: { typing: false } })); window.__tomoyoHitRegionsRefresh?.(true); }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
  b.textPlace = m => { if (m?.clear) line = null; else if (m?.fallback && m.text) line = { fallback: true, text: String(m.text) }; else if (m && Array.isArray(m.rects) && m.text) line = { text: String(m.text), rects: m.rects, client: Array.isArray(m.client) ? m.client : [innerWidth, innerHeight] }; schedule(); };
  b.textPlaceExtra = m => { extras = { items: Array.isArray(m?.items) ? m.items.filter(i => i && typeof i.text === 'string' && Array.isArray(i.rects)) : [], client: Array.isArray(m?.client) ? m.client : null }; schedule(); };
  b.textPlaceMode = m => { on = m?.on === true; if (!on) line = null; schedule(); };
  b.textPlaceStatus = () => ({ on, line: line ? { text: line.text, n: line.rects?.length || 0, fallback: !!line.fallback } : null, placed: document.body.classList.contains('megulit-placed'), geom: lastGeom.split(';').length });
  new MutationObserver(records => { if (on && line && records.some(r => !(r.target.closest?.('.tomoyo-cn-dialog,#megulit-place-extras')))) schedule(); }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  addEventListener('resize', schedule);
})();
