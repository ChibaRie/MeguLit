// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-16 beta live-usage dashboard served by the relay (GET /dashboard). Polls /api/probe/stats on both relay nodes
   (CORS open) every 15 s, shows the first answer and each node's latency. Phone: https://cn-api.megulit.com/dashboard.
   Operator console (btop/htop/tmux idiom), black + red. */
export const DASHBOARD_HTML=String.raw`<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MeguLit Live Ops</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Silkscreen&family=DotGothic16&display=swap">

<style>
/* operator console in the btop / htop / tmux idiom: titled hairline panes, aligned columns, bar meters, sparklines,
   a request log with latency. Black and one red. Code mono for data, small pixel caps for labels, pixel CJK. */
:root{--bg:#070707;--pane:#0b0b0b;--line:#262626;--line2:#1a1a1a;--fg:#cfcfcf;--hi:#f2f2f2;--dim:#626262;--dim2:#3a3a3a;--red:#e0303e;--ok:#5b9a6b;
  --mono:"JetBrains Mono","DotGothic16",ui-monospace,Menlo,Consolas,monospace;--px:"Silkscreen",ui-monospace,monospace;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--fg);font-family:var(--mono);font-size:13px;line-height:1.55;font-variant-numeric:tabular-nums;
  padding-left:max(12px,env(safe-area-inset-left,0px));padding-right:max(12px,env(safe-area-inset-right,0px));padding-block:0 28px;overflow-x:hidden}
.r{color:var(--red)}.d{color:var(--dim)}.h{color:var(--hi)}.dd{color:var(--dim2)}.g{color:var(--ok)}
.wrap{max-width:1040px;margin:0 auto}

/* tmux status line */
.tmux{display:flex;align-items:center;margin:10px 0 12px;background:#111;border:1px solid var(--line2);font-size:12px;white-space:nowrap;overflow:hidden}
.tmux>span{padding:3px 10px}
.tmux .sess{background:var(--red);color:#000;font-family:var(--px);font-size:10px;letter-spacing:.06em;padding:4px 10px}
.tmux .win{color:var(--dim)}.tmux .win.on{color:var(--hi);background:#1b1b1b}
.tmux .sp{flex:1}.tmux .host{color:var(--dim)}
.tmux .clk{color:var(--hi);border-left:1px solid var(--line)}
.gl{position:relative;display:inline-block}
.gl::before,.gl::after{content:attr(data-t);position:absolute;inset:0;padding:inherit;overflow:hidden}
.gl::before{animation:g1 3.1s steps(1) infinite;background:var(--red);color:#000}
.gl::after{animation:g2 4.3s steps(1) infinite;color:var(--hi)}
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
.spark{margin-top:12px;color:var(--red);white-space:pre;overflow:hidden;font-size:14px;line-height:1}
.axis{display:flex;justify-content:space-between;color:var(--dim2);font-size:10px;margin-top:3px}
.cap{color:var(--dim);font-size:12px;margin-top:8px}

/* meters, htop style */
.m{display:grid;grid-template-columns:8em 1fr auto;gap:10px;align-items:center;padding:2px 0}
.m .k{color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m .bar{white-space:pre;overflow:hidden;color:var(--dim2)}
.m .bar i{font-style:normal;color:var(--red)}
.m .v{color:var(--hi);min-width:4ch;text-align:right}
.sep{border-top:1px dashed var(--line);margin:8px 0}

/* full dumps counters */
.cnt{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px}
.cnt>div{border:1px solid var(--line2);padding:6px 8px}
.cnt .v{font-size:22px;line-height:1.1;color:var(--hi)}
.cnt .v.r{color:var(--red)}
.cnt .k{color:var(--dim);font-size:11px}
.kv{display:grid;grid-template-columns:8em 1fr;gap:2px 10px;font-size:12px}
.kv .k{color:var(--dim)}

/* tables */
table{width:100%;border-collapse:collapse;font-size:12px}
th{font-family:var(--px);font-size:9px;letter-spacing:.06em;color:var(--dim);font-weight:400;text-align:left;padding:2px 6px 5px;border-bottom:1px solid var(--line)}
th.rt,td.rt{text-align:right}
td{padding:4px 6px;border-bottom:1px solid var(--line2);vertical-align:top}
td.n{color:var(--dim);width:3ch}td.v{color:var(--red);white-space:nowrap}
td.t{color:var(--hi);word-break:break-word}
td.s{color:var(--dim);white-space:nowrap;font-size:11px}
td.z{color:var(--fg);white-space:nowrap}
tbody tr:hover td{background:#121212}
.tag{color:#000;background:var(--red);font-size:10px;padding:0 4px;margin-left:6px}
.st{display:inline-block;font-size:10px;padding:0 5px;border:1px solid var(--dim2);color:var(--dim)}
.st.ready{border-color:var(--red);color:var(--red)}.st.uploading{border-color:var(--hi);color:var(--hi)}.st.done{border-color:var(--ok);color:var(--ok)}
.empty{color:var(--dim);font-size:12px;padding:4px 0}
@media(max-width:520px){.hide-s{display:none}}

/* log */
.log{font-size:12px;max-height:9.5em;overflow:hidden}
.log div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv{display:inline-block;width:3.2ch}.lv.i{color:var(--ok)}.lv.e{color:var(--red)}
.ms{color:var(--dim)}
.lat{color:var(--red);white-space:pre;font-size:12px;line-height:1;margin-bottom:6px;overflow:hidden}

/* vim-ish footer */
.vim{display:flex;margin-top:14px;border:1px solid var(--line2);font-size:11px;white-space:nowrap;overflow:hidden;background:#0e0e0e}
.vim>span{padding:3px 9px}
.vim .md{background:var(--hi);color:#000;font-family:var(--px);font-size:9px;padding:4px 9px}
.vim .md.err{background:var(--red)}
.vim .sp{flex:1}
.vim .cur::after{content:"";display:inline-block;width:.55em;height:1em;background:var(--red);vertical-align:-2px;margin-left:4px;animation:bl 1s steps(1) infinite}
@keyframes bl{50%{opacity:0}}
#boot{position:fixed;inset:0;z-index:9;background:var(--bg);padding:16px max(14px,env(safe-area-inset-left,0px));font-size:13px;color:var(--fg)}
#boot .ok{color:var(--ok)}#boot.off{display:none}
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
      <div class="m"><span class="k">reporters</span><span class="bar"></span><span class="v" id="v4">--</span></div>
      <div class="m"><span class="k">per game</span><span class="bar"></span><span class="v" id="v5">--</span></div>
    </section>

    <section class="pane">
      <span class="ti">┤ <b>full dumps</b> ├</span><span class="tr">完整剧本上传</span>
      <div class="cnt">
        <div><div class="v r" id="fReady">--</div><div class="k">ready 待适配</div></div>
        <div><div class="v" id="fUp">--</div><div class="k">uploading 上传中</div></div>
        <div><div class="v" id="fDone">--</div><div class="k">done 已适配</div></div>
      </div>
      <div class="m"><span class="k">r2</span><span class="bar" id="bR2"></span><span class="v" id="vR2">--</span></div>
      <div class="kv" style="margin-top:6px">
        <span class="k">stored</span><span id="fMB">--</span>
        <span class="k">avg / dump</span><span id="fAvg">--</span>
        <span class="k">last upload</span><span id="fLast">--</span>
      </div>
    </section>

    <section class="pane">
      <span class="ti">┤ <b>why</b> ├</span><span class="tr">读不好的原因</span>
      <div id="steps"><div class="empty">-- no data</div></div>
    </section>

    <section class="pane wide">
      <span class="ti">┤ <b>targets</b> ├</span><span class="tr">多少人在读</span>
      <div id="top"><div class="empty">-- no rows</div></div>
    </section>

    <section class="pane">
      <span class="ti">┤ <b>recent</b> ├</span><span class="tr">ls -lt full_dumps/</span>
      <div id="recent"><div class="empty">-- no uploads yet</div></div>
    </section>

    <section class="pane">
      <span class="ti">┤ <b>relay.log</b> ├</span><span class="tr" id="latT">latency</span>
      <div class="lat" id="lat"></div>
      <div class="log" id="log"></div>
    </section>
  </div>

  <div class="vim"><span class="md" id="mode">LINK</span><span id="ep">GET /api/probe/stats</span><span class="d" id="code">--</span><span class="sp"></span><span class="d" id="node">--</span><span>poll <span id="count">15</span>s<span class="cur"></span></span></div>
</div>

<script>
"use strict";
var NODES=[["cn-api","https://cn-api.megulit.com/api/probe/stats"],["api","https://api.megulit.com/api/probe/stats"]];
var PERIOD=15,HIST=60;
var $=function(id){return document.getElementById(id);};
var reduce=matchMedia("(prefers-reduced-motion:reduce)").matches;
function fmt(n){return (n==null||isNaN(n))?"--":String(n);}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}
function ago(sec){if(!sec)return "--";var s=Math.max(0,Math.floor(Date.now()/1000-sec));if(s<60)return s+"s ago";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h"+String(Math.floor(s%3600/60)).padStart(2,"0")+"m ago";return Math.floor(s/86400)+"d ago";}
function mb(v){return v==null?"--":(v>=1024?(v/1024).toFixed(2)+" GB":v.toFixed(1)+" MB");}

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
function cols(el,cw){return Math.max(8,Math.floor(el.clientWidth/cw));}
function meter(el,v,max){var w=cols(el,7.9)-2,n=max>0?Math.round(Math.min(1,(v||0)/max)*w):0;
 el.innerHTML="["+"<i>"+"|".repeat(n)+"</i>"+" ".repeat(Math.max(0,w-n))+"]";}

/* sparklines from this viewer's own samples */
function load(k){try{return JSON.parse(localStorage.getItem(k)||"[]").filter(function(p){return Date.now()-p[0]<HIST*PERIOD*1000;});}catch(e){return [];}}
function keep(k,a){try{localStorage.setItem(k,JSON.stringify(a));}catch(e){}}
var hist=load("ml-online-hist"),lath=load("ml-lat-hist");
var BARS=["▁","▂","▃","▄","▅","▆","▇","█"];
function sparkStr(el,vals,cw){var w=cols(el,cw),v=vals.slice(-w),mx=Math.max(1,Math.max.apply(null,v.concat([0])));
 return '<span class="dd">'+"▁".repeat(Math.max(0,w-v.length))+"</span>"+v.map(function(x){return x<=0?'<span class="dd">▁</span>':BARS[Math.min(7,Math.max(1,Math.round(x/mx*7)))];}).join("");}
function spark(){var el=$("spark");el.innerHTML=sparkStr(el,hist.map(function(p){return p[1];}),8.4);$("ax0").textContent="-"+Math.round(cols(el,8.4)*PERIOD/60)+"m";
 var l=$("lat");l.innerHTML=sparkStr(l,lath.map(function(p){return p[1];}),7.3);}

var STEP_CN={"unknown-pack":"封包不认识","not-japanese":"不是日文","parse-failed":"解析失败","decrypt-failed":"解密失败","chinese-build":"汉化版","low-pairing":"中日配不上","timeout":"超时"};
function renderSteps(list){var w=$("steps");
 if(!list||!list.length){w.innerHTML='<div class="empty">-- no data</div>';return;}
 var mx=Math.max.apply(null,list.map(function(s){return s.n;}));
 w.innerHTML=list.map(function(s,i){return '<div class="m"><span class="k" title="'+esc(s.step)+'">'+esc(s.step)+'</span><span class="bar" id="sb'+i+'"></span><span class="v">'+s.n+'</span></div>';}).join("")+
  '<div class="cap">'+list.map(function(s){return STEP_CN[s.step]?esc(s.step)+" = "+STEP_CN[s.step]:"";}).filter(Boolean).join(" · ")+'</div>';
 list.forEach(function(s,i){meter($("sb"+i),s.n,mx);});}
function stateTag(s){return '<span class="st '+esc(s)+'">'+esc(s||"-")+'</span>';}
function renderTop(list){var w=$("top");
 if(!list||!list.length){w.innerHTML='<div class="empty">-- no rows</div>';return;}
 w.innerHTML='<table><thead><tr><th>#</th><th>title</th><th class="hide-s">why</th><th class="rt hide-s">size</th><th>state</th><th class="rt">ppl</th></tr></thead><tbody>'+list.map(function(g,i){
  return '<tr><td class="n">'+(i+1)+'</td><td class="t">'+esc(g.title)+(g.full?'<span class="tag">full</span>':'')+'</td><td class="s hide-s">'+esc(g.step||"-")+'</td><td class="z rt hide-s">'+(g.mb!=null?mb(g.mb):"-")+'</td><td>'+stateTag(g.state)+'</td><td class="v rt">'+fmt(g.reporters)+'</td></tr>';}).join("")+'</tbody></table>';}
function renderRecent(list){var w=$("recent");
 if(!list||!list.length){w.innerHTML='<div class="empty">-- no uploads yet</div>';return;}
 w.innerHTML='<table><tbody>'+list.map(function(g){return '<tr><td class="s">'+ago(g.at)+'</td><td>'+stateTag(g.state)+'</td><td class="z rt">'+mb(g.mb)+'</td><td class="t">'+esc(g.title)+'</td></tr>';}).join("")+'</tbody></table>';}

var logs=[];
function log(level,msg){logs.unshift('<div><span class="d">'+new Date().toTimeString().slice(0,8)+'</span> <span class="lv '+(level==="ERR"?"e":"i")+'">'+level+'</span> '+msg+'</div>');logs=logs.slice(0,6);$("log").innerHTML=logs.join("");}
function kick(){if(reduce)return;var n=$("name");n.classList.remove("kick");void n.offsetWidth;n.classList.add("kick");}

/* both relay nodes are hit every poll; the first good answer is shown, each node's latency is kept */
var lat={};
function poll(){var t0=performance.now();
 var reqs=NODES.map(function(n){return fetch(n[1],{cache:"no-store"}).then(function(r){var ms=Math.round(performance.now()-t0);lat[n[0]]=r.ok?ms:-1;if(!r.ok)throw 0;
  return r.json().then(function(j){j.__node=n[0];j.__ms=ms;j.__code=r.status;return j;});},function(e){lat[n[0]]=-1;throw e;});});
 return {first:Promise.any(reqs),all:Promise.allSettled(reqs)};}
var prev=null,peak=0,since=Date.now(),last=null;
function apply(j){
 var on=j.online|0;hist.push([Date.now(),on]);hist=hist.slice(-HIST);keep("ml-online-hist",hist);
 lath.push([Date.now(),j.__ms]);lath=lath.slice(-HIST);keep("ml-lat-hist",lath);
 peak=Math.max(peak,Math.max.apply(null,hist.map(function(p){return p[1];})));
 if(prev!=null){var d=on-prev;$("delta").innerHTML=d>0?'<span class="r">+'+d+'</span>':d<0?'<span class="r">'+d+'</span>':'<span class="d">0</span>';if(d!==0){kick();since=Date.now();}}
 else $("delta").innerHTML='<span class="d">0</span>';
 prev=on;setBig(on);$("peak").textContent=peak;last=j;render(j);
 $("host").textContent="relay ─ "+j.__node;$("code").textContent=j.__code+" · "+j.__ms+"ms";$("mode").textContent="LINK";$("mode").className="md";
 log("INF",'GET /api/probe/stats <span class="h">'+j.__code+'</span> <span class="ms">'+j.__ms+'ms '+j.__node+'</span> online=<span class="r">'+on+'</span> 1h='+j.active1h+' ready='+((j.full||{}).ready|0));}
function render(j){spark();
 var today=Math.max(j.today|0,1);
 meter($("b1"),j.active1h,today);$("v1").textContent=fmt(j.active1h);
 $("b2").innerHTML='<span class="d">1h/today '+(j.today?Math.round((j.active1h|0)/j.today*100):0)+'%</span>';$("v2").textContent=fmt(j.today);
 var f=j.full||{};
 $("b3").innerHTML='<span class="d">'+(f.games|0)+' with full dump</span>';$("v3").textContent=fmt(j.probedGames);
 $("v4").textContent=fmt(j.reporters);$("v5").textContent=j.probedGames?(j.reporters/j.probedGames).toFixed(2):"--";
 $("fReady").textContent=fmt(f.ready);$("fUp").textContent=fmt(f.uploading);$("fDone").textContent=fmt(f.done);
 meter($("bR2"),f.storedMB||0,f.limitMB||8192);$("vR2").textContent=((f.storedMB||0)/(f.limitMB||8192)*100).toFixed(1)+"%";
 $("fMB").innerHTML=mb(f.storedMB||0)+' <span class="d">/ '+mb(f.limitMB||8192)+'</span>';
 $("fAvg").textContent=f.ready?mb((f.storedMB||0)/f.ready):"--";$("fLast").textContent=ago(f.lastAt);
 renderSteps(j.steps);renderTop(j.top);renderRecent(j.recent);}
function nodesLine(){$("node").innerHTML=NODES.map(function(n){var v=lat[n[0]];return n[0]+" "+(v==null?"--":v<0?'<span class="r">down</span>':v+"ms");}).join(" · ");
 var ok=NODES.filter(function(n){return lat[n[0]]>0;}).map(function(n){return lat[n[0]];});$("latT").textContent=ok.length?"latency "+Math.min.apply(null,ok)+"ms":"latency";}
function tick(){var p=poll();p.first.then(apply).catch(function(){$("mode").textContent="DOWN";$("mode").className="md err";$("code").textContent="timeout";log("ERR","GET /api/probe/stats failed on every node · retry in "+PERIOD+"s");});p.all.then(nodesLine);}
addEventListener("resize",function(){if(last)render(last);else spark();});

var LINES=[['$ ssh op@relay.megulit.com',''],['  authenticated · ed25519','ok'],['$ tmux attach -t megulit',''],['  attached','ok']];
function boot(){var b=$("boot"),tw=$("tw");if(reduce){b.className="off";start();return;}
 var li=0,ci=0,done="";(function step(){if(li>=LINES.length){setTimeout(function(){b.className="off";start();},180);return;}
  var t=LINES[li][0],cls=LINES[li][1];if(ci<=t.length){tw.innerHTML=done+'<div class="'+cls+'">'+esc(t.slice(0,ci))+'█</div>';ci++;setTimeout(step,ci===1?90:18);}
  else{done+='<div class="'+cls+'">'+esc(t)+'</div>';li++;ci=0;setTimeout(step,110);}})();}
function start(){var left=PERIOD;
 setInterval(function(){$("clock").textContent=new Date().toTimeString().slice(0,8);$("since").textContent=Math.floor((Date.now()-since)/1000)+"s";
  if(last)$("fLast").textContent=ago((last.full||{}).lastAt);
  if(--left<=0){left=PERIOD;tick();}$("count").textContent=left;},1000);
 setInterval(kick,6200);setBig("--");spark();log("INF","session attached");tick();}
boot();
</script>

</body>
</html>`;
