// SPDX-License-Identifier: GPL-3.0-or-later
// Off-screen end-to-end replay of the capture compositor (record once, replay): FramePlayer shows a real game frame with
// part ①'s spec-1 dots where the game's glyphs were; MeguLitCompositor captures that window with Windows.Graphics.Capture,
// finds and erases the dots and draws MeguLit's text. Reports fps, latency and the dot detection rate per line.
//   node replay.cjs <frame.png> <outDir> [--scale] [--compositor exe] [--player exe]
// Layout of the default script = ダストマニア・グロテスク (BRUNS, 800x600): 28 px cells from x=50, rows at y=445 / 485,
// 24 cells per row; black-box offsets by character class as a 28 px Gothic face draws them.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
const frame = argv[0], out = argv[1];
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const here = __dirname, nativeDir = path.join(here, '..', '..');
const compositor = opt('--compositor', path.join(nativeDir, 'MeguLitCompositor.exe'));
const player = opt('--player', path.join(process.env.MEGULIT_BUILD_OUT || path.join(here, '..', 'obj'), 'FramePlayer.exe'));
const scale = argv.includes('--scale'), hd = argv.includes('--hd');
// --hd: a 1920x1080 frame = the 800x600 one scaled 1.8x (nearest) and centred; cells scale with it.
const K = hd ? 1.8 : 1, OX = hd ? 240 : 0;
fs.mkdirSync(out, { recursive: true });

const blank = c => /[\s　​﻿]/.test(c);
function cellsFor(text, { x0 = OX + Math.round(50 * K), y0 = Math.round(445 * K), a = Math.round(28 * K), h = Math.round(28 * K), perRow = 24, step = Math.round(40 * K) } = {}) {
  const cells = []; let col = 0, row = 0;
  for (const ch of text) {
    if (blank(ch)) { col++; continue; }
    if (col >= perRow) { col = 0; row++; }
    let bx = 2 + (cells.length % 3), by = 3 + (cells.length % 2), w = 3, hh = 3;
    if ('。、，．'.includes(ch)) { bx = 3; by = 18; }
    else if ('ー—―─'.includes(ch)) { bx = 1; by = 13; hh = 2; }
    else if ('…'.includes(ch)) { bx = 3; by = 13; }
    else if ('・'.includes(ch)) { bx = 12; by = 12; }
    else if ('ぁぃぅぇぉっゃゅょァィゥェォッャュョ'.includes(ch)) { bx = 6; by = 10; }
    else if ('「」『』（）［］[]'.includes(ch)) { bx = ch.match(/[」』）］\]]/) ? 3 : 14; by = ch.match(/[」』）］\]]/) ? 10 : 2; }
    cells.push([x0 + col * a, y0 + row * step, a, h, Math.round(bx * K), Math.round(by * K), w, hh]);
    col++;
  }
  return cells;
}
const lines = [
  { text: '……なんの、音だろう。これは。', tl: '……什么声音呢。这是。' },
  { text: 'ブゥ———————————ン——……・', tl: '嗡————————————……' },
  { text: '聞き覚えがないわけではない。どちらかと云うと、よく聴き知っている類の音だ。', tl: '并不是没听过。倒不如说，是我很熟悉的那一类声音。', ruby: [[32, 33, 'たぐい']] },
  { text: 'でも……', tl: '可是……' },
  { text: '[千春]おかしいなぁ……研究の合間に、仮眠をとろうと思って……眠ったっけ……。', tl: '[千春] 奇怪啊……研究的间隙，想着小睡一会儿……我睡着了吗……。' },
  { text: '聞き覚えがないわけではない。どちらかと云うと、よく聴き知っている類の音だ。', tl: '（影子测试）并不是没听过。', shadow: true },
  { text: '……なんの、音だろう。これは。', tl: '（抖动测试）……什么声音呢。', shake: 4 },
];
const script = hd ? { crop: [0, 0, 1920, 1080], clean: { from: [954, 1008], rows: [792, 946], x: [320, 1612] } } : { crop: [3, 26, 800, 600], clean: { from: [530, 560], rows: [440, 525], x: [44, 762] } };
Object.assign(script, {
  lines: lines.map(l => ({ text: l.text, color: '#ffffff', revealMs: 30, holdMs: 1400, shadow: !!l.shadow, shake: l.shake || 0, cells: cellsFor(l.text) })) });
const scriptPath = path.join(out, 'script.json'); fs.writeFileSync(scriptPath, JSON.stringify(script));

const lineOf = s => { let b = ''; return d => { b += d; let i; const r = []; while ((i = b.indexOf('\n')) >= 0) { const l = b.slice(0, i); b = b.slice(i + 1); try { r.push(JSON.parse(l)); } catch {} } return r; }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const pl = spawn(player, [frame, scriptPath], { stdio: ['pipe', 'pipe', 'inherit'] });
  const plRead = lineOf(); let ready, done = false; const queue = [];
  pl.stdout.on('data', d => { for (const e of plRead(d)) { if (e.e === 'ready') ready = e; else if (e.e === 'done') done = true; else queue.push(e); } });
  while (!ready) await sleep(50);
  const args = ['--hwnd', String(ready.hwnd), '--stats-ms', '1000', '--window-alpha', '1'];
  if (scale) args.push('--scale', '--at', '-32000', '-32000');
  const co = spawn(compositor, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const coRead = lineOf(); const ev = []; let coReady = false;
  co.stdout.on('data', d => { for (const e of coRead(d)) { e.t = Date.now(); ev.push(e); if (e.e === 'ready') coReady = true; } });
  const send = o => co.stdin.write(JSON.stringify(o) + '\n');
  for (let i = 0; i < 100 && !coReady; i++) await sleep(50);
  if (!coReady) { console.log(JSON.stringify({ error: 'compositor not ready', ev })); pl.kill(); co.kill(); process.exit(1); }
  send({ t: 'style', mode: 'bilingual', jpFont: 'Yu Gothic', tlFont: 'Microsoft YaHei' });
  pl.stdin.write('go\n');
  let id = 0;
  while (!done) {
    while (queue.length) {
      const e = queue.shift(); const l = lines[e.n]; id = 1000 + e.n;
      send({ t: 'line', id, text: l.text, tl: l.tl, ruby: l.ruby || [], glyphs: e.glyphs, expected: e.expected });
      const n = e.expected; const k = e.n;
      setTimeout(() => send({ t: 'shot', path: path.join(out, `line${k}-reveal.png`) }), 30 * Math.floor(n / 2));
      setTimeout(() => send({ t: 'shot', path: path.join(out, `line${k}-full.png`) }), 30 * n + 700);
      if (k === 2) setTimeout(() => { send({ t: 'style', mode: 'translation' }); setTimeout(() => { send({ t: 'shot', path: path.join(out, `line${k}-tlonly.png`) }); send({ t: 'style', mode: 'bilingual' }); }, 150); }, 30 * n + 1000);
    }
    await sleep(10);
  }
  await sleep(300); send({ t: 'quit' }); await sleep(800);
  const per = lines.map((l, n) => {
    const e = ev.filter(x => x.e === 'line' && x.id === 1000 + n); const expected = script.lines[n].cells.length;
    const max = Math.max(0, ...e.map(x => x.found)); const complete = e.some(x => x.status === 'complete');
    return { n, expected, maxFound: max, complete, undot: ev.some(x => x.e === 'undot' && x.id === 1000 + n), mismatch: e.some(x => x.status === 'mismatch') };
  });
  const stats = ev.filter(x => x.e === 'stats' && x.frames > 0 && x.fps > 5);
  const avg = k => stats.length ? +(stats.reduce((s, x) => s + x[k], 0) / stats.length).toFixed(2) : 0;
  const totalExpected = per.reduce((s, p) => s + p.expected, 0), totalFound = per.reduce((s, p) => s + Math.min(p.maxFound, p.expected), 0);
  const result = { mode: (scale ? 'scale' : 'overlay') + (hd ? '-1080p' : ''), lines: per, lineRate: per.filter(p => p.complete && !p.mismatch).length / per.length, dotRate: +(totalFound / totalExpected).toFixed(4),
    fps: avg('fps'), latencyMs: avg('latencyMs'), latencyP95Ms: Math.max(0, ...stats.map(x => x.latencyP95Ms)), processMs: avg('processMs'), processP95Ms: Math.max(0, ...stats.map(x => x.processP95Ms)), trackMs: avg('trackMs'), src: stats[0]?.src, dst: stats[0]?.dst };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ result, events: ev }, null, 1));
  console.log(JSON.stringify(result));
  process.exit(result.lineRate >= .85 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
