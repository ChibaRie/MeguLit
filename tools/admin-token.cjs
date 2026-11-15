// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 the relay admin token for the maintainer tools (contrib-workbench.cjs, adapter-pack.cjs).
   Order: MEGULIT_ADMIN_TOKEN (explicit, this shell), then the user-level MEGULIT_ADAPTER_ADMIN_TOKEN as Windows stores it
   (HKCU\Environment), then the same variable of this process. The stored value comes before the process one because a
   terminal opened before the key was changed still carries the old key (setx reaches new processes only; the user's
   terminal answered 401 right after rotating the key). Never printed. */
const {execFileSync}=require('node:child_process');
function stored(name,{run=execFileSync,platform=process.platform}={}){
 if(platform!=='win32')return '';
 try{
  const out=String(run('reg',['query','HKCU\\Environment','/v',name],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}));
  for(const line of out.split(/\r?\n/)){
   const m=/^\s*(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
   if(m&&m[1].toLowerCase()===name.toLowerCase())return m[2].trim();
  }
  return '';
 }catch{return '';}
}
function adminToken(o={}){const env=o.env||process.env;return String(env.MEGULIT_ADMIN_TOKEN||stored('MEGULIT_ADAPTER_ADMIN_TOKEN',o)||env.MEGULIT_ADAPTER_ADMIN_TOKEN||'').trim();}
module.exports={adminToken,stored};
