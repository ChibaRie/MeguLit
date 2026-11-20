/* MeguLit installer: one continuous 3D scene.
   The window is a camera looking into one space. Welcome, location, download field, unpack and finish are places in
   that space; every stage change is a camera move (whip, orbit, dive, roll, pull-back), never a page swap.
   Progress = the real download segments: one tile per segment, lit in the order the engine finishes them.
   This file only draws. Data comes in through Scene.render(snap) (see SEGMENT-FEED in the notes), actions go out
   through Scene.onAction. Transform + opacity only (plus one cheap filter-free streak layer). Reduced motion: no
   camera travel, only a short fade. GSAP drives every move so a recorder can seek frame by frame. */
(function () {
  const Q = new URLSearchParams(location.search);
  const THEME = Q.get('theme') === 'night' ? 'night' : 'edge';
  const REDUCE = Q.get('reduce') === '1' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.documentElement.dataset.theme = THEME;
  const $ = (s) => document.querySelector(s);
  const world = $('#world');
  const T = 56, GAP = 4, ROWS = 8;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const MB = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB');

  /* ---------- geometry helpers ---------- */
  function box(x, y, z, w, h, d, cls) {
    const g = document.createElement('div'); g.className = 'o3 box ' + (cls || ''); g.style.transform = `translate3d(${x}px,${y}px,${z}px)`;
    const face = (c, fw, fh, tf) => { const f = document.createElement('i'); f.className = c; f.style.cssText = `width:${fw}px;height:${fh}px;margin:${-fh / 2}px 0 0 ${-fw / 2}px;transform:${tf}`; g.appendChild(f); };
    face('f', w, h, `translateZ(${d / 2}px)`); face('b', w, h, `rotateY(180deg) translateZ(${d / 2}px)`);
    face('l', d, h, `rotateY(-90deg) translateZ(${w / 2}px)`); face('r', d, h, `rotateY(90deg) translateZ(${w / 2}px)`);
    face('t', w, d, `rotateX(90deg) translateZ(${h / 2}px)`);
    world.appendChild(g); return g;
  }
  function plane(x, y, z, w, h, rx, cls) {
    const p = document.createElement('div'); p.className = 'plane ' + cls; p.style.cssText = `width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px;transform:translate3d(${x}px,${y}px,${z}px) rotateX(${rx}deg)`;
    world.appendChild(p); return p;
  }
  function plate(x, y, z, w, h, html) {
    const p = document.createElement('div'); p.className = 'plate'; p.style.cssText = `width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px;transform:translate3d(${x}px,${y}px,${z}px)`;
    p.innerHTML = '<div class="bar"></div>' + html; world.appendChild(p); return p;
  }
  function ghost(x, y, z, size, text) {
    const g = document.createElement('div'); g.className = 'ghost'; g.textContent = text; g.style.cssText = `font-size:${size}px;transform:translate3d(${x}px,${y}px,${z}px)`; world.appendChild(g);
  }
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

  /* ---------- layout of the world ---------- */
  const FLOOR = THEME === 'edge', P = 820, FY = 1200;
  const A = { x: 3300, y: -260, z: -1400 }, RF = 2400;                 /* the shard cloud's centre and the one correct camera distance */
  let N = 0, COLS = 0, tiles = [], cache = null, revealAt = 1e9;

  function buildStatic() {
    plane(1700, FY, -1000, 9000, 5200, 90, 'floor');
    plane(1700, 300, -1000, 3400, 14, 90, 'guide');                       /* the crimson guide beam: where to look next */
    if (FLOOR) {
      [[-700, -1900, 360, 1500, 300], [-1200, -700, 280, 1700, 260], [600, -2300, 460, 1400, 380], [1700, -2500, 300, 1900, 300], [1900, -2700, 340, 1500, 340],
       [4800, -2300, 380, 1700, 380], [5600, -1100, 300, 1300, 300], [4700, -300, 420, 1500, 360], [1500, 800, 400, 1700, 300], [1000, 700, 360, 1500, 320], [3900, -3400, 520, 2100, 420]]
        .forEach(([x, z, w, hh, d], i) => box(x, FY - hh / 2, z, w, hh, d, i === 3 ? 'red' : ''));
      box(900, 300 - 60, -760, 60, 120, 60, 'red');
    } else {
      for (let i = 0; i < 12; i++) { const x = -800 + i * 600, h = 1100 + rnd() * 1300, d = 260 + rnd() * 260; box(x, FY - h / 2, -1700 - rnd() * 1500, 220 + rnd() * 160, h, d, i === 4 ? 'red' : ''); }
    }
    plate(0, -20, -1000, 760, 360, '<img src="logo.png" alt=""><h2>安装 · INSTALL</h2>');
    plate(1700, -20, -1000, 760, 360, '<h1 style="font-size:96px;letter-spacing:-3px">WHERE</h1><h2>装到哪里 · 选一个位置</h2>');
    ghost(1330, -380, -1010, 190, 'MEGU'); ghost(2200, 120, -1010, 190, 'LIT');
  }

  /* Anamorphic glass shards: one per real download segment. Each hangs at its own depth; its position and size were solved
     backwards so that from ONE camera (FINAL) it projects exactly onto its piece of the logo. From any other angle they are
     just drifting glass. Finished shards light up and show their piece; when all are lit the camera slowly arcs to FINAL and
     the logo resolves. No shard ever moves to assemble; only the viewpoint does. Everything is a pure function of (snapshot, t). */
  const FINAL = { cx: A.x, cy: A.y, cz: A.z + RF, rx: 0, ry: 0, rz: 0 };
  const smooth = (x) => x * x * (3 - 2 * x);
  /* Broken glass: the logo area is fractured (Voronoi cells around seeds of very different spacing) into N irregular shards,
     a few big, many medium, some splinters. A shard carries only its own piece of the logo (printed on the glass), hangs at its
     own depth and tilt, and was placed so that from FINAL its piece lands where it belongs in the whole logo. */
  const LW = 840, LH = Math.round(840 * 169 / 440), LCY = -40;       /* the logo as seen from FINAL: size and vertical offset on screen */
  const clipHalf = (poly, a, b, c0) => { const out = []; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], fp = a * p[0] + b * p[1] - c0, fq = a * q[0] + b * q[1] - c0; if (fp <= 0) out.push(p); if ((fp <= 0) !== (fq <= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } } return out; };
  function fracture(n, rand) {
    const seeds = [], radii = []; const W = LW, H = LH;
    const cls = []; for (let i = 0; i < n; i++) { const u = rand(); cls.push(u < 0.07 ? 58 + rand() * 24 : u < 0.55 ? 28 + rand() * 14 : 11 + rand() * 9); }
    cls.sort((a, b) => b - a);
    for (const r0 of cls) { let r = r0, ok = false; for (let k = 0; k < 400 && !ok; k++) { if (k % 60 === 59) r *= 0.88; const p = [rand() * W, rand() * H]; if (seeds.every((q, j) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= (r + radii[j]) * 0.62)) { seeds.push(p); radii.push(r); ok = true; } } if (!ok) { seeds.push([rand() * W, rand() * H]); radii.push(r); } }
    return seeds.map((s, i) => { let poly = [[0, 0], [W, 0], [W, H], [0, H]]; for (let j = 0; j < seeds.length && poly.length; j++) if (j !== i) { const q = seeds[j]; poly = clipHalf(poly, q[0] - s[0], q[1] - s[1], (q[0] * q[0] + q[1] * q[1] - s[0] * s[0] - s[1] * s[1]) / 2); } return poly; }).filter((p) => p.length >= 3);
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function buildField(n) {
    N = n; let sd = 5; const rr = () => (sd = (sd * 16807) % 2147483647) / 2147483647, r = () => rr() * 2 - 1;
    let cells = fracture(n, rr); while (cells.length < n) cells.push(cells[cells.length % cells.length]);
    cells = cells.slice(0, n); tiles = [];
    const info = cells.map((p) => { const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); return { p, x0, y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }; });
    info.sort((a, b) => a.cx - b.cx || a.cy - b.cy);               /* segment i is shard i: the logo fills in from the left as the download goes on */
    const defs = document.createElementNS(SVGNS, 'svg'); defs.setAttribute('width', 0); defs.setAttribute('height', 0); defs.style.position = 'absolute';
    defs.innerHTML = '<defs><linearGradient id="gBody" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".5" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity=".22"/></linearGradient><linearGradient id="gBody2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".55" stop-color="#fff" stop-opacity=".02"/><stop offset="1" stop-color="#fff" stop-opacity=".26"/></linearGradient><linearGradient id="gEdge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".45" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></linearGradient><linearGradient id="gFill" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff5a76"/><stop offset="1" stop-color="#c8203c"/></linearGradient></defs>';
    world.appendChild(defs);
    info.forEach((q, i) => {
      const d = 1250 + rr() * 2300, k = (d + P) / P, pts = q.p.map((v) => [(v[0] - q.x0).toFixed(1), (v[1] - q.y0).toFixed(1)]), ps = pts.map((v) => v.join(',')).join(' ');
      const gx = pts.reduce((s, v) => s + +v[0], 0) / pts.length, gy = pts.reduce((s, v) => s + +v[1], 0) / pts.length, inset = pts.map((v) => [(gx + (v[0] - gx) * 0.8).toFixed(1), (gy + (v[1] - gy) * 0.8).toFixed(1)].join(',')).join(' ');
      const el = document.createElementNS(SVGNS, 'svg'); el.setAttribute('class', 'shard'); el.setAttribute('width', q.w.toFixed(1)); el.setAttribute('height', q.h.toFixed(1));
      el.style.cssText = `left:${-q.w / 2}px;top:${-q.h / 2}px;width:${q.w}px;height:${q.h}px`;
      const body = i % 2 ? 'gBody' : 'gBody2';
      el.innerHTML = `<defs><clipPath id="c${i}"><polygon points="${ps}"/></clipPath></defs>
        <polygon class="back" points="${ps}" transform="translate(3.5 3.5)" fill="rgba(10,18,36,.30)"/>
        <polygon points="${ps}" fill="url(#${body})"/>
        <image class="art" href="logo.png" x="${-q.x0}" y="${-q.y0}" width="${LW}" height="${LH}" clip-path="url(#c${i})" opacity=".26"/>
        <rect class="fill" x="0" y="0" width="${q.w.toFixed(1)}" height="${q.h.toFixed(1)}" fill="url(#gFill)" clip-path="url(#c${i})" opacity="0" style="transform-origin:0 50%;transform:scaleX(0)"/>
        <polygon points="${inset}" fill="none" stroke="rgba(255,255,255,.42)" stroke-width="1"/>
        <polygon class="edge" points="${ps}" fill="none" stroke="url(#gEdge)" stroke-width="1.7" stroke-linejoin="round"/>
        <polygon class="flash" points="${ps}" fill="#fff" opacity="0"/>`;
      world.appendChild(el);
      tiles.push({ el, art: el.querySelector('.art'), fill: el.querySelector('.fill'), flash: el.querySelector('.flash'), u: q.cx / LW, d, s: k,
        X: FINAL.cx + (q.cx - LW / 2) * k, Y: FINAL.cy + (q.cy - LH / 2 + LCY) * k, Z: FINAL.cz - d,
        rx: r() * 48, ry: r() * 48, rz: r() * 40, ph: rr() * 6.28, amp: 14 + rr() * 44, spin: 0.15 + rr() * 0.3, fxk: '' });
    });
    cache = { st: new Int8Array(N).fill(-1), f: new Float32Array(N).fill(-1), fl: new Float32Array(N).fill(-1), w: new Float32Array(N).fill(-1), blur: new Int8Array(N).fill(-1) };
    const mini = $('#mini'); mini.innerHTML = ''; for (let i = 0; i < N; i++) mini.appendChild(document.createElement('i'));
    cache.mini = new Int8Array(N).fill(-1);
  }

  /* ---------- camera ---------- */
  const cam = { cx: -420, cy: -150, cz: 800, rx: 6, ry: -12, rz: 0 };
  let section = 'welcome', moving = false, last = { t: 0, phase: 'probe' };
  const orbit = (az, el, R) => { const a = az * Math.PI / 180, e = el * Math.PI / 180; return { cx: A.x + R * Math.sin(a) * Math.cos(e), cy: A.y - R * Math.sin(e), cz: A.z + R * Math.cos(a) * Math.cos(e), rx: el, ry: -az, rz: 0 }; };
  const toSph = (p) => { const dx = p.cx - A.x, dy = A.y - p.cy, dz = p.cz - A.z, R = Math.hypot(dx, dy, dz); return { az: Math.atan2(dx, dz) * 180 / Math.PI, el: Math.asin(dy / R) * 180 / Math.PI, R }; };
  const key = (ks, p) => { for (let i = 1; i < ks.length; i++) if (p <= ks[i][0]) { const [p0, v0] = ks[i - 1], [p1, v1] = ks[i]; return lerp(v0, v1, smooth(clamp((p - p0) / (p1 - p0)))); } return ks[ks.length - 1][1]; };
  /* while downloading the camera wanders around the cloud; near 62 % it passes a viewpoint that is almost, not quite, the right one */
  const AZ = [[0, -62], [0.3, -34], [0.75, 3.5], [0.88, 24], [1, 46]], EL = [[0, 18], [0.35, 11], [0.75, 6], [0.9, 13], [1, 19]], RR = [[0, 2650], [0.75, 2200], [1, 2750]];
  const POSE = {
    welcome: () => ({ cx: 0, cy: -20, cz: 0, rx: 0, ry: 0, rz: 0 }),
    loc: () => ({ cx: 1700, cy: -20, cz: 0, rx: 0, ry: THEME === 'edge' ? -6 : 6, rz: 0 }),
    field: (s) => { const p = s && s.total ? clamp(s.got / s.total) : 0; return orbit(key(AZ, p), key(EL, p), key(RR, p)); },
    unpack: () => orbit(30, 52, 3000),
    done: () => ({ ...FINAL })
  };
  const MOVES = {
    whip:  { d: 0.95, ease: 'expo.inOut', fx: (s) => ({ ry: 16 * s, rz: -5 * s, streak: s, flash: 0.2 * s }) },
    orbit: { d: 2.1, ease: 'sine.inOut', fx: (s) => ({ cx: -420 * s, cz: 620 * s, ry: -22 * s, rz: 2 * s }) },
    dive:  { d: 2.2, ease: 'power3.inOut', sph: true, fx: (s) => ({ streak: s * 0.4 }) },
    roll:  { d: 1.9, ease: 'power3.inOut', fx: (s, a, p) => ({ rz: 360 * p, cz: 180 * s }) },
    push:  { d: 1.6, ease: 'power3.inOut', fx: (s) => ({ cz: 220 * s }) },
    pull:  { d: 4.4, ease: 'power2.inOut', sph: true, fx: () => ({}) }
  };
  function apply(extra) {
    const c = cam, e = extra || {};
    const t = last.t || 0, br = REDUCE || moving ? 0 : 1;      /* a little handheld breath while resting */
    const cx = c.cx + Math.sin(t * 0.7) * 5 * br, cy = c.cy + Math.cos(t * 0.5) * 4 * br;
    world.style.transform = `rotateZ(${c.rz}deg) rotateX(${-c.rx}deg) rotateY(${c.ry}deg) translate3d(${-cx}px,${-cy}px,${-c.cz}px)`;
    const sk = $('#streaks'); sk.style.opacity = e.streak || 0; $('#flash').style.opacity = e.flash || 0;
  }
  const UI = { welcome: [], loc: ['#ui-loc'], field: ['#hud'], unpack: ['#hud'], done: ['#ui-done'] };
  const ORDER = ['welcome', 'loc', 'field', 'unpack', 'done'];
  const STEPN = { welcome: '准备 · Prepare', loc: '位置 · Location', field: '下载 · Download', unpack: '安装 · Install', done: '完成 · Done' };
  function setSteps() { const k = ORDER.indexOf(section); document.querySelectorAll('#steps i').forEach((el, i) => el.classList.toggle('on', i < Math.min(4, k + 1) || section === 'done')); $('#stepname').textContent = STEPN[section]; }

  function goTo(name, move, fromName) {
    const tl = gsap.timeline(), m = MOVES[move] || MOVES.push, o = { p: 0 }; let A0 = null;
    const from = fromName || section; const outs = UI[from] || [], ins = UI[name] || [];
    tl.call(() => { A0 = { ...cam }; section = name; moving = true; setSteps(); if (name !== 'done') revealAt = 1e9; });
    if (outs.length && !outs.every((s) => ins.includes(s))) tl.to(outs.filter((s) => !ins.includes(s)), { opacity: 0, duration: 0.22, ease: 'power1.in', onComplete() { outs.forEach((s) => { if (!ins.includes(s)) $(s).style.visibility = 'hidden'; }); } }, 0);
    if (REDUCE) {
      tl.call(() => { Object.assign(cam, POSE[name](last)); moving = false; if (name === 'done') revealAt = last.t || 0; apply(); }, null, 0.05);
    } else {
      tl.to(o, { p: 1, duration: m.d, ease: m.ease, onUpdate() {
        const B = POSE[name](last), p = o.p, s = Math.sin(Math.PI * Math.min(1, p)), x = m.fx(s, A0, p);
        if (m.sph) {
          const a = toSph(A0), b = toSph(B); let da = b.az - a.az; if (da > 180) da -= 360; if (da < -180) da += 360;
          Object.assign(cam, orbit(a.az + da * p, lerp(a.el, b.el, p), lerp(a.R, b.R, p)));
        } else {
          cam.cx = lerp(A0.cx, B.cx, p) + (x.cx || 0); cam.cy = lerp(A0.cy, B.cy, p) + (x.cy || 0); cam.cz = lerp(A0.cz, B.cz, p) + (x.cz || 0);
          cam.rx = lerp(A0.rx, B.rx, p); cam.ry = lerp(A0.ry, B.ry, p) + (x.ry || 0); cam.rz = lerp(A0.rz, B.rz, p) + (x.rz || 0);
        }
        apply(x);
      } }, 0.02);
      tl.call(() => { moving = false; cam.rz = POSE[name](last).rz; if (name === 'done') revealAt = last.t || 0; apply(); });
    }
    ins.forEach((s) => { const el = $(s); tl.set(el, { visibility: 'visible' }, REDUCE ? 0.05 : m.d * (name === 'done' ? 0.9 : 0.72)).fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: REDUCE ? 0.25 : 0.55, ease: 'power2.out' }, '<'); });
    return tl;
  }

  /* ---------- render from a snapshot (pure: same snapshot, same picture) ---------- */
  function render(s) {
    last = s; if (!N && s.st) buildField(s.st.length);
    const t = s.t || 0;
    if (!moving && POSE[section]) { Object.assign(cam, POSE[section](s)); apply(); }
    if (N && s.st) {
      const br = REDUCE ? 0 : 1;
      /* how close the camera is to the one right place: 0 far, 1 there (shards settle their tilt and the blur melts away) */
      const dd = Math.hypot(cam.cx - FINAL.cx, cam.cy - FINAL.cy, cam.cz - FINAL.cz), reveal = s.phase === 'done' ? smooth(clamp(1 - dd / (RF * 0.55))) : 0;
      const post = s.phase === 'done' && reveal > 0.99 ? clamp((t - revealAt - 1.4) / 2.5) * 0.28 : 0;     /* after the reveal they drift a little so you see they are apart */
      const damp = (1 - 0.94 * reveal) + post, pos = new Array(N), ft = t * br;
      for (let i = 0; i < N; i++) {
        const st = s.st[i], f = s.fr[i], tl = tiles[i];
        const ox = Math.sin(ft * 0.5 + tl.ph) * tl.amp * damp * br, oy = Math.cos(ft * 0.4 + tl.ph) * tl.amp * damp * br, oz = Math.sin(ft * 0.6 + tl.ph * 2) * tl.amp * 1.5 * damp * br;
        const k = 1 - reveal, rx = (tl.rx + Math.sin(ft * tl.spin + tl.ph) * 10 * br) * k + post * 9 * Math.sin(t + tl.ph), ry = (tl.ry + Math.cos(ft * tl.spin + tl.ph) * 10 * br) * k + post * 9 * Math.cos(t + tl.ph), rz = tl.rz * k;
        tl.el.style.transform = `translate3d(${(tl.X + ox).toFixed(1)}px,${(tl.Y + oy).toFixed(1)}px,${(tl.Z + oz).toFixed(1)}px) rotateX(${rx.toFixed(1)}deg) rotateY(${ry.toFixed(1)}deg) rotateZ(${rz.toFixed(1)}deg) scale(${tl.s.toFixed(3)})`;
        pos[i] = [tl.X + ox, tl.Y + oy, tl.Z + oz];
        const fl = st === 2 ? clamp(1 - (t - (s.doneAt[i] || 0)) / 0.9) * 0.55 : 0;
        const w = s.phase === 'unpack' ? clamp(1 - Math.abs(tl.u - s.unpack * 1.25 + 0.12) * 7) : 0;
        if (cache.st[i] !== st || cache.f[i] !== f) {
          cache.st[i] = st; cache.f[i] = f;
          tl.art.setAttribute('opacity', st === 2 ? 1 : st === 1 || st === 3 ? 0.55 : 0.26);
          tl.fill.style.opacity = st === 1 || st === 3 || st === 4 ? 0.8 : 0;
          tl.fill.style.transform = `scaleX(${st === 2 ? 0 : f})`;
          tl.fill.setAttribute('fill', st === 3 || st === 4 ? '#f0a34a' : 'url(#gFill)');
        }
        if (cache.fl[i] !== fl) { cache.fl[i] = fl; tl.flash.setAttribute('opacity', fl.toFixed(2)); }
        if (cache.w[i] !== w) { cache.w[i] = w; if (s.phase === 'unpack' || w === 0) { tl.fill.style.opacity = w > 0 ? 0.75 : (st === 1 || st === 3 || st === 4 ? 0.8 : 0); if (w > 0) tl.fill.style.transform = 'scaleX(1)'; } }
        const ms = st === 2 ? 2 : st === 1 ? 1 : st === 3 || st === 4 ? 3 : 0;
        if (cache.mini[i] !== ms) { cache.mini[i] = ms; $('#mini').children[i].className = ['', 'a', 'd', 'r'][ms]; }
      }
      /* depth of field: focus = the shard being fetched now; a shard's blur changes only when it crosses a depth bucket, so the
         compositor keeps each blurred texture while the camera moves. Blur is divided by the shard's own scale (it is applied before it). */
      let fi = N - 1; for (let i = 0; i < N; i++) if (s.st[i] !== 2) { fi = i; break; }
      const useDof = !REDUCE && s.phase !== 'unpack' && reveal < 0.7;
      const D = (p) => Math.hypot(p[0] - cam.cx, p[1] - cam.cy, p[2] - cam.cz), fd = D(pos[fi]);
      for (let i = 0; i < N; i++) {
        let lv = 0; if (useDof) { const rel = Math.abs(D(pos[i]) - fd) / Math.max(300, fd * 0.2); lv = rel < 0.55 ? 0 : rel < 1.1 ? 1 : rel < 1.9 ? 2 : rel < 3 ? 3 : 4; lv = Math.floor(lv * (1 - reveal)); }
        const glow = (s.st[i] === 1 || s.st[i] === 3) ? 1 : (s.st[i] === 2 ? 2 : 0), key = lv * 4 + glow;
        if (cache.blur[i] !== key) { cache.blur[i] = key; const sc = tiles[i].s; tiles[i].el.style.filter = (lv ? `blur(${([0, 1.2, 2.6, 4.4, 6.5][lv] / sc).toFixed(2)}px) ` : '') + (glow === 1 ? `drop-shadow(0 0 ${(9 / sc).toFixed(1)}px rgba(255,64,96,.95))` : ''); }
      }
    }
    const pct = s.total ? Math.floor(100 * s.got / s.total) : 0;
    $('#pct').textContent = pct; $('#got').textContent = MB(s.got || 0); $('#total').textContent = MB(s.total || 0);
    $('#speed').textContent = s.phase === 'download' || s.phase === 'probe' ? (s.speed > 0 ? (s.speed / 1048576).toFixed(1) + ' MB/s' : '测速中') : '';
    $('#eta').textContent = s.eta > 0 ? (s.eta < 60 ? `约剩 ${Math.ceil(s.eta)} 秒` : `约剩 ${Math.floor(s.eta / 60)} 分 ${Math.round(s.eta % 60)} 秒`) : '';
    const W = { probe: ['正在选最快的源', '同时给 GitHub 和国内镜像测速，挑最快的几个一起下'], download: ['正在下载 ' + (s.pack || ''), '来源 <span class="src">' + (s.src || '') + '</span> · 每块碎片是一个真实的下载分段'], unpack: ['正在安装', '解压 ' + (s.pack || '') + ' 到 ' + (s.dir || '')], done: ['装好了', ''] }[s.phase] || ['', ''];
    $('#whatT').textContent = W[0]; $('#whatP').innerHTML = W[1];
    if (s.err && !showErr) showError(s.err); else if (!s.err && showErr) hideError();
  }
  let showErr = false;
  function showError(e) {
    showErr = true; $('#errT').textContent = e.title; $('#errEn').textContent = e.en; $('#errM').textContent = e.msg; $('#errTip').textContent = e.tip;
    gsap.set('#ui-err', { visibility: 'visible' }); gsap.fromTo('#ui-err', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: REDUCE ? 0.2 : 0.45, ease: 'power2.out', overwrite: true });
  }
  function hideError() { showErr = false; gsap.to('#ui-err', { opacity: 0, duration: 0.25, overwrite: true, onComplete() { $('#ui-err').style.visibility = 'hidden'; } }); }

  /* ---------- actions out ---------- */
  const Scene = { cam, onAction: null, goTo, render, THEME, REDUCE, get section() { return section; }, init(opts) { if (opts && opts.count) buildField(opts.count); apply(); setSteps(); } };
  function act(type, extra) { const m = Object.assign({ type }, extra || {}); if (window.chrome && chrome.webview) chrome.webview.postMessage(m); if (Scene.onAction) Scene.onAction(m); }
  $('#install').addEventListener('click', () => act('install', { path: $('#path').value, desktop: $('#swDesk').getAttribute('aria-checked') === 'true', menu: $('#swMenu').getAttribute('aria-checked') === 'true' }));
  $('#browse').addEventListener('click', () => act('browse')); $('#retry').addEventListener('click', () => act('retry'));
  $('#copylog').addEventListener('click', () => act('copylog')); $('#manual').addEventListener('click', () => act('manual')); $('#launch').addEventListener('click', () => act('launch'));
  document.querySelectorAll('.sw').forEach((b) => b.addEventListener('click', () => b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true')));
  /* streak lines for whips */
  const sk = $('#streaks'); for (let i = 0; i < 16; i++) { const b = document.createElement('b'); b.style.top = (6 + i * 5.8) + '%'; b.style.opacity = 0.25 + (i % 4) * 0.2; b.style.transform = `scaleX(${0.4 + (i % 5) * 0.15})`; sk.appendChild(b); }
  if (Q.get('desk') === '1') document.documentElement.classList.add('deskmode');
  let quitOpen = false;
  Scene.showQuit = (on) => { quitOpen = on; const el = $('#ui-quit'); if (on) { gsap.set(el, { visibility: 'visible' }); gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2, overwrite: true }); $('#stay').focus(); } else gsap.to(el, { opacity: 0, duration: 0.18, overwrite: true, onComplete() { el.style.visibility = 'hidden'; } }); };
  $('#btnClose').addEventListener('click', () => { if (last.phase === 'download' || last.phase === 'probe' || last.phase === 'unpack') Scene.showQuit(true); else act('close'); });
  $('#stay').addEventListener('click', () => Scene.showQuit(false)); $('#leave').addEventListener('click', () => act('close')); $('#btnMin').addEventListener('click', () => act('minimize'));
  $('#drag').addEventListener('mousedown', (e) => { if (e.button === 0) act('dragstart'); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (quitOpen) Scene.showQuit(false); else $('#btnClose').click(); } });
  window.Scene = Scene;
  buildStatic();
  Object.assign(cam, REDUCE ? POSE.welcome() : { cx: -420, cy: -150, cz: 800, rx: 6, ry: -12, rz: 0 }); apply(); setSteps();
  /* welcome plate is visible at once; the opening push-in settles on it (demo/host starts it) */
  Scene.intro = () => { const o = { p: 0 }, A = { ...cam }; return gsap.to(o, { p: 1, duration: 2.4, ease: 'power3.out', onUpdate() { const B = POSE.welcome(); for (const k in B) cam[k] = lerp(A[k], B[k], o.p); apply(); } }); };
})();
