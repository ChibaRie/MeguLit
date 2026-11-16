// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-16 beta live-usage dashboard served by the relay (GET /dashboard, same-origin poll of /api/probe/stats).
   Phone: https://cn-api.megulit.com/dashboard (mainland) / https://api.megulit.com/dashboard. Operator console (btop/htop/tmux idiom), black + red. */
export const DASHBOARD_HTML=String.raw`<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MeguLit Live Ops</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Silkscreen&family=DotGothic16&display=swap">

<style>
/* operator console in the btop / htop / tmux idiom: titled hairline panes, aligned columns, bar meters, a sparkline,
   a request log with latency. Black and one red. Code mono for data, small pixel caps for labels, pixel CJK. */
:root{--bg:#070707;--pane:#0b0b0b;--line:#262626;--line2:#1a1a1a;--fg:#cfcfcf;--hi:#f2f2f2;--dim:#626262;--dim2:#3a3a3a;--red:#e0303e;--red2:#7a1b23;
  --mono:"JetBrains Mono","DotGothic16",ui-monospace,Menlo,Consolas,monospace;--px:"Silkscreen",ui-monospace,monospace;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--fg);font-family:var(--mono);font-size:13px;line-height:1.55;font-variant-numeric:tabular-nums;
  padding-left:max(12px,env(safe-area-inset-left,0px));padding-right:max(12px,env(safe-area-inset-right,0px));padding-block:0 28px;overflow-x:hidden}
.r{color:var(--red)}.d{color:var(--dim)}.h{color:var(--hi)}.dd{color:var(--dim2)}
.wrap{max-width:980px;margin:0 auto}

/* tmux status line */
.tmux{display:flex;align-items:center;gap:0;margin:10px 0 12px;background:#111;border:1px solid var(--line2);font-size:12px;white-space:nowrap;overflow:hidden}
.tmux>span{padding:3px 10px}
.tmux .sess{background:var(--red);color:#000;font-family:var(--px);font-size:10px;letter-spacing:.06em;padding:4px 10px;position:relative}
.tmux .win{color:var(--dim)}.tmux .win.on{color:var(--hi);background:#1b1b1b}
.tmux .sp{flex:1}
.tmux .host{color:var(--dim)}
.tmux .clk{color:var(--hi);border-left:1px solid var(--line)}
/* the name glitches now and then */
.gl{position:relative;display:inline-block}
.gl::before,.gl::after{content:attr(data-t);position:absolute;inset:0;padding:inherit;overflow:hidden;color:#000}
.gl::before{animation:g1 3.1s steps(1) infinite;background:var(--red)}
.gl::after{animation:g2 4.3s steps(1) infinite;color:var(--hi);background:transparent}
@keyframes g1{0%,90%,100%{clip-path:inset(0 0 100% 0);transform:none}91%{clip-path:inset(0 0 50% 0);transform:translateX(-3px)}93%{clip-path:inset(55% 0 0 0);transform:translateX(2px)}95%{clip-path:inset(25% 0 45% 0);transform:translateX(-1px)}}
@keyframes g2{0%,84%,100%{clip-path:inset(0 0 100% 0);transform:none}85%{clip-path:inset(35% 0 30% 0);transform:translateX(3px)}87%{clip-path:inset(70% 0 5% 0);transform:translateX(-2px)}}
.gl.kick::before{animation:g1k .3s steps(1)}
@keyframes g1k{0%{clip-path:inset(0 0 40% 0);transform:translateX(-4px)}50%{clip-path:inset(50% 0 0 0);transform:translateX(3px)}100%{clip-path:inset(0 0 100% 0)}}

/* panes */
.grid{display:grid;grid-template-columns:1.25fr 1fr;gap:14px 12px}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
.pane{position:relative;border:1px solid var(--line);background:var(--pane);padding:16px 12px 10px;min-width:0}
.pane .ti{position:absolute;top:-8px;left:10px;background:var(--bg);padding:0 6px;font-family:var(--px);font-size:10px;letter-spacing:.06em;color:var(--hi);line-height:14px}
.pane .ti b{color:var(--red);font-weight:400}
.pane .tr{position:absolute;top:-8px;right:10px;background:var(--bg);padding:0 6px;font-size:11px;color:var(--dim);line-height:14px}
.pane.wide{grid-column:1/-1}

/* online */
.on-row{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap}
.big{margin:0;color:var(--red);font-family:var(--mono);font-size:clamp(9px,2.6vw,13px);line-height:1;letter-spacing:-.02em;white-space:pre;text-shadow:0 0 12px rgba(224,48,62,.35)}
.big.hit{animation:hit .28s steps(1)}
@keyframes hit{0%{transform:translateX(-3px);color:var(--hi)}40%{transform:translateX(2px)}100%{transform:none}}
.side{display:grid;grid-template-columns:auto auto;gap:0 12px;font-size:12px;align-content:end}
.side .k{color:var(--dim)}
.spark{margin-top:12px;color:var(--red);letter-spacing:0;white-space:pre;overflow:hidden;font-size:14px;line-height:1}
.spark .dd{color:var(--dim2)}
.axis{display:flex;justify-content:space-between;color:var(--dim2);font-size:10px;margin-top:3px}
.cap{color:var(--dim);font-size:12px;margin-top:8px}

/* meters, htop style */
.m{display:grid;grid-template-columns:7.5em 1fr auto;gap:10px;align-items:center;padding:2px 0}
.m .k{color:var(--dim)}
.m .bar{white-space:pre;overflow:hidden;color:var(--dim2)}
.m .bar i{font-style:normal;color:var(--red)}
.m .v{color:var(--hi);min-width:4ch;text-align:right}
.sep{border-top:1px dashed var(--line);margin:8px 0}

/* tables */
table{width:100%;border-collapse:collapse;font-size:12px}
th{font-family:var(--px);font-size:9px;letter-spacing:.06em;color:var(--dim);font-weight:400;text-align:left;padding:2px 6px 5px;border-bottom:1px solid var(--line)}
td{padding:4px 6px;border-bottom:1px solid var(--line2);vertical-align:top}
td.n{color:var(--dim);width:3ch}td.v{color:var(--red);text-align:right;white-space:nowrap}
td.t{color:var(--hi);word-break:break-word}
.tag{color:#000;background:var(--red);font-size:10px;padding:0 4px;margin-left:6px}
.empty{color:var(--dim);font-size:12px;padding:4px 0}

/* log */
.log{font-size:12px;max-height:9.5em;overflow:hidden}
.log div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv{display:inline-block;width:3.2ch}.lv.i{color:#5b9a6b}.lv.e{color:var(--red)}
.ms{color:var(--dim)}

/* vim-ish footer */
.vim{display:flex;gap:0;margin-top:14px;border:1px solid var(--line2);font-size:11px;white-space:nowrap;overflow:hidden;background:#0e0e0e}
.vim>span{padding:3px 9px}
.vim .md{background:var(--hi);color:#000;font-family:var(--px);font-size:9px;padding:4px 9px}
.vim .md.err{background:var(--red)}
.vim .sp{flex:1}
.vim .cur::after{content:"";display:inline-block;width:.55em;height:1em;background:var(--red);vertical-align:-2px;margin-left:4px;animation:bl 1s steps(1) infinite}
@keyframes bl{50%{opacity:0}}

#boot{position:fixed;inset:0;z-index:9;background:var(--bg);padding:16px max(14px,env(safe-area-inset-left,0px));font-size:13px;color:var(--fg)}
#boot .ok{color:#5b9a6b}#boot.off{display:none}
@media(max-width:520px){.tmux .win:not(.on),.tmux .host,.vim #ep{display:none}}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
</head>
<body>

<div id="boot"><div id="tw"></div></div>

<div class="wrap">
  <div class="tmux">
    <span class="sess gl" id="name" data-t="MEGULIT">MEGULIT</span>
    <span class="win on">0:live*</span><span class="win">1:dumps</span><span class="win">2:log</span>
    <span class="sp"></span>
    <span class="host" id="host">relay ─</span>
    <span class="clk" id="clock">--:--:--</span>
  </div>

  <div class="grid">
    <section class="pane">
      <span class="ti">┤ <b>online</b> ├</span><span class="tr">last 10 min</span>
      <div class="on-row">
        <pre class="big" id="big" aria-label="online"></pre>
        <div class="side">
          <span class="k">peak</span><span class="h" id="peak">--</span>
          <span class="k">Δ poll</span><span id="delta">--</span>
          <span class="k">since</span><span class="d" id="since">--</span>
        </div>
      </div>
      <div class="spark" id="spark"></div>
      <div class="axis"><span id="ax0">-15m</span><span>now</span></div>
      <div class="cap">正在用 MeguLit 的人 · 每 15 秒采样</div>
    </section>

    <section class="pane">
      <span class="ti">┤ <b>stats</b> ├</span><span class="tr">/api/probe/stats</span>
      <div class="m"><span class="k">active 1h</span><span class="bar" id="b1"></span><span class="v" id="v1">--</span></div>
      <div class="m"><span class="k">active today</span><span class="bar" id="b2"></span><span class="v" id="v2">--</span></div>
      <div class="sep"></div>
      <div class="m"><span class="k">probed games</span><span class="bar" id="b3"></span><span class="v" id="v3">--</span></div>
      <div class="m"><span class="k">reporters</span><span class="bar" id="b4"></span><span class="v" id="v4">--</span></div>
      <div class="m"><span class="k">per game</span><span class="bar d" id="b5"></span><span class="v" id="v5">--</span></div>
    </section>

    <section class="pane">
      <span class="ti">┤ <b>full dumps</b> ├</span><span class="tr">完整剧本上传</span>
      <table><thead><tr><th>state</th><th>count</th><th></th></tr></thead><tbody>
        <tr><td>ready</td><td class="v" id="fReady">--</td><td class="d">待适配</td></tr>
        <tr><td>uploading</td><td class="v" id="fUp">--</td><td class="d">上传中</td></tr>
        <tr><td>done</td><td class="v" id="fDone">--</td><td class="d">已适配</td></tr>
      </tbody></table>
      <div class="m" style="margin-top:8px"><span class="k">r2</span><span class="bar" id="bR2"></span><span class="v" id="vR2">--</span></div>
    </section>

    <section class="pane">
      <span class="ti">┤ <b>targets</b> ├</span><span class="tr">多少人在读</span>
      <div id="top"><div class="empty">-- no rows</div></div>
    </section>

    <section class="pane wide">
      <span class="ti">┤ <b>relay.log</b> ├</span><span class="tr">tail -f</span>
      <div class="log" id="log"></div>
    </section>
  </div>

  <div class="vim"><span class="md" id="mode">LINK</span><span id="ep">GET /api/probe/stats</span><span class="d" id="code">--</span><span class="sp"></span><span class="d" id="node">node --</span><span>poll <span id="count">15</span>s<span class="cur"></span></span></div>
</div>

<script>
"use strict";
var ENDPOINTS=["/api/probe/stats"];
var PERIOD=15,HIST=60;
var $=function(id){return document.getElementById(id);};
var reduce=matchMedia("(prefers-reduced-motion:reduce)").matches;
function fmt(n){return (n==null||isNaN(n))?"--":String(n);}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}

/* block digits */
var B="█",DIG={"0":["###","# #","# #","# #","###"],"1":[" # ","## "," # "," # ","###"],"2":["###","  #","###","#  ","###"],"3":["###","  #","###","  #","###"],
 "4":["# #","# #","###","  #","  #"],"5":["###","#  ","###","  #","###"],"6":["###","#  ","###","# #","###"],"7":["###","  #","  #","  #","  #"],
 "8":["###","# #","###","# #","###"],"9":["###","# #","###","  #","###"],"-":["   ","   ","###","   ","   "]};
function blocks(t){var rows=["","","","",""];for(var i=0;i<t.length;i++){var g=DIG[t.charAt(i)]||DIG["-"];for(var r=0;r<5;r++)rows[r]+=g[r].replace(/#/g,B+B).replace(/ /g,"  ")+(i<t.length-1?"  ":"");}return rows.join("\n");}
var shown="";
function setBig(v){var t=fmt(v),el=$("big");el.setAttribute("aria-label",t+" online");
 if(t===shown||reduce){shown=t;el.textContent=blocks(t);return;}
 var i=0,iv=setInterval(function(){i++;if(i>=7){clearInterval(iv);shown=t;el.textContent=blocks(t);el.classList.remove("hit");void el.offsetWidth;el.classList.add("hit");return;}
  var s="";for(var k=0;k<t.length;k++)s+=String(Math.floor(Math.random()*10));el.textContent=blocks(s);},45);}

/* htop meter */
function meter(id,v,max){var el=$(id),w=Math.max(8,Math.floor(el.clientWidth/7.9)-2),n=max>0?Math.round(Math.min(1,(v||0)/max)*w):0;
 el.innerHTML="["+"<i>"+"|".repeat(n)+"</i>"+" ".repeat(Math.max(0,w-n))+"]";}

/* sparkline from this viewer's own samples (kept per viewer) */
var hist=[];try{hist=JSON.parse(localStorage.getItem("ml-online-hist")||"[]").filter(function(p){return Date.now()-p[0]<HIST*PERIOD*1000;});}catch(e){hist=[];}
var BARS=["▁","▂","▃","▄","▅","▆","▇","█"];
function spark(){var el=$("spark"),w=Math.max(16,Math.floor(el.clientWidth/8.4)),vals=hist.slice(-w).map(function(p){return p[1];}),mx=Math.max(1,Math.max.apply(null,vals.concat([0])));
 var pad=w-vals.length,s='<span class="dd">'+"▁".repeat(Math.max(0,pad))+"</span>";
 s+=vals.map(function(v){return v<=0?'<span class="dd">▁</span>':BARS[Math.min(7,Math.max(1,Math.round(v/mx*7)))];}).join("");
 el.innerHTML=s;var mins=Math.round(w*PERIOD/60);$("ax0").textContent="-"+mins+"m";}

function renderTop(list){var w=$("top");
 if(!list||!list.length){w.innerHTML='<div class="empty">-- no rows · 完整剧本上传发版后列出每个游戏有多少人在读</div>';return;}
 w.innerHTML='<table><thead><tr><th>#</th><th>title</th><th style="text-align:right">ppl</th></tr></thead><tbody>'+list.map(function(g,i){
  return '<tr><td class="n">'+(i+1)+'</td><td class="t">'+esc(g.title)+(g.full?'<span class="tag">full</span>':'')+(g.step?' <span class="d">'+esc(g.step)+'</span>':'')+'</td><td class="v">'+fmt(g.reporters)+'</td></tr>';}).join("")+'</tbody></table>';}

var logs=[];
function log(level,msg){logs.unshift('<div><span class="d">'+new Date().toTimeString().slice(0,8)+'</span> <span class="lv '+(level==="ERR"?"e":"i")+'">'+level+'</span> '+msg+'</div>');logs=logs.slice(0,6);$("log").innerHTML=logs.join("");}
function kick(){if(reduce)return;var n=$("name");n.classList.remove("kick");void n.offsetWidth;n.classList.add("kick");}

function raceStats(){var t0=performance.now();return Promise.any(ENDPOINTS.map(function(u){return fetch(u,{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.json().then(function(j){j.__src=u;j.__ms=Math.round(performance.now()-t0);j.__code=r.status;return j;});});}));}
var prev=null,peak=0,since=Date.now(),last=null;
function apply(j){
 var on=j.online|0;hist.push([Date.now(),on]);hist=hist.slice(-HIST);try{localStorage.setItem("ml-online-hist",JSON.stringify(hist));}catch(e){}
 peak=Math.max(peak,on,Math.max.apply(null,hist.map(function(p){return p[1];})));
 if(prev!=null){var d=on-prev;$("delta").innerHTML=d>0?'<span class="r">+'+d+'</span>':d<0?'<span class="r">'+d+'</span>':'<span class="d">0</span>';if(d!==0){kick();since=Date.now();}}
 else $("delta").innerHTML='<span class="d">0</span>';
 prev=on;setBig(on);$("peak").textContent=peak;last=j;render(j);
 var node=(j.__src||"").indexOf("cn-")>=0?"cn-api":(j.__src?"api":"local");
 $("node").textContent="node "+node;$("host").textContent="relay ─ "+node;$("code").textContent=j.__code+" · "+j.__ms+"ms";$("mode").textContent="LINK";$("mode").className="md";
 log("INF",'GET /api/probe/stats <span class="h">'+j.__code+'</span> <span class="ms">'+j.__ms+'ms</span> online=<span class="r">'+on+'</span> 1h='+j.active1h+' games='+j.probedGames);}
function render(j){spark();
 var top=Math.max(j.today|0,1);
 meter("b1",j.active1h,top);$("v1").textContent=fmt(j.active1h);
 $("b2").innerHTML='<span class="d">'+(j.today?'1h/today '+Math.round((j.active1h|0)/j.today*100)+'%':'')+'</span>';$("v2").textContent=fmt(j.today);
 $("b3").textContent="";$("v3").textContent=fmt(j.probedGames);
 $("b4").textContent="";$("v4").textContent=fmt(j.reporters);
 var per=j.probedGames?(j.reporters/j.probedGames):0;$("b5").textContent="";$("v5").textContent=per?per.toFixed(2):"--";
 var f=j.full||{};$("fReady").textContent=fmt(f.ready);$("fUp").textContent=fmt(f.uploading);$("fDone").textContent=fmt(f.done);
 meter("bR2",f.storedMB||0,f.limitMB||8192);$("vR2").textContent=((f.storedMB||0)/((f.limitMB||8192))*100).toFixed(1)+"%";
 renderTop(j.top);}
function tick(){raceStats().then(apply).catch(function(){$("mode").textContent="DOWN";$("mode").className="md err";$("code").textContent="timeout";log("ERR","GET /api/probe/stats failed · retry in "+PERIOD+"s");});}
function ago(ms){var s=Math.floor(ms/1000);return s<60?s+"s":Math.floor(s/60)+"m"+String(s%60).padStart(2,"0")+"s";}
addEventListener("resize",function(){if(last)render(last);else spark();});

var LINES=[['$ ssh op@relay.megulit.com',''],['  authenticated · ed25519','ok'],['$ tmux attach -t megulit',''],['  attached','ok']];
function boot(){var b=$("boot"),tw=$("tw");if(reduce){b.className="off";start();return;}
 var li=0,ci=0,done="";(function step(){if(li>=LINES.length){setTimeout(function(){b.className="off";start();},180);return;}
  var t=LINES[li][0],cls=LINES[li][1];if(ci<=t.length){tw.innerHTML=done+'<div class="'+cls+'">'+esc(t.slice(0,ci))+'█</div>';ci++;setTimeout(step,ci===1?90:18);}
  else{done+='<div class="'+cls+'">'+esc(t)+'</div>';li++;ci=0;setTimeout(step,110);}})();}
function start(){var left=PERIOD;
 setInterval(function(){$("clock").textContent=new Date().toTimeString().slice(0,8);$("since").textContent=ago(Date.now()-since);
  if(--left<=0){left=PERIOD;tick();}$("count").textContent=left;},1000);
 setInterval(kick,6200);setBig("--");spark();log("INF","session attached");tick();}
boot();
</script>

</body>
</html>`;
