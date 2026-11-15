// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-16 beta live-usage dashboard served by the relay (GET /dashboard, same-origin poll of /api/probe/stats).
   Phone: https://cn-api.megulit.com/dashboard (mainland) / https://api.megulit.com/dashboard. DedSec intrusion console. */
export const DASHBOARD_HTML=String.raw`<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MeguLit Live Ops</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Major+Mono+Display&display=swap">

<style>
/* DedSec intrusion console: pure black, bone-white telemetry, blood-red hack accent, data-rain + glitch + CRT. Single dark world. */
:root{
  --bg:#000; --panel:rgba(10,10,10,.72); --edge:#2a2a2a; --edge2:#1a1a1a;
  --fg:#f4f4f4; --dim:#6e6e6e;
  --red:#ff0033; --red2:#b00020; --cy:#00e5ff;
  --mono:"Share Tech Mono",ui-monospace,Menlo,Consolas,monospace;
  --disp:"Major Mono Display","Share Tech Mono",monospace;
  color-scheme:dark;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:#000;color:var(--fg);font-family:var(--mono);letter-spacing:.03em;
  padding-left:max(14px,env(safe-area-inset-left,0px));padding-right:max(14px,env(safe-area-inset-right,0px));padding-block:0 46px;
  -webkit-font-smoothing:none;position:relative;min-height:100%}
#rain{position:fixed;inset:0;z-index:0;opacity:.5;pointer-events:none}
/* CRT scanlines + vignette + sweeping red bar, over everything but under content */
.crt{position:fixed;inset:0;z-index:2;pointer-events:none;
  background:
    repeating-linear-gradient(0deg,rgba(255,255,255,.045) 0 1px,transparent 1px 3px),
    radial-gradient(130% 120% at 50% 50%,transparent 55%,rgba(0,0,0,.85) 100%);}
.crt::after{content:"";position:absolute;left:0;right:0;height:120px;top:-120px;
  background:linear-gradient(180deg,transparent,rgba(255,0,51,.10),rgba(255,0,51,.22),transparent);
  animation:sweep 5.5s linear infinite;mix-blend-mode:screen}
@keyframes sweep{0%{top:-120px}100%{top:100%}}
.wrap{max-width:740px;margin:0 auto;position:relative;z-index:3}

/* boot / intrusion overlay */
#boot{position:fixed;inset:0;z-index:40;background:#000;display:flex;flex-direction:column;justify-content:center;
  padding:0 24px;font-family:var(--mono);font-size:13px;line-height:1.7;white-space:pre-wrap}
#boot .l{color:var(--dim)} #boot .g{color:var(--red);text-shadow:0 0 10px rgba(255,0,51,.6)}
#boot.off{animation:bootout .5s forwards} @keyframes bootout{to{opacity:0;visibility:hidden}}

/* header with skull */
.top{display:flex;align-items:center;gap:12px;padding:16px 0 10px;border-bottom:1px solid var(--red2);position:relative}
.top::after{content:"";position:absolute;left:0;bottom:-1px;width:70px;height:2px;background:var(--red);box-shadow:0 0 12px var(--red)}
.skull{width:38px;height:38px;flex:0 0 auto;filter:drop-shadow(0 0 6px rgba(255,0,51,.5))}
.ident{flex:1;min-width:0}
.brand{font-family:var(--disp);font-size:clamp(17px,4.6vw,24px);letter-spacing:.06em;text-transform:lowercase;position:relative;color:#fff}
.brand .glitch{position:relative;display:inline-block}
.brand .glitch::before,.brand .glitch::after{content:attr(data-t);position:absolute;left:0;top:0;width:100%;overflow:hidden;clip-path:inset(0 0 0 0)}
.brand .glitch::before{color:var(--red);transform:translate(-2px,0);animation:gl1 2.6s infinite steps(2)}
.brand .glitch::after{color:var(--cy);transform:translate(2px,0);animation:gl2 3.4s infinite steps(2)}
@keyframes gl1{0%,92%,100%{clip-path:inset(0 0 100% 0)}93%{clip-path:inset(10% 0 60% 0)}96%{clip-path:inset(40% 0 20% 0)}}
@keyframes gl2{0%,90%,100%{clip-path:inset(100% 0 0 0)}91%{clip-path:inset(60% 0 10% 0)}95%{clip-path:inset(20% 0 55% 0)}}
.tagline{color:var(--dim);font-size:10px;letter-spacing:.24em;text-transform:uppercase;margin-top:2px}
.clock{color:var(--red);font-size:11px;letter-spacing:.12em;text-align:right;white-space:nowrap}
.clock small{display:block;color:var(--dim);letter-spacing:.2em}

/* HUD panel: cut corners + corner ticks */
.hud{position:relative;background:var(--panel);border:1px solid var(--edge);margin:16px 0;
  clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px));backdrop-filter:blur(1px)}
.hud>.pad{padding:16px}
.hud::before{content:"";position:absolute;top:6px;left:6px;width:12px;height:12px;border-left:2px solid var(--red);border-top:2px solid var(--red)}
.hud::after{content:"";position:absolute;bottom:6px;right:6px;width:12px;height:12px;border-right:2px solid var(--red);border-bottom:2px solid var(--red)}

/* hero */
.hero .lbl{color:var(--dim);font-size:12px;letter-spacing:.24em;text-transform:uppercase}
.live{position:absolute;top:14px;right:16px;color:var(--red);font-size:11px;letter-spacing:.14em}
.live .dot{display:inline-block;width:8px;height:8px;background:var(--red);border-radius:50%;box-shadow:0 0 8px var(--red);animation:bl 1.3s infinite;vertical-align:middle;margin-right:5px}
@keyframes bl{50%{opacity:.15}}
.big{font-family:var(--disp);font-size:clamp(60px,21vw,128px);line-height:.92;color:var(--red);
  font-variant-numeric:tabular-nums;text-shadow:0 0 26px rgba(255,0,51,.55),0 0 2px #fff;margin:2px 0}
.big.scr{color:#fff;text-shadow:0 0 18px rgba(255,255,255,.5)}
.cap{color:var(--fg);font-size:12px;letter-spacing:.08em;margin-top:2px}
.cap b{color:var(--red)}

/* tiles */
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:9px;margin:9px 0}
.tile{position:relative;background:var(--panel);border:1px solid var(--edge2);padding:12px;clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,0 100%)}
.tile .n{font-family:var(--disp);font-size:clamp(22px,7vw,32px);font-variant-numeric:tabular-nums;color:#fff}
.tile .k{color:var(--dim);font-size:10px;letter-spacing:.14em;text-transform:uppercase;margin-top:5px}
.tile .k::before{content:"▸ ";color:var(--red)}

/* sections */
.sec{margin-top:22px}
.sec>h2{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:#fff;margin:0 0 9px;display:flex;align-items:center;gap:8px}
.sec>h2::before{content:"";width:9px;height:9px;background:var(--red);box-shadow:0 0 8px var(--red);transform:rotate(45deg)}
.sec>h2 .en{color:var(--dim);font-size:10px;letter-spacing:.16em}
.bar{display:flex;flex-wrap:wrap;gap:7px}
.chip{border:1px solid var(--edge);padding:7px 11px;font-size:12px;letter-spacing:.05em;background:var(--panel)}
.chip b{color:var(--red);font-variant-numeric:tabular-nums}
.chip.w b{color:#fff}

/* top list */
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 8px;border-bottom:1px solid var(--edge2);vertical-align:top}
th{color:var(--dim);font-weight:400;font-size:10px;letter-spacing:.14em;text-transform:uppercase}
td.rank{color:var(--red);width:3ch;font-variant-numeric:tabular-nums}
td.rep{text-align:right;color:var(--red);font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:0 0 8px rgba(255,0,51,.4)}
.title-cell{min-width:0;word-break:break-word;color:#fff}
.step{color:var(--dim);font-size:11px}
.tag{display:inline-block;border:1px solid var(--red2);color:var(--red);font-size:9px;padding:0 5px;margin-left:6px;letter-spacing:.1em}
.empty{color:var(--dim);border:1px dashed var(--edge);padding:16px;font-size:12px;text-align:center}

/* terminal log footer */
.log{margin-top:20px;border-top:1px solid var(--red2);padding-top:8px;font-size:11px;color:var(--dim);min-height:52px;line-height:1.6}
.log .ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.log .ok{color:var(--red)} .log .t{color:#555}
.foot{color:#555;font-size:10px;letter-spacing:.1em;margin-top:8px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px}
.foot .err{color:var(--red)}

@media(prefers-reduced-motion:reduce){*{animation:none!important}.crt::after{display:none}}
</style>
</head>
<body>

<canvas id="rain"></canvas>
<div class="crt"></div>

<div id="boot"></div>

<div class="wrap">
  <header class="top">
    <svg class="skull" viewBox="0 0 32 32" aria-hidden="true">
      <g fill="#f4f4f4">
        <rect x="8" y="3" width="16" height="2"/><rect x="6" y="5" width="20" height="2"/>
        <rect x="5" y="7" width="22" height="10"/><rect x="5" y="17" width="4" height="4"/>
        <rect x="11" y="17" width="10" height="4"/><rect x="23" y="17" width="4" height="4"/>
        <rect x="9" y="21" width="14" height="2"/>
      </g>
      <g fill="#000"><rect x="8" y="9" width="6" height="6"/><rect x="18" y="9" width="6" height="6"/><rect x="14" y="16" width="4" height="4"/></g>
      <g fill="#ff0033"><rect x="10" y="11" width="2" height="2"/><rect x="20" y="11" width="2" height="2"/></g>
      <g fill="#f4f4f4" transform="rotate(45 16 27)"><rect x="4" y="26" width="24" height="2"/></g>
      <g fill="#f4f4f4" transform="rotate(-45 16 27)"><rect x="4" y="26" width="24" height="2"/></g>
    </svg>
    <div class="ident">
      <div class="brand"><span class="glitch" data-t="megulit">megulit</span> <span style="color:var(--red)">//</span> live_ops</div>
      <div class="tagline">DedSec · beta telemetry uplink</div>
    </div>
    <div class="clock"><span id="clock">--:--:--</span><small id="date">----/--/--</small></div>
  </header>

  <div class="hud"><div class="pad hero" style="position:relative">
    <div class="live"><span class="dot"></span>LIVE</div>
    <div class="lbl">PLAYERS ONLINE NOW</div>
    <div class="big" id="online">000</div>
    <div class="cap" id="onlineCap">last 10 min · 正在联网的 <b>MeguLit</b></div>
  </div></div>

  <div class="grid">
    <div class="tile"><div class="n" id="active1h">0</div><div class="k">Active 1h</div></div>
    <div class="tile"><div class="n" id="today">0</div><div class="k">Active today</div></div>
    <div class="tile"><div class="n" id="games">0</div><div class="k">Probed games</div></div>
    <div class="tile"><div class="n" id="reporters">0</div><div class="k">Reporters</div></div>
  </div>

  <div class="sec">
    <h2>Full probes <span class="en">// 完整剧本上传</span></h2>
    <div class="bar">
      <span class="chip">READY <b id="fReady">0</b></span>
      <span class="chip">UPLOADING <b id="fUp">0</b></span>
      <span class="chip w">DONE <b id="fDone">0</b></span>
      <span class="chip w">STORED <b id="fMB">0</b>/<span id="fLimit">8192</span> MB</span>
    </div>
  </div>

  <div class="sec">
    <h2>Top games <span class="en">// 多少人在读</span></h2>
    <div id="topWrap"><div class="empty">// scanning network …</div></div>
  </div>

  <div class="log" id="log"></div>
  <div class="foot"><span id="status">// standby</span><span>node <span id="src">—</span> · poll <span id="count">15</span>s</span></div>
</div>

<script>
"use strict";
var ENDPOINTS=["/api/probe/stats"];
var PERIOD=15, GLYPHS="0123456789ABCDEF#%&@░▒▓";
var $=function(id){return document.getElementById(id);};
var reduce=matchMedia("(prefers-reduced-motion:reduce)").matches;
function fmt(n){return (n==null||isNaN(n))?"--":String(n).replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}

/* hex data-rain */
(function(){var c=$("rain"),x=c.getContext("2d"),cols,drops,fs=14;
 function size(){c.width=innerWidth;c.height=innerHeight;cols=Math.floor(c.width/fs);drops=[];for(var i=0;i<cols;i++)drops[i]=Math.random()*-50;}
 size();addEventListener("resize",size);
 function draw(){x.fillStyle="rgba(0,0,0,.08)";x.fillRect(0,0,c.width,c.height);x.font=fs+"px monospace";
  for(var i=0;i<cols;i++){var ch=GLYPHS[Math.floor(Math.random()*GLYPHS.length)];var y=drops[i]*fs;
   x.fillStyle=Math.random()>.94?"#ff0033":"rgba(255,40,70,.35)";x.fillText(ch,i*fs,y);
   if(y>c.height&&Math.random()>.975)drops[i]=0;drops[i]++;}}
 if(!reduce)setInterval(draw,55);else{c.style.opacity=".12";}
})();

/* scramble a number into place (decrypt effect) */
function scrambleTo(el,val){
 var target=fmt(val);
 if(reduce||el.textContent===target){el.textContent=target;return;}
 var frames=10,i=0,big=el.classList.contains("big");if(big)el.classList.add("scr");
 clearInterval(el._t);
 el._t=setInterval(function(){
  i++;
  if(i>=frames){clearInterval(el._t);el.textContent=target;if(big)setTimeout(function(){el.classList.remove("scr");},120);return;}
  var s="";for(var k=0;k<target.length;k++){var c=target[k];s+=(c===","||c==="."||c===" ")?c:GLYPHS[Math.floor(Math.random()*16)];}
  el.textContent=s;
 },34);
}

/* terminal log */
var logLines=[];
function logPush(msg,cls){var d=new Date().toTimeString().slice(0,8);
 logLines.unshift('<div class="ln"><span class="t">['+d+']</span> <span class="'+(cls||"")+'">'+msg+'</span></div>');
 logLines=logLines.slice(0,4);$("log").innerHTML=logLines.join("");}

function raceStats(){return Promise.any(ENDPOINTS.map(function(u){
 return fetch(u,{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.json().then(function(j){j.__src=u;return j;});});}));}

var prevOnline=null;
function renderTop(list){var w=$("topWrap");
 if(!list||!list.length){w.innerHTML='<div class="empty">// 还没有游戏上报标题（脱敏样本不含标题）</div>';return;}
 var rows=list.map(function(g,i){var tag=g.full?'<span class="tag">FULL</span>':'';var step=g.step?'<div class="step">'+esc(g.step)+'</div>':'';
  return '<tr><td class="rank">'+String(i+1).padStart(2,"0")+'</td><td class="title-cell">'+esc(g.title)+tag+step+'</td><td class="rep">'+fmt(g.reporters)+'</td></tr>';}).join("");
 w.innerHTML='<table><thead><tr><th>#</th><th>target</th><th>ppl</th></tr></thead><tbody>'+rows+'</tbody></table>';}

function apply(j){
 scrambleTo($("online"),j.online);
 if(prevOnline!=null){var d=j.online-prevOnline;$("onlineCap").innerHTML="last 10 min · "+(d>0?'<b>▲ +'+d+'</b>':d<0?'<b>▼ '+d+'</b>':"=")+" since last ping";}
 prevOnline=j.online;
 scrambleTo($("active1h"),j.active1h);scrambleTo($("today"),j.today);scrambleTo($("games"),j.probedGames);scrambleTo($("reporters"),j.reporters);
 var f=j.full||{};scrambleTo($("fReady"),f.ready);scrambleTo($("fUp"),f.uploading);scrambleTo($("fDone"),f.done);
 $("fMB").textContent=(f.storedMB==null?"--":f.storedMB);$("fLimit").textContent=fmt(f.limitMB||8192);
 renderTop(j.top);
 var host=(j.__src||"").indexOf("cn-")>=0?"cn-api":"api";$("src").textContent=host;
 $("status").innerHTML='<span style="color:var(--red)">// LINK ACTIVE</span> · '+new Date().toLocaleTimeString();
 logPush("sync OK · "+j.online+" online · node "+host,"ok");
}
function tick(){raceStats().then(apply).catch(function(){$("status").innerHTML='<span class="err">// UPLINK LOST</span> · retrying';logPush("connection dropped, retrying…","err");});}

/* boot intrusion sequence then reveal */
var SEQ=["> MEGULIT NETWORK // DedSec telemetry","> establishing uplink ████████████ OK","> bypassing ctOS handshake ... OK","> decrypting live feed ...","> ACCESS GRANTED"];
function boot(){var b=$("boot");if(reduce){b.className="off";start();return;}
 var html="",i=0;
 (function step(){if(i>=SEQ.length){setTimeout(function(){b.className="off";start();},420);return;}
  var cls=i===SEQ.length-1?"g":"l";html+='<div class="'+cls+'">'+SEQ[i]+'</div>';b.innerHTML=html;i++;setTimeout(step,i===SEQ.length?260:340);})();}
function start(){
 var left=PERIOD;
 setInterval(function(){var d=new Date();$("clock").textContent=d.toTimeString().slice(0,8);
  $("date").textContent=d.getFullYear()+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getDate()).padStart(2,"0");
  left--;if(left<=0){left=PERIOD;tick();}$("count").textContent=left;},1000);
 logPush("uplink established","ok");tick();
}
boot();
</script>

</body>
</html>`;
