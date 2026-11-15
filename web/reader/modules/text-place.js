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
  let on = false, line = null, frame = 0, lastGeom = '', drawnByGame = '', page = null; const clones = new Map();
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
    /* 2026-11-15 the game still draws this line itself (core/overlay-placement.cjs `visible`): no Japanese or ruby over it, the translation stays */
    'body.megulit-place-game-drawn .sentence-window.tomoyo-hook-reader .sentence-text:not(.megulit-old-line){visibility:hidden!important}',
    'body.megulit-place-game-drawn .sentence-window.tomoyo-hook-reader .tomoyo-cn-row{visibility:visible!important}',
    /* layer 4 page model: older lines of the page (their own .sentence-text, placed like the current one) */
    'body.megulit-place-asleep .sentence-window.tomoyo-hook-reader{visibility:hidden!important}',
    'body:not(.megulit-placed) .megulit-old-line{display:none!important}',
    '#megulit-page-ahead{position:fixed;left:0;top:0;width:0;height:0;pointer-events:none}','#megulit-page-ahead>i{position:fixed;display:block;pointer-events:none;background:none}',
    /* every line of the page is a full-window .sentence-text: only its characters take the pointer, or the top one swallows the clicks meant for the lines under it */
    'body.megulit-placed .megulit-place-window .sentence-text{pointer-events:none!important}',
    /* Dashes (― — ─ and their kin; never the long-vowel mark ー, which is a letter and stays the font's). A game draws
       「――」 as one unbroken line: its font's dash fills the cell. Reader fonts draw it short, low or with a gap, so the
       glyph is hidden and a stroke is drawn across the token's whole box at mid height, 7 % of the size thick, a hair
       past both edges so neighbours join. One rule for every path: the reader's own box, a flow page, in-place boxes.
       (2026-11-15: three attempts lived only in in-place mode and the last one was thinner than the game's.) */
    '.sentence-text .char-token.megulit-dash{position:relative;-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important;overflow:visible!important}',
    '.sentence-text .char-token.megulit-dash::after{content:"";position:absolute;left:-.03em;right:-.03em;top:50%;height:max(1px,.07em);margin-top:calc(max(1px,.07em) / -2);background:var(--megulit-dash-color,currentColor);pointer-events:none}',
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
    if (!page) document.body.classList.remove('megulit-placed');
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
  /* the reader's current line, as the placement compares it (blanks out) */
  function readerLine() {
    const sentence = target()?.querySelector('.sentence-text:not(.megulit-old-line)');
    return sentence ? [...sentence.querySelectorAll('.char-token')].filter(t => !t.closest('.tome-page-lines') && !t.hasAttribute('data-tomoyo-leading-space') && !blank(t.textContent)).map(t => t.textContent).join('') : '';
  }
  function gameDrawn() {
    const text = on && drawnByGame ? readerLine() : '';
    const drawn = !!text && drawnByGame.includes(text);
    if (document.body.classList.contains('megulit-place-game-drawn') !== drawn) { document.body.classList.toggle('megulit-place-game-drawn', drawn); window.__tomoyoHitRegionsRefresh?.(true); }
    return drawn;
  }
  let reveal = { id: 0, n: 0, t: 0 };
  /* tags a dash token (see the style rule); the stroke takes the colour the glyph was filled with */
  function markDash(t) {
    if (t.classList.contains('megulit-dash') || !DASH.test(t.textContent || '')) return;
    const cs = getComputedStyle(t), fill = cs.webkitTextFillColor, color = fill && fill !== 'rgba(0, 0, 0, 0)' ? fill : cs.color;
    t.style.setProperty('--megulit-dash-color', color); t.classList.add('megulit-dash');
  }
  const DASH = /^[‒-―─━⸺⸻]+$/;
  /* put a sentence's character tokens on their boxes (boxes[j] for the j-th shown token; a missing box = not drawn yet) */
  function layout(sentence, boxes, geom) {
    const tokens = [...sentence.querySelectorAll('.char-token')].filter(t => !t.closest('.tome-page-lines'));
    const shown = tokens.filter(t => !t.hasAttribute('data-tomoyo-leading-space') && !blank(t.textContent));
    const cjk = boxes.filter((r, j) => r && shown[j] && /[^\x00-\x7f｡-ﾟ]/.test(shown[j].textContent)).map(r => r[2]);
    const size = Math.max(6, median(cjk) || median(boxes.filter(Boolean).map(r => r[3])));
    for (const t of tokens) if (!shown.includes(t)) t.classList.add('megulit-unplaced');
    const place = new Map();
    shown.forEach((t, j) => { const r = boxes[j]; if (!r) { t.classList.add('megulit-unplaced'); return; } t.classList.remove('megulit-unplaced'); place.set(t, r); });
    for (const base of sentence.querySelectorAll('.megulit-ruby-base')) {
      let rs = [...base.querySelectorAll('.char-token')].map(t => place.get(t)).filter(Boolean);
      if (!rs.length) continue;
      /* a word the game wrapped (its first characters at the end of a row, the rest on the next): the base is the part
         on the first row, so the reading sits over it; a box over both rows put the reading in the middle of nowhere */
      const top = Math.min(...rs.map(r => r[1])); rs = rs.filter(r => r[1] < top + r[3] * .5);
      const x0 = Math.min(...rs.map(r => r[0])), y0 = top, x1 = Math.max(...rs.map(r => r[0] + r[2])), y1 = Math.max(...rs.map(r => r[1] + r[3]));
      set(base, 'left', x0 + 'px'); set(base, 'top', y0 + 'px'); set(base, 'width', (x1 - x0) + 'px'); set(base, 'height', (y1 - y0) + 'px');
      base.__megulitOrigin = [x0, y0];
    }
    for (const [t, r] of place) {
      const base = t.parentElement?.closest('.megulit-ruby-base'), o = base && sentence.contains(base) && base.__megulitOrigin || [0, 0];
      set(t, 'left', (r[0] - o[0]) + 'px'); set(t, 'top', (r[1] - o[1]) + 'px'); set(t, 'width', r[2] + 'px'); set(t, 'height', r[3] + 'px');
      set(t, 'font-size', size + 'px'); set(t, 'line-height', r[3] + 'px');
      /* a dash is one unbroken stroke across its box in the game; fonts draw it short and raised */
      markDash(t);
      geom?.push(r.map(Math.round).join(','));
    }
    return { place, size, shown };
  }
  /* a line (or part of one) the reader has no tokens for: plain characters, in the reader sentence's own classes so they sit and look like its characters */
  function plain(text) { const s = document.createElement('div'), like = target()?.querySelector('.sentence-text:not(.megulit-old-line)'); s.className = like ? like.className : 'sentence-text'; [...text].forEach((c, i) => { const span = document.createElement('span'); span.className = 'char-token'; span.dataset.index = String(i); span.textContent = c; s.append(span); }); return s; }
  function dropOld(win, keep) { for (const n of document.querySelectorAll('.megulit-old-line')) if (!keep || !keep.has(n) || n.parentElement !== win) n.remove(); }
  /* layer 4 page model: the whole page on the game's own places. The reader's line is the page line with its text; the
     page's other lines are drawn from the copy kept when they were the reader's line (ruby, word tokens), or as plain
     tokens when the reader never showed them. No page on screen: nothing is drawn. */
  function applyPage() {
    const body = document.body, win = target(), sentence = win?.querySelector('.sentence-text:not(.megulit-old-line)');
    const asleep = on && page.awake === false, live = on && page.awake && page.armed && page.lines.length > 0;
    if (body.classList.contains('megulit-place-asleep') !== asleep) { body.classList.toggle('megulit-place-asleep', asleep); window.__tomoyoHitRegionsRefresh?.(true); }
    if (!live || !sentence) { document.getElementById('megulit-page-ahead')?.replaceChildren(); dropOld(null); clones.clear(); const p = page; page = null; release(); page = p; body.classList.remove('megulit-placed'); /* a page the layer does not hide (not armed, or no line has places yet): the game's own text is on screen, the reader's Japanese is never drawn at its own place over it; the translation stays */ const own = on && page.awake; if (body.classList.contains('megulit-place-game-drawn') !== own) { body.classList.toggle('megulit-place-game-drawn', own); window.__tomoyoHitRegionsRefresh?.(true); } return; }
    const map = mapper(page.client), readerText = readerLine(), geom = [];
    let cur = null; if (readerText) for (let i = page.lines.length - 1; i >= 0; i--) if (page.lines[i].text.includes(readerText)) { cur = page.lines[i]; break; }
    body.classList.remove('megulit-place-fallback'); body.classList.add('megulit-placed'); win.classList.add('megulit-place-window');
    for (const w of document.querySelectorAll('.megulit-place-window')) if (w !== win) w.classList.remove('megulit-place-window');
    /* the reader's line is not on the page (its places are not claimed yet, or the game shows another page): its Japanese is not drawn anywhere else */
    const hideCur = !cur; if (body.classList.contains('megulit-place-game-drawn') !== hideCur) body.classList.toggle('megulit-place-game-drawn', hideCur);
    if (cur) {
      const at = [...cur.text.slice(0, cur.text.indexOf(readerText))].length, n = [...readerText].length;
      /* the places arrive from the game in uneven batches (several characters, then nothing for 0.1 s): the line's
         characters are let in one after another, catching up with what has arrived within about 0.1 s */
      const have = Math.max(0, Math.min(n, cur.rects.length - at)), nowT = performance.now();
      if (reveal.id !== cur.id) reveal = { id: cur.id, n: 0, t: nowT };
      if (reveal.n > have) reveal.n = have;
      else if (reveal.n < have && nowT - reveal.t >= 8) { reveal.n = Math.min(have, reveal.n + Math.max(1, (have - reveal.n) * (nowT - reveal.t) / 100)); reveal.t = nowT; }
      if (reveal.n < have) schedule(); else reveal.t = nowT;
      const { place, size } = layout(sentence, cur.rects.slice(at, at + Math.floor(reveal.n)).map(map), geom);
      const row = win.querySelector('.tomoyo-cn-row'), all = [...place.values()];
      if (row && all.length) {
        const x0 = Math.min(...all.map(r => r[0])), y0 = Math.min(...all.map(r => r[1])), x1 = Math.max(...all.map(r => r[0] + r[2])), y1 = Math.max(...all.map(r => r[1] + r[3]));
        const only = body.classList.contains('tomoyo-gal-zh-only');
        set(row, 'left', x0 + 'px'); set(row, 'top', (only ? y0 : y1 + size * .25) + 'px');
        set(row, 'width', Math.max(x1 - x0, Math.min(innerWidth - x0 - 8, size * 20)) + 'px');
        set(row, 'font-size', (only ? size : Math.max(12, Math.round(size * .6))) + 'px');
      }
      const copy = sentence.cloneNode(true); copy.__megulitText = readerText; copy.__megulitAt = at; clones.set(cur.id, copy);
    }
    /* The reader window paints only inside its regions, and a character's own region reached the window a frame or two
       after the character: every new character came in cut off on its right. While the newest line is being typed the
       rest of its row and the next row are regions ahead of time (painted, the pointer passes to the game). */
    {
      const all = page.lines.flatMap(l => l.rects).map(map), last = cur && cur.rects.length ? map(cur.rects[cur.rects.length - 1]) : null;
      let ahead = document.getElementById('megulit-page-ahead'), boxes = [];
      if (cur && last && all.length && cur.rects.length < [...cur.text].length) {
        const x0 = Math.min(...all.map(r => r[0])), x1 = Math.max(Math.max(...all.map(r => r[0] + r[2])), x0 + last[3] * 20), h = last[3], pitch = h * 1.3;
        boxes = [[last[0] + last[2], last[1] - h * .5, Math.max(0, x1 - last[0] - last[2]), h * 1.6], [x0, last[1] + pitch - h * .5, x1 - x0, h * 1.6]];
      }
      /* the translation streams in the same way: its row (three lines of room) is a region before the text is there */
      { const row = cur && win.querySelector('.tomoyo-cn-row'), rb = row && row.style.left ? row.getBoundingClientRect() : null; if (rb && rb.width > 0) { const fs = parseFloat(getComputedStyle(row).fontSize) || 16; boxes.push([rb.left - 6, rb.top - 4, rb.width + 12, Math.max(rb.height, fs * 1.6 * 3) + 8]); } }
      const key = boxes.map(r => r.map(Math.round).join(',')).join(';');
      if (!ahead && boxes.length) { ahead = document.createElement('div'); ahead.id = 'megulit-page-ahead'; ahead.setAttribute('aria-hidden', 'true'); document.body.append(ahead); }
      if (ahead && ahead.__megulitKey !== key) { ahead.__megulitKey = key; ahead.replaceChildren(...boxes.map(r => { const i = document.createElement('i'); i.style.cssText = 'left:' + r[0] + 'px;top:' + r[1] + 'px;width:' + r[2] + 'px;height:' + r[3] + 'px'; return i; })); window.__tomoyoHitRegionsRefresh?.(true); }
    }
    const keep = new Set();
    /* characters of a line that the reader's own text lacks (its source was shortened on the way: a repeated syllable
       dropped, a name cut off): the game does not draw them either, so they are drawn plain on their places; the line
       keeps them when it is no longer the reader's own */
    const rest = (l, at, n) => {
      const all = [...l.text], idx = all.map((c, i) => i).filter(i => (i < at || i >= at + n) && l.rects[i]), key = l.id + ':' + idx.join(',');
      let node = [...win.querySelectorAll(':scope>.megulit-line-rest')].find(x => x.__megulitLine === l.id);
      if (!idx.length) { node?.remove(); return; }
      if (!node || node.__megulitKey !== key) { node?.remove(); node = plain(idx.map(i => all[i]).join('')); node.classList.add('megulit-old-line', 'megulit-line-rest'); node.__megulitKey = key; node.__megulitLine = l.id; win.append(node); }
      keep.add(node); layout(node, idx.map(i => map(l.rects[i])), geom);
    };
    if (cur) rest(cur, [...cur.text.slice(0, cur.text.indexOf(readerText))].length, [...readerText].length);
    const ids = new Set(page.lines.map(l => l.id));
    for (const id of [...clones.keys()]) if (!ids.has(id)) clones.delete(id);
    for (const l of page.lines) {
      if (l === cur || !l.rects.length) continue;
      let src = clones.get(l.id);
      if (!src) { src = plain(l.text); src.__megulitText = l.text; src.__megulitAt = 0; clones.set(l.id, src); }
      /* the kept copy stays out of the document; what is shown is a copy of it, made again when the reader's own passes
         (a new sentence's ruby pass clears every base in the window) took its ruby away */
      const bases = src.querySelectorAll('.megulit-ruby-base').length;
      let node = src.__megulitShown;
      if (!node || node.parentElement !== win || node.querySelectorAll('.megulit-ruby-base').length !== bases) {
        node?.remove(); node = src.cloneNode(true); node.__megulitText = src.__megulitText; node.__megulitAt = src.__megulitAt; src.__megulitShown = node;
        node.classList.add('megulit-old-line'); node.removeAttribute('data-sequence'); for (const t of node.querySelectorAll('.tome-typewriter-pending')) t.classList.remove('tome-typewriter-pending'); for (const t of node.querySelectorAll('.tome-page-lines,.tome-inline-wait')) t.remove();
        win.append(node);
      }
      keep.add(node);
      layout(node, l.rects.slice(node.__megulitAt, node.__megulitAt + [...node.__megulitText].length).map(map), geom);
      rest(l, node.__megulitAt, [...node.__megulitText].length);
    }
    dropOld(win, keep);
    const key = geom.join(';');
    if (key !== lastGeom) { lastGeom = key; dispatchEvent(new CustomEvent('megulit-reveal-progress', { detail: { typing: false } })); window.__tomoyoHitRegionsRefresh?.(true); }
  }
  function apply() {
    frame = 0;
    drawExtras();
    if (page) return applyPage();
    if (!on || !line) { release(); gameDrawn(); return; }
    if (line.fallback) { release(true); return; }
    const win = target(), sentence = win?.querySelector('.sentence-text:not(.megulit-old-line)');
    if (!sentence) { release(); return; }
    const tokens = [...sentence.querySelectorAll('.char-token')].filter(t => !t.closest('.tome-page-lines'));
    const shown = tokens.filter(t => !t.hasAttribute('data-tomoyo-leading-space') && !blank(t.textContent));
    const readerText = shown.map(t => t.textContent).join(''), placeText = [...line.text].filter(c => !blank(c)).join('');
    /* map the reader's characters onto the record (the record may carry a speaker or more before the reader's text) */
    const placeRects = [], chars = [...line.text];
    chars.forEach((c, i) => { if (!blank(c)) placeRects.push(line.rects[i]); });
    const at = readerText ? placeText.indexOf(readerText) : -1;
    /* a placement of another line (the current one is not placed yet): the game's own copy of this line may still be on
       screen, so no plateless Japanese at the reader's place when the source said so */
    if (at < 0) { if (gameDrawn()) release(); else release(true); return; }
    if (document.body.classList.contains('megulit-place-game-drawn')) { document.body.classList.remove('megulit-place-game-drawn'); window.__tomoyoHitRegionsRefresh?.(true); }
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
  b.textPlace = m => { if (m?.visible === true) { drawnByGame = [...String(m.text || '')].filter(c => !blank(c)).join(''); schedule(); return; } if (m && Array.isArray(m.rects) && m.text) drawnByGame = ''; if (m?.clear) line = null; else if (m?.fallback && m.text) line = { fallback: true, text: String(m.text) }; else if (m && Array.isArray(m.rects) && m.text) line = { text: String(m.text), rects: m.rects, client: Array.isArray(m.client) ? m.client : [innerWidth, innerHeight] }; schedule(); };
  const pageGone = () => { for (const n of document.querySelectorAll('.megulit-old-line')) n.remove(); clones.clear(); document.body.classList.remove('megulit-place-asleep'); };
  b.textPlacePage = m => { const had = !!page; page = m && Array.isArray(m.lines) ? { awake: m.awake === true, armed: m.armed === true, lines: m.lines.filter(l => l && typeof l.text === 'string' && Array.isArray(l.rects)), client: Array.isArray(m.client) ? m.client : [innerWidth, innerHeight] } : null; if (page) { line = null; drawnByGame = ''; } else if (had) pageGone(); schedule(); };
  b.textPlaceExtra = m => { extras = { items: Array.isArray(m?.items) ? m.items.filter(i => i && typeof i.text === 'string' && Array.isArray(i.rects)) : [], client: Array.isArray(m?.client) ? m.client : null }; schedule(); };
  b.textPlaceMode = m => { on = m?.on === true; if (!on) { line = null; drawnByGame = ''; if (page) { page = null; pageGone(); } } schedule(); };
  b.textPlaceStatus = () => ({ on, line: line ? { text: line.text, n: line.rects?.length || 0, fallback: !!line.fallback } : null, placed: document.body.classList.contains('megulit-placed'), geom: lastGeom.split(';').length });
  let busy = false;
  new MutationObserver(records => { if (on && (line || drawnByGame || page) && records.some(r => !(r.target.closest?.('.tomoyo-cn-dialog,#megulit-place-extras,#megulit-page-ahead,.megulit-old-line')) && !r.target.classList?.contains('megulit-old-line'))) { /* page mode: at once, before the next paint, so a line that just stopped being the reader's own never misses a frame */ if (page && !busy) { busy = true; try { apply(); } finally { busy = false; } } else schedule(); } }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  const markAll = root => { for (const t of (root.querySelectorAll ? root.querySelectorAll('.sentence-text .char-token:not(.megulit-dash)') : [])) markDash(t); };
  new MutationObserver(records => { for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) { if (n.matches?.('.char-token') && n.closest('.sentence-text')) markDash(n); else markAll(n); } }).observe(document.documentElement, { subtree: true, childList: true });
  markAll(document);
  addEventListener('resize', schedule);
})();
