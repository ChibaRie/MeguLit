/* Demo driver: a deterministic simulation of the real segment feed (same shape as the engine snapshot, see
   setup/ui-web/SEGMENT-FEED.md) plus the user's clicks, on one GSAP master timeline so a recorder can seek frame by frame.
   Open index.html?demo=1 (live preview) or ?demo=1&paused=1 (a recorder drives Demo.seek). Not shipped logic. */
(function () {
  const N = 142, SEG = 4 * 1048576, TOTAL = N * SEG, T0 = 2.4, PACKS = [['基础组件', 0], ['注音分词词典', 27], ['语音引擎', 75]];
  const SRC = ['cn-dl.megulit.com', 'dl.megulit.com', 'github.com'];
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const start = [], end = [], src = [], retry = {}; const free = Array.from({ length: 8 }, (_, i) => T0 + 0.1 * i);
  for (let i = 0; i < N; i++) {
    let k = 0; for (let j = 1; j < 8; j++) if (free[j] < free[k]) k = j;
    const s = src.push(k % 8 < 4 ? 0 : k % 8 < 7 ? 1 : 2) - 1, f = [1.0, 0.85, 0.5][src[s]];
    const d = (0.2 + rnd() * 0.24) / f; start[i] = free[k]; end[i] = free[k] + d;
    if (i === 96 || i === 97) { retry[i] = [start[i] + d * 0.55, 1.1]; end[i] += 1.5; src[i] = 1; }
    free[k] = end[i];
  }
  const TEND = Math.max(...end), U0 = TEND + 0.7, UD = 2.0, DONE = U0 + UD;
  function gotAt(t) { let g = 0; for (let i = 0; i < N; i++) { if (t >= end[i]) g += SEG; else if (t > start[i]) g += SEG * (t - start[i]) / (end[i] - start[i]) * 0.9; } return g; }
  function at(t, o) {
    o = o || {}; const st = new Int8Array(N), fr = new Float32Array(N), da = new Float32Array(N); let first = N;
    for (let i = 0; i < N; i++) {
      da[i] = end[i];
      if (t >= end[i]) st[i] = 2; else if (t >= start[i]) {
        const r = retry[i]; if (r && t >= r[0] && t < r[0] + r[1]) { st[i] = 3; fr[i] = (r[0] - start[i]) / (end[i] - start[i]); }
        else { st[i] = 1; fr[i] = r && t >= r[0] + r[1] ? (t - r[0] - r[1]) / (end[i] - r[0] - r[1]) : (t - start[i]) / (end[i] - start[i]); }
      }
      if (st[i] !== 2 && i < first) first = i;
    }
    const got = gotAt(t), g0 = gotAt(t - 1), speed = t > T0 + 0.8 && t < TEND ? Math.max(0, got - g0) : 0;
    let pack = PACKS[0][0]; for (const p of PACKS) if (Math.min(first, N - 1) >= p[1]) pack = p[0];
    const busy = {}; for (let i = 0; i < N; i++) if (st[i] === 1) busy[src[i]] = 1; const nb = Object.keys(busy).length;
    const lead = SRC[+Object.keys(busy)[0] || 0];
    const s = { t, st, fr, doneAt: da, got: Math.min(TOTAL, got), total: TOTAL, speed, eta: speed > 0 ? (TOTAL - got) / speed : 0, pack, src: nb > 1 ? lead + ' 等 ' + nb + ' 个源' : lead, dir: 'D:/MeguLit/runtime',
      phase: t < T0 ? 'probe' : t < TEND + 0.4 ? 'download' : t < DONE ? 'unpack' : 'done', unpack: Math.max(0, Math.min(1, (t - U0) / UD)) };
    if (s.phase === 'unpack' || s.phase === 'done') s.got = TOTAL;
    if (o.fail === 'download') { for (let i = 0; i < N; i++) if (st[i] === 1 || st[i] === 3) st[i] = 4; s.speed = 0; s.eta = 0;
      s.err = { title: '下载中断了', en: 'Download interrupted', msg: '所有下载源都连不上（cn-dl.megulit.com、dl.megulit.com、github.com 均无响应）', tip: '先点「重试」：会重新测速、换最快的源，已下好的碎片保留。还是不行就复制日志发给我们，或到官网手动下载整包。' }; }
    if (o.fail === 'install') s.err = { title: '安装没有完成', en: 'Install did not finish', msg: '解压失败：安装位置的 runtime 文件夹里有文件被其他程序占用', tip: '关掉占用的程序、腾出磁盘空间后点「重试」；组件已经下载好，不会重下。' };
    return s;
  }
  const THEME_ROUTE = { edge: ["whip", "orbit", "dive", "pull"], night: ["roll", "whip", "orbit", "pull"] }; const ROUTE = THEME_ROUTE[Scene.THEME]; let tl = null, fixed = null;
  function build() {
    tl = gsap.timeline({ paused: true });
    tl.add(Scene.intro(), 0);
    tl.add(Scene.goTo('loc', ROUTE[0], 'welcome'), T0).add(Scene.goTo('field', ROUTE[1], 'loc'), 4.9).add(Scene.goTo('unpack', ROUTE[2], 'field'), U0 - 0.3).add(Scene.goTo('done', ROUTE[3], 'unpack'), DONE);
    const BS = String.fromCharCode(92), typed = 'D:' + BS + 'Games' + BS + 'MeguLit'; const path = document.getElementById('path');
    tl.call(() => { path.value = 'D:' + BS + 'MeguLit'; }, null, 0);
    for (let i = 0; i < typed.length; i++) tl.call(() => { path.value = typed.slice(0, i + 1); }, null, 3.3 + i * 0.05);
    tl.call(() => { document.getElementById('free').textContent = '所在磁盘可用 182 GB · 需要约 1.4 GB'; }, null, 4.2);
    tl.fromTo('#install', { scale: 1 }, { scale: 0.96, duration: 0.12, yoyo: true, repeat: 1 }, 4.7);
    tl.to({}, { duration: DONE + 7.4 }, 0);
    return tl;
  }
  const Demo = {
    N, TOTAL, T0, TEND, U0, DONE, at, DURATION: DONE + 7.4,
    build() { build(); window.__demoTl = tl; return tl; },
    seek(t, o) { fixed = o || null; tl.time(t, false); Scene.render(at(t, fixed)); const q = document.getElementById("ui-quit"); q.style.visibility = o && o.quit ? "visible" : "hidden"; q.style.opacity = o && o.quit ? 1 : 0; },
    play() { tl.eventCallback('onUpdate', () => Scene.render(at(tl.time()))); tl.play(); }
  };
  window.Demo = Demo;
  Scene.init({ count: N }); Demo.build();
  if (new URLSearchParams(location.search).get('paused') !== '1') Demo.play(); else Scene.render(at(0));
})();
