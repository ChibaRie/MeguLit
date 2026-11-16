// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const kit=require('./kit.cjs');
/* Nitro+ NPA ("NPA\x01", N2System: Chaos;Head, Muramasa, Demonbane, DRAMAtical Murder ...). The container and its per-title
   ciphers are core/nitroplus-npa.cjs (GARbro ArcNPA, scheme table from Formats.dat); with no title known every scheme is
   tried. Scripts are the .nss text entries. A line of text is what is left of a script line after its <...> tags and
   // comments; <VOICE name="..."> names the speaker and <RUBY text="よみ">漢字</RUBY> is the game's own reading. */
const fs=require('node:fs'),path=require('node:path'),npa=require('../../core/nitroplus-npa.cjs');
const memo=new Map();
function open(file){const st=fs.statSync(file),key=path.resolve(file).toLowerCase()+'|'+st.size+'|'+st.mtimeMs;if(memo.has(key))return memo.get(key);
 let arc=null;try{arc=npa.openNpa(file);}catch{arc=null;}memo.clear();memo.set(key,arc);return arc;}
function list(file){const arc=open(file);if(!arc)return null;return arc.entries.map(e=>({name:e.name,read:()=>npa.npaData(arc,e)}));}
function decode(buf){const u=buf.toString('utf8');return u.includes('\ufffd')?kit.SJIS.decode(buf):u.replace(/^\ufeff/,'');}
function parse(buf){const lines=[],ruby=[],anchors=[];
 for(const raw of decode(buf).split(/\r\n|\r|\n/)){const t=raw.trim();if(!t||t.startsWith('//')){continue;}
  const name=(/<VOICE\b[^>]*\bname="([^"]*)"/i.exec(t)||[])[1];const pairs=[];
  const text=t.replace(/<RUBY\s+text="([^"]*)">([^<]*)<\/RUBY>/gi,(_,r,b)=>{pairs.push([b,r]);return b;}).replace(/<[^>]*>/g,'').trim();
  if(!text||!/[ぁ-ゖァ-ヺ一-龯]/.test(text)){anchors.push(t.slice(0,40));continue;}
  if(name){lines.push(name);ruby.push(null);}lines.push(text);ruby.push(pairs.length?pairs:null);}
 return {lines,anchors,ruby};}
const engine=kit.engine({id:'nitro-npa',hint:'nss.npa',overlay:false,
 archives:{name:/\.npa$/i,subs:['','..'],list,entry:/\.nss$/i,sort:false},parse,test:n=>/\.nss$/i.test(n)});
module.exports={list,parse,engine};
