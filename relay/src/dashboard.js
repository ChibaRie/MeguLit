// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-16 beta live-usage dashboard served by the relay (GET /dashboard, same-origin poll of /api/probe/stats).
   Phone: https://cn-api.megulit.com/dashboard (mainland) / https://api.megulit.com/dashboard. Raw terminal, pixel mono, black + red. */
export const DASHBOARD_HTML=String.raw`<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MeguLit Live Ops</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen&family=VT323&family=DotGothic16&display=swap">

<style>
/* raw terminal: black, one red, pixel mono everywhere; data printed as code, the live number as block characters */
:root{--bg:#000;--fg:#d8d8d8;--dim:#6b6b6b;--dim2:#333;--red:#e0303e;
  --px:"VT323","DotGothic16",ui-monospace,Menlo,Consolas,monospace;--tag:"Silkscreen","VT323",monospace;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--fg);font-family:var(--px);font-size:19px;line-height:1.35;-webkit-font-smoothing:none;
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:14px 40px;overflow-x:hidden}
body::after{content:"";position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.03) 0 1px,transparent 1px 3px)}
.wrap{max-width:720px;margin:0 auto}
.r{color:var(--red)}.d{color:var(--dim)}.w{color:#fff}
.cur::after{content:"\2588";color:var(--red);animation:bl 1s steps(1) infinite;margin-left:2px}
@keyframes bl{50%{opacity:0}}

/* top line: small pixel name with a glitch */
.top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;border-bottom:1px dashed var(--dim2);padding-bottom:8px}
.name{font-family:var(--tag);font-size:15px;color:var(--red);position:relative;display:inline-block;letter-spacing:.04em}
.name::before,.name::after{content:attr(data-t);position:absolute;left:0;top:0;width:100%;overflow:hidden}
.name::before{color:#fff;animation:g1 2.7s steps(1) infinite}
.name::after{color:var(--red);opacity:.6;animation:g2 3.3s steps(1) infinite}
@keyframes g1{0%,88%,100%{clip-path:inset(0 0 100% 0);transform:none}89%{clip-path:inset(0 0 55% 0);transform:translateX(-3px)}91%{clip-path:inset(60% 0 0 0);transform:translateX(2px)}93%{clip-path:inset(30% 0 40% 0);transform:translateX(-1px)}}
@keyframes g2{0%,80%,100%{clip-path:inset(0 0 100% 0);transform:none}81%{clip-path:inset(40% 0 20% 0);transform:translate(4px,1px)}84%{clip-path:inset(10% 0 70% 0);transform:translateX(-4px)}}
.name.jolt{animation:jolt .25s steps(2)}
@keyframes jolt{0%{transform:translateX(0)}25%{transform:translateX(-3px)}50%{transform:translateX(3px)}75%{transform:translateX(-1px)}100%{transform:none}}
.top .d{font-size:17px}

/* blocks */
.cmd{margin-top:16px;color:var(--dim)}
.cmd b{color:var(--red);font-weight:400}
.big{margin:6px 0 0;font-family:var(--px);color:var(--red);font-size:clamp(16px,4.6vw,24px);line-height:.95;letter-spacing:0;white-space:pre}
.big.hit{animation:hit .3s steps(1)}
@keyframes hit{0%{transform:translateX(-4px);opacity:.6}33%{transform:translateX(3px);color:#fff}66%{transform:translateX(-1px)}100%{transform:none}}
.note{color:var(--dim);margin-top:6px}
pre.code{margin:6px 0 0;font-family:var(--px);font-size:19px;line-height:1.35;white-space:pre-wrap;word-break:break-word}
.k{color:#9a9a9a}.n{color:var(--red)}.p{color:#555}.s{color:#d8d8d8}
.row{display:flex;gap:10px;align-items:baseline;border-bottom:1px dashed var(--dim2);padding:3px 0}
.row .t{flex:1;min-width:0;word-break:break-word}
.row .c{color:var(--red);white-space:nowrap}
.log{margin-top:6px;color:var(--dim)}
.log div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.log div:first-child{color:var(--fg)}
.foot{margin-top:14px;color:var(--dim);border-top:1px dashed var(--dim2);padding-top:6px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px}
#boot{position:fixed;inset:0;z-index:9;background:#000;padding:20px max(16px,env(safe-area-inset-left,0px));color:var(--fg)}
#boot.off{display:none}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
</head>
<body>

<div id="boot"><div id="tw"></div></div>

<div class="wrap">
  <div class="top"><span class="name" id="name" data-t="MEGULIT">MEGULIT</span><span class="d"><span id="clock">--:--:--</span> · <span id="date">----.--.--</span></span></div>

  <div class="cmd">$ <b>watch</b> megulit --online</div>
  <pre class="big" id="big" aria-label="online"></pre>
  <div class="note">// 最近 10 分钟正在用 megulit 的人 · <span id="delta">--</span></div>

  <div class="cmd">$ <b>cat</b> stats.json</div>
  <pre class="code" id="stats"></pre>

  <div class="cmd">$ <b>ls</b> full_dumps/  <span class="d">// 完整剧本上传</span></div>
  <pre class="code" id="dumps"></pre>

  <div class="cmd">$ <b>top</b> targets  <span class="d">// 多少人在读</span></div>
  <div id="top"></div>

  <div class="cmd">$ <b>tail</b> -f relay.log</div>
  <div class="log" id="log"></div>

  <div class="foot"><span id="status">-- standby</span><span>poll <span id="count">15</span>s<span class="cur"></span></span></div>
</div>

<script>
"use strict";
var ENDPOINTS=["/api/probe/stats"];
var PERIOD=15;
var $=function(id){return document.getElementById(id);};
var reduce=matchMedia("(prefers-reduced-motion:reduce)").matches;
function fmt(n){return (n==null||isNaN(n))?"--":String(n);}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}

/* block-character digits, 5 rows */
var B="█",DIG={"0":["###","# #","# #","# #","###"],"1":[" # ","## "," # "," # ","###"],"2":["###","  #","###","#  ","###"],"3":["###","  #","###","  #","###"],
 "4":["# #","# #","###","  #","  #"],"5":["###","#  ","###","  #","###"],"6":["###","#  ","###","# #","###"],"7":["###","  #","  #","  #","  #"],
 "8":["###","# #","###","# #","###"],"9":["###","# #","###","  #","###"],"-":["   ","   ","###","   ","   "]};
function blocks(t){var rows=["","","","",""];for(var i=0;i<t.length;i++){var g=DIG[t.charAt(i)]||DIG["-"];for(var r=0;r<5;r++)rows[r]+=g[r].replace(/#/g,B+B).replace(/ /g,"  ")+"  ";}return rows.join("\n");}
var shown="";
function setBig(v){var t=fmt(v);if(t===shown){$("big").textContent=blocks(t);return;}
 if(reduce){shown=t;$("big").textContent=blocks(t);return;}
 var i=0,iv=setInterval(function(){i++;if(i>=7){clearInterval(iv);shown=t;$("big").textContent=blocks(t);var b=$("big");b.classList.remove("hit");void b.offsetWidth;b.classList.add("hit");return;}
  var s="";for(var k=0;k<t.length;k++)s+=String(Math.floor(Math.random()*10));$("big").textContent=blocks(s);},50);
 $("big").setAttribute("aria-label",t+" online");}

function kv(k,v,last){return '  <span class="k">"'+k+'"</span><span class="p">:</span> <span class="n">'+v+'</span>'+(last?'':'<span class="p">,</span>');}
function renderStats(j){$("stats").innerHTML='<span class="p">{</span>\n'+[kv("active_1h",fmt(j.active1h)),kv("active_today",fmt(j.today)),kv("probed_games",fmt(j.probedGames)),kv("reporters",fmt(j.reporters),true)].join("\n")+'\n<span class="p">}</span>';}
function renderDumps(f){f=f||{};var line=function(n,v,c){return '<span class="d">'+(v>0?"drwx":"----")+'</span> <span class="n">'+String(fmt(v)).padStart(4," ")+'</span>  '+n+'  <span class="d">'+c+'</span>';};
 $("dumps").innerHTML=[line("ready/",f.ready,"待适配"),line("uploading/",f.uploading,"上传中"),line("done/",f.done,"已适配"),
  '<span class="d">r2 used</span> <span class="n">'+fmt(f.storedMB)+'</span><span class="d">/'+fmt(f.limitMB||8192)+' MB</span>'].join("\n");}
function renderTop(list){var w=$("top");
 if(!list||!list.length){w.innerHTML='<div class="note">(empty) 完整剧本上传发版后列出每个游戏有多少人在读</div>';return;}
 w.innerHTML=list.map(function(g){return '<div class="row"><span class="t">'+esc(g.title)+(g.full?' <span class="r">[full]</span>':'')+(g.step?' <span class="d">'+esc(g.step)+'</span>':'')+'</span><span class="c">'+fmt(g.reporters)+'</span></div>';}).join("");}

var logs=[];
function log(m,err){logs.unshift('<div'+(err?' class="r"':'')+'>['+new Date().toTimeString().slice(0,8)+'] '+m+'</div>');logs=logs.slice(0,4);$("log").innerHTML=logs.join("");}
function jolt(){if(reduce)return;var n=$("name");n.classList.remove("jolt");void n.offsetWidth;n.classList.add("jolt");}
setInterval(jolt,4100);

function raceStats(){return Promise.any(ENDPOINTS.map(function(u){return fetch(u,{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.json().then(function(j){j.__src=u;return j;});});}));}
var prev=null;
function apply(j){
 if(prev!=null){var d=j.online-prev;$("delta").innerHTML=d>0?'<span class="r">+'+d+'</span> since last poll':d<0?'<span class="r">'+d+'</span> since last poll':'no change';if(d!==0)jolt();}
 else $("delta").textContent="first poll";
 prev=j.online;setBig(j.online);renderStats(j);renderDumps(j.full);renderTop(j.top);
 var host=(j.__src||"").indexOf("cn-")>=0?"cn":(j.__src?"global":"local");
 $("status").textContent="-- linked · node "+host;
 log("GET /api/probe/stats 200 · online="+j.online+" games="+j.probedGames);}
function tick(){raceStats().then(apply).catch(function(){$("status").textContent="-- link lost";log("GET /api/probe/stats failed · retry",true);});}

var LINES=["$ ssh dedsec@relay.megulit","connected.","$ watch megulit --online"];
function boot(){var b=$("boot"),tw=$("tw");if(reduce){b.className="off";start();return;}
 var li=0,ci=0,done="";(function step(){if(li>=LINES.length){setTimeout(function(){b.className="off";start();},250);return;}
  var t=LINES[li];if(ci<=t.length){tw.innerHTML=done+'<div>'+esc(t.slice(0,ci))+'<span class="cur"></span></div>';ci++;setTimeout(step,ci===1?120:28);}
  else{done+='<div>'+esc(t)+'</div>';li++;ci=0;setTimeout(step,140);}})();}
function start(){var left=PERIOD;
 setInterval(function(){var d=new Date();$("clock").textContent=d.toTimeString().slice(0,8);
  $("date").textContent=d.getFullYear()+"."+String(d.getMonth()+1).padStart(2,"0")+"."+String(d.getDate()).padStart(2,"0");
  if(--left<=0){left=PERIOD;tick();}$("count").textContent=left;},1000);
 renderStats({});renderDumps({});setBig("--");log("tail started");tick();}
boot();
</script>

</body>
</html>`;
