// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* E700 CRI CPK archives (CRIWARE file system: Danganronpa V3, ゆのはな, APOLLOCRISIS, many console ports). Layout after
   CriPakTools / vgmtoolbox / VGMStream's cpk docs: "CPK " chunk + @UTF table (CpkHeader: TocOffset, ContentOffset,
   EtocOffset, ItocOffset, Files); "TOC " chunk + @UTF table with DirName / FileName / FileSize / ExtractSize / FileOffset
   (offsets count from min(TocOffset, ContentOffset)); ITOC (id-only files, DataL / DataH) when there is no TOC.
   Both tables may be masked with the CRI @UTF stream cipher (key 0x655f, step 0x4115). Files with ExtractSize > FileSize
   are CRILAYLA compressed ("CRILAYLA" + u32 size + u32 header size, the stream is read backwards, 9 bit tokens for
   references, 8 bit literals, uncompressed 0x100 byte header kept in front).
   list(file) → [{name, offset, size, extract}], read(file, entry) → Buffer (decompressed when needed). */
const fs=require('node:fs');
const kit=require('./kit.cjs');

/* @UTF table → { rows:[{col:value}] } */
function unmask(b){const out=Buffer.from(b);let m=0x655f;for(let i=0;i<out.length;i++){out[i]^=m&0xff;m=(Math.imul(m,0x4115))>>>0;}return out;}
function utf(buf){
 let t=buf;if(t.toString('latin1',0,4)!=='@UTF'){t=unmask(buf);if(t.toString('latin1',0,4)!=='@UTF')return null;}
 const base=8,rowsOff=t.readUInt16BE(10)+base,strOff=t.readUInt32BE(12)+base,dataOff=t.readUInt32BE(16)+base,cols=t.readUInt16BE(24),rowLen=t.readUInt16BE(26),nRows=t.readUInt32BE(28);
 const str=o=>{const s=strOff+o,e=t.indexOf(0,s);return t.toString('utf8',s,e<0?t.length:e);};
 let p=32;const schema=[];
 for(let i=0;i<cols;i++){const flags=t[p++],name=str(t.readUInt32BE(p));p+=4;const type=flags&15,store=flags>>4;let val;
  if(store===3){const r=read(type,p);val=r.v;p=r.p;}schema.push({name,type,store,val});}
 function read(type,q){switch(type){case 0:return {v:t[q],p:q+1};case 1:return {v:t.readInt8(q),p:q+1};case 2:return {v:t.readUInt16BE(q),p:q+2};case 3:return {v:t.readInt16BE(q),p:q+2};
   case 4:return {v:t.readUInt32BE(q),p:q+4};case 5:return {v:t.readInt32BE(q),p:q+4};case 6:case 7:return {v:Number(t.readBigUInt64BE(q)),p:q+8};case 8:return {v:t.readFloatBE(q),p:q+4};
   case 10:return {v:str(t.readUInt32BE(q)),p:q+4};case 11:{const o=t.readUInt32BE(q),n=t.readUInt32BE(q+4);return {v:t.subarray(dataOff+o,dataOff+o+n),p:q+8};}default:throw Error('CPK_UTF_TYPE');}}
 const rows=[];for(let r=0;r<nRows;r++){let q=rowsOff+r*rowLen;const row={};
  for(const c of schema){if(c.store===5){const x=read(c.type,q);row[c.name]=x.v;q=x.p;}else if(c.store===3)row[c.name]=c.val;else row[c.name]=null;}rows.push(row);}
 return {rows,name:str(t.readUInt32BE(20))};}

function chunk(fd,offset){const h=Buffer.alloc(16);if(fs.readSync(fd,h,0,16,offset)<16)return null;const size=h.readUInt32LE(8);if(size<16||size>1<<28)return null;
 const b=Buffer.alloc(size);fs.readSync(fd,b,0,size,offset+16);return {magic:h.toString('latin1',0,4),table:utf(b)};}

const memo=new Map();
function list(file){const key=file;if(memo.has(key))return memo.get(key);let fd,out=null;
 try{fd=fs.openSync(file,'r');const head=Buffer.alloc(4);fs.readSync(fd,head,0,4,0);if(head.toString('latin1')!=='CPK ')throw 0;
  const hdr=chunk(fd,0)?.table?.rows[0];if(!hdr)throw 0;
  const toc=Number(hdr.TocOffset||0),content=Number(hdr.ContentOffset||0),itoc=Number(hdr.ItocOffset||0);const baseAdd=toc&&content?Math.min(toc,content):(toc||content);out=[];
  if(toc){const t=chunk(fd,toc)?.table;if(t)for(const r of t.rows){const dir=r.DirName||'',name=r.FileName;if(!name)continue;out.push({name:(dir?dir+'/':'')+name,offset:Number(r.FileOffset)+baseAdd,size:r.FileSize,extract:r.ExtractSize||r.FileSize});}}
  else if(itoc){const t=chunk(fd,itoc)?.table;if(t?.rows[0]){const r0=t.rows[0];for(const key of ['DataL','DataH']){const sub=r0[key]&&Buffer.isBuffer(r0[key])?utf(r0[key]):null;if(!sub)continue;
     /* ids are small ids; their offsets follow in file order from ContentOffset */
     let pos=content;for(const r of sub.rows){const sz=r.FileSize;out.push({name:String(r.ID).padStart(5,'0')+'.bin',offset:pos,size:sz,extract:r.ExtractSize||sz});pos+=(sz+(Number(hdr.Align||2048)-1))&~(Number(hdr.Align||2048)-1);}}}}
 }catch{out=null;}finally{if(fd!==undefined)fs.closeSync(fd);}
 memo.set(key,out);if(memo.size>12)memo.delete(memo.keys().next().value);return out;}

/* CRILAYLA: the compressed stream is read from its end towards its start; output is written from its end backwards */
function layla(src){
 if(src.toString('latin1',0,8)!=='CRILAYLA')return src;
 const usize=src.readUInt32LE(8),hsize=src.readUInt32LE(12),out=Buffer.alloc(usize+0x100);
 src.copy(out,0,src.length-0x100);/* the last 0x100 bytes of the stream are the plain head of the file */
 let sp=src.length-0x100-1,bits=0,left=0,n=0;const end=usize+0x100-1,stop=0x10;
 const get=k=>{let v=0;while(k>0){if(!left){if(sp<stop)throw Error('CRILAYLA_EOF');bits=src[sp--];left=8;}const t=Math.min(k,left);left-=t;v=(v<<t)|((bits>>left)&((1<<t)-1));k-=t;}return v;};
 while(n<usize){
  if(get(1)){const off=get(13)+3;let len=3;const lv=[2,3,5,8];
   for(let i=0;i<4;i++){const x=get(lv[i]);len+=x;if(x!==(1<<lv[i])-1)break;if(i===3){let y;do{y=get(8);len+=y;}while(y===255);}}
   for(let k=0;k<len&&n<usize;k++){out[end-n]=out[end-n+off+1];n++;}}
  else{out[end-n]=get(8);n++;}}
 return out;}

function read(file,e){const raw=kit.readAt(file,e.offset,e.size);return e.extract>e.size?layla(raw):raw;}
module.exports={list,read,layla,utf,unmask};
