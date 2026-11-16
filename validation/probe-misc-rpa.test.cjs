'use strict';
/* #247 Ren'Py rpa variant headers (ALT-1.0, unknown tag, ZiX offset/key maths) */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const F=require('./helpers/engine-fixtures.cjs');
const rpyc=require('../services/original-engines/renpy-rpyc.cjs');
const tmp=t=>{const r=fs.mkdtempSync(path.join(process.env.MEGULIT_TEST_TMP||os.tmpdir(),'rpa-'));t.after(()=>fs.rmSync(r,{recursive:true,force:true}));return r;};
/* hand-built archive: custom first line, files from byte 34, big (>32 bit) key */
test('zix key / offset maths match unrpa',()=>{
 assert.equal(String(rpyc.zixKey('abc123456789')),'2217633');
 assert.equal(rpyc.zixOffset('ab12cd34').toString(16),'43ab1dc2');});
test('ALT-1.0 and an unknown tag read through the generic fallback',t=>{
 const base=F.rpa({'a.rpyc':'AAAA','b.rpyc':'BBBBBB'},{key:0x42424242});
 const dir=tmp(t);
 /* ALT-1.0 <key^extra> <offset>: reuse the RPA-3.0 body, rewrite the header line */
 const m=/^RPA-3\.0 ([0-9a-f]+) ([0-9a-f]+)/.exec(base.toString('latin1',0,34));
 const mk=line=>{const b=Buffer.from(base);b.fill(0,0,34);Buffer.from(line+'\n','latin1').copy(b);return b;};
 const alt=path.join(dir,'alt.rpa');fs.writeFileSync(alt,mk('ALT-1.0 '+(0x42424242^0xDABE8DF0).toString(16)+' '+m[1]));
 const unk=path.join(dir,'unk.rpa');fs.writeFileSync(unk,mk('XYZ-1.0 '+m[1]));
 for(const f of [alt,unk]){const idx=rpyc.rpaIndex(f);assert.ok(idx,path.basename(f));assert.equal(rpyc.rpaRead(f,idx.get('b.rpyc')).toString(),'BBBBBB');}});
