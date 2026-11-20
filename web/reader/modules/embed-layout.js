// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-20 (owner: 「内嵌现在这边太臃肿了 好好调一下整体布局」). The Alt+T 内嵌 tab put every hook control in one long column: a status bar,
   status chips, a message, a hint, three buttons and a block of advanced controls all said the same thing in different places.
   This module only re-arranges the nodes hook-panel.js already built inside `.tome-hooks` (they keep their data- hooks, so every
   handler and every paint() in hook-panel.js / source-indicator.js keeps working) and moves the troubleshooting ones into one fold.
   Nothing is removed and no setting logic is touched. Layout is chosen with ?embedUi=1|2|3 or localStorage megulit-embed-ui (default 1). */
(function installEmbedLayout() {
  'use strict';
  if (document.readyState === 'loading' || !window.__tomoyoChinese?.tomeSourceIndicator) { document.addEventListener('DOMContentLoaded', installEmbedLayout, { once: true }); return; }
  const b = window.__tomoyoChinese;
  if (b.tomeEmbedLayout) return;
  b.tomeEmbedLayout = true;
  const lang = (document.documentElement.lang || 'zh').slice(0, 2);
  const ALL = {
    zh: { trouble: '遇到问题？', common: '常用', fix: '排障', troubleHint: '文本不对、原文没隐藏、连不上时用', status: '连接状态' },
    en: { trouble: 'Having trouble?', common: 'Common', fix: 'Troubleshoot', troubleHint: 'Wrong text, original still visible, or not connecting', status: 'Connection' },
    ja: { trouble: '困ったときは', common: '基本', fix: 'トラブル対処', troubleHint: '文字が違う・原文が消えない・接続できないとき', status: '接続状態' }
  };
  const T = ALL[lang] || ALL.zh;
  const variant = () => { try { return new URLSearchParams(location.search).get('embedUi') || localStorage.getItem('megulit-embed-ui') || '1'; } catch { return '1'; } };
  const css = document.createElement('style');
  css.textContent = `
  .tome-hooks[data-embed-layout]{padding:0;border:0;background:none;margin:0}
  .tome-hooks[data-embed-layout] .tome-hook-summary,.tome-hooks[data-embed-layout] .tome-hook-mode,.tome-hooks[data-embed-layout] .tome-hook-hint{display:none}
  .tome-hooks[data-embed-layout] .tome-hook-main{margin:0;gap:0}
  .tome-hooks[data-embed-layout] .tome-src{margin-bottom:8px}
  .tome-emb-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}.tome-emb-chips .tome-hook-chips{margin:0}
  .tome-emb-rows{display:grid}.tome-emb-rows>label{margin:0!important;padding:9px 2px;display:flex;align-items:center;flex-direction:row-reverse;justify-content:space-between;gap:12px;border-top:1px solid color-mix(in srgb,var(--theme-text,#e9eaf0) 8%,transparent)}
  .tome-emb-rows>label:first-child{border-top:0}
  .tome-trouble{margin-top:6px;border-top:1px solid color-mix(in srgb,var(--theme-text,#e9eaf0) 8%,transparent);padding-top:6px}
  .tome-trouble>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:6px 2px;font-size:13px;font-weight:600}
  .tome-trouble>summary::-webkit-details-marker{display:none}
  .tome-trouble>summary::after{content:"";margin-left:auto;width:7px;height:7px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);opacity:.6;transition:transform .16s ease}
  .tome-trouble[open]>summary::after{transform:rotate(-135deg)}
  .tome-trouble>summary small{font-weight:400;opacity:.65;font-size:12px}
  .tome-trouble>summary:focus-visible,.tome-emb-tabs button:focus-visible{outline:2px solid var(--theme-primary,#ad1539);outline-offset:2px;border-radius:6px}
  .tome-trouble-body{display:grid;gap:10px;padding:6px 0 2px}.tome-trouble-body .tome-hook-actions{display:flex;flex-wrap:wrap;gap:8px}
  .tome-trouble-body .tome-hook-proof{margin:0}
  .tome-emb-tabs{display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--theme-text,#e9eaf0) 8%,transparent);margin-bottom:10px}
  .tome-emb-tabs button{margin:0;border:0;background:transparent;color:inherit;padding:7px 10px;border-radius:8px;font-size:12.5px;cursor:pointer}
  .tome-emb-tabs button[aria-selected=true]{background:color-mix(in srgb,var(--theme-primary,#ad1539) 70%,#000);color:#fff}
  .tome-emb-quick{margin:6px 0 2px}
  .tome-emb-tiles{display:grid;grid-template-columns:1fr;gap:8px}.tome-emb-tiles>label{margin:0!important;display:flex;flex-direction:row-reverse;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--theme-text,#e9eaf0) 6%,transparent);font-size:13px}
  `;
  document.head.append(css);
  const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
  const tip = (label, text) => { if (label && text) label.title = text; };
  function arrange(p, v) {
    const q = s => p.querySelector(s);
    const src = q('.tome-src'), main = q('.tome-hook-main'), proof = q('[data-hook-proof]'), adv = q('.tome-hook-advanced');
    const hideLabel = q('[data-hook-pref=hookHide]')?.closest('label'), autoLabel = q('[data-hook-pref=hookAutoStart]')?.closest('label');
    const reselect = q('[data-hook-reselect]')?.parentElement, chips = proof?.querySelector('.tome-hook-chips'), hint = q('.tome-hook-hint');
    if (!src || !main || !proof || !adv || !hideLabel || !autoLabel || !reselect) return false;
    tip(hideLabel, hint?.textContent);
    /* connection chips belong to the source card: one place says what is connected and read */
    const chipRow = el('div', 'tome-emb-chips'); chipRow.append(chips); src.querySelector('.tome-src-body').append(chipRow);
    const toggles = el('div', v === '2' ? 'tome-emb-tiles' : 'tome-emb-rows'); toggles.append(hideLabel, autoLabel);
    const keep = [q('[data-hook-summary]'), q('[data-hook-mode]'), hint].filter(Boolean);
    const fix = el('div', 'tome-trouble-body'); if (v === '3') fix.append(proof, adv); else fix.append(proof, reselect, adv);
    adv.open = false;
    /* the engine-method select has a single choice: it belongs with the troubleshooting controls */
    /* menu-layout re-places that label on its own, so it stays where it is and is only shown together with the troubleshooting controls */
    const maskMode = document.querySelector('select[name=galMaskMode]')?.closest('label'), showMethod = on => { if (maskMode) maskMode.hidden = !on; }; showMethod(false);
    if (v === '2') {
      const tabs = el('div', 'tome-emb-tabs'); tabs.setAttribute('role', 'tablist');
      const mk = (id, text) => { const x = el('button'); x.type = 'button'; x.role = 'tab'; x.textContent = text; x.dataset.tab = id; return x; };
      const a = mk('common', T.common), z = mk('fix', T.fix); tabs.append(a, z);
      const paneA = el('div'); paneA.append(toggles); const paneB = fix; paneB.hidden = true;
      const pick = id => { paneA.hidden = id !== 'common'; paneB.hidden = id !== 'fix'; a.setAttribute('aria-selected', String(id === 'common')); z.setAttribute('aria-selected', String(id === 'fix')); };
      a.onclick = () => { pick('common'); showMethod(false); }; z.onclick = () => { pick('fix'); showMethod(true); }; pick('common');
      main.replaceChildren(src, tabs, paneA, paneB, ...keep);
    } else {
      const fold = el('details', 'tome-trouble'); const sum = el('summary'); sum.innerHTML = `<span>${T.trouble}</span><small>${T.troubleHint}</small>`;
      fold.append(sum, fix); fold.addEventListener('toggle', () => { showMethod(fold.open); b.refreshHitRegions?.(); });
      if (v === '3') { reselect.classList.add('tome-emb-quick'); main.replaceChildren(src, toggles, reselect, fold, ...keep); } else main.replaceChildren(src, toggles, fold, ...keep);
    }
    return true;
  }
  function mount() {
    for (const p of document.querySelectorAll('.tome-hooks')) {
      
      if (p.dataset.embedLayout || !p.querySelector('.tome-src')) continue;
      const v = variant();
      if (arrange(p, v)) p.dataset.embedLayout = v;
    }
  }
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  mount();
})();
