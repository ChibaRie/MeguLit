// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-16 beta live-usage dashboard served by the relay (GET /dashboard, same-origin poll of /api/probe/stats).
   Phone: https://cn-api.megulit.com/dashboard (mainland) / https://api.megulit.com/dashboard. megu-edit x DedSec, pixel type. */
export const DASHBOARD_HTML=String.raw`<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MeguLit Live Ops</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=VT323&family=DotGothic16&display=swap">

<style>
/* megu-edit x DedSec. Two poles (black / paper), one accent (MeguLit red). DedSec's 1-bit dithered pixel stickers carry the
   marks (logo, live number); megu-edit carries the text and rhythm: tiny lowercase wide-tracked typed lines, a roman serif
   glow line, paper PiP cards with blueprint rules, barcode + speed-line hits, single-frame flash / invert. */
:root{
  --black:#000; --paper:#f4f4f2; --ink:#111; --dim:#8a8a8a; --dim2:#4a4a4a; --red:#c8323c;
  --serif:"VT323","DotGothic16",ui-monospace,monospace;
  --mono:"VT323","DotGothic16",ui-monospace,monospace;
  color-scheme:dark;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--black);color:var(--paper);font-family:var(--mono);font-weight:400;
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:0 52px;overflow-x:hidden}
.grain{position:fixed;inset:-50%;z-index:30;pointer-events:none;opacity:.07;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  animation:grain .8s steps(6) infinite}
@keyframes grain{0%{transform:translate(0,0)}25%{transform:translate(-3%,2%)}50%{transform:translate(2%,-3%)}75%{transform:translate(-2%,-1%)}100%{transform:translate(1%,3%)}}
.wrap{max-width:760px;margin:0 auto;position:relative}
.wrap.in{animation:push .9s cubic-bezier(.16,1,.3,1) both}
@keyframes push{from{transform:scale(1.06);filter:blur(6px)}to{transform:none;filter:none}}

/* tiny lowercase wide-tracked caption, megu-edit */
.tiny{font-size:16px;letter-spacing:.14em;text-transform:lowercase;color:var(--dim)}
.cur::after{content:"\25AE";color:var(--red);margin-left:.15em;animation:bl 1s steps(1) infinite}
@keyframes bl{50%{opacity:0}}

/* boot: black silence, typed line, white flash */
#boot{position:fixed;inset:0;z-index:60;background:#000;display:grid;place-items:center;padding:24px}
#boot .tw{font-size:17px;letter-spacing:.18em;color:var(--paper);text-transform:lowercase;line-height:2.2;max-width:460px;width:100%}
#boot .tw .r{color:var(--red)}
#flash{position:fixed;inset:0;z-index:70;background:var(--paper);pointer-events:none;opacity:0}
#flash.on{opacity:1}
#boot.off{display:none}

/* header */
.top{display:flex;flex-direction:column;gap:14px;padding-top:16px}
.logo{image-rendering:pixelated;image-rendering:crisp-edges;width:min(100%,460px);height:auto;display:block;margin-left:-4px}
.badge{display:flex;justify-content:space-between;align-items:center;gap:10px}
.badge .pl{display:flex;align-items:center;gap:8px;border:1px solid var(--paper);padding:5px 9px 5px 7px;font-size:16px;letter-spacing:.14em;text-transform:lowercase}
.badge .pl i{width:8px;height:8px;background:var(--red);display:block;animation:bl 1.1s steps(1) infinite}
.badge .when{display:flex;align-items:baseline;gap:10px}
.badge .tm{font-family:var(--serif);font-style:normal;font-size:26px;line-height:1;color:var(--paper);text-shadow:0 0 14px rgba(244,244,242,.35)}

/* hero */
.hero{position:relative;margin-top:26px;padding:6px 0 4px;min-height:150px}
.hero .burst{position:absolute;left:-10%;top:-30%;width:120%;height:160%;pointer-events:none;opacity:0}
.hero.hit .burst{animation:burst .5s cubic-bezier(.16,1,.3,1)}
@keyframes burst{0%{opacity:.9;transform:scale(.85)}100%{opacity:0;transform:scale(1.15)}}
.numrow{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;position:relative}
#num{image-rendering:pixelated;image-rendering:crisp-edges;height:clamp(120px,34vw,200px);width:auto;display:block}
.hero.inv{filter:invert(1)}
.lead{padding-bottom:8px;min-width:0}
.lead .glow{font-family:var(--serif);font-style:normal;font-weight:500;font-size:clamp(34px,9vw,52px);line-height:1;color:var(--paper);
  text-shadow:0 0 18px rgba(244,244,242,.45),0 0 2px #fff;text-transform:lowercase}
.lead .tiny{display:block;margin-top:10px}
.lead .delta{display:block;margin-top:6px;font-size:16px;letter-spacing:.14em;color:var(--paper)}
.lead .delta b{color:var(--red);font-weight:500}
.barcode{height:14px;margin-top:14px;background:repeating-linear-gradient(90deg,var(--paper) 0 2px,transparent 2px 5px,var(--paper) 5px 6px,transparent 6px 9px,var(--paper) 9px 13px,transparent 13px 15px);opacity:.85;
  -webkit-mask-image:linear-gradient(90deg,#000 0 70%,transparent);mask-image:linear-gradient(90deg,#000 0 70%,transparent)}
.hero.hit .barcode{animation:bar .4s steps(4)}
@keyframes bar{0%{background-position:0 0}100%{background-position:60px 0}}

/* paper PiP cards with blueprint rules */
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:22px}
@media(max-width:560px){.cards{grid-template-columns:repeat(2,1fr)}}
.card{position:relative;background:var(--paper);color:var(--ink);padding:12px 12px 10px;
  background-image:linear-gradient(rgba(17,17,17,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(17,17,17,.06) 1px,transparent 1px);background-size:12px 12px}
.card::before,.card::after{content:"";position:absolute;width:9px;height:9px;border-color:var(--ink);border-style:solid}
.card::before{top:4px;left:4px;border-width:1px 0 0 1px}
.card::after{bottom:4px;right:4px;border-width:0 1px 1px 0}
.card .n{font-family:var(--serif);font-style:normal;font-weight:400;font-size:clamp(48px,13vw,68px);line-height:.95;font-variant-numeric:tabular-nums}
.card .k{font-size:14px;letter-spacing:.14em;text-transform:lowercase;color:#555;margin-top:6px;border-top:1px dashed #999;padding-top:6px}
.card.acc .n{color:var(--red)}

/* sections */
.sec{margin-top:30px}
.sh{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.sh .t{font-size:17px;letter-spacing:.2em;text-transform:lowercase;color:var(--paper)}
.sh .z{font-size:14px;letter-spacing:.14em;color:var(--dim)}
.sh .rule{flex:1;border-top:1px dashed var(--dim2)}
/* wireframe -> filled on a hit */
.wires{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
@media(max-width:560px){.wires{grid-template-columns:repeat(2,1fr)}}
.wire{border:1px solid var(--dim2);padding:10px 12px;transition:background .25s,border-color .25s}
.wire .v{font-family:var(--serif);font-style:normal;font-size:34px;line-height:1;color:var(--paper)}
.wire .v small{font-family:var(--mono);font-style:normal;font-size:14px;letter-spacing:.2em;color:var(--dim)}
.wire .l{font-size:14px;letter-spacing:.14em;color:var(--dim);margin-top:6px;text-transform:lowercase}
.wire.full{background:var(--red);border-color:var(--red)}.wire.full .v,.wire.full .l,.wire.full .v small{color:var(--paper)}

/* list */
.row{display:grid;grid-template-columns:40px 1fr auto;gap:12px;align-items:baseline;padding:10px 0;border-bottom:1px dashed var(--dim2)}
.row .rk{font-family:var(--serif);font-style:normal;font-size:22px;color:var(--red)}
.row .tt{min-width:0;word-break:break-word;font-size:18px;font-weight:400;color:var(--paper);letter-spacing:.04em}
.row .tt .st{display:block;font-size:14px;letter-spacing:.14em;color:var(--dim);margin-top:3px}
.row .pp{font-family:var(--serif);font-style:normal;font-size:24px;color:var(--paper)}
.tag{font-size:13px;letter-spacing:.2em;background:var(--red);color:var(--paper);padding:1px 6px;margin-left:8px;vertical-align:2px}
.empty{border:1px dashed var(--dim2);padding:22px 14px;text-align:center;line-height:2}
.empty .glow{font-family:var(--serif);font-style:normal;font-size:22px;color:var(--paper);text-shadow:0 0 12px rgba(244,244,242,.35)}

/* log */
.log{margin-top:30px;border-left:2px solid var(--red);padding:4px 0 4px 12px;font-size:16px;letter-spacing:.18em;line-height:2;color:var(--dim);text-transform:lowercase;min-height:64px}
.log .ln{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.log .ln:first-child{color:var(--paper)}
.log .err{color:var(--red)}
.foot{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-top:12px}

/* glitch: rgb split + slice, on hits only */
.gl.hit2{animation:slice .34s steps(1) 1}
@keyframes slice{0%{clip-path:inset(0);transform:none;filter:none}
 25%{clip-path:inset(14% 0 56% 0);transform:translateX(-8px);filter:drop-shadow(4px 0 var(--red))}
 50%{clip-path:inset(52% 0 20% 0);transform:translateX(6px)}
 75%{clip-path:inset(30% 0 42% 0);transform:translateX(-3px)}
 100%{clip-path:inset(0);transform:none;filter:none}}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}

.lead .glow,.badge .tm,.row .rk,.row .pp,.wire .v,.card .n{-webkit-font-smoothing:none;font-smooth:never}
</style>
</head>
<body>

<div class="grain"></div>
<div id="flash"></div>
<div id="boot"><div class="tw" id="tw"></div></div>

<div class="wrap" id="wrap">
  <header class="top gl" id="hdr">
    <div class="badge"><span class="pl"><i></i>live</span><span class="when"><span class="tm" id="clock">--:--</span><span class="tiny" id="date">----.--.--</span></span></div>
    <canvas id="logo" class="logo" role="img" aria-label="MeguLit"></canvas>
  </header>

  <section class="hero gl" id="hero">
    <svg class="burst" viewBox="-100 -100 200 200" aria-hidden="true" preserveAspectRatio="none"><g id="rays" stroke="#f4f4f2" stroke-width=".6"></g></svg>
    <div class="numrow">
      <canvas id="num" role="img" aria-label="0"></canvas>
      <div class="lead">
        <div class="glow">people online</div>
        <span class="tiny cur" id="cap">正在用 megulit 的人 · 最近十分钟</span>
        <span class="delta" id="delta">// waiting for the next ping</span>
      </div>
    </div>
    <div class="barcode"></div>
  </section>

  <div class="cards">
    <div class="card"><div class="n" id="active1h">0</div><div class="k">一小时活跃</div></div>
    <div class="card"><div class="n" id="today">0</div><div class="k">今日活跃</div></div>
    <div class="card acc"><div class="n" id="games">0</div><div class="k">探针游戏</div></div>
    <div class="card"><div class="n" id="reporters">0</div><div class="k">上报人次</div></div>
  </div>

  <section class="sec">
    <div class="sh"><span class="t">full dumps</span><span class="z">完整剧本上传</span><span class="rule"></span></div>
    <div class="wires">
      <div class="wire" id="wReady"><div class="v" id="fReady">0</div><div class="l">待适配</div></div>
      <div class="wire" id="wUp"><div class="v" id="fUp">0</div><div class="l">上传中</div></div>
      <div class="wire" id="wDone"><div class="v" id="fDone">0</div><div class="l">已适配</div></div>
      <div class="wire"><div class="v"><span id="fMB">0</span><small> / <span id="fLimit">8192</span> mb</small></div><div class="l">r2 存储</div></div>
    </div>
  </section>

  <section class="sec">
    <div class="sh"><span class="t">targets</span><span class="z">多少人在读</span><span class="rule"></span></div>
    <div id="topWrap"><div class="empty"><div class="glow">scanning</div><div class="tiny">// …</div></div></div>
  </section>

  <div class="log" id="log"></div>
  <div class="foot"><span class="tiny" id="status">// standby</span><span class="tiny">poll <span id="count">15</span>s</span></div>
</div>

<script>
"use strict";
var ENDPOINTS=["/api/probe/stats"];
var PERIOD=15;
var $=function(id){return document.getElementById(id);};
var reduce=matchMedia("(prefers-reduced-motion:reduce)").matches;
function fmt(n){return (n==null||isNaN(n))?"--":String(n).replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});}

/* ---- DedSec 1-bit sticker, black and red: real letterforms (Anton) are set into a coarse cell grid, then every cell is
   red body or a black dot ('/' hatch near the top, ordered dither toward the bottom), cut out with a black gap and a
   stepped red sticker edge. Counters and letter gaps stay black. ---- */
var INK=[0,0,0,255],RED=[200,50,60,255],NONE=[0,0,0,0],BAY=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
function textMask(text,fs,stair,wt){var font=(wt||'700')+' '+fs+'px "Silkscreen",monospace',pad=10,c=document.createElement("canvas"),x=c.getContext("2d");
 x.font=font;var ws=[],tot=0;for(var i=0;i<text.length;i++){var w=x.measureText(text.charAt(i)).width;ws.push(w);tot+=w;}
 var W=Math.ceil(tot+pad*2),H=Math.ceil(fs*1.05+pad*2+stair*text.length);c.width=W;c.height=H;x.font=font;x.fillStyle="#fff";x.textBaseline="alphabetic";
 for(var j=0,cx=pad;j<text.length;j++){x.fillText(text.charAt(j),cx,pad+fs*.85+(text.length-1-j)*stair);cx+=ws[j];}
 var d=x.getImageData(0,0,W,H).data,m=new Uint8Array(W*H),top=H,bot=0;
 for(var k=0;k<W*H;k++)if(d[k*4+3]>128){m[k]=1;var yy=(k/W)|0;if(yy<top)top=yy;if(yy>bot)bot=yy;}
 return {W:W,H:H,m:m,top:top,h:Math.max(1,bot-top)};}
function sticker(cv,mk){var W=mk.W+12,H=mk.H+12,R=new Uint8Array(W*H);
 for(var y=0;y<mk.H;y++)for(var x=0;x<mk.W;x++)R[(y+6)*W+x+6]=mk.m[y*mk.W+x];
 var top=mk.top+6,fh=mk.h;function at(x,y){return (x>=0&&y>=0&&x<W&&y<H)?R[y*W+x]:0;}
 var out=new Array(W*H),D=new Uint8Array(W*H),EX=new Uint8Array(W*H),q=[];
 for(var y1=0;y1<H;y1++)for(var x1=0;x1<W;x1++){var k=y1*W+x1;
  if(R[k]){var s=Math.max(0,Math.min(1,(y1-top)/fh));
   out[k]=((((x1+y1)%6)===0&&s>.18)||(s>.55&&BAY[(y1&3)*4+(x1&3)]<(s-.55)/.45*16))?INK:RED;continue;}
  var dd=9;for(var yy=-6;yy<=6;yy++)for(var xx=-6;xx<=6;xx++)if(at(x1+xx,y1+yy))dd=Math.min(dd,Math.max(Math.abs(xx),Math.abs(yy)));D[k]=dd;out[k]=null;
  if((x1===0||y1===0||x1===W-1||y1===H-1)&&dd>=5){EX[k]=1;q.push(k);}}
 while(q.length){var i=q.pop(),qx=i%W,qy=(i-qx)/W;[[1,0],[-1,0],[0,1],[0,-1]].forEach(function(v){var nx=qx+v[0],ny=qy+v[1];if(nx<0||ny<0||nx>=W||ny>=H)return;var j=ny*W+nx;if(!EX[j]&&D[j]>=5){EX[j]=1;q.push(j);}});}
 function nearEx(x,y){for(var yy=-2;yy<=2;yy++)for(var xx=-2;xx<=2;xx++){var nx=x+xx,ny=y+yy;if(nx>=0&&ny>=0&&nx<W&&ny<H&&EX[ny*W+nx])return true;}return false;}
 var minx=W,miny=H,maxx=0,maxy=0;
 for(var y2=0;y2<H;y2++)for(var x2=0;x2<W;x2++){var k2=y2*W+x2;if(out[k2]===null){var e=D[k2];out[k2]=EX[k2]?NONE:(e<=1?INK:((e<=3&&nearEx(x2,y2))?RED:INK));}
  if(out[k2][3]){if(x2<minx)minx=x2;if(y2<miny)miny=y2;if(x2>maxx)maxx=x2;if(y2>maxy)maxy=y2;}}
 if(maxx<minx)return;var cw=maxx-minx+1,ch=maxy-miny+1;cv.width=cw;cv.height=ch;var ctx=cv.getContext("2d"),img=ctx.createImageData(cw,ch);
 for(var y3=0;y3<ch;y3++)for(var x3=0;x3<cw;x3++){var c=out[(y3+miny)*W+x3+minx],p=(y3*cw+x3)*4;img.data[p]=c[0];img.data[p+1]=c[1];img.data[p+2]=c[2];img.data[p+3]=c[3];}
 ctx.putImageData(img,0,0);}
function drawLogo(){sticker($("logo"),textMask("MEGULIT",80,5,"400"));}
function drawNum(text){sticker($("num"),textMask(text,96,0));$("num").setAttribute("aria-label",text);}

/* ---- motion helpers ---- */
(function(){var g=$("rays"),s="";for(var i=0;i<38;i++){var a=i/38*Math.PI*2,r1=42+Math.random()*16,r2=95+Math.random()*30;
 s+='<line x1="'+(Math.cos(a)*r1).toFixed(1)+'" y1="'+(Math.sin(a)*r1).toFixed(1)+'" x2="'+(Math.cos(a)*r2).toFixed(1)+'" y2="'+(Math.sin(a)*r2).toFixed(1)+'"/>';}g.innerHTML=s;})();
function retrig(el,cls){if(reduce||!el)return;el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);}
function hitHero(){retrig($("hero"),"hit");if(!reduce){$("hero").classList.add("inv");setTimeout(function(){$("hero").classList.remove("inv");},50);}}
setInterval(function(){retrig(Math.random()<.5?$("hero"):$("hdr"),"hit2");},5200);
var curNum="";
function scrambleNum(val){var target=String(val==null?"--":val);if(reduce||target===curNum){curNum=target;drawNum(target);return;}
 var i=0,t=setInterval(function(){i++;if(i>=8){clearInterval(t);curNum=target;drawNum(target);return;}
  var s="";for(var k=0;k<target.length;k++)s+=String(Math.floor(Math.random()*10));drawNum(s);},45);}
function scrambleTo(el,val){var target=fmt(val);if(reduce||el.textContent===target){el.textContent=target;return;}
 var i=0;clearInterval(el._t);el._t=setInterval(function(){i++;if(i>=8){clearInterval(el._t);el.textContent=target;return;}
  var s="";for(var k=0;k<target.length;k++){var c=target.charAt(k);s+=c===","?c:String(Math.floor(Math.random()*10));}el.textContent=s;},40);}

var logs=[];
function log(msg,cls){var t=new Date().toTimeString().slice(0,8);logs.unshift('<div class="ln '+(cls||"")+'">'+t+'  '+msg+'</div>');logs=logs.slice(0,3);$("log").innerHTML=logs.join("");}
function raceStats(){return Promise.any(ENDPOINTS.map(function(u){return fetch(u,{cache:"no-store"}).then(function(r){if(!r.ok)throw 0;return r.json().then(function(j){j.__src=u;return j;});});}));}

var prev=null;
function renderTop(list){var w=$("topWrap");
 if(!list||!list.length){w.innerHTML='<div class="empty"><div class="glow">no targets yet</div><div class="tiny">完整剧本上传发版后，这里列出每个游戏有多少人在读</div></div>';return;}
 w.innerHTML=list.map(function(g,i){return '<div class="row"><span class="rk">'+(i+1)+'</span><span class="tt">'+esc(g.title)+(g.full?'<span class="tag">full</span>':'')+(g.step?'<span class="st">'+esc(g.step)+'</span>':'')+'</span><span class="pp">'+fmt(g.reporters)+'</span></div>';}).join("");}
function wire(id,v){$(id).classList.toggle("full",(v|0)>0);}
function apply(j){
 var changed=prev!=null&&j.online!==prev;
 scrambleNum(j.online);
 if(prev!=null){var d=j.online-prev;$("delta").innerHTML=d>0?'<b>+'+d+'</b>  since last ping':d<0?'<b>'+d+'</b>  since last ping':'// steady';}
 if(changed||prev==null)hitHero();prev=j.online;
 scrambleTo($("active1h"),j.active1h);scrambleTo($("today"),j.today);scrambleTo($("games"),j.probedGames);scrambleTo($("reporters"),j.reporters);
 var f=j.full||{};scrambleTo($("fReady"),f.ready);scrambleTo($("fUp"),f.uploading);scrambleTo($("fDone"),f.done);wire("wReady",f.ready);wire("wUp",f.uploading);wire("wDone",f.done);
 $("fMB").textContent=f.storedMB==null?"--":f.storedMB;$("fLimit").textContent=fmt(f.limitMB||8192);
 renderTop(j.top);
 var host=(j.__src||"").indexOf("cn-")>=0?"cn":(j.__src?"global":"local");
 $("status").textContent="// linked · node "+host+" · "+new Date().toTimeString().slice(0,8);
 log("sync ok · "+j.online+" online · "+j.probedGames+" games");}
function tick(){raceStats().then(apply).catch(function(){$("status").textContent="// link lost · retrying";log("uplink dropped · retrying","err");});}

/* ---- boot: black silence -> typed lowercase lines -> single white flash -> push in ---- */
var LINES=["dedsec uplink // megulit beta","handshake <span class='r'>ok</span>","we are in."];
function typeLines(el,lines,done){var li=0,ci=0,html="";
 function plain(s){return s.replace(/<[^>]+>/g,"");}
 (function step(){if(li>=lines.length){done();return;}var full=lines[li],txt=plain(full);
  if(ci<=txt.length){el.innerHTML=html+"<div>"+(ci===txt.length?full:esc(txt.slice(0,ci)))+'<span style="color:var(--red)">▮</span></div>';ci++;setTimeout(step,ci===1?160:34);}
  else{html+="<div>"+full+"</div>";li++;ci=0;setTimeout(step,200);}})();}
function boot(){var b=$("boot");if(reduce){b.className="off";start();return;}
 typeLines($("tw"),LINES,function(){setTimeout(function(){var f=$("flash");f.className="on";b.className="off";$("wrap").classList.add("in");
  setTimeout(function(){f.className="";},70);start();},260);});}
function start(){var left=PERIOD;
 setInterval(function(){var d=new Date();$("clock").textContent=d.toTimeString().slice(0,5);
  $("date").textContent=d.getFullYear()+"."+String(d.getMonth()+1).padStart(2,"0")+"."+String(d.getDate()).padStart(2,"0");
  if(--left<=0){left=PERIOD;tick();}$("count").textContent=left;},1000);
 log("uplink established");tick();}
var drawn=false;function firstDraw(){if(drawn)return;drawn=true;drawLogo();drawNum(curNum||"0");}
(document.fonts&&document.fonts.load?Promise.all([document.fonts.load('700 64px "Silkscreen"'),document.fonts.load('400 64px "Silkscreen"')]).then(firstDraw,firstDraw):firstDraw());setTimeout(firstDraw,1500);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){drawLogo();if(curNum)drawNum(curNum);});
boot();
</script>

</body>
</html>`;
