// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-19 (user: MeguLit's Japanese should look like the game's own text; 千恋＊万花 draws its dialogue with
   "スキップ", a Fontworks LETS face shipped only as KiriKiri pre-rendered glyph files, data.xp3 font/font1_<size>.tft).
   A pre-rendered font is a bitmap per character, so the reader cannot use it as is. This turns the largest size into an
   outline TrueType font for this PC only: every glyph's grey bitmap (65 levels) is traced at half coverage with
   marching squares (sub-pixel crossings from the grey levels), simplified, and written as straight-line contours.
   At reading sizes the result matches the game's glyph shapes; characters the game never drew are not in the file
   and fall back to the reader's next font.
   KiriKiri pre-rendered font (krkr2/krkrz PrerenderedFont): "TVP pre-rendered font\x1a", u8 version (0 raw, 1 run-length:
   a byte >= 0x41 repeats the last value (byte - 0x40) times), u8 character size (2 = UTF-16), u32 count, u32 offset of
   the code table (u16 each, ascending), u32 offset of the items: {u32 bitmap offset, u16 width, u16 height, i16 origin x,
   i16 origin y (top of the bitmap above the baseline), i16 inc x, i16 inc y, i16 inc, u16 reserved}. */
const MAGIC='TVP pre-rendered font\x1a';

function isPrerendered(b){return Buffer.isBuffer(b)&&b.length>36&&b.toString('latin1',0,22)===MAGIC&&b[23]===2;}
function parse(b){
 if(!isPrerendered(b))return null;const version=b[22],count=b.readUInt32LE(24),codes=b.readUInt32LE(28),items=b.readUInt32LE(32);
 if(version>1||count<1||count>65535||codes+count*2>b.length||items+count*20>b.length)return null;
 const glyphs=[];
 for(let i=0;i<count;i++){const it=items+i*20,code=b.readUInt16LE(codes+i*2),offset=b.readUInt32LE(it),w=b.readUInt16LE(it+4),h=b.readUInt16LE(it+6);
  const g={code,w,h,ox:b.readInt16LE(it+8),oy:b.readInt16LE(it+10),inc:b.readInt16LE(it+12)||b.readInt16LE(it+16),offset};
  if(w*h>0&&w<=512&&h<=512&&offset<b.length)g.bitmap=()=>bitmap(b,version,offset,w*h);glyphs.push(g);}
 return {version,glyphs};
}
function bitmap(b,version,at,n){const out=new Uint8Array(n);
 if(version===0){b.copy(Buffer.from(out.buffer),0,at,Math.min(b.length,at+n));return out;}
 let p=at,d=0,last=0;while(d<n&&p<b.length){const v=b[p++];if(v>=0x41){let c=v-0x40;while(c--&&d<n)out[d++]=last;}else out[d++]=last=v;}return out;}

/* --- tracing: oriented marching squares at half coverage, inside on the left in image space (y down), so contours
   are clockwise once y points up (TrueType outer contours); holes come out the other way round by construction --- */
function trace(values,w,h,level=32){
 const W=w+2,H=h+2,v=(x,y)=>x<1||y<1||x>w||y>h?0:values[(y-1)*w+(x-1)];
 const point=new Map(),next=new Map();
 const cross=(key,ax,ay,bx,by)=>{if(!point.has(key)){const va=v(ax,ay),vb=v(bx,by),t=va===vb?0.5:(level-va)/(vb-va);point.set(key,[ax+(bx-ax)*t,ay+(by-ay)*t]);}return key;};
 for(let y=0;y<H-1;y++)for(let x=0;x<W-1;x++){
  const c=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],ins=c.map(([px,py])=>v(px,py)>=level);
  if(ins.every(Boolean)||!ins.some(Boolean))continue;
  /* edges clockwise (image space): top, right, bottom, left; each is shared with the neighbour cell by its key */
  const edges=[['h',x,y,0,1],['v',x+1,y,1,2],['h',x,y+1,2,3],['v',x,y,3,0]],found=[];
  for(const [kind,ex,ey,a,bI] of edges){if(ins[a]===ins[bI])continue;const key=kind+ex+','+ey;cross(key,c[a][0],c[a][1],c[bI][0],c[bI][1]);found.push({key,into:!ins[a]&&ins[bI]});}
  if(found.length===2){const a=found.find(f=>f.into),o=found.find(f=>!f.into);next.set(a.key,o.key);}
  else if(found.length===4){const center=(v(x,y)+v(x+1,y)+v(x+1,y+1)+v(x,y+1))/4>=level;
   /* found is in walk order and alternates; inside corners joined through an inside centre */
   const i0=found.findIndex(f=>f.into),seq=[0,1,2,3].map(k=>found[(i0+k)%4]);/* in1,out1,in2,out2 */
   if(center){next.set(seq[0].key,seq[3].key);next.set(seq[2].key,seq[1].key);}else{next.set(seq[0].key,seq[1].key);next.set(seq[2].key,seq[3].key);}}
 }
 const loops=[],done=new Set();
 for(const start of next.keys()){if(done.has(start))continue;const loop=[];let k=start;
  while(k!==undefined&&!done.has(k)){done.add(k);loop.push(point.get(k));k=next.get(k);}
  if(loop.length>=3)loops.push(loop);}
 return loops;/* points in padded pixel-centre space: pixel (i, j) has its centre at (i + 1, j + 1) */
}
function simplify(loop,tol=0.12){
 if(loop.length<8)return loop;
 const rdp=(pts)=>{if(pts.length<3)return pts;const [ax,ay]=pts[0],[bx,by]=pts[pts.length-1],dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1;let far=0,at=0;
  for(let i=1;i<pts.length-1;i++){const d=Math.abs((pts[i][0]-ax)*dy-(pts[i][1]-ay)*dx)/len;if(d>far){far=d;at=i;}}
  if(far<=tol)return [pts[0],pts[pts.length-1]];const l=rdp(pts.slice(0,at+1)),r=rdp(pts.slice(at));return l.slice(0,-1).concat(r);};
 /* a closed loop is split at its farthest point from the first one */
 let far=0,at=0;for(let i=1;i<loop.length;i++){const d=Math.hypot(loop[i][0]-loop[0][0],loop[i][1]-loop[0][1]);if(d>far){far=d;at=i;}}
 const a=rdp(loop.slice(0,at+1)),b=rdp(loop.slice(at).concat([loop[0]]));const out=a.slice(0,-1).concat(b.slice(0,-1));
 return out.length>=3?out:loop;
}
const area=pts=>{let s=0;for(let i=0;i<pts.length;i++){const [x1,y1]=pts[i],[x2,y2]=pts[(i+1)%pts.length];s+=x1*y2-x2*y1;}return s/2;};

/* --- TrueType writer: straight-line contours, cmap format 4, names in English and Japanese --- */
function ttf({family,glyphs,upm,ascent,descent}){
 const all=[{advance:Math.round(upm/2),contours:[]},...glyphs];const n=all.length;
 const glyf=[],loca=[0];let bbox=[0,0,0,0],maxPts=0,maxCnt=0,first=true;
 for(const g of all){
  if(!g.contours.length){loca.push(loca[loca.length-1]);glyf.push(Buffer.alloc(0));g.xMin=0;continue;}
  let xs=[],ys=[],ends=[],count=0;for(const c of g.contours){for(const [x,y] of c){xs.push(x);ys.push(y);}count+=c.length;ends.push(count-1);}
  const xMin=Math.min(...xs),yMin=Math.min(...ys),xMax=Math.max(...xs),yMax=Math.max(...ys);g.xMin=xMin;
  if(first){bbox=[xMin,yMin,xMax,yMax];first=false;}else bbox=[Math.min(bbox[0],xMin),Math.min(bbox[1],yMin),Math.max(bbox[2],xMax),Math.max(bbox[3],yMax)];
  maxPts=Math.max(maxPts,count);maxCnt=Math.max(maxCnt,g.contours.length);
  const head=Buffer.alloc(10+ends.length*2+2);head.writeInt16BE(g.contours.length,0);head.writeInt16BE(xMin,2);head.writeInt16BE(yMin,4);head.writeInt16BE(xMax,6);head.writeInt16BE(yMax,8);
  ends.forEach((e,i)=>head.writeUInt16BE(e,10+i*2));head.writeUInt16BE(0,10+ends.length*2);
  const flags=Buffer.alloc(count,1),dx=Buffer.alloc(count*2),dy=Buffer.alloc(count*2);let px=0,py=0;
  for(let i=0;i<count;i++){dx.writeInt16BE(xs[i]-px,i*2);dy.writeInt16BE(ys[i]-py,i*2);px=xs[i];py=ys[i];}
  let body=Buffer.concat([head,flags,dx,dy]);if(body.length%4)body=Buffer.concat([body,Buffer.alloc(4-body.length%4)]);
  glyf.push(body);loca.push(loca[loca.length-1]+body.length);}
 const T={};
 T.glyf=Buffer.concat(glyf);
 T.loca=Buffer.alloc(loca.length*4);loca.forEach((o,i)=>T.loca.writeUInt32BE(o,i*4));
 T.hmtx=Buffer.alloc(n*4);all.forEach((g,i)=>{T.hmtx.writeUInt16BE(Math.max(0,g.advance),i*4);T.hmtx.writeInt16BE(g.xMin||0,i*4+2);});
 const maxAdvance=Math.max(...all.map(g=>g.advance));
 T.head=Buffer.alloc(54);T.head.writeUInt32BE(0x00010000,0);T.head.writeUInt32BE(0x00010000,4);T.head.writeUInt32BE(0x5F0F3CF5,12);T.head.writeUInt16BE(0x000B,16);T.head.writeUInt16BE(upm,18);
 T.head.writeInt16BE(bbox[0],36);T.head.writeInt16BE(bbox[1],38);T.head.writeInt16BE(bbox[2],40);T.head.writeInt16BE(bbox[3],42);T.head.writeUInt16BE(8,46);T.head.writeInt16BE(2,48);T.head.writeInt16BE(1,50);
 T.hhea=Buffer.alloc(36);T.hhea.writeUInt32BE(0x00010000,0);T.hhea.writeInt16BE(ascent,4);T.hhea.writeInt16BE(-descent,6);T.hhea.writeUInt16BE(maxAdvance,10);T.hhea.writeInt16BE(bbox[0],12);T.hhea.writeInt16BE(0,14);T.hhea.writeInt16BE(bbox[2],16);T.hhea.writeInt16BE(1,18);T.hhea.writeUInt16BE(n,34);
 T.maxp=Buffer.alloc(32);T.maxp.writeUInt32BE(0x00010000,0);T.maxp.writeUInt16BE(n,4);T.maxp.writeUInt16BE(maxPts,6);T.maxp.writeUInt16BE(maxCnt,8);T.maxp.writeUInt16BE(1,14);
 T.post=Buffer.alloc(32);T.post.writeUInt32BE(0x00030000,0);
 const codes=glyphs.map((g,i)=>[g.code,i+1]).sort((a,b)=>a[0]-b[0]);
 const os2=Buffer.alloc(96);os2.writeUInt16BE(4,0);os2.writeInt16BE(Math.round(upm/2),2);os2.writeUInt16BE(400,4);os2.writeUInt16BE(5,6);os2.writeUInt16BE(0,8);
 os2.writeUInt32BE(0x00000001|0x00020000,42+0);/* unicode ranges: Latin, CJK */os2.writeUInt32BE(0x00000000,46);os2.writeUInt32BE(0x00000000,50);os2.writeUInt32BE(0,54);
 os2.write('MGLT',58,'latin1');os2.writeUInt16BE(0x40,62);os2.writeUInt16BE(codes[0]?.[0]||0x20,64);os2.writeUInt16BE(Math.min(0xffff,codes[codes.length-1]?.[0]||0x20),66);
 os2.writeInt16BE(ascent,68);os2.writeInt16BE(-descent,70);os2.writeInt16BE(0,72);os2.writeUInt16BE(Math.max(ascent,bbox[3]),74);os2.writeUInt16BE(Math.max(descent,-bbox[1]),76);
 os2.writeUInt32BE(0x00020000,78);/* code pages: JIS */os2.writeInt16BE(Math.round(ascent*0.5),86);os2.writeInt16BE(ascent,88);os2.writeUInt16BE(0,90);os2.writeUInt16BE(0x20,92);os2.writeUInt16BE(1,94);
 T['OS/2']=os2;
 /* cmap format 4: one segment per run of consecutive codes with consecutive glyph ids */
 const segs=[];for(const [c,g] of codes){const s=segs[segs.length-1];if(s&&c===s.end+1&&g===s.glyph+(c-s.start))s.end=c;else segs.push({start:c,end:c,glyph:g});}
 segs.push({start:0xffff,end:0xffff,glyph:0});
 const sc=segs.length,f4=Buffer.alloc(16+sc*8);f4.writeUInt16BE(4,0);f4.writeUInt16BE(f4.length,2);f4.writeUInt16BE(sc*2,6);
 const p2=2**Math.floor(Math.log2(sc));f4.writeUInt16BE(p2*2,8);f4.writeUInt16BE(Math.log2(p2),10);f4.writeUInt16BE(sc*2-p2*2,12);
 segs.forEach((s,i)=>{f4.writeUInt16BE(s.end,14+i*2);f4.writeUInt16BE(s.start,16+sc*2+i*2);f4.writeUInt16BE(s.start===0xffff?1:((s.glyph-s.start)&0xffff),16+sc*4+i*2);f4.writeUInt16BE(0,16+sc*6+i*2);});
 const cm=Buffer.alloc(12);cm.writeUInt16BE(0,0);cm.writeUInt16BE(1,2);cm.writeUInt16BE(3,4);cm.writeUInt16BE(1,6);cm.writeUInt32BE(12,8);T.cmap=Buffer.concat([cm,f4]);
 /* name: family, subfamily, full name, PostScript name (ASCII), in English and Japanese */
 const ps=('MeguLit-'+Buffer.from(family).toString('hex').slice(0,40)).slice(0,60);
 const recs=[];for(const lang of [0x409,0x411])for(const [id,text] of [[1,family],[2,'Regular'],[4,family],[6,ps]])recs.push({lang,id,text:Buffer.from(text,'utf16le').swap16()});
 const strings=Buffer.concat(recs.map(r=>r.text));const nm=Buffer.alloc(6+recs.length*12);nm.writeUInt16BE(0,0);nm.writeUInt16BE(recs.length,2);nm.writeUInt16BE(6+recs.length*12,4);
 let off=0;recs.forEach((r,i)=>{const o=6+i*12;nm.writeUInt16BE(3,o);nm.writeUInt16BE(1,o+2);nm.writeUInt16BE(r.lang,o+4);nm.writeUInt16BE(r.id,o+6);nm.writeUInt16BE(r.text.length,o+8);nm.writeUInt16BE(off,o+10);off+=r.text.length;});
 T.name=Buffer.concat([nm,strings]);
 /* table directory, 4-byte aligned tables, checksums, head.checkSumAdjustment */
 const tags=Object.keys(T).sort(),num=tags.length,dir=Buffer.alloc(12+num*16),p=2**Math.floor(Math.log2(num));
 dir.writeUInt32BE(0x00010000,0);dir.writeUInt16BE(num,4);dir.writeUInt16BE(p*16,6);dir.writeUInt16BE(Math.log2(p),8);dir.writeUInt16BE(num*16-p*16,10);
 const sum=buf=>{let s=0;const pad=Buffer.concat([buf,Buffer.alloc((4-buf.length%4)%4)]);for(let i=0;i<pad.length;i+=4)s=(s+pad.readUInt32BE(i))>>>0;return s;};
 let at=12+num*16;const parts=[dir];
 tags.forEach((tag,i)=>{const data=T[tag],o=12+i*16;dir.write(tag.padEnd(4,' '),o,'latin1');dir.writeUInt32BE(sum(data),o+4);dir.writeUInt32BE(at,o+8);dir.writeUInt32BE(data.length,o+12);
  const padded=Buffer.concat([data,Buffer.alloc((4-data.length%4)%4)]);parts.push(padded);T[tag]={at};at+=padded.length;});
 const font=Buffer.concat(parts);const headAt=T.head.at;font.writeUInt32BE((0xB1B0AFBA-sum(font))>>>0,headAt+8);
 return font;
}

/* A pre-rendered font file -> {font: TrueType buffer, glyphs, size} or null. family names the result. */
function toTrueType(buffer,family,{upm=1024}={}){
 const f=parse(buffer);if(!f)return null;
 /* the em: the advance most CJK glyphs share (a few dashes are wider) */
 const counts=new Map();for(const g of f.glyphs)if(g.code>=0x3000&&g.inc>0)counts.set(g.inc,(counts.get(g.inc)||0)+1);
 const size=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||Math.max(1,...f.glyphs.map(g=>g.inc));
 const s=upm/size,ascent=Math.round(upm*0.88),descent=upm-ascent,out=[];
 for(const g of f.glyphs){if(g.code<0x20||g.code>0xfffd||(g.code>=0xd800&&g.code<=0xdfff))continue;
  const glyph={code:g.code,advance:Math.round(g.inc*s),contours:[]};
  if(g.bitmap){const loops=trace(g.bitmap(),g.w,g.h).map(l=>simplify(l));
   for(const loop of loops){/* padded pixel-centre (x, y) -> font units: centre of pixel i is ox + i + 0.5 */
    const pts=loop.map(([x,y])=>[Math.round((g.ox+x-0.5)*s),Math.round((g.oy-(y-0.5))*s)]);
    const clean=pts.filter((q,i)=>i===0||q[0]!==pts[i-1][0]||q[1]!==pts[i-1][1]);if(clean.length>2&&clean[0][0]===clean[clean.length-1][0]&&clean[0][1]===clean[clean.length-1][1])clean.pop();
    if(clean.length>=3&&Math.abs(area(clean))>=s*s*0.05)glyph.contours.push(clean);}}
  out.push(glyph);}
 if(!out.length)return null;
 return {font:ttf({family:String(family||'Game font').slice(0,48),glyphs:out,upm,ascent,descent}),glyphs:out.length,size};
}
module.exports={isPrerendered,parse,trace,simplify,ttf,toTrueType,MAGIC};
