/* SPDX-License-Identifier: GPL-3.0-or-later
   Alt+T 文字 / 校准 tabs: denser layout only. Three layouts (a, b, c) wait for the owner's pick; the choice is
   localStorage 'megulit-altt-layout' or ?alttUi=a|b|c; empty = the old layout. No control is created, removed or renamed
   (except the sub-tab chips this file adds, marked data-ac-added): nodes may be moved, never rebuilt, so every id,
   name, binding and event stays. Scoped to .tome-ac, so the 内嵌 / 画面与排版 tab and the shared panel CSS are untouched. */
(function installAlttCompact(){
 'use strict';
 if(window.__megulitAlttCompact)return;window.__megulitAlttCompact=true;
 const pick=()=>{try{const q=new URLSearchParams(location.search).get('alttUi');if(q!==null)return q;return localStorage.getItem('megulit-altt-layout')||'';}catch{return '';}};
 const V=pick();if(!/^[abc]$/.test(V))return;
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
 /* long hints: one line, full text on hover (title) or tap */
 .tome-ac:not(#q1):not(#q2):not(#q3) :is(${T},${C}) :is(small.tomoyo-hotkey-hint,small.tome-pad-note,small.tome-manual-region-hint,small.tome-island-layout-hint,.tome-text-general>small,details>small){display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;cursor:help;margin:2px 0 0!important;line-height:1.5!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) small.tome-ac-open{-webkit-line-clamp:unset!important;display:block!important;overflow:visible!important}
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
 /* b/c: sub-tab chips (plain text tabs, same look as the settings sidebar) and folds */
 .tome-ac-chips{display:flex;flex-wrap:wrap;gap:2px 6px;margin:6px 0 4px;border-bottom:1px solid var(--menu-border,#34343a)}
 .tome-ac-chips>button{padding:6px 10px!important;border:0!important;border-bottom:2px solid transparent!important;border-radius:0!important;background:transparent!important;color:var(--theme-textSecondary,#aaa)!important;cursor:pointer;font-size:13px;margin-bottom:-1px}
 .tome-ac-chips>button[aria-selected=true]{color:var(--menu-accent,#e0495a)!important;border-bottom-color:var(--menu-accent,#e0495a)!important;font-weight:700}
 .tome-ac-chips>button:focus-visible{outline:2px solid var(--menu-accent,#e0495a);outline-offset:-2px}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-off{display:none!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) details.tome-ac-pane{border:0!important;background:transparent!important;margin-top:0!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) details.tome-ac-pane>summary{display:none!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) details.tome-ac-static>summary{pointer-events:none;cursor:default}
 .tome-ac:not(#q1):not(#q2):not(#q3) details.tome-ac-static>summary::after,.tome-ac:not(#q1):not(#q2):not(#q3) details.tome-ac-static>summary::marker{display:none!important;content:none!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-cols .tomoyo-cn-grid{grid-template-columns:minmax(0,1fr)!important}
 .tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:0 28px}
 @container (min-width:640px){.tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-cols{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
 @media (pointer:coarse){.tome-ac:not(#q1):not(#q2):not(#q3) .tome-ac-chips>button{padding:10px 12px!important}}
 `;(document.head||document.documentElement).appendChild(style);
 const strip=s=>(s||'').replace(/\s*(设置|設定|settings?)$/i,'').trim();
 const mk=(tag,cls,attrs)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k in attrs||{})e.setAttribute(k,attrs[k]);return e;};
 const wrapPair=(a,b,cls)=>{if(!a||!b||a.parentElement!==b.parentElement||a.parentElement.classList.contains('tome-ac-pair'))return;const w=mk('div','tome-ac-pair '+(cls||''));a.before(w);w.append(a,b);};
 const byName=(root,n)=>root.querySelector('[name='+n+']')?.closest('label');
 /* sub-tab bar: items = [{label, nodes:[...], get label()}]; idempotent, re-run on every mutation */
 function chips(host,before,id,items,state){
  let bar=host.querySelector(':scope>.tome-ac-chips[data-ac-id='+id+']');
  if(!bar){bar=mk('div','tome-ac-chips',{role:'tablist','data-ac-id':id,'data-ac-added':''});before.before(bar);
   items.forEach((it,i)=>{const b=mk('button','',{type:'button',role:'tab','data-ac-added':''});b.onclick=()=>{state.i=i;paint();};bar.append(b);});
   bar.addEventListener('keydown',e=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;const n=(state.i+(e.key==='ArrowRight'?1:items.length-1))%items.length;state.i=n;paint();bar.children[n].focus();e.preventDefault();});}
  function paint(){[...bar.children].forEach((b,i)=>{const t=items[i].label();if(b.textContent!==t)b.textContent=t;b.setAttribute('aria-selected',String(i===state.i));b.tabIndex=i===state.i?0:-1;});
   items.forEach((it,i)=>{for(const n of it.nodes()){n.classList.toggle('tome-ac-off',i!==state.i);if(n.tagName==='DETAILS'){n.classList.add('tome-ac-pane');if(i===state.i)n.open=true;}}});}
  paint();}
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
   chips(text,groups[0],'text',groups.map(g=>({label:()=>strip(g.querySelector('summary')?.textContent),nodes:()=>[g]})),st.text);
      chips(cal,calNodes.sync||cal.firstElementChild,'cal',[
    {label:()=>I('校准与位置'),nodes:()=>[calNodes.sync,calNodes.pos].filter(Boolean)},
    {label:()=>I('窗口与导入'),nodes:()=>[calNodes.bind,calNodes.imp,calNodes.hist].filter(Boolean)}],st.cal);
  }
  if(V==='c'){
   if(jp&&cn){let row=text.querySelector(':scope>.tome-ac-cols');if(!row){row=mk('div','tome-ac-cols');jp.before(row);}for(const g of [jp,cn]){if(g.parentElement!==row)row.append(g);g.open=true;g.classList.add('tome-ac-static');}}
   const rest=[en,ruby,pal,spc,gf].filter(Boolean);
   let more=text.querySelector(':scope>details.tome-ac-more');if(!more){more=mk('details','tome-ac-more');const s=mk('summary');s.dataset.acAdded='';s.dataset.noI18n='';more.append(s);text.append(more);}
   more.querySelector('summary').textContent=I('更多文字设置');for(const g of rest)if(g.parentElement!==more)more.append(g);
   let adv=cal.querySelector(':scope>details.tome-ac-bindmore');if(!adv){adv=mk('details','tome-ac-bindmore');const s=mk('summary');s.dataset.acAdded='';s.dataset.noI18n='';adv.append(s);const h=calNodes.hist;(h||cal.lastElementChild).before(adv);}
   adv.querySelector('summary').textContent=I('绑定与导入');for(const n of [calNodes.bind,calNodes.imp])if(n&&n.parentElement!==adv)adv.append(n);
   if(calNodes.hist&&calNodes.hist.previousElementSibling!==adv)adv.after(calNodes.hist);
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
