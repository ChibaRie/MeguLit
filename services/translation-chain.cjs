// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-19 (user rule, every game): a line the translation group's / official Chinese does not cover (no pairing, not
   recognised, a grown line) is never left as 「未翻译」 / 「翻译暂不可用」. It goes, in order, to
     1. the local model, when one is installed or chosen (a cold start is started here, as the chosen local engine is),
     2. an API the user bound (the chosen API engine, then any other API engine with a stored key),
     3. machine translation (Microsoft, then Google; both free and keyless).
   Only sources the user has set up are used; nothing new is switched on for them. Only when all fail does the line say so,
   and a background retry keeps going (Retries) and fills the translation in on screen and in the dialogue log.
   Per line, the same for every game; the result says which source gave it (never recorded as a group pairing). */
const {ENGINES}=require('../core/engines.cjs');
const API_BUILTIN=['gpt','deepseek','bing','deepl'];
const isLocal=p=>ENGINES[p]?.group==='local';
const isMt=p=>p==='google'||ENGINES[p]?.kind==='mt'&&ENGINES[p]?.keyless===true;
const isApi=p=>!isLocal(p)&&!isMt(p)&&(API_BUILTIN.includes(p)||!!ENGINES[p]);

/* The ordered option sets for one line.
   prefs: the reader preferences (provider, baseUrl, model, ...); hasKey(baseUrl): a key is stored for that API;
   localInstalled: a local model is installed (the runtime can start it). resolve: core/providers resolveOptions. */
function candidates(prefs,{hasKey=()=>false,localInstalled=false,resolve=require('../core/providers.cjs').resolveOptions}={}){
 const out=[],seen=new Set(),add=o=>{try{const r=resolve(o);const k=r.provider+'|'+(r.baseUrl||'')+'|'+(r.model||'');if(seen.has(k))return;seen.add(k);out.push(r);}catch{}};
 const chosen=String(prefs?.provider||'');
 if(isLocal(chosen))add({...prefs});else if(localInstalled)add({...prefs,provider:'sakura',baseUrl:'',model:''});
 const keyed=o=>{try{return ENGINES[o.provider]?.keyless===true||hasKey(resolve(o).baseUrl);}catch{return false;}};
 if(isApi(chosen)&&keyed(prefs))add({...prefs});
 for(const p of [...API_BUILTIN,...Object.keys(ENGINES)])if(p!==chosen&&isApi(p)&&!ENGINES[p]?.hidden){const o={...prefs,provider:p,baseUrl:'',model:''};if(ENGINES[p]?.keyless!==true&&keyed(o))add(o);}
 if(isMt(chosen))add({...prefs});
 add({...prefs,provider:'microsoft',baseUrl:'',model:''});add({...prefs,provider:'google',baseUrl:'',model:''});
 return out;
}
const sourceOf=o=>isLocal(o.provider)?'local':isMt(o.provider)?'mt':'api';

/* Tries each option until one gives a translation. attempt(options) -> string (throws or '' on failure). */
async function translate(text,list,attempt,{isCurrent=()=>true}={}){
 const errors=[];
 for(const options of list){if(!isCurrent())break;try{const t=String(await attempt(options)||'').trim();if(t)return {text:t,provider:options.provider,source:sourceOf(options),errors};errors.push(options.provider+': empty');}catch(e){errors.push(options.provider+': '+String(e?.message||e).slice(0,120));}}
 const e=Error('TRANSLATION_UNAVAILABLE');e.errors=errors;throw e;
}

/* Background retries for lines that got no translation: 5 s, 20 s, 1 min, then every 2 min, 8 times at most; a line that
   gets its translation is filled in (fill(text, result)) and forgotten. */
class Retries{
 constructor(run,fill,{delays=[5000,20000,60000,120000,120000,120000,120000,120000],timers={set:setTimeout,clear:clearTimeout}}={}){this.run=run;this.fill=fill;this.delays=delays;this.timers=timers;this.jobs=new Map();}
 add(text,context={}){const key=String(text||'').replace(/\s+/g,'');if(!key||this.jobs.has(key))return;const job={text,context,tries:0,timer:null};this.jobs.set(key,job);this.next(key,job);}
 next(key,job){if(job.tries>=this.delays.length){this.jobs.delete(key);return;}job.timer=this.timers.set(async()=>{job.tries++;try{const r=await this.run(job.text,job.context);if(r&&r.text){this.jobs.delete(key);this.fill(job.text,r,job.context);return;}}catch{}if(this.jobs.get(key)===job)this.next(key,job);},this.delays[job.tries]);job.timer?.unref?.();}
 clear(){for(const j of this.jobs.values())this.timers.clear(j.timer);this.jobs.clear();}
 get size(){return this.jobs.size;}
}
module.exports={candidates,translate,Retries,sourceOf,isLocal,isMt,isApi};
