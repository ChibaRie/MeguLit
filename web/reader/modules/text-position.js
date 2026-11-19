// SPDX-License-Identifier: GPL-3.0-or-later
// Live tracking of where the game draws its dialogue. Engine draw hooks report each line's extent in the engine's own
// units (hookTextPos, see ToMeTextPos.h). A position sync pairs those units with where the original text was measured
// on screen, once per game, which gives a scale and an offset (saved per game executable). With "follow original text
// coordinates" on, every new line then moves the text box to the mapped place; moves are previews, not saved settings.
(function install(){
 'use strict';const b=window.__tomoyoChinese;if(!b){document.addEventListener('DOMContentLoaded',install,{once:true});return;}if(b.textPosition)return;
 const send=m=>{try{window.__tomoyoTranslateRequest(JSON.stringify(m));}catch{}};
 const repaint=()=>window.__tomeStyleSyncPaint?.();
 let identity='',map=null,last=null,lastAt=0,cal=null,following=false,applied='';
 // Engine units are pixels of the game's own canvas: a value far outside any canvas means the hook read something that
 // is not a coordinate (an early ISLAND build reported a pointer), and must never move the text box.
 const unit=v=>Number.isFinite(v)&&Math.abs(v)<=20000;
 const plausibleMap=v=>!!v&&[v.s,v.bx,v.by,v.dx,v.dy].every(Number.isFinite)&&v.s>.1&&v.s<10&&Math.abs(v.bx)<=20000&&Math.abs(v.by)<=20000&&Math.abs(v.dx)<=20000&&Math.abs(v.dy)<=20000&&v.cw>0&&v.ch>0;
 const api={
  resetSession(nextIdentity){stateStyle.clear();readState='';map=last=cal=null;lastAt=0;following=false;applied='';if(nextIdentity!==undefined)identity=String(nextIdentity);b.lineColorReset?.();repaint();},
  refresh(){if(last)b.textPosition(last,true);},
  mapExtent(m){if(!plausibleMap(map)||map.engine!==m.engine)return null;const l=b.galLayoutInfo?.(),kx=(l?.clientWidth||map.cw)/map.cw,ky=(l?.clientHeight||map.ch)/map.ch;return {x:(map.s*m.x0+map.bx)*kx,y:(map.s*m.y0+map.by)*ky,width:map.s*(m.x1-m.x0+m.size)*kx,size:map.s*m.size*ky};},
  getMap:()=>map?{...map}:null,
  state:()=>({source:!!last&&Date.now()-lastAt<15*60*1000,calibrated:!!map&&(!last||map.engine===last.engine)||/_adv_v1$/.test(String(last?.engine||''))&&last.sw>0&&last.sh>0,following}),
  setMap(value){map=plausibleMap(value)?value:null;repaint();},
  startCalibration(){cal={x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity,size:0,engine:'',lines:new Map()};},
  cancelCalibration(){cal=null;},
  // target: where the original's first glyph ink was measured (client px) and the measured text width; prefs: the
  // corrected box. Scale = measured width / reported width; offsets make the reported top-left land on the ink.
  finishCalibration(target,prefs,options={}){let c=cal;cal=null;
   // A measured sample is paired with that exact sentence's final extent. Do not calibrate using the union of
   // unrelated pages/positions, or one late event will distort every later coordinate.
   if(c?.lines&&Array.isArray(target.samples)){const pairs=target.samples.map(s=>({sample:s,line:c.lines.get(s.token)})).filter(p=>p.line&&p.sample.textWidth>0);if(!pairs.length)return;
    pairs.sort((a,b)=>a.line.y0-b.line.y0||a.line.x0-b.line.x0);const pair=pairs[0];c=pair.line;target={...target,...pair.sample};}
   if(!c||!Number.isFinite(c.x0)||!(target.width>0)||!(target.height>0))return;
   const reported=c.x1-c.x0+c.size,measured=Number(target.textWidth)||0;let s=reported>0&&measured>0?measured/reported:target.width/1280;s=Math.max(.1,Math.min(10,s));
   const next={px:Number(prefs.x),py:Number(prefs.y),pw:Number(prefs.width),engine:c.engine,s,bx:target.inkLeft-s*c.x0,by:target.inkTop-s*c.y0,dx:target.inkLeft-prefs.x*target.width/100,dy:target.inkTop-prefs.y*target.height/100,cw:target.width,ch:target.height};
   if(!plausibleMap(next))return;map=next;if(options.persist!==false)send({type:'textPosMapSave',map:next,key:b.gameProfileKey?.()});repaint();return next;}
 };
 window.__tomeTextPosition=api;
 const priorStatus=b.galStatus;b.galStatus=m=>{if(typeof m.hookSourceRead==='boolean')readState=m.hookSourceReadOrigin==='engine'?(m.hookSourceRead?'read':'unread'):'';else if(typeof m.hookSource==='string')readState='';if(m.type==='gameClosed'){api.resetSession('');}else if(m.hookSource===null||typeof m.hookSource==='string'&&!m.hookSource.trim())b.lineColorReset?.();else if(typeof m.hookSource==='string')b.lineColorFor?.(m.hookSource,m.hookSequence);else if(m.gameStarted||m.gameProcessId){const old=identity.split('|'),next=String(m.gameProcessId||old[0]||'')+'|'+String(m.gameStarted||old[1]||'');if(identity&&next!==identity)api.resetSession(next);identity=next;}return priorStatus?.(m);};
 // ISLAND (CS2) reports dialogue in its message texture: pages sit in 720-high slots of a tall texture (y 4364-4837
 // seen for one on-screen page), and the message layer is drawn about 63 px right and 8 px down on the 1280x720
 // canvas (measured against the game's own screenshots). Normalized coordinates are reported as cs2_screen_v3, so
 // position maps calibrated on the old raw values are never applied to them.
 const cs2Canvas=m=>{if(m?.engine!=='cs2_screen_v2'||![m.y0,m.y1,m.x0,m.x1].every(Number.isFinite))return m;const slot=Math.floor(m.y0/720)*720;return {...m,engine:'cs2_screen_v3',x0:m.x0+63,x1:m.x1+63,y0:m.y0-slot+8,y1:m.y1-slot+8};};
 /* E550 (user, ファタモルガーナの館: calibration failed, the box sat at the default place, every line white). An engine that
    reports its own canvas size with a line (sw/sh, ADV mode: <engine>_adv_v1) needs no calibration: canvas pixels map to the
    client by the uniform scale the engine uses (letterbox centred), and the box is placed so its first glyph lands on the
    line's first glyph. A calibrated map for the same engine still wins. */
 const inkOffset=()=>{const text=document.querySelector('.sentence-text'),tok=text?.querySelector('.char-token')||text;if(!tok)return {x:0,y:0};const r=tok.getBoundingClientRect(),
  root=getComputedStyle(document.documentElement),rx=parseFloat(root.getPropertyValue('--tomoyo-reader-x')),ry=parseFloat(root.getPropertyValue('--tomoyo-reader-y'));
  if(!r.width||!Number.isFinite(rx)||!Number.isFinite(ry))return {x:0,y:0};const size=parseFloat(getComputedStyle(tok).fontSize)||r.height,dpr=Math.max(.5,Number(window.devicePixelRatio)||1);
  return {x:(r.left-rx)*dpr,y:(r.top+Math.max(0,r.height-size)/2-ry)*dpr};};
 const canvasMap=(m,layout,ink)=>{if(!/_adv_v1$/.test(String(m?.engine||''))||!(m.sw>0&&m.sh>0))return null;const cw=layout?.clientWidth,ch=layout?.clientHeight;if(!(cw>0&&ch>0))return null;
  const s=Math.min(cw/m.sw,ch/m.sh);return {engine:m.engine,s,bx:(cw-s*m.sw)/2,by:(ch-s*m.sh)/2,dx:ink?.x||0,dy:ink?.y||0,cw,ch,implicit:true};};
 api.canvasMap=canvasMap;
 /* E550 per-line colour: the colour the engine drew this line with (KiriKiri chColor: narration grey, speech white), else the
    colour learned for its kind (speech in 「」 or narration) at calibration, else the text colour. */
 // A colour belongs to a draw transaction, never to a wall-clock cache. Source can arrive on either side of begin.
 let colorSource='',colorSequence=null,colorDraw=null,latestDraw=null,retiredDraw=null,waitingDraw=false;
 const sourceToken=text=>text?window.TomeIslandSource?.token(text)??null:null;
 /* Read styles: every sentence is painted from its own evidence (the engine's draw call, else the game's pixels: fill, opacity,
    outline). A sentence with none takes the last reliable sample of the same engine-reported read state, never the other state's
    and never a guess; with no state or no sample the saved colours apply. Furigana reads the same variables. */
 const stateStyle=new Map();let readState='',pixelPaint=null;
 const paintLine=(color,text,style)=>{const gs=window.TomoyoGameStyle,p=b.galPreferences?.()||{},root=document.documentElement.style;
  let paint=gs?.linePaint?gs.linePaint(p,text||'',color,style||null):null;if(!gs?.linePaint&&gs?.lineColor){const c=gs.lineColor(p,text||'',color);paint=c?{color:c,edge:'',sampled:!!color}:null;}
  if(paint?.sampled&&readState)stateStyle.set(readState,paint);
  else if(!color&&!style&&text&&readState&&p.autoGameStyle!==false&&stateStyle.has(readState))paint=stateStyle.get(readState);
  const on=!!paint?.color,edge=on&&!!paint.edge;document.body.classList.toggle('tome-line-color',on);document.body.classList.toggle('tome-line-edge',edge);
  if(on)root.setProperty('--tomoyo-gal-line-color',paint.color);else root.removeProperty('--tomoyo-gal-line-color');
  if(edge)root.setProperty('--tomoyo-gal-line-edge',paint.edge);else root.removeProperty('--tomoyo-gal-line-edge');};
 api.lineStyleState=()=>({readState,states:Object.fromEntries(stateStyle),pixel:pixelPaint});
 api.paintLine=paintLine;
 b.lineColorReset=()=>{pixelPaint=null;colorSource='';colorSequence=null;colorDraw=latestDraw=retiredDraw=null;waitingDraw=false;paintLine('','');};
 b.lineColorFor=(text,sequence)=>{const next=String(text||''),seq=Number.isSafeInteger(sequence)?sequence:null;
  if(next===colorSource&&(seq===null||seq===colorSequence))return;colorSource=next;colorSequence=seq;pixelPaint=null;
  if(colorDraw&&!colorDraw.claimed&&colorDraw.sourceToken!=null&&colorDraw.sourceToken===sourceToken(next)){colorDraw.claimed=true;waitingDraw=false;paintLine(colorDraw.color,next,colorDraw.style);return;}
  /* A draw already claimed by the previous sequence is retired: a late end for it must not recolour this one, even with the same text. */
  retiredDraw=colorDraw?.claimed?{engine:colorDraw.engine,line:colorDraw.line}:null;colorDraw=null;waitingDraw=true;paintLine('',next);
 };
 const lineColor=m=>{
  if(!/_adv_v1$/.test(String(m.engine||''))||!Number.isSafeInteger(m.line))return;
  if(latestDraw?.engine===m.engine&&m.line<latestDraw.line)return;
  const same=latestDraw?.engine===m.engine&&latestDraw.line===m.line;
  const matches=Number.isSafeInteger(m.sourceToken)&&m.sourceToken===sourceToken(colorSource);
  if(m.phase==='end'&&!same&&!Number.isSafeInteger(m.sourceToken))return;
  if(retiredDraw?.engine===m.engine&&retiredDraw.line===m.line)return;
  if(!same||!colorDraw&&matches){latestDraw={engine:m.engine,line:m.line};colorDraw={...latestDraw,claimed:waitingDraw,color:'',style:null,sourceToken:null};waitingDraw=false;}
  // A late end for the previous source cannot recolour a sentence waiting for its own begin.
  if(!colorDraw||colorDraw.engine!==m.engine||colorDraw.line!==m.line)return;
  if(typeof m.color==='string'&&/^#[0-9a-f]{6}$/i.test(m.color))colorDraw.color=m.color;
  if(m.style&&typeof m.style==='object'&&/^#[0-9a-f]{6}$/i.test(m.style.fill||''))colorDraw.style=m.style;
  if(Number.isSafeInteger(m.sourceToken)){colorDraw.sourceToken=m.sourceToken;colorDraw.claimed=matches;}
  if(colorDraw.claimed)paintLine(colorDraw.color||pixelPaint?.color||'',colorSource,colorDraw.style||(colorDraw.color?null:pixelPaint?.style));
 };
 /* The game's own pixels for the sentence on screen (core/line-pixels.cjs): used when the engine's draw call said nothing for it. */
 b.lineStyleSample=m=>{if(!colorSource||!Number.isSafeInteger(m.sourceToken)||m.sourceToken!==sourceToken(colorSource))return;
  const style=m.style&&typeof m.style==='object'&&/^#[0-9a-f]{6}$/i.test(m.style.fill||'')?m.style:null;if(!style)return;pixelPaint={color:style.fill,style};
  if(colorDraw?.claimed&&(colorDraw.color||colorDraw.style))return;paintLine(style.fill,colorSource,style);};
 b.textPosition=(m,refresh=false)=>{m=cs2Canvas(m);
  if(!m||![m.x0,m.y0,m.x1,m.y1].every(unit)||m.x1<m.x0||m.y1<m.y0||!Number.isFinite(m.size)||m.size<=0||m.size>256)return;const firstSource=!last;last=m;lastAt=Date.now();
  if(!refresh)lineColor(m);
  if(cal){if(Number.isSafeInteger(m.token)&&m.token>=0)cal.lines.set(m.token,{...m});cal.engine=m.engine;cal.x0=Math.min(cal.x0,m.x0);cal.y0=Math.min(cal.y0,m.y0);cal.x1=Math.max(cal.x1,m.x1);cal.y1=Math.max(cal.y1,m.y1);cal.size=Math.max(cal.size,m.size||0);}
  if(b.islandPage?.position(m)){repaint();return;}
  /* ADV lines (E550) arrive as the game starts drawing, before their text: no page token to match */
  if(!/_adv_v1$/.test(m.engine)){if(b.pagePositionReady?.()===false)return;const currentToken=b.currentPageToken?.();if(currentToken!=null&&m.token!==currentToken)return;}
  const layout0=b.galLayoutInfo?.(),use=map&&map.engine===m.engine?map:canvasMap(m,layout0,inkOffset()); /* E422 follows automatically once calibrated; no switch */
  if(!use){if(following||firstSource){following=false;repaint();}return;}
  // The game window may have been resized since calibration: the mapping scales with the client size.
  const layout=layout0,cw=layout?.clientWidth||use.cw,ch=layout?.clientHeight||use.ch,kx=cw/use.cw,ky=ch/use.ch;
  const boxX=(use.s*m.x0+use.bx-use.dx)*kx,boxY=(use.s*m.y0+use.by-use.dy)*ky-(b.pageHistoryHeight?.()||0)*(window.devicePixelRatio||1);
  const x=Math.round(Math.max(0,Math.min(95,boxX*100/cw))*10)/10,y=Math.round(Math.max(0,Math.min(95,boxY*100/ch))*10)/10,key=x+','+y;
  if(key!==applied){applied=key;b.previewGalPosition?.({x,y});}
  if(!following){following=true;repaint();}
 };
})();
