'use strict';
/* 2026-11-19 (user: "这些字体…可以通过读内存来获取并使用吧 怎么没实装？给我自动装上 校准的时候也要自动去换 手动点查找的时候也要自动去找";
   "扫描游戏字体现在基本上无法使用"). 千恋＊万花 showed 未发现可导入的游戏字体文件: its dialogue font is a KiriKiri pre-rendered
   glyph file inside the encrypted data.xp3 (font/font1_<size>.tft, "スキップ"), next to outline fonts in the same archive.
   Fixtures here: a pre-rendered font and an outline font in an xp3, a font the game registered in memory (font probe),
   and a game that only names its face. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const ROOT=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const pf=require('../core/prerendered-font.cjs'),{tables,cmap}=require('../core/font-map.cjs'),gf=require('../core/game-fonts.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'megulit-gamefont-'));

/* a pre-rendered font: kana and a few kanji, each a ring (outer square, inner hole) so tracing must keep the hole */
function tft(size,codes){const glyphs=codes.map(code=>{const w=size-4,h=size-4,px=Buffer.alloc(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const edge=Math.min(x,y,w-1-x,h-1-y);px[y*w+x]=edge<Math.max(2,size>>3)?64:0;}
  /* version 1: run-length (a byte >= 0x41 repeats the last value) */
  const rle=[];for(let i=0;i<px.length;){let j=i+1;while(j<px.length&&px[j]===px[i]&&j-i<0x3f)j++;rle.push(px[i]);if(j-i>1)rle.push(0x40+(j-i-1));i=j;}return {code,w,h,data:Buffer.from(rle)};});
 const head=Buffer.alloc(36);head.write('TVP pre-rendered font\x1a',0,'latin1');head[22]=1;head[23]=2;head.writeUInt32LE(glyphs.length,24);
 const codesAt=36,itemsAt=codesAt+glyphs.length*2,dataAt=itemsAt+glyphs.length*20;head.writeUInt32LE(codesAt,28);head.writeUInt32LE(itemsAt,32);
 const codeBuf=Buffer.alloc(glyphs.length*2),items=Buffer.alloc(glyphs.length*20),datas=[];let at=dataAt;
 glyphs.forEach((g,i)=>{codeBuf.writeUInt16LE(g.code,i*2);const o=i*20;items.writeUInt32LE(at,o);items.writeUInt16LE(g.w,o+4);items.writeUInt16LE(g.h,o+6);items.writeInt16LE(2,o+8);items.writeInt16LE(size-6,o+10);items.writeInt16LE(size,o+12);items.writeInt16LE(0,o+14);items.writeInt16LE(size,o+16);datas.push(g.data);at+=g.data.length;});
 return Buffer.concat([head,codeBuf,items,...datas]);}
const KANA=[...Array(90)].map((_,i)=>0x3042+i),KANJI=[0x4e00,0x4eba,0x65e5,0x672c];
/* a plain (unencrypted) XP3: header, entries, index with File/info/segm/adlr chunks */
function xp3(entries){const magic=Buffer.from([0x58,0x50,0x33,0x0d,0x0a,0x20,0x0a,0x1a,0x8b,0x67,0x01]);let at=11+8;const blobs=[],files=[];
 for(const [name,data] of entries){const nm=Buffer.from(name,'utf16le'),info=Buffer.alloc(22+nm.length);info.writeUInt32LE(0,0);info.writeBigUInt64LE(BigInt(data.length),4);info.writeBigUInt64LE(BigInt(data.length),12);info.writeUInt16LE(name.length,20);nm.copy(info,22);
  const segm=Buffer.alloc(28);segm.writeUInt32LE(0,0);segm.writeBigUInt64LE(BigInt(at),4);segm.writeBigUInt64LE(BigInt(data.length),12);segm.writeBigUInt64LE(BigInt(data.length),20);const adlr=Buffer.alloc(4);
  const chunk=(tag,b)=>{const h=Buffer.alloc(12);h.write(tag,0,'latin1');h.writeBigUInt64LE(BigInt(b.length),4);return Buffer.concat([h,b]);};
  files.push(chunk('File',Buffer.concat([chunk('info',info),chunk('segm',segm),chunk('adlr',adlr)])));blobs.push(data);at+=data.length;}
 const index=Buffer.concat(files),flag=Buffer.alloc(9);flag[0]=0;flag.writeBigUInt64LE(BigInt(index.length),1);const off=Buffer.alloc(8);off.writeBigUInt64LE(BigInt(at));
 return Buffer.concat([magic,off,...blobs,flag,index]);}

test('a pre-rendered glyph file becomes a TrueType font: names, cmap, advances, checksums, holes kept',()=>{
 const r=pf.toTrueType(tft(40,[...KANA,...KANJI]),'テスト丸ゴ');assert.ok(r&&r.glyphs===94&&r.size===40);
 const t=tables(r.font);for(const tag of ['head','hhea','maxp','OS/2','hmtx','cmap','name','post','glyf','loca'])assert.ok(t.has(tag),tag);
 const m=cmap(t);assert.equal(m.size,94);assert.ok(m.has(0x3042)&&m.has(0x65e5));
 assert.equal(gf.familyName(r.font),'テスト丸ゴ');assert.equal(gf.classify(r.font,'テスト丸ゴ')?.lang,'ja');
 let sum=0;for(let i=0;i<r.font.length;i+=4)sum=(sum+r.font.readUInt32BE(i))>>>0;assert.equal(sum,0xB1B0AFBA,'whole-font checksum (head.checkSumAdjustment)');
 /* glyph あ: one outer contour and one hole, wound oppositely (non-zero fill keeps the hole) */
 const glyf=t.get('glyf'),loca=t.get('loca'),gid=m.get(0x3042),g=glyf.subarray(loca.readUInt32BE(gid*4),loca.readUInt32BE(gid*4+4));
 assert.equal(g.readInt16BE(0),2,'outer contour and hole');
});
test('tracing keeps sub-pixel edges and drops nothing for an empty glyph',()=>{
 const w=10,h=10,v=new Uint8Array(w*h);for(let y=2;y<8;y++)for(let x=2;x<8;x++)v[y*w+x]=64;const loops=pf.trace(v,w,h);
 assert.equal(loops.length,1);const xs=loops[0].map(p=>p[0]);assert.ok(Math.min(...xs)>2.4&&Math.min(...xs)<2.6,'edge half way between an empty and a full pixel centre');
 assert.equal(pf.trace(new Uint8Array(16),4,4).length,0);
});
test('KiriKiri: fonts inside the xp3 are found, the pre-rendered dialogue family is named by the game\'s font list and converted',()=>{
 const dir=tmp(),cache=tmp();const outline=pf.toTrueType(tft(24,[...KANA,...KANJI]),'Outline Gothic JP').font;
 const list=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('(const)%[ "name"=>"テスト丸ゴ", "file"=>"main_${size}.tft" ]\n(const)%[ "name"=>"*システム", "file"=>"sys_10.tft" ]\n','utf16le')]);
 fs.writeFileSync(path.join(dir,'data.xp3'),xp3([['startup.tjs',Buffer.from([0xff,0xfe,0x41,0])],['font/main_20.tft',tft(20,[...KANA,...KANJI])],['font/main_40.tft',tft(40,[...KANA,...KANJI])],['font/sys_10.tft',tft(10,KANA)],['font/sys_12.tft',tft(12,KANA)],['font/sys_14.tft',tft(14,KANA)],['font/fontlist.tjs',list],['font/extra.ttf',outline]]));
 fs.writeFileSync(path.join(dir,'game.exe'),'MZ');
 const scan=require('../core/engine-font-scan.cjs'),r=scan.scan(dir,cache);
 assert.equal(r.engine,'kirikiri');assert.equal(r.face,'テスト丸ゴ','the dialogue family, by the name the game gives it (not the UI family with more sizes)');
 assert.match(r.reason,/pre-rendered data\.xp3 › font\/main_40\.tft/);assert.deepEqual(r.prerendered.sizes,[20,40]);
 assert.ok(r.files.length>=1&&r.files.every(f=>fs.existsSync(f)));assert.match(r.labels[r.files[0]],/main_40\.tft \(pre-rendered\)/);
 assert.equal(gf.familyName(fs.readFileSync(r.files[0])),'テスト丸ゴ');
 assert.ok(r.candidates.some(c=>/font\/extra\.ttf/.test(c.source)&&c.family==='Outline Gothic JP'),'the outline font in the archive is read too (a 94-glyph subset is not offered: under 1500 kanji)');
 for(const d of [dir,cache])fs.rmSync(d,{recursive:true,force:true});
});
test('a font the game registered in memory is imported and labelled as memory; the scan of the folder stays its own source',async()=>{
 const dir=tmp(),cfg=tmp(),cache=tmp();fs.writeFileSync(path.join(dir,'game.exe'),'MZ');
 const fonts=new gf.GameFonts({config:cfg,cache},()=>{},async()=>path.join(dir,'game.exe'));await fonts.detect(1);
 assert.equal(fonts.current.fonts.length,0);assert.deepEqual(fonts.current.sources.folder,{found:0});
 const mem=path.join(cache,'mem-0badf00d.ttf');fs.writeFileSync(mem,pf.toTrueType(tft(32,[...KANA,...KANJI]),'Memory Font').font);
 const added=fonts.addFile(mem,'mem');assert.equal(added.length,1);assert.equal(added[0].lang,'ja');assert.match(added[0].source,/^内存 /);
 const archive=fonts.addFile(mem.replace('mem-','a-')+'',  'archive','data.xp3 › font/x.tft (pre-rendered)');assert.equal(archive,null,'a missing file adds nothing');
 const payload=fonts.payload(false);assert.equal(payload.fonts[0].loaded,'mem');assert.equal(payload.fonts[0].data,'');
 fonts.note('engine',{face:'ＭＳ ゴシック'});assert.equal(fonts.current.sources.engine.face,'ＭＳ ゴシック');
 for(const d of [dir,cfg,cache])fs.rmSync(d,{recursive:true,force:true});
});
test('only a face name: the reader uses the installed font of that name; a game font of the same family wins',()=>{
 const ef=require('../core/engine-font.cjs');
 assert.deepEqual(ef.pick({face:'ＭＳ 明朝'}),{key:'engine:ＭＳ 明朝',face:'ＭＳ 明朝',reason:'face'});
 assert.equal(ef.pick({face:'テスト丸ゴ',fonts:[{id:'abc',lang:'ja',family:'テスト丸ゴ'}]}).key,'game:abc');
});
test('three moments run every source and apply it unless the user picked a font by hand',()=>{
 const reader=read('services/reader.cjs');
 assert.match(reader,/this\.confirmGameFont\('bind'\)/,'when a game is bound');
 assert.match(reader,/case 'gameFontsRescan':if\(this\.gamePid\)await this\.confirmGameFont\('rescan',\{force:true\}\)/,'重新查找游戏字体 ignores the caches');
 assert.match(reader,/message\.type==='dialogCalibration'&&message\.success===true[^\n]*this\.confirmGameFont\('calibration'\)/,'after a calibration');
 const c=reader.slice(reader.indexOf('async confirmGameFont('),reader.indexOf(' probeFonts(){'));
 for(const step of ['this.fonts.detect(pid,force)','this.probeFonts()','this.engineFontScan(pid,{force})'])assert.ok(c.includes(step),step);
 assert.ok(c.indexOf("japaneseFontSource==='user'")<c.indexOf('this.followGameFont()'),'a hand-picked font is kept');
 assert.match(c,/no source gave a font/,'nothing found: no default face is forced');
});
test('the font panel names the font and its source, or lists what was tried',()=>{
 const ui=read('web/reader/modules/game-fonts-ui.js');
 for(const k of ['folder','archive','registered','engine'])assert.match(ui,new RegExp("parts\\.push\\(s\\('"+k+"'\\)"));
 assert.match(ui,/title:s\('using'\)\+hit\.family,detail:s\('from'\)\+sourceOf\(hit\)/);
 assert.match(ui,/title:s\('none'\)[^}]*tried\(\)/);
});
test('game fonts never leave this PC: probe bundles skip every font kind, archives with font heads get their filter',()=>{
 const probe=require('../services/probe-full.cjs');
 for(const head of ['TVP pre-rendered font\x1a','ttcf\0\x02\0\0','\0\x01\0\0\0\x10','OTTO\0\x10','wOF2'])assert.ok(probe.isMediaBytes(Buffer.from(head,'latin1')),JSON.stringify(head));
 for(const n of ['font/font1_56.tft','a.otc','b.woff2','c.ttf'])assert.ok(probe.isMediaName(n),n);
 assert.match(read('services/original-engines/cx-filter.cjs'),/const HEAD=[^\n]*\\xfe\\xfe\[\\x00-\\x02\]\\xff\|TVP \|OTTO\|\\x00\\x01\\x00\\x00\|ttcf/);
});
