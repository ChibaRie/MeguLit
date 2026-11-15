// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 (user: 石头门启动失败). A Steam game started directly can still decide it was not started by Steam
   (SteamAPI_RestartAppIfNecessary): it quits with exit code 53 and has Steam run it again. That quit is Steam taking
   over, not a failed start. When the game had a command line ("Game.exe mages_sgate"), Steam runs steam://run/<id>//<args>
   and waits for the user to confirm the arguments; Steam's console log says what it is waiting for. Any Steam game. */
const fs=require('node:fs'),path=require('node:path');
const RESTART_EXIT=53;
const restarted=exit=>!!exit&&exit.code===RESTART_EXIT;
const pad=n=>String(n).padStart(2,'0');
const stamp=ms=>{const d=new Date(ms);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;};
function tail(file,bytes=256*1024){let fd;try{fd=fs.openSync(file,'r');const size=fs.fstatSync(fd).size,len=Math.min(bytes,size),b=Buffer.alloc(len);fs.readSync(fd,b,0,len,size-len);return b.toString('utf8');}catch{return '';}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}}
/* What Steam's launch of `appid` started at or after `since` (ms) is still waiting for: 'ShowGameArgs' (confirm launch
   arguments), another user response, or '' when nothing waits. Reads <steam>\logs\console_log.txt. */
function pendingPrompt(steamRoot,appid,since=0){
 if(!steamRoot||!/^\d+$/.test(String(appid||'')))return '';
 const from=stamp(since-2000),id=String(appid);let waiting='';
 for(const line of tail(path.join(steamRoot,'logs','console_log.txt')).split(/\r?\n/)){
  const m=/^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\]\s+(.*)$/.exec(line);if(!m||m[1]<from)continue;const text=m[2];
  if(!text.includes('[AppID '+id+',')&&!text.includes('AppID '+id+' '))continue;
  let w=/LaunchApp waiting for user response to (\w+)/.exec(text);if(w){waiting=w[1];continue;}
  if(/LaunchApp continues with user response|changed task to Completed|Game process added/.test(text))waiting='';}
 return waiting;
}
module.exports={RESTART_EXIT,restarted,pendingPrompt,_internal:{stamp}};
