// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 (user: alt+m从开关主页的快捷键改一下 改成绑定当前游戏窗口的快捷键): Alt+M binds the window in front, the same
   bind as picking it in Alt+T → 窗口绑定 (GalNative.bind). The bridge only reports the foreground top-level window
   (bindHotkey: hwnd, pid, title, className, processName, own); what may be bound is decided here. MeguLit's own windows,
   the desktop / taskbar and Explorer are refused with a hint. The library game is matched by the existing bound path
   (gameProcessId → executable → library). */
const WORDS={
 zh:{own:'现在在前面的是 MeguLit 自己的窗口：先点一下游戏窗口，再按 Alt+M',desktop:'现在在前面的是桌面：先点一下游戏窗口，再按 Alt+M',
  explorer:'现在在前面的是资源管理器：先点一下游戏窗口，再按 Alt+M',none:'没有找到在前面的窗口：先点一下游戏窗口，再按 Alt+M',bound:'已绑定：',failed:'绑定失败：',busy:'MeguLit 的游戏组件还没准备好，稍后再按 Alt+M'},
 ja:{own:'前面にあるのは MeguLit 自身のウィンドウです。ゲームのウィンドウをクリックしてから Alt+M を押してください',desktop:'前面にあるのはデスクトップです。ゲームのウィンドウをクリックしてから Alt+M を押してください',
  explorer:'前面にあるのはエクスプローラーです。ゲームのウィンドウをクリックしてから Alt+M を押してください',none:'前面のウィンドウが見つかりません。ゲームのウィンドウをクリックしてから Alt+M を押してください',bound:'割り当てました：',failed:'割り当てに失敗しました：',busy:'MeguLit のゲーム用コンポーネントがまだ準備中です。少し待ってから Alt+M を押してください'},
 en:{own:'MeguLit\'s own window is in front: click the game window, then press Alt+M',desktop:'The desktop is in front: click the game window, then press Alt+M',
  explorer:'File Explorer is in front: click the game window, then press Alt+M',none:'No window is in front: click the game window, then press Alt+M',bound:'Bound: ',failed:'Could not bind: ',busy:'MeguLit\'s game component is not ready yet; press Alt+M again in a moment'}};
const SHELL=new Set(['Progman','WorkerW','Shell_TrayWnd','Shell_SecondaryTrayWnd']);
/* 'ok' when the window may be bound, else why not: own | desktop | explorer | none */
function classify(m){
 const hwnd=String(m?.hwnd??'');if(!/^\d{1,19}$/.test(hwnd)||/^0+$/.test(hwnd))return 'none';
 const name=String(m.processName||'').toLowerCase().replace(/\.exe$/,''),cls=String(m.className||'');
 if(m.own===true||/^megulit/.test(name)||name==='msedgewebview2')return 'own';
 if(SHELL.has(cls))return 'desktop';
 if(name==='explorer')return 'explorer';
 return 'ok';
}
const words=lang=>WORDS[String(lang||'zh').slice(0,2)]||WORDS.zh;
const message=(kind,lang,detail='')=>{const w=words(lang);if(kind==='bound')return w.bound+(String(detail||'').trim()||'?');if(kind==='failed')return w.failed+String(detail||'');return w[kind]||w.none;};
/* reader: the Reader (services/reader.cjs); emit(result) gets {type:'bindHotkeyResult',ok,kind,title,message} */
function request(reader,m,emit,lang){
 const kind=classify(m),title=String(m?.title||'').slice(0,200);
 if(kind!=='ok'){emit({type:'bindHotkeyResult',ok:false,kind,title,message:message(kind,lang)});return false;}
 const g=reader.gal;if(!g){emit({type:'bindHotkeyResult',ok:false,kind:'busy',title,message:message('busy',lang)});return false;}
 reader.hotkeyBind={hwnd:String(m.hwnd),title,at:Date.now()};
 try{reader.translator?.().clearContext?.();}catch{}
 g.bind(String(m.hwnd),{...g.preferences,bindEnabled:true});return true;
}
/* bridge messages after a hotkey bind: 'bound' for that window says done, an 'error' soon after says why not */
function follow(reader,m,emit,lang){
 const pending=reader.hotkeyBind;if(!pending)return;
 if(Date.now()-pending.at>8000){reader.hotkeyBind=null;return;}
 if(m.type==='bound'&&String(m.gameHwnd||'')===pending.hwnd){reader.hotkeyBind=null;const title=String(m.gameTitle||pending.title||'');emit({type:'bindHotkeyResult',ok:true,kind:'bound',title,message:message('bound',lang,title)});}
 else if(m.type==='error'){reader.hotkeyBind=null;emit({type:'bindHotkeyResult',ok:false,kind:'failed',title:pending.title,message:message('failed',lang,m.message)});}
}
module.exports={classify,message,request,follow};
