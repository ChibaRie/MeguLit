'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const S='../services/original-engines/';
const lzma=require(S+'lzma.cjs'),ufs=require(S+'unityfs.cjs'),ser=require(S+'unity-serialized.cjs'),ua=require(S+'unity-assets.cjs'),cpk=require(S+'cri-cpk.cjs'),drv3=require(S+'drv3.cjs'),scenes=require(S+'scenes.cjs');
// E700 LZMA-alone stream (props + payload) of "Hello Unity bundle. " x20 + こんにちは
const LZ_PROPS=Buffer.from('5d00008000','hex'),LZ_BODY=Buffer.from('00241949986f1011485d43e4f7fef537c86a8b365b6f7de817db8b815190faaa8830d404dbd0dbf2b2d33fffffe7944000','hex');
test('LZMA decoder',()=>{const out=lzma.decode(LZ_BODY,415,LZ_PROPS);assert.equal(out.toString('utf8'),'Hello Unity bundle. '.repeat(20)+'こんにちは');});
test('UnityFS prefix scan finds a bundle behind padding',()=>{const sig=Buffer.from('UnityFS\0','latin1');assert.equal(ufs.start(Buffer.concat([Buffer.alloc(37),sig])),37);assert.equal(ufs.start(Buffer.alloc(64)),-1);});
test('Fungus command list: Say lines with speaker',()=>{
 const json=JSON.stringify([{Command:'Block',arg0:'开始'},{Command:'Say',arg0:'01_Krosa',arg1:'这里是港口。'},{Command:'Say',arg0:'',arg1:'船来了。'},{Command:'Menu',arg0:'去',arg1:'去'}]);
 const r=ua.parse(Buffer.from(json));assert.deepEqual(r.lines,['Krosa：这里是港口。','船来了。','去']);});
test('CSV script: text column and speaker column',()=>{
 const csv='Name,Text\n'+['真白,「おはよう、今日もいい天気だね」','悠,「そうだね、散歩に行こう」','真白,「うん、行こうよ」'].join('\n');
 assert.deepEqual(ua.parse(Buffer.from(csv)).lines,['真白：「おはよう、今日もいい天気だね」','悠：「そうだね、散歩に行こう」','真白：「うん、行こうよ」']);});
test('DRV3 SPC compression and STX tags',()=>{
 /* flag 0xB0 = 1,0,1,1: literal 'a', ref (count 2, off 0x3ff = distance 1) , literals 'b' 'c' */
 const out=drv3.spcLz(Buffer.from([0xb0,0x61,0xff,0x03,0x62,0x63]),5);assert.equal(out.toString(),'aaabc');
 const s=['<CLT=cltMIND>やあ<CLT>'],hdr=Buffer.alloc(0x28);hdr.write('STXTJPLL',0,'latin1');hdr.writeUInt32LE(1,8);hdr.writeUInt32LE(0x20,12);hdr.writeUInt32LE(8,16);hdr.writeUInt32LE(1,20);
 const b=Buffer.alloc(0x20+8);b.write('STXTJPLL',0,'latin1');b.writeUInt32LE(1,8);b.writeUInt32LE(0x20,0x0c);b.writeUInt32LE(8,0x10);b.writeUInt32LE(1,0x14);b.writeUInt32LE(0,0x20);b.writeUInt32LE(0x28,0x24);
 assert.deepEqual(drv3.parse(Buffer.concat([b,Buffer.from(s[0]+'\0','utf16le')])).lines,['やあ']);});
test('CRI @UTF cipher round-trips',()=>{const t=Buffer.from('@UTF....');assert.equal(cpk.unmask(cpk.unmask(t)).toString(),t.toString());});
const dr='e:/steam/steamapps/common/Danganronpa V3 Killing Harmony';
test('Danganronpa V3 (Steam): CPK → SPC → STX text',{skip:!fs.existsSync(dr)&&'no local copy'},()=>{
 assert.equal(scenes.detect(dr),'drv3');const l=scenes.read('drv3',dr);assert.ok(l.length>5000);assert.ok(l.some(s=>s.lines.some(x=>/\w{4,}/.test(x))));});
const hs='e:/steam/steamapps/common/海沙风云';
test('海沙风云 (Unity + Fungus JSON in TextAssets)',{skip:!fs.existsSync(hs)&&'no local copy'},()=>{
 assert.equal(scenes.detect(hs),'unity-assets');const l=scenes.read('unity-assets',hs);const big=l.find(s=>s.name==='脑死部分');assert.ok(big&&big.lines.length>1000);assert.equal(big.lines[0],'这里是贝让旧城区的港口。');});
