// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Text architecture ③ at launch (docs/text-architecture.md). services/bridge.cjs asks prepare() before it starts a
   game itself; when an engine path applies and is allowed, the start is adjusted:
     web   (NW.js / Electron shell next to the program): Chromium's remote debugging switches on a free loopback port;
     unity (Mono or IL2CPP, pack "unity-text" installed): the program in MeguLit's shadow folder, Steam's app id in the
           environment so Steam does not restart it from the real folder.
   KiriKiri and Ren'Py need nothing at launch: HookBridge loads their DLLs into the running game.
   The returned session connects after the start (connect(pid)), feeds ToMe_CHARS records to the hook reader and
   follows its replacement switch (hide) and source lines (want). Off unless the caller passes enabled (the owner's
   "MeguLit draws all text" switch), and per game off once the crash canary tripped. */
const path=require('node:path');
const {Canary}=require('./text-paths.cjs');
const W=require('./text-paths-web.cjs'),U=require('./text-paths-unity.cjs');

function unityPack(root){const dir=path.join(root,'runtime','unity-text');try{return require('node:fs').existsSync(path.join(dir,'MeguLitUnityText.dll'))?dir:null;}catch{return null;}}

async function prepare({root,exe,profile={},enabled=false,shadowRoot=null,trace=()=>{}}){
 if(!enabled||!exe)return null;
 const canary=new Canary(root,exe);const off=canary.settle();if(Object.keys(off||{}).length)trace('text-paths-canary',{off:Object.keys(off)});
 const steam=profile.source==='steam'&&/^\d+$/.test(String(profile.appid||''))?String(profile.appid):null;
 const steamEnv=steam?{SteamAppId:steam,SteamGameId:steam,SteamOverlayGameId:steam}:{};
 if(W.chromiumShell(exe)&&canary.allowed('web')){
  const port=await W.freePort();const session=new W.WebTextPath({port,canary});
  return {path:'web',exe,args:W.launchArgs(port),env:steamEnv,cwd:path.dirname(exe),session,
   connect:()=>session.attach().then(ok=>{trace('text-paths-web',{attached:ok,port});return ok;})};
 }
 const pack=unityPack(root);
 const kind=pack&&U.unityGame(exe),il2cppReady=kind==='il2cpp'&&require('node:fs').existsSync(path.join(pack,'MeguLitUnityText.IL2CPP.dll'));
 if(pack&&(kind==='mono'||il2cppReady)&&!U.modded(exe)&&canary.allowed('unity')){
  const session=new U.UnityTextPath({canary});const port=await session.listen();
  let sh;try{sh=U.makeShadow({exe,shadowRoot:shadowRoot||path.join(root,'data','unity-shadow'),pack,port,steamAppId:steam});}catch(e){session.stop();trace('text-paths-unity-skipped',{error:e.message});return null;}
  trace('text-paths-unity',{shadow:sh.shadow,links:sh.links,copies:sh.copies,junctions:sh.junctions});
  return {path:'unity',exe:sh.exe,args:[],env:steamEnv,cwd:sh.shadow,session,connect:async()=>true};
 }
 return null;
}

/* Connect a prepared session to the hook reader (core/hook-native.cjs): records in, replacement switch and lines out. */
function attach(prepared,hook){if(!prepared?.session||!hook)return;const s=prepared.session;
 s.onChars=line=>hook.charRects(line);s.onStatus=st=>hook.trace?.('text path '+prepared.path+': '+st);hook.attachTextPath?.(s);}

/* ③ dot font at the source (native/fontdot, docs/text-architecture.md): when ① starts the game through MeguLitLaunch
   (compositor mode), MeguLitFontDot<bit>.dll rides along in MEGULIT_LAUNCH_EXTRA and is loaded while the game is still
   suspended. Off with MEGULIT_FONTDOT_OFF=1, without the DLL, or once the crash canary saw the game die with it. The DLL
   itself serves dots only while the compositor's heartbeat says it is presenting (else the real fonts). */
function fontDot(root,exe,early,trace=()=>{}){
 if(!early||process.env.MEGULIT_FONTDOT_OFF==='1')return null;
 const bit=/MeguLitLaunch32\.exe$/i.test(early.file)?'32':'64',dll=path.join(root,'native','MeguLitFontDot'+bit+'.dll');
 if(!require('node:fs').existsSync(dll))return null;
 const canary=new Canary(root,exe);canary.settle();
 if(!canary.allowed('fontdot')){trace('fontdot-off',{reason:canary.read().off?.fontdot?.reason||''});return null;}
 early.env={...early.env,MEGULIT_LAUNCH_EXTRA:[early.env?.MEGULIT_LAUNCH_EXTRA,dll].filter(Boolean).join(';')};
 canary.arm('fontdot');trace('fontdot',{dll:path.basename(dll)});
 return {dll,canary,
  /* the launcher exits at once, so the game's own process is watched: gone within 20 s = died with the dot font */
  watch(pid,{alive=p=>{try{process.kill(p,0);return true;}catch{return false;}},every=1000,until=21000}={}){
   const t0=Date.now();if(!Number.isInteger(Number(pid))){canary.exited('fontdot',0);return;}
   const w=setInterval(()=>{if(!alive(Number(pid))){clearInterval(w);canary.exited('fontdot',-1);trace('fontdot-canary',{died:Date.now()-t0});return;}
    if(Date.now()-t0>=until){clearInterval(w);canary.alive('fontdot');canary.exited('fontdot',0);}},every);w.unref?.();}};
}

module.exports={prepare,attach,unityPack,fontDot};
