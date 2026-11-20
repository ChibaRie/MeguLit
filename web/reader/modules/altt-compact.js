/* SPDX-License-Identifier: GPL-3.0-or-later
   Alt+T 文字 / 校准 tabs: denser layout only. Layout picked by the owner (top common rows + in-panel sub-tabs). Off switch: localStorage
   'megulit-altt-layout'='off' or ?alttUi=0 (old layout). No control is created, removed or renamed
   (except the sub-tab chips this file adds, marked data-ac-added): nodes may be moved, never rebuilt, so every id,
   name, binding and event stays. Scoped to .tome-ac, so the 内嵌 / 画面与排版 tab and the shared panel CSS are untouched. */
(function installAlttCompact(){
 'use strict';
 if(window.__megulitAlttCompact)return;window.__megulitAlttCompact=true;
 const pick=()=>{try{const q=new URLSearchParams(location.search).get('alttUi');const v=q!==null?q:localStorage.getItem('megulit-altt-layout');return v==='0'||v==='off'?'':'b';}catch{return 'b';}};
 const V=pick();if(!V)return;
 const T='.tome-ac:not(#q1):not(#q2):not(#q3) [data-menu-category=text]',C='.tome-ac:not(#q1):not(#q2):not(#q3) [data-menu-category=calibrate]';
 const SLIDER='label:has(>output.tomoyo-slider-value)';
 const style=document.createElement('style');style.textContent=`
 .tome-ac:not(#q1):not(#q2):not(#q3) :is(${T},${C}) [hidden]{display:none!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tomoyo-menu-content{container-type:inline-size;padding-top:6px}
 /* label | slider | value on one line */
 .tome-ac:not(#q1):not(#q2):not(#q3) ${SLIDER}{display:grid!important;grid-template-columns:clamp(6.8em,24cqw,10em) minmax(0,1fr) 3.2em;align-items:center;column-gap:12px;margin-top:4px!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) ${SLIDER}>input[type=range]{order:2;margin:0!important;width:100%;min-width:0}
 .tome-ac:not(#q1):not(#q2):not(#q3) ${SLIDER}>output{order:3;position:static!important;float:none!important;margin:0!important;text-align:right}
 .tome-ac:not(#q1):not(#q2):not(#q3) :is(${T},${C}) label:has(>select){display:grid!important;grid-template-columns:clamp(6.8em,24cqw,10em) minmax(0,1fr);align-items:center;column-gap:12px;margin-top:6px!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) :is(${T},${C}) label>select{margin:0!important;min-width:0;padding:6px 10px!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) :is(${T},${C}) label{margin-top:6px!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) :is(${T},${C}) label:has(>input[type=checkbox]){margin-top:4px!important}
 /* 文字: common switches */
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-text-general>.tomoyo-cn-grid{display:flex!important;flex-wrap:wrap;gap:2px 20px!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-text-general>.tomoyo-cn-grid>label{margin-top:4px!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-pair{display:grid;grid-template-columns:minmax(0,1fr);column-gap:24px}
 @container (min-width:600px){.tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-pair{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-pair.tome-ac-switch-slider{grid-template-columns:max-content minmax(0,1fr)}}
 .tome-ac:not(#q1):not(#q2):not(#q3) details>summary{min-height:0!important;padding:7px 12px!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) details{margin-top:8px!important;padding-top:0!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) details[open]>:is(div.tomoyo-cn-grid,.tomoyo-ruby-position){margin-top:0}
 .tome-ac:not(#q1):not(#q2):not(#q3) details .tomoyo-cn-grid{gap:0 20px!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) details .tomoyo-cn-grid>label{margin-top:6px!important}
 @container (min-width:600px){.tome-ac:not(#q1):not(#q2):not(#q3) [data-text-spacing]>.tomoyo-cn-grid{grid-template-columns:1fr 1fr 1fr!important}}
 /* 校准 */
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-game-style-sync{display:flex!important;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px!important;margin:0!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-game-style-sync>label{flex:1 1 100%;margin:0!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-game-style-sync>button{margin:0!important;padding:6px 12px!important;min-height:0!important;height:32px}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-game-style-sync>small{flex:1 1 100%;margin:0!important;order:5}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-game-style-sync>label{order:0}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-game-style-sync>small:empty{display:none}
 .tome-ac:not(#q1):not(#q2):not(#q3) [data-calibration-position] .tomoyo-cn-grid{display:block!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-window-bind-row,.tome-ac:not(#q1):not(#q2):not(#q3) .tome-window-bind-list{display:flex!important;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-window-bind-list>label{flex:1 1 15em;margin:0!important}
 @container (max-width:560px){.tome-ac:not(#q1):not(#q2):not(#q3) .tome-window-bind-list>label{flex-basis:100%}.tome-ac:not(#q1):not(#q2):not(#q3) .tome-import-row{grid-template-columns:minmax(0,1fr) auto}}
 .tome-ac:not(#q1):not(#q2):not(#q3) :is(.tome-window-bind-row,.tome-window-bind-list)>button{margin:0!important;padding:6px 12px!important;min-height:0!important;height:32px}
 .tome-ac:not(#q1):not(#q2):not(#q3) [data-calibration-window-bind]{margin-top:4px}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-import-row{display:grid!important;grid-template-columns:9em minmax(0,1fr) auto;align-items:center;gap:10px;margin-top:6px!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-import-row>span{grid-column:auto!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-import-row>:is(select,button){margin:0!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-import-row>button{padding:5px 12px!important;height:32px}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-calibration-imports{margin-top:6px}
 /* reusable in-panel second-level tabs (.mg-subtabs): plain text tabs, one row, scrolls sideways when too many */
 .mg-subtabs{display:flex;flex-wrap:nowrap;gap:2px 4px;margin:6px 0 6px;border-bottom:1px solid var(--menu-border,#34343a);overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
 .mg-subtabs>button{flex:none;padding:7px 12px!important;border:0!important;border-bottom:2px solid transparent!important;border-radius:0!important;background:transparent!important;color:var(--theme-textSecondary,#aaa)!important;cursor:pointer;font-size:13px;margin-bottom:-1px;white-space:nowrap}
 .mg-subtabs>button:hover{color:var(--theme-text,#e8e9ec)!important}
 .mg-subtabs>button[aria-selected=true]{color:var(--menu-accent,#e0495a)!important;border-bottom-color:var(--menu-accent,#e0495a)!important;font-weight:700}
 .mg-subtabs>button:focus-visible{outline:2px solid var(--menu-accent,#e0495a);outline-offset:-2px;border-radius:6px!important}
 @media (pointer:coarse){.mg-subtabs>button{padding:11px 14px!important}}
 .tome-ac:not(#q1):not(#q2):not(#q3) output.tomoyo-slider-value{color:var(--theme-text,#f1f1f4)!important;background:color-mix(in srgb,var(--menu-accent,#e0495a) 30%,transparent)!important;border-radius:6px;padding:1px 6px;font-weight:600}
 .tome-ac:not(#q1):not(#q2):not(#q3) [data-menu-category=text] details.tome-ac-pane .tomoyo-cn-grid{display:block!important}
 @container (min-width:600px){.tome-ac:not(#q1):not(#q2):not(#q3) [data-menu-category=text] details[data-text-colours] .tomoyo-cn-grid{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:0 24px!important}.tome-ac:not(#q1):not(#q2):not(#q3) [data-menu-category=text] details[data-text-colours] .tomoyo-cn-grid>label:has(>output){grid-column:1/-1}}
 .tome-ac:not(#q1):not(#q2):not(#q3) [data-menu-category=text] details.tome-ac-pane small{display:block;margin:6px 0 0!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-off{display:none!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) details.tome-ac-pane{border:0!important;background:transparent!important;margin-top:0!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) details.tome-ac-pane>summary{display:none!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) details.tome-ac-static>summary{pointer-events:none;cursor:default}
 .tome-ac:not(#q1):not(#q2):not(#q3) details.tome-ac-static>summary::after,.tome-ac:not(#q1):not(#q2):not(#q3) details.tome-ac-static>summary::marker{display:none!important;content:none!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-cols .tomoyo-cn-grid{grid-template-columns:minmax(0,1fr)!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:0 28px}
 @container (min-width:640px){.tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-cols{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
 @media (pointer:coarse){.tome-ac:not(#q1):not(#q2):not(#q3) .mg-subtabs>button{padding:10px 12px!important}}
 `;(document.head||document.documentElement).appendChild(style);
 const strip=s=>(s||'').replace(/\s*(设置|設定|settings?)$/i,'').trim();
 const mk=(tag,cls,attrs)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k in attrs||{})e.setAttribute(k,attrs[k]);return e;};
 const wrapPair=(a,b,cls)=>{if(!a||!b||a.parentElement!==b.parentElement||a.parentElement.classList.contains('tome-ac-pair'))return;const w=mk('div','tome-ac-pair '+(cls||''));a.before(w);w.append(a,b);};
 const byName=(root,n)=>root.querySelector('[name='+n+']')?.closest('label');
 /* sub-tab bar: items = [{label, nodes:[...], get label()}]; idempotent, re-run on every mutation */
 function chips(host,before,id,items,state){
  let bar=host.querySelector(':scope>.mg-subtabs[data-ac-id='+id+']');
  if(!bar){bar=mk('div','mg-subtabs',{role:'tablist','data-ac-id':id,'data-ac-added':''});before.before(bar);
   items.forEach((it,i)=>{const b=mk('button','',{type:'button',role:'tab','data-ac-added':''});b.onclick=()=>{state.i=i;paint();save();};bar.append(b);});
   const sk='megulit-altt-subtab-'+id,save=()=>{try{localStorage.setItem(sk,String(state.i));}catch{}};
   try{const v=Number(localStorage.getItem(sk));if(Number.isInteger(v)&&v>=0&&v<items.length)state.i=v;}catch{}
   bar.addEventListener('keydown',e=>{const k=e.key;if(!['ArrowRight','ArrowLeft','Home','End'].includes(k))return;const n=k==='Home'?0:k==='End'?items.length-1:(state.i+(k==='ArrowRight'?1:items.length-1))%items.length;state.i=n;paint();save();bar.children[n].focus();bar.children[n].scrollIntoView({block:'nearest',inline:'nearest'});e.preventDefault();});}
  function paint(){[...bar.children].forEach((b,i)=>{const t=items[i].label();if(b.textContent!==t)b.textContent=t;b.setAttribute('aria-selected',String(i===state.i));b.tabIndex=i===state.i?0:-1;});
   items.forEach((it,i)=>{for(const n of it.nodes()){n.classList.toggle('tome-ac-off',i!==state.i);if(n.tagName==='DETAILS'&&it.pane){n.classList.add('tome-ac-pane');if(i===state.i){n.open=true;for(const d of n.querySelectorAll('details'))if(!d.dataset.acOpened){d.dataset.acOpened='1';d.open=true;}}}}});}
  paint();return bar;}
 window.__megulitSubTabs={mount:chips};
 const st={text:{i:0},cal:{i:0}};
 function organize(dialog){
  const text=dialog.querySelector('[data-menu-category=text]'),cal=dialog.querySelector('[data-menu-category=calibrate]');if(!text||!cal)return;
  const general=text.querySelector('.tome-text-general');if(!general)return;
  /* pairs of short rows share a line when the panel is wide */
  wrapPair(byName(general,'galAutoScale'),byName(general,'galEmbedTranslation'));
  const tw=byName(general,'galTypewriter'),sp=byName(general,'galTypewriterSpeed');
  if(tw&&sp&&!tw.parentElement.classList.contains('tome-ac-pair')){wrapPair(tw,sp,'tome-ac-switch-slider');}
  const det=n=>text.querySelector(':scope>details[data-text-'+n+']'),jp=det('japanese'),cn=det('chinese'),en=det('megulit-english')||text.querySelector(':scope>details[data-megulit-english]'),ruby=det('ruby'),pal=det('colours'),spc=det('spacing'),gf=det('game-font');
  const groups=[jp,cn,en,ruby,pal,spc,gf].filter(Boolean);
  const calNodes={sync:cal.querySelector(':scope>.tome-game-style-sync'),pos:cal.querySelector(':scope>[data-calibration-position]'),bind:cal.querySelector('[data-calibration-window-bind]'),imp:cal.querySelector('.tome-calibration-imports'),hist:cal.querySelector('.tome-calibration-history')};
  if(V==='b'){
   chips(text,groups[0],'text',groups.map(g=>({pane:true,label:()=>strip(g.querySelector('summary')?.textContent),nodes:()=>[g]})),st.text);
      chips(cal,calNodes.sync||cal.firstElementChild,'cal',[
    {label:()=>I('校准与位置'),nodes:()=>[calNodes.sync,calNodes.pos].filter(Boolean)},
    {label:()=>I('窗口与导入'),nodes:()=>[calNodes.bind,calNodes.imp,calNodes.hist].filter(Boolean)}],st.cal);
  }
  for(const s of dialog.querySelectorAll('[data-menu-category=text] small,[data-menu-category=calibrate] small'))if(!s.dataset.acT){s.dataset.acT='1';s.addEventListener('mouseover',()=>{if(!s.title&&s.scrollHeight>s.clientHeight+1)s.title=s.textContent.trim();});s.addEventListener('click',()=>s.classList.toggle('tome-ac-open'));}
 }
 const L={en:{'校准与位置':'Calibrate & position','窗口与导入':'Window & import','更多文字设置':'More text settings','绑定与导入':'Binding & import'},ja:{'校准与位置':'調整と位置','窗口与导入':'ウィンドウと取り込み','更多文字设置':'その他の文字設定','绑定与导入':'バインドと取り込み'}};
 const I=k=>(L[document.documentElement.lang.slice(0,2)]||{})[k]||k;
 let queued=0;
 const run=()=>{queued=0;const d=document.querySelector('.tomoyo-cn-dialog[data-menu-organized]:not([data-leaving])');if(!d)return;d.classList.add('tome-ac');d.dataset.alttUi=V;try{organize(d);}catch(e){console.error('altt-compact',e);}};
 new MutationObserver(()=>{if(!queued)queued=requestAnimationFrame(run);}).observe(document.documentElement,{subtree:true,childList:true});
 run();
})();
