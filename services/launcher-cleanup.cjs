// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 (死に逝く君、館に芽吹く憎悪, softdenchi 「打开游戏.exe」): a DRM launcher first shows its own banner and waits for OK. When
   nobody can answer it (its window hidden, a test rig, a start that timed out), the launcher stays behind without a window, and each
   further start added one more: seven stuck 「打开游戏.exe」 were found, and a hidden one also blocks single-instance launchers.
   A launcher MeguLit started is ended when that start fails, and hidden copies left by an earlier start are ended before the next
   one, but only while the game itself is not running. A launcher with a visible window (the banner still waiting for the user)
   is never touched. */
const path=require('node:path');
const TICKS_AT_EPOCH=621355968000000000n;
const startedMs=ticks=>{try{return Number((BigInt(String(ticks))-TICKS_AT_EPOCH)/10000n);}catch{return NaN;}};
function paths(launchVia){const out=new Set();const add=p=>{if(p)out.add(path.normalize(p));};add(launchVia);try{add(require('node:fs').realpathSync(launchVia));}catch{}return [...out];}
/* list(exe) -> [{pid,visible,started}] (GalWindowBridge --process-status); kill(pid) ends one process */
async function endHidden({launchVia,gameExe,since=0,list,kill=pid=>process.kill(pid),trace=()=>{}}={}){
 if(!launchVia||typeof list!=='function')return [];
 try{if(gameExe&&(await list(gameExe)).length)return [];}catch{return [];}
 const ended=[],seen=new Set();
 for(const exe of paths(launchVia)){let found=[];try{found=await list(exe);}catch{continue;}
  for(const p of found){const pid=Number(p?.pid);if(!Number.isSafeInteger(pid)||pid<1||seen.has(pid))continue;seen.add(pid);
   if(p.visible===true)continue;const at=startedMs(p.started);if(since&&!(at>=since-2000))continue;
   try{kill(pid);ended.push(pid);}catch{}}}
 if(ended.length)trace('launcher-ended',{launcher:path.basename(launchVia),pids:ended});
 return ended;
}
module.exports={endHidden,startedMs};
