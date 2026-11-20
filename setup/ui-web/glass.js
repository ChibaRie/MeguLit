/* MeguLit installer: the real-3D layer (three.js). Buildings, magic etchings, light bands and the eight glass plates are objects in one
   WebGL scene; the DOM keeps only the HUD, the glass control panel and the window frame.
   Glass = MeshPhysicalMaterial with transmission (refracts the buildings behind it), real thickness and bevel, clearcoat, green-white
   edge tint. The logo is NOT painted on it: it is a frosted volume inside the glass (three thin translucent layers at different depths
   inside the plate, with a bump map, so parallax shows it sits inside), unlit parts stay perfectly clear. Light is the only "colour":
   a cold white light enters from the plate's edge and fills the etching along the group's real progress.
   If WebGL is not available this file does nothing and scene.js keeps its DOM fallback.  */
(function () {
  const THREE = window.THREE; if (!THREE) return;
  const Q = new URLSearchParams(location.search), NIGHT = Q.get('theme') === 'night', REDUCE = Q.get('reduce') === '1' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const MODE = Q.get('mode') === 'B' ? 'B' : 'A';
  const view = document.getElementById('view'); if (!view) return;
  let renderer; try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); } catch (e) { return; }
  if (!renderer.getContext()) return;
  const P = 820, FY = 1200, D2R = Math.PI / 180;
  const el = renderer.domElement; el.id = 'gl'; el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'; view.insertBefore(el, view.firstChild);
  const wd = document.getElementById('world'); if (wd) wd.style.display = 'none';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, REDUCE ? 1 : 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const BG = NIGHT ? 0x0a0c10 : 0xa9b4c5;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(BG); scene.fog = new THREE.Fog(BG, 3200, 15000);
  const camera = new THREE.PerspectiveCamera(40, 1.5, 30, 40000); camera.rotation.order = 'YXZ';
  function resize() { const w = view.clientWidth || 1000, h = view.clientHeight || 640; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = 2 * Math.atan((h / 2) / P) / D2R; camera.updateProjectionMatrix(); }
  resize(); if (window.ResizeObserver) new ResizeObserver(resize).observe(view);

  /* ---- light + a small studio for reflections (softboxes make the glass edges and clearcoat read) ---- */
  scene.add(new THREE.HemisphereLight(NIGHT ? 0x8fa0c4 : 0xffffff, NIGHT ? 0x14171f : 0x8d97a8, NIGHT ? 0.9 : 1.15));
  const sun = new THREE.DirectionalLight(NIGHT ? 0xcfe0ff : 0xffffff, NIGHT ? 1.1 : 1.5); sun.position.set(-2500, 4000, 3000); scene.add(sun);
  { const es = new THREE.Scene(); es.background = new THREE.Color(NIGHT ? 0x05060a : 0xcfd6e2);
    const box = (w, h, x, y, z, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m); };
    box(60, 14, -40, 40, 30, NIGHT ? 14 : 5); box(10, 60, 45, 10, -30, NIGHT ? 10 : 4); box(80, 8, 0, -40, 20, NIGHT ? 5 : 2.5); box(30, 30, 0, 60, -50, NIGHT ? 8 : 3);
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0.02).texture; pm.dispose(); }

  /* ---- canvas textures ---- */
  const tex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const cnv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const LINE = NIGHT ? '235,242,255' : '24,28,36';
  function drawCircle(cv, prog) {
    const g = cv.getContext('2d'), S = cv.width, r = S / 200; g.clearRect(0, 0, S, S); g.save(); g.translate(S / 2, S / 2); g.scale(r, r);
    if (prog === undefined) {
      g.strokeStyle = `rgba(${LINE},.7)`; g.lineWidth = 1.5; const ring = (rad, w, dash) => { g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.arc(0, 0, rad, 0, 7); g.stroke(); };
      ring(97, 2.4); ring(82, 1.4, [2, 5]); ring(66, 1.4); ring(12, 1.4); g.setLineDash([]); g.lineWidth = 1.2;
      for (let i = 0; i < 48; i++) { const a = i * Math.PI / 24, r0 = i % 4 ? 90 : 84; g.beginPath(); g.moveTo(r0 * Math.cos(a), r0 * Math.sin(a)); g.lineTo(96 * Math.cos(a), 96 * Math.sin(a)); g.stroke(); }
      for (const rot of [-Math.PI / 2, Math.PI / 2]) { g.beginPath(); for (let i = 0; i < 3; i++) { const a = rot + i * 2 * Math.PI / 3; i ? g.lineTo(60 * Math.cos(a), 60 * Math.sin(a)) : g.moveTo(60 * Math.cos(a), 60 * Math.sin(a)); } g.closePath(); g.stroke(); }
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6 + 0.26, x = 73 * Math.cos(a), y = 73 * Math.sin(a); g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2); g.beginPath(); g.moveTo(-4, -5); g.lineTo(4, 0); g.lineTo(-4, 5); g.moveTo(4, -5); g.lineTo(4, 5); g.stroke(); g.restore(); }
    } else { g.strokeStyle = NIGHT ? 'rgba(220,235,255,.95)' : 'rgba(255,255,255,1)'; g.lineWidth = 5; g.shadowColor = NIGHT ? 'rgba(160,200,255,.9)' : 'rgba(80,100,130,.9)'; g.shadowBlur = 14; g.beginPath(); g.arc(0, 0, 75, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.0001, prog)); g.stroke(); }
    g.restore();
  }
  const mat = (map, extra) => new THREE.MeshBasicMaterial(Object.assign({ map, transparent: true, depthWrite: false }, extra || {}));

  /* ---- the city: plain blocks, one facet of magic cut into them as colourless line work ---- */
  const bMat = new THREE.MeshStandardMaterial({ color: NIGHT ? 0x1b1f28 : 0xf2f4f8, roughness: 0.92, metalness: 0 });
  const eMat = new THREE.LineBasicMaterial({ color: NIGHT ? 0x3b4456 : 0xaab3c2, transparent: true, opacity: 0.9 });
  const addBox = (x, z, w, hh, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), bMat); m.position.set(x, -(FY - hh / 2), z); scene.add(m); const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), eMat); l.position.copy(m.position); scene.add(l); };
  [[-800, -6200, 520, 2600, 420], [700, -7000, 420, 3200, 380], [1900, -6000, 600, 2300, 500], [3300, -7400, 700, 3400, 520], [4700, -6100, 560, 2500, 460], [5900, -6900, 420, 3000, 400], [7100, -6000, 520, 2400, 440], [8300, -7200, 460, 3100, 420], [-1900, -7000, 500, 2800, 420],
    [900, -2300, 360, 1700, 320], [300, -1200, 300, 1500, 280], [5800, -1700, 360, 1800, 320], [7200, -900, 320, 1500, 300], [-1200, -2600, 400, 2000, 360], [8200, -2400, 420, 2100, 380], [-200, -3200, 1500, 2400, 300], [6600, -3000, 1500, 2400, 300]].forEach((b) => addBox(...b));
  { const gc = cnv(256, 256), g = gc.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 256, 256); g.strokeStyle = NIGHT ? 'rgba(90,104,130,.55)' : 'rgba(120,132,152,.5)'; g.lineWidth = 2; g.strokeRect(1, 1, 255, 255);
    const t = new THREE.CanvasTexture(gc); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(100, 75);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(12000, 9000), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })); fl.rotation.x = -Math.PI / 2; fl.position.set(1700, -FY, -1000); scene.add(fl);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 9000), new THREE.MeshStandardMaterial({ color: NIGHT ? 0x0f1217 : 0xe6e9ef, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.set(1700, -FY - 2, -1000); scene.add(ground); }
  /* guide beam + etched circles + halo rings + a band of travelling light */
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(3400, 14), new THREE.MeshBasicMaterial({ color: NIGHT ? 0xe8f0ff : 0x20242c, transparent: true, opacity: NIGHT ? 0.9 : 0.8 })); beam.rotation.x = -Math.PI / 2; beam.position.set(1700, -300, -1000); scene.add(beam);
  const circleBase = cnv(1024, 1024); drawCircle(circleBase);
  const progCv = cnv(512, 512), progTex = tex(progCv); drawCircle(progCv, 0);
  const place = (m, x, y, z) => { m.position.set(x, y, z); scene.add(m); return m; };
  const ct = tex(circleBase);
  place(new THREE.Mesh(new THREE.PlaneGeometry(1180, 1180), mat(ct)), -200, -(FY - 1300), -3200 + 151); place(new THREE.Mesh(new THREE.PlaneGeometry(1180, 1180), mat(progTex, { blending: THREE.AdditiveBlending })), -200, -(FY - 1300), -3200 + 153);
  place(new THREE.Mesh(new THREE.PlaneGeometry(1180, 1180), mat(ct)), 6600, -(FY - 1300), -3000 + 151);
  for (const [x, z] of [[6600, -3000], [-200, -3200]]) { const r = new THREE.Mesh(new THREE.TorusGeometry(550, 4.5, 8, 140), new THREE.MeshBasicMaterial({ color: NIGHT ? 0xeaf2ff : 0x20242c })); r.rotation.x = Math.PI / 2; place(r, x, -(FY - 2450), z); }
  const bandCv = cnv(16, 128), bg2 = bandCv.getContext('2d'); bg2.fillStyle = '#fff'; bg2.fillRect(0, 0, 16, 46); const bandTex = tex(bandCv); bandTex.wrapT = THREE.RepeatWrapping; bandTex.repeat.set(1, 2200 / 120);
  const band = place(new THREE.Mesh(new THREE.PlaneGeometry(12, 2200), mat(bandTex, { blending: THREE.AdditiveBlending, color: NIGHT ? 0xdbe8ff : 0x20242c })), 560, -(FY - 1100), -2870 + 0);
  { const rc = cnv(64, 920), g = rc.getContext('2d'); g.strokeStyle = `rgba(${LINE},.6)`; g.lineWidth = 3; for (let i = 0; i < 12; i++) { const y = i * 76 + 10; g.beginPath(); g.moveTo(6, y + 10); g.lineTo(30, y); g.lineTo(54, y + 10); g.lineTo(30, y + 20); g.closePath(); g.moveTo(30, y + 30); g.lineTo(30, y + 66); g.stroke(); } place(new THREE.Mesh(new THREE.PlaneGeometry(90, 1400), mat(tex(rc))), 3300, -(FY - 1700), -7400 + 261); }
  /* welcome + location plates, text and logo drawn onto planes */
  const logoImg = new Image(); const plates = [];
  function plate(x, y, z, title, sub, withLogo) { const cv = cnv(1520, 720), t = tex(cv); const m = place(new THREE.Mesh(new THREE.PlaneGeometry(760, 360), mat(t, { depthWrite: true })), x, y, z); plates.push({ cv, t, title, sub, withLogo }); redrawPlate(plates[plates.length - 1]); return m; }
  function redrawPlate(p) { const g = p.cv.getContext('2d'); g.fillStyle = NIGHT ? '#1b1f28' : '#ffffff'; g.fillRect(0, 0, 1520, 720); g.fillStyle = NIGHT ? '#3b4456' : '#aab3c2'; g.fillRect(0, 0, 14, 720);
    if (p.withLogo && logoImg.complete && logoImg.naturalWidth) g.drawImage(logoImg, 100, 90, 1000, 424); else if (p.title) { g.fillStyle = NIGHT ? '#f3f5f9' : '#14161a'; g.font = '800 190px "Segoe UI",sans-serif'; g.fillText(p.title, 100, 300); }
    g.fillStyle = NIGHT ? '#8d95a3' : '#6d7480'; g.font = '500 52px "Segoe UI","Microsoft YaHei UI",sans-serif'; g.fillText(p.sub || '', 104, 640); p.t.needsUpdate = true; }
  logoImg.onload = () => plates.forEach(redrawPlate); logoImg.src = 'logos/logo-A-' + (NIGHT ? 'white' : 'black') + '.svg';
  const copy = window.SceneCopy || { welcomeSub: '先把东西备齐', locSub: '你想装在哪儿' };
  plate(0, 20, -1000, '', copy.welcomeSub, true); plate(1200, 20, -1000, 'WHERE', copy.locSub, false);

  /* ---- the glass plates ---- */
  const etchImg = new Image(), etchTexs = []; let shards = [], LWg = 840, LHg = 356, built = false, cells = null;
  const TH = 15;
  function makeEtchTextures() {
    const W = 2048, H = Math.round(2048 * LHg / LWg), a = cnv(W, H), ag = a.getContext('2d'); ag.drawImage(etchImg, 0, 0, W, H);
    const b = cnv(W / 2, H / 2), bgc = b.getContext('2d'); bgc.fillStyle = '#000'; bgc.fillRect(0, 0, W / 2, H / 2); bgc.filter = 'blur(5px)'; bgc.drawImage(a, 0, 0, W / 2, H / 2);
    const alpha = new THREE.CanvasTexture(a), bump = new THREE.CanvasTexture(b); alpha.colorSpace = THREE.SRGBColorSpace; return { alpha, bump };
  }
  const glowFrag = `uniform sampler2D map; uniform vec4 box; uniform float prog; uniform float lit; uniform float time; uniform float uGain; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){ float a = texture2D(map, vUv).g; float lx = (vUv.x - box.x) / max(0.0001, box.z - box.x);
      float front = smoothstep(prog + 0.07, prog - 0.03, lx) * step(0.0005, prog);
      float edge = exp(-abs(lx - prog) * 16.0) * step(0.0005, prog) * (1.0 - lit);
      float grain = 0.75 + 0.5 * h(floor(vUv * 900.0));
      float g = (front * 0.34 + edge * 0.9 + lit * (0.32 + 0.05 * sin(time * 2.0))) * a * grain * uGain;
      gl_FragColor = vec4(vec3(0.80, 0.90, 1.0) * g, g); }`;
  function buildShards() {
    const E = window.SceneCells; if (!E || !etchImg.complete || !etchImg.naturalWidth) return; cells = E.cells; LWg = E.LW; LHg = E.LH;
    const { alpha, bump } = makeEtchTextures();
    cells.forEach((q, i) => {
      const pts = q.p.map((v) => new THREE.Vector2(v[0] - q.cx, -(v[1] - q.cy))); const shape = new THREE.Shape(pts);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: TH, bevelEnabled: true, bevelThickness: 2.6, bevelSize: 2.6, bevelOffset: -2.6, bevelSegments: 2, steps: 1, curveSegments: 1 }); geo.translate(0, 0, -TH / 2);
      const glass = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.04, transmission: 1, thickness: 22, ior: 1.52, attenuationColor: new THREE.Color(0xb9ecdd), attenuationDistance: 420, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: NIGHT ? 1.6 : 1.1, specularIntensity: 1 }));
      const g = new THREE.Group(); g.add(glass);
      /* frost: three translucent layers at different depths inside the plate, bumped, so the etching has volume */
      const mk = () => { const sg = new THREE.ShapeGeometry(shape); const pos = sg.attributes.position, uv = sg.attributes.uv; for (let k = 0; k < pos.count; k++) { uv.setXY(k, (pos.getX(k) + q.cx) / LWg, 1 - (q.cy - pos.getY(k)) / LHg); } uv.needsUpdate = true; return sg; };
      (MODE === 'B' ? [] : [[-4.2, 0.16], [0, 0.26], [4.2, 0.18]]).forEach(([z, op]) => { const m = new THREE.Mesh(mk(), new THREE.MeshStandardMaterial({ color: NIGHT ? 0xe6eefb : 0xc4cfde, alphaMap: alpha, transparent: true, opacity: op, roughness: 1, metalness: 0, bumpMap: bump, bumpScale: 14, depthWrite: false, envMapIntensity: 0.4 })); m.position.z = z; m.renderOrder = 2; g.add(m); });
      const glowMat = new THREE.ShaderMaterial({ uniforms: { map: { value: alpha }, box: { value: new THREE.Vector4(q.x0 / LWg, 0, (q.x0 + q.w) / LWg, 1) }, prog: { value: 0 }, lit: { value: 0 }, time: { value: 0 }, uGain: { value: NIGHT ? 1 : 0.5 } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: glowFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const glow = new THREE.Mesh(mk(), glowMat); glow.visible = MODE !== 'B';
      if (MODE === 'B') { const gp = geo.attributes.position, gu = geo.attributes.uv; for (let k = 0; k < gp.count; k++) gu.setXY(k, (gp.getX(k) + q.cx) / LWg, 1 - (q.cy - gp.getY(k)) / LHg); gu.needsUpdate = true; glass.material.bumpMap = bump; glass.material.bumpScale = 30; glass.material.needsUpdate = true; } glow.position.z = 0.4; glow.renderOrder = 3; g.add(glow);
      const ring = [...pts, pts[0]].map((p) => new THREE.Vector3(p.x, p.y, TH / 2 + 0.3)); const edgeMat = new THREE.LineBasicMaterial({ color: 0xdceaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), edgeMat); line.renderOrder = 3; g.add(line);
      scene.add(g); shards.push({ g, glow: glowMat, line: edgeMat, glass });
    }); built = true;
  }
  etchImg.onload = () => { if (MODE === 'B') { buildShards(); GL.draw(); } }; etchImg.src = MODE === 'B' ? 'logos/logo-sil.svg' : 'logos/logo-etch.svg';

  const silImg = new Image(); let frags = [], fragBuilt = false, byArea = [], FU = 1, FMW = 1024, FMH = 434;
  /* contour of a pixel set: boundary pixel edges linked into loops, RDP-simplified and softened once (so the cut has no stair-steps) */
  function rdp(pts, tol) { if (pts.length < 4) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) { const [a, b] = st.pop(); let md = 0, mi = -1; const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } } if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
    return pts.filter((_, i) => keep[i]); }
  const chaikin = (p) => { const o = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } return o; };
  const area2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const inPoly = (pt, p) => { let r = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (((p[i][1] > pt[1]) !== (p[j][1] > pt[1])) && (pt[0] < (p[j][0] - p[i][0]) * (pt[1] - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0])) r = !r; return r; };
  function loopsOf(pix, W, lab, id) {
    const edges = new Map(), add = (x0, y0, x1, y1) => { const k = x0 + ',' + y0; (edges.get(k) || edges.set(k, []).get(k)).push([x1, y1, false]); };
    for (const p of pix) { const x = p % W, y = (p / W) | 0, same = (xx, yy) => lab[yy * W + xx] === id;
      if (y === 0 || !same(x, y - 1)) add(x, y, x + 1, y); if (x === W - 1 || !same(x + 1, y)) add(x + 1, y, x + 1, y + 1); if (!same(x, y + 1)) add(x + 1, y + 1, x, y + 1); if (x === 0 || !same(x - 1, y)) add(x, y + 1, x, y); }
    const loops = []; for (const [k, arr] of edges) for (const e of arr) { if (e[2]) continue; const [sx, sy] = k.split(',').map(Number); const pts = []; let cx = sx, cy = sy, cur = e, dx = e[0] - sx, dy = e[1] - sy; e[2] = true; pts.push([cx, cy]); cx = e[0]; cy = e[1];
      for (let guard = 0; guard < 100000; guard++) { if (cx === sx && cy === sy) break; pts.push([cx, cy]); const outs = (edges.get(cx + ',' + cy) || []).filter((q) => !q[2]); if (!outs.length) break; const pref = [[-dy, dx], [dx, dy], [dy, -dx]]; let pick = null;
        for (const [px, py] of pref) { pick = outs.find((q) => q[0] - cx === px && q[1] - cy === py); if (pick) break; } pick = pick || outs[0]; pick[2] = true; dx = pick[0] - cx; dy = pick[1] - cy; cx = pick[0]; cy = pick[1]; }
      if (pts.length > 3) loops.push(pts); }
    return loops; }
  function buildFragments() {
    if (!silImg.complete || !silImg.naturalWidth) return; const MW = FMW, MH = FMH, cv = cnv(MW, MH), g = cv.getContext('2d'); g.drawImage(silImg, 0, 0, MW, MH); const d = g.getImageData(0, 0, MW, MH).data;
    const mask = new Uint8Array(MW * MH); for (let i = 0; i < MW * MH; i++) { const x = i % MW, y = (i / MW) | 0, lum = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2], hat = x < MW * 0.55 && y < MH * 0.56; mask[i] = d[i * 4 + 3] > 110 && (lum >= 66 || hat) ? 1 : 0; }   /* keep the lettering, the flare, the ring and the hat; drop the dark shadow mass under the letters */
    let sd = 31; const rr = () => (sd = (sd * 16807) % 2147483647) / 2147483647, seeds = [], radii = [], cls = [];
    for (let i = 0; i < 128; i++) { const u = rr(); cls.push(u < 0.1 ? 62 + rr() * 30 : u < 0.42 ? 30 + rr() * 16 : 11 + rr() * 9); } cls.sort((a, b) => b - a);
    for (const r0 of cls) { let r = r0, ok = false; for (let k = 0; k < 600 && !ok; k++) { if (k % 80 === 79) r *= 0.88; const x = rr() * MW, y = rr() * MH; if (!mask[(y | 0) * MW + (x | 0)]) continue; if (seeds.every((q, j) => Math.hypot(x - q[0], y - q[1]) >= (r + radii[j]) * 0.5)) { seeds.push([x, y]); radii.push(r); ok = true; } } }
    const lab = new Int32Array(MW * MH).fill(-1), cell = new Int16Array(MW * MH).fill(-1);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { if (!mask[y * MW + x]) continue; let b = 0, bd = 1e9; for (let k = 0; k < seeds.length; k++) { const dx = x - seeds[k][0], dy = y - seeds[k][1]; const dd = dx * dx + dy * dy * 1.0 + 6 * Math.sin(x * 0.07 + y * 0.05 + k); if (dd < bd) { bd = dd; b = k; } } cell[y * MW + x] = b; }
    let nextId = 0; const comps = []; const stack = [];
    for (let s0 = 0; s0 < MW * MH; s0++) { if (cell[s0] < 0 || lab[s0] >= 0) continue; const id = nextId++, pix = [], cl = cell[s0]; stack.push(s0); lab[s0] = id;
      while (stack.length) { const p = stack.pop(); pix.push(p); const x = p % MW, y = (p / MW) | 0; for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue; const q = ny * MW + nx; if (cell[q] === cl && lab[q] < 0) { lab[q] = id; stack.push(q); } } }
      if (pix.length >= 26) comps.push({ id, pix }); }
    for (const cp of comps) {
      const loops = loopsOf(cp.pix, MW, lab, cp.id).map((l) => { let p = rdp(l, 1.0); p = chaikin(p); p = rdp(p, 0.5); return p; }).filter((l) => l.length > 2 && Math.abs(area2(l)) > 6);
      if (!loops.length) continue; loops.sort((a, b) => Math.abs(area2(b)) - Math.abs(area2(a))); const sign = Math.sign(area2(loops[0])), outers = loops.filter((l) => Math.sign(area2(l)) === sign), holes = loops.filter((l) => Math.sign(area2(l)) !== sign);
      const xs = loops[0].map((p) => p[0]), ys = loops[0].map((p) => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, T = (p) => new THREE.Vector2(p[0] - cx, -(p[1] - cy));
      outers.forEach((o) => { const shape = new THREE.Shape(o.map(T)); holes.forEach((h) => { if (inPoly(h[0], o)) shape.holes.push(new THREE.Path(h.map(T))); }); frags.push({ shape, cx, cy, area: Math.abs(area2(o)), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }); });
    }
    frags.sort((a, b) => a.cx - b.cx); const K = frags.length; FU = (window.SceneCells ? window.SceneCells.LW : 860) / MW; const LW = MW * FU, LH = MH * FU;
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 1, thickness: 20, ior: 1.52, dispersion: 0.6, attenuationColor: new THREE.Color(0xcdeee5), attenuationDistance: 1500, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: NIGHT ? 1.8 : 1.25, specularIntensity: 1, depthWrite: false });
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: NIGHT ? 0.05 : 0.14, depthWrite: false });
    frags.forEach((f, i) => {
      const geo = new THREE.ExtrudeGeometry(f.shape, { depth: 18, bevelEnabled: true, bevelThickness: 2.6, bevelSize: 2.2, bevelOffset: -2.2, bevelSegments: 2, curveSegments: 1 }); geo.translate(0, 0, -9);
      const g3 = new THREE.Group(), glass = new THREE.Mesh(geo, glassMat), ghost = new THREE.Mesh(new THREE.ShapeGeometry(f.shape, 1), ghostMat);
      const edgeMat = new THREE.LineBasicMaterial({ color: NIGHT ? 0xe6f1ff : 0x222b3a, transparent: true, opacity: 0.1, blending: NIGHT ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false });
      const ring = (pts) => new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y, 9.6))), edgeMat);
      const line = ring(f.shape.getPoints()); const lines = [line]; f.shape.holes.forEach((h) => lines.push(ring(h.getPoints())));
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xdbe9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), glow = new THREE.Mesh(new THREE.ShapeGeometry(f.shape, 1), glowMat); glow.position.z = 0.5;
      glass.renderOrder = 1; ghost.renderOrder = 0; glow.renderOrder = 3; lines.forEach((l) => { l.renderOrder = 3; g3.add(l); }); g3.add(glass, ghost, glow); scene.add(g3);
      const dpt = 420 + Math.pow(rr(), 1.15) * 6200, k = (dpt + P) / P;
      Object.assign(f, { g3, glass, ghost, edgeMat, glowMat, d: dpt, k, X: FINAL.cx + ((f.cx - MW / 2) * FU) * k, Y: FINAL.cy + ((f.cy - MH / 2) * FU + LCYg) * k, Z: FINAL.cz - dpt,
        rx: (rr() < 0.5 ? -1 : 1) * (30 + rr() * 55), ry: (rr() < 0.5 ? -1 : 1) * (30 + rr() * 55), rz: (rr() - 0.5) * 120, ph: rr() * 6.28, amp: 24 + rr() * 80, spin: 0.1 + rr() * 0.25 });
    });
    byArea = frags.map((_, i) => i).sort((a, b) => frags[b].area - frags[a].area); fragBuilt = true;
  }
  const FINAL = { cx: 3300, cy: -260, cz: 1000 }, LCYg = -30;
  silImg.onload = () => { if (MODE === 'A') { buildFragments(); GL.draw(); } }; silImg.src = 'logos/logo-orig.svg';

  /* ---- API used by scene.js ---- */
  const GL = {
    ok: true, THREE, scene, camera, renderer,
    setCamera(c, bx, by) {
      camera.position.set(c.cx + (bx || 0), -(c.cy + (by || 0)), c.cz); camera.rotation.set(-c.rx * D2R, -c.ry * D2R, c.rz * D2R, 'YXZ'); camera.translateZ(P); camera.updateMatrixWorld(true);
    },
    update(frames, m) {
      if (MODE === 'A') { if (!fragBuilt) buildFragments(); if (!fragBuilt) return; const s = m.s, N = s.st.length, K = frags.length, br = REDUCE ? 0 : 1, ft = m.t * br, damp = 1 - m.reveal, kk = 1 - m.reveal;
        frags.forEach((f, i) => { const seg = Math.min(N - 1, Math.floor(i * N / K)), st = s.st[seg], fr = st === 2 ? 1 : (st === 1 || st === 3 ? s.fr[seg] : 0), lit = st === 2 ? 1 : 0;
          const ox = Math.sin(ft * 0.5 + f.ph) * f.amp * damp * br, oy = Math.cos(ft * 0.4 + f.ph) * f.amp * damp * br, oz = Math.sin(ft * 0.6 + f.ph * 2) * f.amp * 2 * damp * br;
          f.g3.position.set(f.X + ox, -(f.Y + oy), f.Z + oz); f.g3.rotation.set(-(f.rx + Math.sin(ft * f.spin + f.ph) * 8 * br) * kk * D2R, (f.ry + Math.cos(ft * f.spin + f.ph) * 8 * br) * kk * D2R, -f.rz * kk * D2R, 'ZYX'); f.g3.scale.setScalar(f.k * FU);
          const on = fr > 0 || lit; f.glass.visible = on; f.ghost.visible = !on;
          const fl = lit ? Math.max(0, 1 - (m.t - (s.doneAt[seg] || 0)) / 0.9) : 0;
          f.edgeMat.opacity = lit ? (m.reveal > 0.5 ? 0.42 : 0.95) : fr > 0 ? 0.3 + 0.6 * fr : 0.08; f.glowMat.opacity = lit ? 0.06 + 0.5 * fl : fr * 0.05; });
        if (m.prog !== undefined && GL._pp !== Math.round(m.prog * 100)) { GL._pp = Math.round(m.prog * 100); drawCircle(progCv, m.prog); progTex.needsUpdate = true; } bandTex.offset.y = REDUCE ? 0 : -((m.t || 0) * 1.3); return; }
      if (!built) buildShards(); if (!built) return;
      frames.forEach((f, i) => { const s = shards[i]; if (!s || !f) return; s.g.position.set(f.x, -f.y, f.z); s.g.rotation.set(-f.rx * D2R, f.ry * D2R, -f.rz * D2R, 'ZYX'); s.g.scale.setScalar(f.s);
        s.glow.uniforms.prog.value = f.f; s.glow.uniforms.lit.value = f.lit; s.glow.uniforms.time.value = m.t; s.line.opacity = Math.min(1, f.f * 0.5 + f.lit * 0.5) * (m.reveal > 0.5 ? 0.35 : 1);
        s.glass.material.thickness = 22; });
      progTex.needsUpdate = false;
      if (m.prog !== undefined && GL._pp !== Math.round(m.prog * 100)) { GL._pp = Math.round(m.prog * 100); drawCircle(progCv, m.prog); progTex.needsUpdate = true; }
      bandTex.offset.y = REDUCE ? 0 : -((m.t || 0) * 1.3);
    },
    pose(i) { if (MODE === 'A') { const f = frags[byArea[i]]; return f ? { x: f.g3.position.x, y: -f.g3.position.y, z: f.g3.position.z, s: f.k * FU, w: f.w, h: f.h } : null; } const s = shards[i]; return s ? { x: s.g.position.x, y: -s.g.position.y, z: s.g.position.z, s: s.g.scale.x, w: cells[i].w, h: cells[i].h } : null; },
    draw() { try { renderer.render(scene, camera); } catch (e) { /* context lost: the DOM fallback is hidden, nothing else to do */ } },
    onResize: resize
  };
  window.GL = GL;
})();
