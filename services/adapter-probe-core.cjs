// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* E560 local probe of one game folder: every reader and unpacker MeguLit has, run against the folder, and one structured
   result. Runs in the probe worker (adapter-probe-worker.cjs), never in the service: a reader that hangs only costs the
   worker, which the service kills and restarts after the per-game budget.

   probeGame({dir,executable}) → {
     schema:'megulit.probe-result', version:1, reader:'<12 hex of the reader code>', ms,
     fingerprint:{key,exe,size,engine} | null          shared-adaptation key: the same game on any PC, no path in it
     inventory:{files,bytes,ext:{'.xp3':3,...},archives:[{name,size,magic,format}]}   names desensitized
     engines:[{id,scenes,lines,error,ms}]               every reader that recognised something (or failed trying)
     detected:'<engine id>'|null, lines, japaneseLines, sizes:[lines per scene]
     step:'ok'|'unknown-pack'|'decrypt-failed'|'parse-failed'|'not-japanese'|'chinese-build'|'decode-suspect'|'no-script'|'low-pairing'|'timeout',
     detail:'<code>', unsupported:{engine,code}|null, preparing:'unpack'|'capture'|null }
   No line of text leaves this function: only counts. The pairing part (low-pairing) is added by adapter-probe.cjs from
   the zero-latency state. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {maskString}=require('./desensitize.cjs');

/* Known archive magics (format names only; the bytes that follow are never kept). */
const MAGICS=[['xp3','58503333'.slice(0,6)],['xp3','5850330d0a'],['pfs-pf8','706638'],['pfs-pf6','706636'],['bgi-arc20','4255524b4f20415243'],['bgi-packfile','5061636b46696c6520'],['ypf','59504600'],['kcap','4b434150'],['npk2','4e504b32'],['npa','4e504100'],
 ['iga','49474130'],['mpk','4d504b00'],['cpk','43504b20'],['afs','41465300'],['psb','50534200'],['mdf','6d646600'],['zip','504b0304'],['rar','52617221'],['7z','377abcaf'],['unityfs','556e69747946532000'],['wolf','574f4c46'],
 ['ain','56455253'],['ai2','41493200'],['gpk','47504b'],['lpk','4c504b'],['ykc','594b433030'],['dxa','4458'],['pac-nep','5041430000'],['arc-advhd','41524332'],['cat2-int','4b494600'],['ogg','4f676753'],['png','89504e47'],['riff','52494646']];
const ARCHIVE=/\.(xp3|pfs|pf8|arc|pac|pak|dat|ypf|int|mpk|nsa|sar|ns2|gpk|ykc|lpk|mrg|fpk|afs|vfs|dxa|bin|cpz|hxp|lib|lac|pck|epk|vff|isa|nnk|ar2|psb|npk|npa|iga|cpk|wolf|ain|dbs|wad|assets|bundle)$/i;
/* anything else of some size near the top of the game folder may be an archive in a format no reader knows */
const NOT_ARCHIVE=/\.(g0[0-2]|g[ia]n|tcr|cgm|exe|dll|ini|cfg|log|url|html?|pdf|ico|png|jpe?g|bmp|gif|webp|ogg|wav|mp3|m4a|flac|opus|mp4|webm|avi|wmv|mpe?g|mkv|ttf|otf|ttc|fon|xml|md|bat|cmd|lnk|sav|sys|reg|manifest|config|txt|ks|tjs|json|rpy|rpyc|lua|cs|js|css|vdf|acf|dmp)$/i;
const SCRIPTISH=/\.(ks|tjs|ast|txt|scr|ss|s|sc|scn|ws2|ybn|bsc|ain|rpy|json|lua|nut|asb|mjo|hcb|dbs|lin)$/i;
const SKIP_DIR=/^(save|savedata|movie|movies|video|bgm|sound|voice|se|logs?|\.megulit|_commonredist|directx|redist)$/i;

function readerStamp(){try{const h=crypto.createHash('sha256'),dir=path.join(__dirname,'original-engines');for(const f of fs.readdirSync(dir).filter(n=>n.endsWith('.cjs')).sort())h.update(f+'|').update(fs.readFileSync(path.join(dir,f)));
 for(const f of ['adapter-packs.cjs','adapter-probe-core.cjs'])try{h.update(f).update(fs.readFileSync(path.join(__dirname,f)));}catch{}return h.digest('hex').slice(0,12);}catch{return '';}}
let stampMemo=null;const reader=()=>stampMemo??=readerStamp();

const head=(file,n=16)=>require('./original-engines/kit.cjs').head(file,n);/* E580 */
function format(h){const hex=h.toString('hex');for(const [name,m] of MAGICS)if(m.length>=6&&hex.startsWith(m))return name;return '';}
/* the magic of an archive as safe hex: printable ASCII and control bytes stay, every byte >= 0x80 is masked (it could be
   the first character of a Japanese file name or text) */
const magicHex=h=>Buffer.from(h.subarray(0,8).map(b=>b>=0x80?0x3f:b)).toString('hex');
function inventory(dir,{depth=2,limit=6000}={}){
 const inv={files:0,bytes:0,ext:{},archives:[],scripts:0};const walk=(d,level)=>{let list;try{list=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
  for(const e of list){if(inv.files>=limit)return;const full=path.join(d,e.name);
   if(e.isDirectory()){if(level<depth&&!SKIP_DIR.test(e.name))walk(full,level+1);continue;}if(!e.isFile())continue;
   let size=0;try{size=fs.statSync(full).size;}catch{}inv.files++;inv.bytes+=size;const ext=(path.extname(e.name).toLowerCase()||'(none)').slice(0,12);inv.ext[ext]=(inv.ext[ext]||0)+1;
   if(SCRIPTISH.test(e.name))inv.scripts++;
   if((ARCHIVE.test(e.name)&&size>=4096||!NOT_ARCHIVE.test(e.name)&&size>=512&&level<=1)&&inv.archives.length<48){const h=head(full);inv.archives.push({name:maskString(path.relative(dir,full).replace(/\\/g,'/')).slice(0,120),size,magic:magicHex(h),format:format(h),_path:full});}}};
 walk(dir,0);inv.archives.sort((a,b)=>b.size-a.size);return inv;}

const DECRYPT=/decrypt|encrypt|cipher|key|filter|scheme|CX|PROTECT|TPM/i;
const KANA=/[ぁ-ゖァ-ヺ]/;
const HAN=/[㐀-鿿]/;
/* E600 language counting. dialogue = a line that can be spoken text: script commands, identifiers, file names and
   resource paths are not (they would drown the ratio of games with many of them). chinese = Han and no kana. */
const PATHISH=/^[\w.\-\/\\:$%]+$/,SCRIPTISH_LINE=/^[@#\[<*;%$&]|^[A-Za-z_][\w.]*\s*[(=]|\.(png|jpe?g|bmp|ogg|wav|mp3|ks|tjs|txt|ws2|scr|mjo|bsc|ybn|dat|arc|xp3)\b/i;
function lineKind(l){const t=String(l).trim();if(!t||PATHISH.test(t)||SCRIPTISH_LINE.test(t)&&!KANA.test(t))return 0;
 if(KANA.test(t))return 3;if(HAN.test(t))return 2;return /[A-Za-z]+\s+[A-Za-z]+/.test(t)?1:0;}
/* → {dialogue,japanese,chinese} over a list of lines; japanese keeps the old meaning (any kana, whole list) */
function countLines(lines){let dialogue=0,japanese=0,chinese=0;for(const l of lines||[]){if(KANA.test(l))japanese++;const k=lineKind(l);if(k)dialogue++;if(k===2)chinese++;}return {dialogue,japanese,chinese};}
/* every engine of scenes.cjs, plus System4 / BGI from original-text.cjs, with a per-engine time cap */
function runEngines(dir,{deadline}){
 const scenes=require('./original-engines/scenes.cjs'),out=[];
 for(const id of Object.keys(scenes.ENGINES)){if(Date.now()>deadline){out.push({id,scenes:-1,lines:0,error:'BUDGET',ms:0});continue;}
  const engine=scenes.ENGINES[id],t=Date.now();let list=null,error='',lines=0,sizes=[],japanese=0,parsed=0,dialogue=0,chinese=0;
  try{list=engine.scenes(dir)||[];}catch(e){error=String(e?.code||e?.message||e).slice(0,60);}
  if(list&&list.length){for(const s of list){if(Date.now()>deadline){error=error||'BUDGET';break;}let p;try{p=engine.parse(s.read());parsed++;}catch(e){if(!error)error=String(e?.code||e?.message||e).slice(0,60);sizes.push(0);continue;}
    const n=p?.lines?.length||0;lines+=n;sizes.push(n);const c=countLines(p?.lines);japanese+=c.japanese;dialogue+=c.dialogue;chinese+=c.chinese;}}
  if(list?.length||error)out.push({id,scenes:list?list.length:-1,parsed,lines,japaneseLines:japanese,dialogueLines:dialogue,chineseLines:chinese,sizes:sizes.slice(0,4000),error,ms:Date.now()-t});}
 return out;}
function nativeEngines(dir,executable){const out=[];let ot;try{ot=require('./original-text.cjs');}catch{return out;}
 for(const id of ['system4','bgi']){const a=ot.ADAPTERS?.[id];if(!a)continue;const t=Date.now();let loc=null,error='';try{loc=a.locate(dir,path.parse(String(executable||'')).name);}catch(e){error=String(e?.message||e).slice(0,60);}
  if(!loc&&!error)continue;let lines=0,japanese=0,dialogue=0,chinese=0,sizes=[];if(loc)try{const r=a.read(loc.target);lines=r.lines.length;const c=countLines(r.lines);japanese=c.japanese;dialogue=c.dialogue;chinese=c.chinese;sizes=(r.sizes||[]).slice(0,4000);}catch(e){error=String(e?.message||e).slice(0,60);}
  out.push({id,scenes:loc?1:-1,parsed:loc?1:0,lines,japaneseLines:japanese,dialogueLines:dialogue,chineseLines:chinese,sizes,error,ms:Date.now()-t});}
 return out;}

/* Language of a reader's text, from counts only (no text). → 'japanese' | 'chinese-build' | 'decode-suspect' | 'not-japanese'
   - denominator is the dialogue-line count when the probe has it (E600+), else every line;
   - a big absolute number of Japanese lines is Japanese whatever the ratio (a 160k-line script with 2.6k kana lines
     is a Japanese game whose rest is commands);
   - Chinese lines in the majority, or (old probes without chineseLines) a Chinese-build title → 'chinese-build';
   - almost no Japanese in a big script → 'decode-suspect': the reader most likely mis-decoded it, not a language fact. */
const CHINESE_TITLE=/汉化|漢化|简体|簡體|繁体|繁體|中文|官中|国语|國語|翻译|翻譯|和谐|和諧|AI\s*翻|机翻|機翻|Chinese|CHS|CHT/i;
const SIMPLIFIED_ONLY=/[华镜诅传说汉兰寻译为这个们对时开关与东发见现过还进动机实队网图书写读语终贝车电马鱼鸟龙长门风飞饭给结经红绿纪约级维线细织统缘继续]/;
const chineseTitle=t=>{const s=String(t||'');return !!s&&(CHINESE_TITLE.test(s)||!KANA.test(s)&&SIMPLIFIED_ONLY.test(s));};
function judgeLanguage({lines=0,japaneseLines=0,dialogueLines,chineseLines,title}={}){
 const base=dialogueLines>0?Math.min(dialogueLines,lines)||dialogueLines:lines,jp=japaneseLines;
 if(lines<50)return 'japanese';
 const knownChinese=Number.isFinite(chineseLines);
 if(knownChinese&&chineseLines>=base*.5&&chineseLines>=jp)return 'chinese-build';
 if(!knownChinese&&jp<base*.1&&chineseTitle(title))return 'chinese-build';/* old probe: the title says Chinese build, and kana lines are a sliver */
 if(jp>=1000||jp>=base*.3)return 'japanese';
 if(jp<Math.max(10,lines*.001)&&lines>=1000)return 'decode-suspect';
 return jp>=Math.min(300,base*.05)?'japanese':'not-japanese';}

/* which step failed, from the evidence */
function classify({engines,inventory:inv,unsupported,preparing,title}){
 const read=engines.filter(e=>e.lines>0).sort((a,b)=>b.lines-a.lines)[0];
 if(read){const lang=judgeLanguage({...read,title});if(lang==='chinese-build'||lang==='decode-suspect'||lang==='not-japanese')return {step:lang,detail:read.id,detected:read.id};return {step:'ok',detail:read.id,detected:read.id};}
 if(unsupported)return {step:DECRYPT.test(unsupported.code)?'decrypt-failed':'parse-failed',detail:(unsupported.engine+':'+unsupported.code).slice(0,60),detected:null};
 const failedDecrypt=engines.find(e=>e.error&&DECRYPT.test(e.error));if(failedDecrypt)return {step:'decrypt-failed',detail:failedDecrypt.id+':'+failedDecrypt.error,detected:null};
 if(preparing==='capture')return {step:'decrypt-failed',detail:'encrypted-archive',detected:null};
 const opened=engines.find(e=>e.scenes>0);if(opened)return {step:'parse-failed',detail:opened.id,detected:null};
 const errored=engines.find(e=>e.error&&e.error!=='BUDGET');if(errored)return {step:'parse-failed',detail:errored.id+':'+errored.error,detected:null};
 const unknown=inv.archives.filter(a=>!['ogg','png','riff','zip'].includes(a.format));
 const scenePck=unknown.find(a=>/(^|\/)scene\.pck$/i.test(a.name));if(scenePck)return {step:'unknown-pack',detail:'siglus-scene-pck',detected:null};if(unknown.length)return {step:'unknown-pack',detail:unknown[0].format||'magic:'+unknown[0].magic.slice(0,8),detected:null};
 if(inv.scripts)return {step:'parse-failed',detail:'loose-scripts',detected:null};
 return {step:'no-script',detail:'',detected:null};}

function probeGame({dir,executable,title},{budgetMs=60000}={}){
 const t=Date.now(),deadline=t+budgetMs;let fingerprint=null;
 try{if(executable)fingerprint=require('./shared-adaptation.cjs').fingerprint(executable);}catch{}
 const inv=inventory(dir);let unsupported=null,preparing=null;
 /* cx archives are decrypted here, not by a background worker the probe would not wait for */
 try{require('./original-engines/scenes.cjs').cxPrepareSync(dir,{deadline:t+budgetMs/2});}catch{}
 try{const scenes=require('./original-engines/scenes.cjs');unsupported=scenes.unsupportedReason(dir);preparing=scenes.preparing(dir)?.kind||null;}catch{}
 const engines=[...nativeEngines(dir,executable),...runEngines(dir,{deadline})];
 const c=classify({engines,inventory:inv,unsupported,preparing,title});const best=engines.find(e=>e.id===c.detected);
 return {schema:'megulit.probe-result',version:1,reader:reader(),ms:Date.now()-t,fingerprint:fingerprint?{key:fingerprint.key,exe:maskString(fingerprint.exe),size:fingerprint.size}:null,
  inventory:{files:inv.files,bytes:inv.bytes,ext:inv.ext,scripts:inv.scripts,archives:inv.archives.map(({_path,...a})=>a)},
  engines:engines.map(({sizes,...e})=>e),detected:c.detected,lines:best?.lines||0,japaneseLines:best?.japaneseLines||0,dialogueLines:best?.dialogueLines||0,chineseLines:best?.chineseLines||0,sizes:best?.sizes||[],
  step:c.step,detail:c.detail,unsupported:unsupported?{engine:unsupported.engine,code:unsupported.code}:null,preparing,_archives:inv.archives.map(a=>a._path)};
}
module.exports={probeGame,classify,judgeLanguage,countLines,inventory,reader,MAGICS};
