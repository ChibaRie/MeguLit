'use strict';
/* E595 a Chinese patch laid over the Japanese release in the same folder (user 2026-11-15, 死に逝く君、館に芽吹く憎悪
   汉化硬盘版: data.xp3 + .sig are the Japanese release, patch.xp3 from a month later with no .sig is the translation,
   KiriKiri reads patch*.xp3 last so it wins). The restore check only saw the KiriKiri language switch and said "already
   Japanese"; importing the Japanese release from the same folder was refused. Read-only here: which files are the
   overlay and why. Turning it off is the import's "remove" step (core/japanese-import-original.cjs), backed up first.
   Overlays: the import's known Chinese overrides (patch*.xp3, update*.ypf, archives named cn/chs/汉化), when this folder
   also holds the release they lie over. Signs, any one is enough:
   - the overlay's own text is Chinese (lines with Han but no kana outnumber lines with kana)
   - every release archive carries a signature (.sig) and the overlay does not
   - the folder or a file beside it says 汉化 / 中文 (a translated "hard disk edition") */
const fs=require('node:fs'),path=require('node:path');
const KANA=/[ぁ-ゖァ-ヺ]/,HAN=/[一-鿿]/,MARK=/汉化|漢化|中文|简体|繁體|簡體/;
function override(){return require('./japanese-import-original.cjs')._internal.OVERRIDE;}
const stat=f=>{try{return fs.statSync(f);}catch{return null;}};
/* Chinese share of an xp3's readable text (.ks / .txt / .csv / .tjs), or null when nothing could be read */
function xp3Chinese(file){
 let x,l;try{x=require('../services/original-engines/xp3.cjs');l=x.list(file)?.files;}catch{return null;}if(!l)return null;
 let han=0,kana=0;const td=new TextDecoder('gbk'),sj=new TextDecoder('shift_jis');
 for(const e of l.filter(e=>!e.encrypted&&/\.(ks|txt|csv|tjs)$/i.test(e.name)&&e.size<2e6).slice(0,60)){let b;try{b=x.read(file,e);}catch{continue;}if(!Buffer.isBuffer(b))continue;
  let t;if(b[0]===0xff&&b[1]===0xfe)t=b.toString('utf16le');else{const u=b.toString('utf8');if(!u.includes('�'))t=u;else{const g=td.decode(b),s=sj.decode(b);t=(g.match(/�/g)||[]).length<=(s.match(/�/g)||[]).length?g:s;}}
  for(const line of t.split(/\r?\n/)){if(/^\s*(;|\/\/|@|\[)/.test(line)&&!/[「」]/.test(line))continue;if(KANA.test(line))kana++;else if(HAN.test(line))han++;}}
 return han+kana<10?null:han/(han+kana);
}
function detect(gameDir){
 gameDir=path.resolve(String(gameDir||''));let names=[];try{names=fs.readdirSync(gameDir);}catch{return {translated:false,overlays:[]};}
 const isOverride=override(),lower=new Set(names.map(n=>n.toLowerCase()));
 const overlays=names.filter(n=>isOverride(n)&&stat(path.join(gameDir,n))?.isFile());
 if(!overlays.length)return {translated:false,overlays:[]};
 /* the release they lie over: other archives of the same kind that are not overrides */
 const kinds=new Set(overlays.map(n=>path.extname(n).toLowerCase()));
 const release=names.filter(n=>kinds.has(path.extname(n).toLowerCase())&&!isOverride(n));
 if(!release.length)return {translated:false,overlays:[]};
 const evidence=[],out=[];
 const signed=release.every(n=>lower.has(n.toLowerCase()+'.sig'));
 const marked=MARK.test(path.basename(gameDir))||names.some(n=>MARK.test(n)&&!/\.exe$/i.test(n));
 for(const n of overlays){const why=[];
  const zh=/\.xp3$/i.test(n)?xp3Chinese(path.join(gameDir,n)):null;
  if(zh!==null&&zh>=.5)why.push('chinese-text');
  if(signed&&!lower.has(n.toLowerCase()+'.sig'))why.push('unsigned');
  if(marked)why.push('marked');
  if(zh!==null&&zh<.2)continue; /* its text is Japanese: an official patch, never moved */
  if(why.length)out.push({file:n,size:stat(path.join(gameDir,n))?.size||0,why,chinese:zh});}
 for(const o of out)for(const w of o.why)if(!evidence.includes(w))evidence.push(w);
 return {translated:out.length>0,overlays:out,release,evidence};
}
module.exports={detect,_internal:{xp3Chinese}};
