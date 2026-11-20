/* MeguLit logo proposals for the glass / anamorphic installer language (PROPOSALS ONLY, no repo logo is touched).
   node tools/logo-proposals.cjs <outDir>   -> logo-A/B/C .svg, icons 16/32/256 png, sheet png */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const out = process.argv[2] || 'H:/MeguLit-Work/setup-ui-redesign/logo'; fs.mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const RED = '#c8203c', RED2 = '#8f1230', HOT = '#ff5a76', GOLD = '#f0b25a', INK = '#16181d';
/* the mark: a witch hat (Megumin) with the explosion flare, cut into glass facets. Each facet = [points, shade] in a 256 box. */
const F = [
  [[24, 180, 128, 154, 128, 192], 0.55], [[232, 180, 128, 154, 128, 192], 0.35], [[24, 180, 128, 192, 96, 208], 0.3], [[232, 180, 128, 192, 160, 208], 0.18], [[96, 208, 128, 192, 160, 208, 128, 214], 0.1],
  [[76, 160, 182, 160, 188, 176, 70, 176], 0.12],
  [[76, 160, 128, 154, 122, 96], 0.62], [[128, 154, 182, 160, 122, 96], 0.4], [[76, 160, 122, 96, 104, 70], 0.7], [[122, 96, 182, 160, 150, 60], 0.28],
  [[104, 70, 122, 96, 150, 60], 0.5], [[104, 70, 150, 60, 132, 34], 0.8], [[132, 34, 150, 60, 168, 24], 0.45]
];
const STAR = (cx, cy, R, r) => { const pts = []; for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8 - Math.PI / 2, rr = i % 2 ? r : (i % 4 === 0 ? R : R * 0.72); pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); } return pts; };
const poly = (p) => p.join ? (Array.isArray(p[0]) ? p.map((q) => q.join(',')).join(' ') : p.reduce((s, v, i) => s + (i % 2 ? ',' + v : (i ? ' ' : '') + v), '')) : '';
const shade = (a) => { const t = Math.max(0, Math.min(1, a)); const c = (x, y) => Math.round(x + (y - x) * t); return `rgb(${c(143, 255)},${c(18, 90)},${c(48, 118)})`; };
function mark(opts = {}) {
  const { id = 'm', dx = 0, scatter = false, glass = true } = opts; let s = '';
  F.forEach(([pts, sh], i) => {
    let tf = '', op = 1;
    if (scatter) { const a = (i * 53) % 360, k = 1 + ((i * 7) % 5) / 10; tf = ` transform="translate(${(((i * 37) % 90) - 45) * 1.4} ${(((i * 61) % 80) - 40) * 1.2}) rotate(${((i * 29) % 70) - 35} 128 128) scale(${k})"`; op = 0.8; }
    s += `<polygon points="${poly(pts)}" fill="${shade(sh)}" stroke="rgba(255,255,255,${glass ? 0.55 : 0.2})" stroke-width="1.2" opacity="${op}"${tf}/>`;
  });
  const st = STAR(206, 50, 42, 9);
  const sp = (a, b) => `<polygon points="${poly([[206, 50], st[a], st[b]])}" fill="${GOLD}" opacity="${a % 4 === 0 ? 1 : 0.85}" stroke="rgba(255,255,255,.7)" stroke-width="1"`;
  for (let i = 0; i < 16; i += 2) { let tf = ''; if (scatter) tf = ` transform="translate(${(((i * 41) % 70) - 35)} ${(((i * 23) % 60) - 30)}) rotate(${i * 11} 206 50)"`; s += sp(i, (i + 1) % 16) + tf + '/>' + sp(i + 1 > 15 ? 0 : i + 1, (i + 2) % 16) + tf + '/>'; }
  s += `<circle cx="206" cy="50" r="7" fill="#fff" opacity="${scatter ? 0.6 : 1}"/>`;
  if (glass) s += `<polygon points="76,160 128,154 122,96 104,70" fill="url(#gl${id})" opacity=".55"/>`;
  return s;
}
const defs = (id) => `<defs><linearGradient id="gl${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="wm${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${HOT}"/><stop offset="1" stop-color="${RED2}"/></linearGradient></defs>`;
/* A: wordmark in bold sans, cut by one glass diagonal, flare as the dot of the i */
const wordA = (dark) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 220">${defs('A')}
 <g font-family="Segoe UI Black,Segoe UI,Arial Black,sans-serif" font-weight="900" font-size="150" letter-spacing="-6">
  <clipPath id="ca1"><polygon points="0,0 760,0 760,92 0,150"/></clipPath><clipPath id="ca2"><polygon points="0,150 760,92 760,220 0,220"/></clipPath>
  <g clip-path="url(#ca1)"><text x="14" y="165" fill="${dark ? '#f4f5f8' : INK}">Megu</text><text x="386" y="165" fill="url(#wmA)">Lit</text></g>
  <g clip-path="url(#ca2)" transform="translate(7 5)"><text x="14" y="165" fill="${dark ? '#f4f5f8' : INK}">Megu</text><text x="386" y="165" fill="url(#wmA)">Lit</text></g>
 </g>
 <polygon points="${poly([[610, 28], [622, 52], [646, 40], [634, 62], [660, 70], [634, 78], [646, 100], [622, 88], [610, 112], [598, 88], [574, 100], [586, 78], [560, 70], [586, 62], [574, 40], [598, 52]])}" fill="${GOLD}" stroke="#fff" stroke-width="1.5" opacity=".95"/>
</svg>`;
/* B: faceted hat mark + wordmark */
const lockB = (dark) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 256">${defs('B')}<g>${mark({ id: 'B' })}</g>
 <g font-family="Segoe UI Black,Segoe UI,Arial Black,sans-serif" font-weight="900" font-size="104" letter-spacing="-4"><text x="270" y="170" fill="${dark ? '#f4f5f8' : INK}">Megu</text><text x="270" y="170" dx="262" fill="url(#wmB)">Lit</text></g>
 <text x="274" y="212" font-family="Segoe UI,Arial,sans-serif" font-size="20" letter-spacing="8" fill="${dark ? '#8d95a3' : '#6d7480'}">PLAY · READ · LEARN</text></svg>`;
const markB = (id) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${defs(id)}<g>${mark({ id })}</g></svg>`;
/* C: the anamorphic mark: aligned (installed) and scattered (the same facets hanging apart in depth) */
const markC = (id, sc) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sc ? '-40 -30 336 316' : '0 0 256 256'}">${defs(id)}<g>${mark({ id, scatter: sc })}</g></svg>`;

const files = { 'logo-A-wordmark-light.svg': wordA(false), 'logo-A-wordmark-dark.svg': wordA(true), 'logo-B-lockup-light.svg': lockB(false), 'logo-B-lockup-dark.svg': lockB(true), 'logo-B-mark.svg': markB('b1'), 'logo-C-aligned.svg': markC('c1', false), 'logo-C-scattered.svg': markC('c2', true) };
for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(out, n), s);
function shot(html, png, w, h, bg) { const f = path.join(out, '_t.html'); fs.writeFileSync(f, `<html><body style="margin:0;background:${bg || 'transparent'}">${html}</body></html>`); execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, '--default-background-color=00000000', `--screenshot=${png}`, 'file:///' + f.replace(/\\/g, '/')], { stdio: 'ignore' }); }
for (const sz of [16, 32, 256]) {
  shot(`<div style="width:${sz}px;height:${sz}px">${markB('i' + sz).replace('<svg ', `<svg width="${sz}" height="${sz}" `)}</div>`, path.join(out, `icon-B-${sz}.png`), sz, sz);
  shot(`<div style="width:${sz}px;height:${sz}px">${markC('j' + sz, false).replace('<svg ', `<svg width="${sz}" height="${sz}" `)}</div>`, path.join(out, `icon-C-${sz}.png`), sz, sz);
}
const sz = (svg, w) => svg.replace('<svg ', `<svg style="width:${w}px;height:auto;display:block" `);
const card = (bg, ink, inner, label) => `<div style="background:${bg};color:${ink};padding:22px;border-radius:16px;display:flex;flex-direction:column;gap:12px;font:13px 'Segoe UI','Microsoft YaHei UI'">${inner}<div style="opacity:.6">${label}</div></div>`;
const icons = (bg, ink, id) => `<div style="display:flex;gap:18px;align-items:flex-end">${[16, 32, 64, 128].map((n) => `<div style="text-align:center"><div style="width:${n}px;height:${n}px">${markB(id + n).replace('<svg ', `<svg width="${n}" height="${n}" `)}</div><div style="font-size:10px;opacity:.6;margin-top:4px">${n}</div></div>`).join('')}</div>`;
const sheet = `<div style="padding:26px;background:#e9ecf0;width:1500px;font-family:'Segoe UI','Microsoft YaHei UI';color:#16181d"><div style="font-size:26px;font-weight:800;margin-bottom:4px">MeguLit logo proposals — glass / anamorphic language</div><div style="opacity:.6;margin-bottom:18px">提案稿，未替换任何现有 logo · A 切面字标 · B 玻璃帽徽 + 字标 · C 错视碎片徽（同一套切面，对齐=徽标，散开=安装中）</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
${card('#fff', INK, sz(wordA(false), 640), 'A · 切面字标 Facet wordmark：一刀玻璃切线、闪光做 i 点')}
${card('#14161c', '#fff', sz(wordA(true), 640), 'A · dark')}
${card('#fff', INK, sz(lockB(false), 640), 'B · 玻璃帽徽 + 字标 Glass hat lockup')}
${card('#14161c', '#fff', sz(lockB(true), 640), 'B · dark')}
${card('#fff', INK, `<div style="display:flex;gap:30px;align-items:center">${sz(markC('s1', false), 250)}${sz(markC('s2', true), 300)}</div>`, 'C · 错视碎片徽 Anamorphic shards：左 = 对齐（静态标准版）· 右 = 同一批碎片在空间里散开（安装中）')}
${card('#fff', INK, icons('#fff', INK, 'ic'), 'B/C 图标缩小效果 16 / 32 / 64 / 128 px（浅底）')}
${card('#14161c', '#fff', icons('#14161c', '#fff', 'id'), '图标缩小效果（深底）')}
${card('#fff', INK, `<div style="display:flex;gap:26px;align-items:center"><div style="width:256px">${sz(markB('big'), 256)}</div><div style="font-size:13px;line-height:1.7;max-width:320px">酒红主色保留；帽檐 / 帽身 / 爆裂星芒各由 13 + 8 块切面组成，所以能拆成碎片：安装器里每块碎片就是一个真实下载分段，装完之后摄影机转到唯一正确的角度，碎片对齐成这枚徽标。</div></div>`, '256px 版 + 设计说明')}
</div></div>`;
shot(sheet, path.join(out, 'logo-proposals.png'), 1552, 1500, '#e9ecf0');
fs.rmSync(path.join(out, '_t.html'), { force: true });
console.log(fs.readdirSync(out).join('\n'));
