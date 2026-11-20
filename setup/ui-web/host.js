/* Trial host adapter: connects the scene to the real downloader (setup/try/try-server.cjs). Loaded with ?host=1.
   Everything the scene shows comes from the engine's state: segment states and fractions, bytes, speed, source, phase.
   The camera moves are triggered by real events (user presses Install, the engine starts unpacking, the engine is done). */
(function () {
  const api = (type, extra) => fetch('/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ type }, extra || {})) }).then((r) => r.json()).catch(() => ({}));
  const tag = document.createElement('div'); tag.id = 'trialTag'; tag.textContent = '试用版 · 装到测试目录，不碰正式安装'; document.querySelector('#ui-top .top').appendChild(tag);
  let info = null, state = null, N = 0, st = null, fr = null, doneAt = null, section = 'welcome', started = false, installed = false, lastPhase = '', checkTimer = null, firstState = false;
  const pathEl = document.getElementById('path');
  const clock = () => performance.now() / 1000;
  async function check(p) { const c = await api('checkpath', { path: p }); Scene.setFree(c.free || 0, c.need || (info && info.need) || 0, c.state === 'protected' ? 'protected' : c.state === 'readonly' ? 'readonly' : 'ok'); return c; }
  Scene.onAction = async (m) => {
    if (m.type === 'checkpath') { clearTimeout(checkTimer); checkTimer = setTimeout(() => check(m.path), 250); }
    else if (m.type === 'browse') { const r = await api('browse'); if (r.path) { pathEl.value = r.path; check(r.path); } }
    else if (m.type === 'install') { const c = await api('install', { path: pathEl.value, desktop: m.desktop, menu: m.menu }); if (c.state && c.state !== 'ok') { Scene.setFree(c.free || 0, c.need || 0, c.state === 'protected' ? 'protected' : 'readonly'); return; } installed = true; goTo('field', 'under'); }
    else if (m.type === 'retry') { api('retry'); }
    else if (m.type === 'copylog') api('copylog'); else if (m.type === 'manual') api('manual'); else if (m.type === 'launch') api('launch'); else if (m.type === 'minimize') api('minimize'); else if (m.type === 'close') { api('close'); setTimeout(() => window.close(), 400); }
  };
  function goTo(name, move) { if (section === name) return; Scene.goTo(name, move, section); section = name; }
  /* the engine's JSON becomes a scene snapshot */
  function snapshot() {
    const s = state; if (!s || !s.n) return null; if (!st || st.length !== s.n) { N = s.n; st = new Int8Array(N); fr = new Float32Array(N); doneAt = new Float32Array(N); }
    const t = clock(); for (let i = 0; i < N; i++) { const v = +s.st[i] || 0; if (v === 2 && st[i] !== 2) doneAt[i] = t; st[i] = v; fr[i] = (s.fr[i] || 0) / 100; }
    const speed = s.speed || 0, total = s.total || 0, got = s.got || 0;
    let phase = s.phase === 'download' || s.phase === 'probe' ? (s.got > 0 || s.phase === 'download' ? 'download' : 'probe') : s.phase === 'downloaded' ? 'download' : s.phase === 'unpack' ? 'unpack' : s.phase === 'done' ? 'done' : 'probe';
    const out = { t: t, st, fr, doneAt, got, total, speed, eta: speed > 0 ? (total - got) / speed : 0, pack: s.pack || '', src: s.src || '', srcN: s.srcN || 0, dir: s.dir || '', phase, unpack: s.unpack || 0 };
    if (s.phase === 'failed') { out.err = { kind: s.kind || 'download' }; }
    return out;
  }
  async function poll() {
    try { const r = await fetch('/api/state', { cache: 'no-store' }); state = await r.json(); firstState = true; } catch (e) { /* server gone */ }
    setTimeout(poll, 150);
    if (!state) return; const p = state.phase;
    if (installed && (p === 'unpack') && section !== 'unpack' && section !== 'done') goTo('unpack', 'dive');
    if (p === 'done' && section !== 'done') { if (section === 'loc' || section === 'welcome') { installed = true; } goTo('done', 'pull'); }
    if (p === 'downloaded' && installed && section === 'field') { /* waiting for the engine to start unpacking */ }
  }
  function frame() { const s = snapshot(); if (s) Scene.render(s); setTimeout(() => requestAnimationFrame(frame), 33); }
  (async () => {
    info = await (await fetch('/api/info')).json(); pathEl.value = info.defaultTarget; Scene.setDrives(info.drives || []); await check(info.defaultTarget);
    poll(); requestAnimationFrame(frame);
    setTimeout(() => { if (section === 'welcome') goTo('loc', 'skim'); }, 2200);
  })();
})();
