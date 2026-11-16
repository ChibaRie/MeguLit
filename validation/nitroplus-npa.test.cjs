// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Nitro+ NPA: GARbro-compatible container with per-title ciphers; unknown title -> every scheme tried.
const test=require('node:test'),assert=require('node:assert'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const npa=require('../core/nitroplus-npa.cjs'),engine=require('../services/original-engines/nitro-npa.cjs');

/* encoder = the inverse of GARbro's EncryptedStream (it ships one for writing archives) */
function build(files,schemeName,{compress=true,k1=0x4147414e,k2=0x21214f54}={}){
 const scheme=npa.SCHEMES[schemeName],lam=scheme&&scheme.title==='LAMENTO',key=scheme?npa.archiveKey(scheme.title,k1,k2):npa.archiveKey('',k1,k2);
 const dec=scheme?npa.keyTable(scheme):null,enc=dec&&(()=>{const t=Buffer.alloc(256);for(let i=0;i<256;i++)t[dec[i]]=i;return t;})();
 const rows=[],bodies=[];let off=0,no=0;
 for(const [name,data] of Object.entries(files)){
  const raw=Buffer.from(name,'latin1');let body=compress&&!/\.png$/i.test(name)?zlib.deflateSync(data):Buffer.from(data);
  if(scheme){const ek=npa.entryKey(raw,scheme,key,data.length),n=Math.min(body.length,0x1000+(lam?0:raw.length));
   for(let i=0;i<n;i++)body[i]=enc[(body[i]+ek+(lam?0:i))&0xff];}
  const row=Buffer.alloc(4+raw.length+17);row.writeInt32LE(raw.length,0);
  for(let x=0;x<raw.length;x++)row[4+x]=(raw[x]-npa.nameByte(x,no,key))&0xff;
  row[4+raw.length]=2;const a=5+raw.length;row.writeUInt32LE(off,a+4);row.writeUInt32LE(body.length,a+8);row.writeUInt32LE(data.length,a+12);
  rows.push(row);bodies.push(body);off+=body.length;no++;}
 const idx=Buffer.concat(rows),h=Buffer.alloc(41);h.write('NPA\x01',0,'latin1');h.writeInt32LE(k1,7);h.writeInt32LE(k2,11);h[15]=compress?1:0;h[16]=scheme?1:0;
 h.writeInt32LE(rows.length,17);h.writeInt32LE(0,21);h.writeInt32LE(rows.length,25);h.writeUInt32LE(idx.length,37);
 return Buffer.concat([h,idx,...bodies]);}
const NSS=Buffer.from('//c\r\n<VOICE name="A" src="v1">「<RUBY text="かんじ">漢字</RUBY>です」\r\n<PRE x>\r\n地の文です。\r\n','utf8');
const FILES={'nss/a.nss':NSS,'bgm/b.ogg':Buffer.concat([Buffer.from('OggS'),Buffer.alloc(64,7)]),'cg/c.png':Buffer.concat([Buffer.from([0x89]),Buffer.from('PNG'),Buffer.alloc(40)])};
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'npa-'));

for(const title of ['Muramasa','Chaos;Head','Lamento','DRAMAtical Murder',null])test('NPA '+(title||'unencrypted'),()=>{
 const d=tmp(),f=path.join(d,'nss.npa');fs.writeFileSync(f,build(FILES,title));
 const arc=npa.openNpa(f);assert.deepStrictEqual(arc.entries.map(e=>e.name),Object.keys(FILES));
 for(const e of arc.entries)assert.ok(npa.npaData(arc,e).equals(FILES[e.name]),e.name);
 if(title)assert.ok(arc.schemeName);});
test('a title sharing the key table is still found by trying every scheme',()=>{
 const d=tmp(),f=path.join(d,'nss.npa');fs.writeFileSync(f,build(FILES,'Hanachirasu'));
 const arc=npa.openNpa(f);for(const e of arc.entries)assert.ok(npa.npaData(arc,e).equals(FILES[e.name]));});
test('NPA scenes and parse',()=>{
 const d=tmp();fs.writeFileSync(path.join(d,'nss.npa'),build(FILES,'Muramasa'));
 const sc=engine.engine.scenes(d);assert.deepStrictEqual(sc.map(s=>s.name),['a.nss']);
 const r=engine.engine.parse(sc[0].read());assert.deepStrictEqual(r.lines,['A','「漢字です」','地の文です。']);assert.deepStrictEqual(r.ruby[1],[['漢字','かんじ']]);});
test('NPK2 opens with any known GARbro key (another title / build)',()=>{
 const npk=require('../core/nitroplus-npk.cjs'),key=Buffer.from(require('../services/original-engines/nitro-schemes.json').npk2['Minikui Mojika no Ko'],'hex');
 const buf=npk.createNpk({'media/script/nps/a.nps':Buffer.from('hello')},{key});
 assert.throws(()=>npk.readNpk(buf));
 const arc=npk.readNpkAny(buf);assert.ok(npk.npkData(arc,arc.entries[0]).equals(Buffer.from('hello')));});
