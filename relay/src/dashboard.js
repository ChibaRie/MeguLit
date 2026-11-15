// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-16 the beta live-usage dashboard served by the relay itself (owner: 我想看实时有多少人在使用).
   GET /dashboard — a public, same-origin page that polls /api/probe/stats; open it on a phone at
   https://cn-api.megulit.com/dashboard (mainland) or https://api.megulit.com/dashboard. DedSec black/white/red. */
export const DASHBOARD_HTML=String.raw`<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MeguLit Live Ops</title>
<style>
/* DedSec terminal: pure black ground, bone-white data, blood-red accent on scanlines, mono throughout. Single dark world. */
:root{
  --bg:#000000; --panel:#0b0b0b; --line:#1c1c1c;
  --fg:#f2f2f2; --dim:#767676; --ghost:#1a0008;
  --hot:#ff0033; --amber:#ff2d2d; --red:#ff0033;
  --mono:"DejaVu Sans Mono",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
  color-scheme:dark;
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:var(--bg); color:var(--fg); font-family:var(--mono);
  padding-left:max(16px,env(safe-area-inset-left,0px));
  padding-right:max(16px,env(safe-area-inset-right,0px));
  padding-block:20px 40px;
  background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px);
  -webkit-font-smoothing:none; letter-spacing:.02em;
}
.wrap{max-width:720px;margin:0 auto}
a{color:var(--hot)}

/* header */
.top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--dim);padding-bottom:10px}
.brand{font-size:clamp(18px,5vw,26px);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.brand b{color:var(--hot)}
.brand .cur{display:inline-block;width:.6ch;background:var(--hot);animation:blink 1.1s steps(1) infinite;margin-left:2px}
.sub{color:var(--dim);font-size:11px;letter-spacing:.14em;text-transform:uppercase}
@keyframes blink{50%{opacity:0}}

/* hero online */
.hero{margin:18px 0 10px;border:1px solid var(--line);background:var(--panel);padding:18px 16px;position:relative;overflow:hidden}
.hero::before{content:"● LIVE";position:absolute;top:10px;right:12px;color:var(--red);font-size:11px;letter-spacing:.1em;animation:pulse 1.6s ease-in-out infinite}
.hero .lbl{color:var(--dim);font-size:12px;letter-spacing:.2em;text-transform:uppercase}
.big{font-size:clamp(56px,20vw,120px);line-height:.95;font-weight:700;color:var(--hot);font-variant-numeric:tabular-nums;text-shadow:0 0 22px rgba(255,0,51,.5);margin:4px 0 2px}
.hero .cap{color:var(--fg);font-size:12px;letter-spacing:.1em}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}

/* tiles */
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:8px 0}
.tile{border:1px solid var(--line);background:var(--panel);padding:12px}
.tile .n{font-size:clamp(22px,7vw,34px);font-weight:700;font-variant-numeric:tabular-nums;color:var(--fg)}
.tile .k{color:var(--dim);font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-top:4px}

/* sections */
.sec{margin-top:22px}
.sec>h2{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--amber);margin:0 0 8px;border-left:3px solid var(--amber);padding-left:8px}
.bar{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--line);padding:6px 10px;font-size:12px;letter-spacing:.06em}
.chip b{color:var(--hot);font-variant-numeric:tabular-nums}
.chip.amber b{color:var(--amber)} .chip.dim b{color:var(--dim)}

/* top list */
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:400;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
td.rank{color:var(--dim);width:2ch}
td.rep{text-align:right;color:var(--hot);font-variant-numeric:tabular-nums;white-space:nowrap}
.title-cell{min-width:0;word-break:break-word}
.step{color:var(--dim);font-size:11px}
.tag{display:inline-block;border:1px solid var(--dim);color:var(--amber);font-size:10px;padding:0 5px;margin-left:6px;letter-spacing:.08em}
.empty{color:var(--dim);border:1px dashed var(--line);padding:14px;font-size:12px;text-align:center}

/* footer */
.foot{margin-top:24px;border-top:1px solid var(--dim);padding-top:10px;color:var(--dim);font-size:11px;display:flex;flex-wrap:wrap;gap:4px 14px;justify-content:space-between;letter-spacing:.06em}
.foot .ok{color:var(--hot)} .foot .err{color:var(--red)}
.flick{animation:fl .15s steps(2) 1}
@keyframes fl{50%{opacity:.4}}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>

<div class="wrap">
  <div class="top">
    <div class="brand">MEGU<b>LIT</b> // LIVE_OPS<span class="cur">&nbsp;</span></div>
    <div class="sub" id="clock">--:--:--</div>
  </div>

  <div class="hero">
    <div class="lbl">PLAYERS ONLINE NOW</div>
    <div class="big" id="online">--</div>
    <div class="cap" id="onlineCap">last 10 min · 正在联网的 MeguLit</div>
  </div>

  <div class="grid">
    <div class="tile"><div class="n" id="active1h">--</div><div class="k">Active · 1h</div></div>
    <div class="tile"><div class="n" id="today">--</div><div class="k">Active · today</div></div>
    <div class="tile"><div class="n" id="games">--</div><div class="k">Probed games</div></div>
    <div class="tile"><div class="n" id="reporters">--</div><div class="k">Reporters</div></div>
  </div>

  <div class="sec">
    <h2>Full probes · 完整剧本上传</h2>
    <div class="bar" id="fullBar">
      <span class="chip">READY <b id="fReady">--</b></span>
      <span class="chip amber">UPLOADING <b id="fUp">--</b></span>
      <span class="chip dim">DONE <b id="fDone">--</b></span>
      <span class="chip">STORED <b id="fMB">--</b>/<span id="fLimit">8192</span> MB</span>
    </div>
  </div>

  <div class="sec">
    <h2>Top games · 多少人在读</h2>
    <div id="topWrap"><div class="empty">// waiting for signal …</div></div>
  </div>

  <div class="foot">
    <span id="status">// connecting …</span>
    <span>src <span id="src">—</span> · refresh <span id="count">15</span>s</span>
  </div>
</div>

<script>
"use strict";
var ENDPOINTS=["/api/probe/stats"];
var PERIOD=15; // seconds
var $=function(id){return document.getElementById(id);};
var prevOnline=null;

function fmt(n){return (n==null||isNaN(n))?"--":String(n).replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}

function raceStats(){
  // try both relay hosts, take whichever answers first; cn-api is faster from the mainland
  return Promise.any(ENDPOINTS.map(function(u){
    return fetch(u,{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.json().then(function(j){j.__src=u;return j;});});
  }));
}

function setNum(id,v){var el=$(id);var t=fmt(v);if(el.textContent!==t){el.textContent=t;el.classList.remove("flick");void el.offsetWidth;el.classList.add("flick");}}

function renderTop(list){
  var w=$("topWrap");
  if(!list||!list.length){w.innerHTML='<div class="empty">// 还没有游戏上报标题（脱敏样本不含标题）</div>';return;}
  var rows=list.map(function(g,i){
    var tag=g.full?'<span class="tag">FULL</span>':'';
    var step=g.step?'<div class="step">'+esc(g.step)+'</div>':'';
    return '<tr><td class="rank">'+(i+1)+'</td><td class="title-cell">'+esc(g.title)+tag+step+'</td><td class="rep">'+fmt(g.reporters)+'</td></tr>';
  }).join("");
  w.innerHTML='<table><thead><tr><th></th><th>Game</th><th>ppl</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function apply(j){
  setNum("online",j.online);
  if(prevOnline!=null){var d=j.online-prevOnline;$("onlineCap").textContent="last 10 min · "+(d>0?"▲ +"+d:d<0?"▼ "+d:"=")+" vs last check";}
  prevOnline=j.online;
  setNum("active1h",j.active1h); setNum("today",j.today);
  setNum("games",j.probedGames); setNum("reporters",j.reporters);
  var f=j.full||{};
  setNum("fReady",f.ready); setNum("fUp",f.uploading); setNum("fDone",f.done);
  $("fMB").textContent=(f.storedMB==null?"--":f.storedMB); $("fLimit").textContent=fmt(f.limitMB||8192);
  renderTop(j.top);
  var host=(j.__src||"").indexOf("cn-")>=0?"cn-api":"api";
  $("src").textContent=host;
  $("status").innerHTML='<span class="ok">// ONLINE</span> · synced '+new Date().toLocaleTimeString();
}

function tick(){
  raceStats().then(apply).catch(function(){
    $("status").innerHTML='<span class="err">// NO SIGNAL</span> · retrying …';
  });
}

// clock + refresh countdown
var left=PERIOD;
setInterval(function(){
  var d=new Date();
  $("clock").textContent=d.toTimeString().slice(0,8);
  left--; if(left<=0){left=PERIOD;tick();}
  $("count").textContent=left;
},1000);
tick();
</script>

</body>
</html>`;
