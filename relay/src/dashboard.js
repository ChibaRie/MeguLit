// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-16 beta live-usage dashboard served by the relay (GET /dashboard, same-origin poll of /api/probe/stats).
   Phone: https://cn-api.megulit.com/dashboard (mainland) / https://api.megulit.com/dashboard. DedSec street-hacker poster look. */
export const DASHBOARD_HTML=String.raw`<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MeguLit Live Ops</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Silkscreen:wght@400;700&family=Share+Tech+Mono&display=swap">

<style>
/* DedSec street-hacker poster: black ground with halftone, bone-white slabs, marker-red highlights, stickers + tape,
   chunky condensed numerals, pixel labels, slice glitches. Single dark world. */
:root{
  --ink:#000; --paper:#f1efe9; --grey:#8a8a8a; --soft:#1b1b1b;
  --red:#ff1a40; --pink:#ff4f9a; --cy:#21e6ff;
  --big:"Anton","Impact","Arial Narrow Bold",sans-serif;
  --pix:"Silkscreen","Share Tech Mono",monospace;
  --mono:"Share Tech Mono",ui-monospace,Menlo,Consolas,monospace;
  color-scheme:dark;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--ink);color:var(--paper);font-family:var(--mono);
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:0 48px;
  background-image:radial-gradient(rgba(255,255,255,.07) 1px,transparent 1.4px);background-size:7px 7px;overflow-x:hidden}
.wrap{max-width:760px;margin:0 auto;position:relative}
.noise{position:fixed;inset:-50%;z-index:30;pointer-events:none;opacity:.06;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  animation:grain .8s steps(6) infinite}
@keyframes grain{0%{transform:translate(0,0)}25%{transform:translate(-3%,2%)}50%{transform:translate(2%,-3%)}75%{transform:translate(-2%,-1%)}100%{transform:translate(1%,3%)}}

/* ---- boot ---- */
#boot{position:fixed;inset:0;z-index:50;background:#000;display:grid;place-items:center;padding:24px}
#boot .box{font-family:var(--pix);font-size:13px;line-height:1.9;color:var(--grey);max-width:420px;width:100%}
#boot .box .r{color:var(--red)}
#boot .gr{margin-top:14px;font-family:var(--big);font-size:46px;color:#000;background:var(--paper);display:inline-block;padding:2px 12px;transform:rotate(-2deg);box-shadow:6px 6px 0 var(--red)}
#boot.off{animation:out .45s forwards}@keyframes out{to{opacity:0;visibility:hidden}}

/* ---- header: inverted slab ---- */
.top{display:flex;align-items:stretch;gap:0;margin-top:18px;position:relative}
.slab{background:var(--paper);color:#000;padding:6px 14px 4px;display:flex;align-items:center;gap:10px;flex:1;min-width:0;
  clip-path:polygon(0 0,100% 0,calc(100% - 14px) 100%,0 100%)}
.slab .word{font-family:var(--big);font-size:clamp(30px,8.5vw,52px);line-height:1;letter-spacing:.01em;position:relative;white-space:nowrap}
.slab .word i{font-style:normal;color:var(--red)}
.skull{width:clamp(36px,9vw,50px);height:auto;flex:0 0 auto}
.clock{font-family:var(--pix);font-size:11px;color:var(--paper);text-align:right;padding:4px 0 0 12px;line-height:1.5;white-space:nowrap}
.clock b{display:block;font-family:var(--big);font-size:22px;font-weight:400;color:var(--red);letter-spacing:.02em}
.sub{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}
.stk{font-family:var(--pix);font-size:10px;letter-spacing:.06em;padding:3px 8px;border:2px solid var(--paper);color:var(--paper);transform:rotate(-1.5deg)}
.stk.r{background:var(--red);border-color:var(--red);color:#000;transform:rotate(1.2deg)}
.stk.w{background:var(--paper);color:#000;transform:rotate(-.6deg)}

/* glitch slices (periodic) */
.gl{position:relative}
.gl.hit{animation:slice .38s steps(1) 1}
@keyframes slice{
  0%{clip-path:inset(0 0 0 0);transform:none;filter:none}
  20%{clip-path:inset(12% 0 58% 0);transform:translateX(-9px);filter:drop-shadow(3px 0 var(--red)) drop-shadow(-3px 0 var(--cy))}
  40%{clip-path:inset(55% 0 18% 0);transform:translateX(7px)}
  60%{clip-path:inset(30% 0 40% 0);transform:translateX(-4px);filter:drop-shadow(-3px 0 var(--red))}
  80%{clip-path:inset(0 0 0 0);transform:translateX(2px)}
  100%{clip-path:inset(0 0 0 0);transform:none;filter:none}}

/* ---- hero ---- */
.hero{margin-top:22px;position:relative;border:3px solid var(--paper);padding:18px 18px 14px;background:rgba(0,0,0,.55)}
.hero .tape{position:absolute;top:-13px;left:22px;background:rgba(241,239,233,.88);color:#000;font-family:var(--pix);font-size:11px;padding:3px 14px;transform:rotate(-3deg);letter-spacing:.06em}
.hero .live{position:absolute;top:12px;right:12px;font-family:var(--pix);font-size:11px;background:var(--red);color:#000;padding:3px 8px;transform:rotate(3deg)}
.hero .live::before{content:"";display:inline-block;width:7px;height:7px;background:#000;margin-right:6px;vertical-align:1px;animation:bl 1s steps(1) infinite}
@keyframes bl{50%{opacity:0}}
.numrow{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap}
.big{font-family:var(--big);font-size:clamp(110px,34vw,220px);line-height:.82;color:var(--paper);font-variant-numeric:tabular-nums;
  text-shadow:6px 0 0 var(--red),-3px 0 0 rgba(33,230,255,.55);letter-spacing:-.01em;margin-top:6px}
.who{padding-bottom:10px;min-width:0}
.who .mk{font-family:var(--big);font-size:clamp(26px,7vw,40px);line-height:1.02;color:#000;background:var(--red);display:inline;padding:0 6px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.who .s{display:block;font-family:var(--pix);font-size:11px;color:var(--grey);margin-top:8px}
.delta{font-family:var(--pix);font-size:11px;margin-top:6px;color:var(--paper)}
.delta b{color:var(--red)}

/* ---- tiles ---- */
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
@media(max-width:560px){.grid{grid-template-columns:repeat(2,1fr)}}
.tile{border:2px solid var(--paper);padding:10px 12px 10px;background:#000;position:relative}
.tile:nth-child(2){transform:rotate(.5deg)}.tile:nth-child(3){transform:rotate(-.4deg)}
.tile .n{font-family:var(--big);font-size:clamp(38px,10vw,54px);line-height:1;color:var(--paper);font-variant-numeric:tabular-nums}
.tile .k{font-family:var(--pix);font-size:10px;color:var(--grey);margin-top:6px;text-transform:uppercase}
.tile.r{background:var(--paper);color:#000}.tile.r .n{color:#000}.tile.r .k{color:#333}
.tile.r::after{content:"";position:absolute;right:-2px;top:-2px;border:10px solid transparent;border-top-color:var(--red);border-right-color:var(--red)}

/* ---- sections ---- */
.sec{margin-top:28px}
.h{display:flex;align-items:center;gap:10px;margin:0 0 10px}
.h .t{font-family:var(--big);font-size:28px;line-height:1;background:var(--paper);color:#000;padding:2px 10px 0;transform:rotate(-1deg)}
.h .z{font-family:var(--pix);font-size:10px;color:var(--grey)}
.h .line{flex:1;height:3px;background:repeating-linear-gradient(90deg,var(--red) 0 10px,transparent 10px 16px)}
.chips{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
@media(max-width:560px){.chips{grid-template-columns:repeat(2,1fr)}}
.chip{border:2px dashed #555;padding:8px 10px}
.chip .v{font-family:var(--big);font-size:30px;line-height:1;color:var(--red)}
.chip .v small{font-family:var(--pix);font-size:10px;color:var(--grey)}
.chip .l{font-family:var(--pix);font-size:10px;color:var(--grey);margin-top:4px}

/* list */
.list{border-top:3px solid var(--paper)}
.row{display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:10px 4px;border-bottom:1px dashed #333}
.row .rk{font-family:var(--big);font-size:26px;color:var(--red);line-height:1}
.row .tt{min-width:0;word-break:break-word;font-size:14px;color:var(--paper)}
.row .tt .st{display:block;font-family:var(--pix);font-size:9px;color:var(--grey);margin-top:2px}
.row .pp{font-family:var(--big);font-size:24px;color:#000;background:var(--paper);padding:0 8px}
.tag{font-family:var(--pix);font-size:9px;background:var(--red);color:#000;padding:1px 5px;margin-left:6px;vertical-align:2px}
.empty{border:2px dashed #444;padding:18px 14px;font-family:var(--pix);font-size:11px;color:var(--grey);text-align:center;line-height:1.7}
.empty b{color:var(--paper);background:#000;font-weight:400}

/* log + footer */
.log{margin-top:26px;background:var(--paper);color:#000;padding:8px 10px;font-family:var(--pix);font-size:10px;line-height:1.75;min-height:66px;
  clip-path:polygon(0 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%)}
.log .ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.log .t{color:#777}.log .ok{color:#000}.log .err{color:var(--red)}
.foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-top:10px;font-family:var(--pix);font-size:10px;color:var(--grey)}
.foot .on{color:var(--red)}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
</head>
<body>

<div class="noise"></div>
<div id="boot"><div class="box" id="bootBox"></div></div>

<div class="wrap">
  <header class="top gl" id="hdr">
    <div class="slab">
      <svg class="skull" viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges">
        <path fill="#000" d="M7 2h10v1h2v1h1v2h1v7h-1v2h-2v3h-2v2H8v-2H6v-3H4v-2H3V6h1V4h1V3h2z"/>
        <path fill="#f1efe9" d="M7 8h4v4H7zM13 8h4v4h-4z"/>
        <path fill="#ff1a40" d="M8 9h2v2H8zM14 9h2v2h-2z"/>
        <path fill="#f1efe9" d="M11 13h2v2h-2zM9 17h1v2H9zM11 17h1v2h-1zM13 17h1v2h-1zM15 17h1v2h-1z"/>
        <path fill="#000" d="M1 21h4v1h2v1H1zM23 21h-4v1h-2v1h6z"/>
      </svg>
      <div class="word">MEGU<i>LIT</i>/LIVE</div>
    </div>
    <div class="clock"><b id="clock">--:--</b><span id="date">----.--.--</span></div>
  </header>
  <div class="sub">
    <span class="stk r">BETA UPLINK</span><span class="stk">DEDSEC NODE</span><span class="stk w" id="nodeTag">NODE ?</span>
  </div>

  <section class="hero gl" id="hero">
    <span class="tape">REAL-TIME // 实时</span>
    <span class="live">LIVE</span>
    <div class="numrow">
      <div class="big" id="online">0</div>
      <div class="who">
        <span class="mk">PEOPLE ONLINE</span>
        <span class="s">正在用 MeguLit 的人 · 最近 10 分钟</span>
        <div class="delta" id="delta">// waiting for next ping</div>
      </div>
    </div>
  </section>

  <div class="grid">
    <div class="tile"><div class="n" id="active1h">0</div><div class="k">1 小时活跃</div></div>
    <div class="tile"><div class="n" id="today">0</div><div class="k">今日活跃</div></div>
    <div class="tile r"><div class="n" id="games">0</div><div class="k">探针游戏</div></div>
    <div class="tile"><div class="n" id="reporters">0</div><div class="k">上报人次</div></div>
  </div>

  <section class="sec">
    <div class="h"><span class="t">FULL DUMPS</span><span class="z">完整剧本上传</span><span class="line"></span></div>
    <div class="chips">
      <div class="chip"><div class="v" id="fReady">0</div><div class="l">待适配</div></div>
      <div class="chip"><div class="v" id="fUp">0</div><div class="l">上传中</div></div>
      <div class="chip"><div class="v" id="fDone">0</div><div class="l">已适配</div></div>
      <div class="chip"><div class="v"><span id="fMB">0</span><small> / <span id="fLimit">8192</span>MB</small></div><div class="l">R2 存储</div></div>
    </div>
  </section>

  <section class="sec">
    <div class="h"><span class="t">TARGETS</span><span class="z">多少人在读</span><span class="line"></span></div>
    <div id="topWrap"><div class="empty">// scanning …</div></div>
  </section>

  <div class="log" id="log"></div>
  <div class="foot"><span id="status">// standby</span><span>poll <span id="count">15</span>s</span></div>
</div>

<script>
"use strict";
var ENDPOINTS=["/api/probe/stats"];
var PERIOD=15,GLYPHS="0123456789#%&@$";
var $=function(id){return document.getElementById(id);};
var reduce=matchMedia("(prefers-reduced-motion:reduce)").matches;
function fmt(n){return (n==null||isNaN(n))?"--":String(n).replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}

function scrambleTo(el,val){var target=fmt(val);if(reduce||el.textContent===target){el.textContent=target;return;}
 var i=0;clearInterval(el._t);el._t=setInterval(function(){i++;if(i>=9){clearInterval(el._t);el.textContent=target;return;}
  var s="";for(var k=0;k<target.length;k++){var c=target[k];s+=c===","?c:GLYPHS[Math.floor(Math.random()*GLYPHS.length)];}el.textContent=s;},40);}

function glitch(id){var e=$(id);if(!e||reduce)return;e.classList.remove("hit");void e.offsetWidth;e.classList.add("hit");}
setInterval(function(){glitch(Math.random()<.5?"hero":"hdr");},4200);

var logs=[];
function log(msg,cls){var t=new Date().toTimeString().slice(0,8);logs.unshift('<div class="ln"><span class="t">'+t+'</span> <span class="'+(cls||"ok")+'">'+msg+'</span></div>');logs=logs.slice(0,3);$("log").innerHTML=logs.join("");}

function raceStats(){return Promise.any(ENDPOINTS.map(function(u){return fetch(u,{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.json().then(function(j){j.__src=u;return j;});});}));}

var prev=null;
function renderTop(list){var w=$("topWrap");
 if(!list||!list.length){w.innerHTML='<div class="empty">还没有游戏上报标题<br><b>完整剧本上传</b>的客户端发版后，这里会列出每个游戏有多少人在读</div>';return;}
 w.innerHTML='<div class="list">'+list.map(function(g,i){return '<div class="row"><span class="rk">'+String(i+1).padStart(2,"0")+'</span><span class="tt">'+esc(g.title)+(g.full?'<span class="tag">FULL</span>':'')+(g.step?'<span class="st">'+esc(g.step)+'</span>':'')+'</span><span class="pp">'+fmt(g.reporters)+'</span></div>';}).join("")+'</div>';}

function apply(j){
 scrambleTo($("online"),j.online);
 if(prev!=null){var d=j.online-prev;$("delta").innerHTML=d>0?'<b>▲ +'+d+'</b> since last ping':d<0?'<b>▼ '+d+'</b> since last ping':'// steady';if(d!==0)glitch("hero");}
 prev=j.online;
 scrambleTo($("active1h"),j.active1h);scrambleTo($("today"),j.today);scrambleTo($("games"),j.probedGames);scrambleTo($("reporters"),j.reporters);
 var f=j.full||{};scrambleTo($("fReady"),f.ready);scrambleTo($("fUp"),f.uploading);scrambleTo($("fDone"),f.done);
 $("fMB").textContent=f.storedMB==null?"--":f.storedMB;$("fLimit").textContent=fmt(f.limitMB||8192);
 renderTop(j.top);
 var host=(j.__src||"").indexOf("cn-")>=0?"CN":(j.__src?"GLOBAL":"LOCAL");$("nodeTag").textContent="NODE "+host;
 $("status").innerHTML='<span class="on">● LINKED</span> '+new Date().toLocaleTimeString();
 log("sync ok · "+j.online+" online · "+j.probedGames+" games","ok");}
function tick(){raceStats().then(apply).catch(function(){$("status").innerHTML='<span class="on">● LINK LOST</span> retrying';log("uplink dropped · retrying","err");});}

var SEQ=["> dedsec relay // megulit beta","> handshake ............ <span class='r'>ok</span>","> pulling live counters ..","> decrypt ............... <span class='r'>ok</span>"];
function boot(){var b=$("boot"),box=$("bootBox");if(reduce){b.className="off";start();return;}
 var i=0,h="";(function step(){if(i<SEQ.length){h+="<div>"+SEQ[i++]+"</div>";box.innerHTML=h;setTimeout(step,280);}
  else{box.innerHTML=h+'<div class="gr">WE ARE IN.</div>';setTimeout(function(){b.className="off";start();},700);}})();}
function start(){var left=PERIOD;
 setInterval(function(){var d=new Date();$("clock").textContent=d.toTimeString().slice(0,5);
  $("date").textContent=d.getFullYear()+"."+String(d.getMonth()+1).padStart(2,"0")+"."+String(d.getDate()).padStart(2,"0");
  if(--left<=0){left=PERIOD;tick();}$("count").textContent=left;},1000);
 log("uplink established");tick();glitch("hdr");}
boot();
</script>

</body>
</html>`;
