// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* E700 LZMA (LZMA1, "LZMA alone" without the size field) decoder, after Igor Pavlov's public-domain LzmaSpec.cpp.
   Unity asset bundles compress blocks with it (UnityFS flag 1: 5 property bytes, then the range-coded stream; the
   uncompressed size comes from the block table). decode(src, size[, props]) → Buffer of size bytes; props is the
   5-byte property header when the stream does not start with it. */
function decode(src,size,props=null){
 let p=0;const pr=props||src.subarray(0,5);if(!props)p=5;
 let d=pr[0];if(d>=9*5*5)throw Error('LZMA_PROPS');const lc=d%9;d=(d/9)|0;const lp=d%5,pb=(d/5)|0;
 const out=Buffer.alloc(size);let pos=0;
 /* range decoder */
 let range=0xFFFFFFFF,code=0;p++;for(let i=0;i<4;i++)code=((code<<8)|src[p++])>>>0;
 const norm=()=>{if(range<0x1000000){range=(range<<8)>>>0;code=((code<<8)|(p<src.length?src[p++]:0))>>>0;}};
 const bit=(probs,i)=>{const v=probs[i],bound=(range>>>11)*v;let b;if(code<bound){probs[i]=v+((2048-v)>>5);range=bound;b=0;}else{probs[i]=v-(v>>5);code=(code-bound)>>>0;range=(range-bound)>>>0;b=1;}norm();return b;};
 const direct=n=>{let r=0;while(n--){range>>>=1;let t;if(code>=range){code=(code-range)>>>0;t=1;}else t=0;r=((r<<1)|t)>>>0;norm();}return r;};
 const P=n=>new Uint16Array(n).fill(1024);
 const tree=(probs,base,bits)=>{let m=1;for(let i=0;i<bits;i++)m=(m<<1)+bit(probs,base+m);return m-(1<<bits);};
 const rtree=(probs,base,bits)=>{let m=1,s=0;for(let i=0;i<bits;i++){const b=bit(probs,base+m);m=(m<<1)+b;s|=b<<i;}return s;};
 const lenCoder=()=>({c:P(2),low:P(16<<3),mid:P(16<<3),high:P(256)});
 const len=(L,ps)=>{if(!bit(L.c,0))return tree(L.low,ps<<3,3);if(!bit(L.c,1))return 8+tree(L.mid,ps<<3,3);return 16+tree(L.high,0,8);};
 const lit=P(0x300<<(lc+lp)),posSlot=P(4<<6),posDec=P(115),align=P(16),isMatch=P(12<<4),isRep=P(12),g0=P(12),g1=P(12),g2=P(12),rep0Long=P(12<<4),lenD=lenCoder(),repD=lenCoder();
 let state=0,r0=0,r1=0,r2=0,r3=0;const pbMask=(1<<pb)-1,lpMask=(1<<lp)-1;
 while(pos<size){const ps=pos&pbMask;
  if(!bit(isMatch,(state<<4)+ps)){const prev=pos?out[pos-1]:0,base=0x300*(((pos&lpMask)<<lc)+(prev>>(8-lc)));let s=1;
   if(state>=7){let mb=out[pos-r0-1];do{const m=(mb>>7)&1;mb<<=1;const b=bit(lit,base+((1+m)<<8)+s);s=(s<<1)|b;if(m!==b)break;}while(s<0x100);}
   while(s<0x100)s=(s<<1)|bit(lit,base+s);out[pos++]=s-0x100;state=state<4?0:state<10?state-3:state-6;continue;}
  let n;
  if(bit(isRep,state)){if(!pos)throw Error('LZMA_DATA');
   if(!bit(g0,state)){if(!bit(rep0Long,(state<<4)+ps)){state=state<7?9:11;out[pos]=out[pos-r0-1];pos++;continue;}}
   else{let dist;if(!bit(g1,state))dist=r1;else{if(!bit(g2,state))dist=r2;else{dist=r3;r3=r2;}r2=r1;}r1=r0;r0=dist;}
   n=len(repD,ps);state=state<7?8:11;}
  else{r3=r2;r2=r1;r1=r0;n=len(lenD,ps);state=state<7?7:10;
   const slot=tree(posSlot,Math.min(n,3)<<6,6);
   if(slot<4)r0=slot;else{const nd=(slot>>1)-1;let dist=((2|(slot&1))<<nd)>>>0;
    if(slot<14)dist=(dist+rtree(posDec,dist-slot,nd))>>>0;else{dist=(dist+(direct(nd-4)<<4))>>>0;dist=(dist+rtree(align,0,4))>>>0;}r0=dist;}
   if(r0===0xFFFFFFFF)break;}
  n+=2;if(r0>=pos)throw Error('LZMA_DIST');for(let k=0;k<n&&pos<size;k++){out[pos]=out[pos-r0-1];pos++;}}
 return pos===size?out:out.subarray(0,pos);}
module.exports={decode};
