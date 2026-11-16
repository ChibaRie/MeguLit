// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* E700 MAGES. SC3 scripts inside CRI CPK (ゆのはな: data/script.cpk holds 886 *.scx, data/scrchs.cpk the Chinese set).
   The SC3 format and its glyph sheets are mages.cjs (E342); only the container differs: cri-cpk.cjs lists the CPK, each
   .scx ("SC3\0") is read and parsed there. A Chinese script CPK beside it (scr*chs / *cn / *zh .cpk) gives each Japanese
   line its translation when both scripts of a scene have the same number of lines. */
const fs=require('node:fs'),path=require('node:path');
const cpk=require('./cri-cpk.cjs'),mages=require('./mages.cjs');
const {stat}=require('./file-key.cjs');
const KANA=/[ぁ-ゖァ-ヺ]/,HANS=/[们这说话时个来对没还让门见问题电车为样边过东华爱头间学认长听写书钱后于]/g;
function cpkFiles(dir){const out=[];for(const sub of ['','data','Data']){let names;try{names=fs.readdirSync(path.join(dir,sub));}catch{continue;}for(const n of names)if(/\.cpk$/i.test(n)&&/scr|script|scenario/i.test(n))out.push(path.join(dir,sub,n));}return out.sort();}
/* a CPK that holds SC3 scripts: { file, entries } */
const memo=new Map();
function scriptSets(dir){const files=cpkFiles(dir),sig=files.map(f=>f+'|'+stat(f)).join('\n'),hit=memo.get(dir);if(hit&&hit.sig===sig)return hit.sets;
 const sets=[];for(const f of files){let l=null;try{l=cpk.list(f);}catch{}if(!l)continue;const scx=l.filter(e=>/\.scx$/i.test(e.name));if(!scx.length)continue;
  let ok=false;try{ok=cpk.read(f,scx[0]).toString('latin1',0,4)==='SC3\0';}catch{}if(ok)sets.push({file:f,entries:new Map(scx.map(e=>[e.name.toLowerCase(),e]))});}
 memo.set(dir,{sig,sets});if(memo.size>4)memo.delete(memo.keys().next().value);return sets;}
const parseOne=b=>{const p=mages.parse(b);const o={lines:p.lines,anchors:p.anchors,ruby:p.ruby};if(p.voices)o.voices=p.voices;
 if(b.zhRead){try{const z=mages.parse(b.zhRead()).lines;if(z.length===p.lines.length)o.zh=z;}catch{}}return o;};
function split(sets){/* the Japanese set is the one whose scenes read as kana; the Chinese one carries many simplified characters */
 let ja=null,zh=null;for(const s of sets){let lines=[];for(const e of [...s.entries.values()].filter(x=>x.size>4000).slice(0,12)){try{const b=cpk.read(s.file,e);if(b.length!==e.extract)continue;lines=parseOne(b).lines;if(lines.length)break;}catch{}}
  const text=lines.join('');const kana=(text.match(/[ぁ-ゖァ-ヺ]/g)||[]).length,hans=(text.match(HANS)||[]).length;
  if(/chs|cn|zh|sc\b/i.test(path.basename(s.file))&&hans>=kana/4)zh=zh||s;else if(kana>text.length*.1)ja=ja||s;}
 return {ja,zh};}
const engine={id:'mages-cpk',hint:'data\script.cpk（MAGES SC3 *.scx）',
 scenes(dir){const {ja,zh}=split(scriptSets(dir));if(!ja)return [];
  return [...ja.entries.values()].map(e=>({name:e.name,read:()=>{const b=cpk.read(ja.file,e);const ze=zh?.entries.get(e.name.toLowerCase());if(ze)b.zhRead=()=>cpk.read(zh.file,ze);return b;}})).sort((a,b)=>a.name.localeCompare(b.name));},
 archives:()=>[],sources:dir=>{const {ja,zh}=split(scriptSets(dir));return [ja?.file,zh?.file].filter(Boolean);},
 parse:buf=>parseOne(buf),test:()=>false,
 /* the Chinese script's line of each Japanese line (same scene, same line count) */
 patchLines(base){let any=false;const list=base.map(scene=>{const zh=scene.zh||[];if(!zh.some(Boolean))return scene;any=true;return {...scene,patched:true,lines:scene.lines.map((t,k)=>zh[k]||t)};});return any?list:null;},
};
module.exports={engine,scriptSets,split};
