'use strict';
const assert=require('node:assert'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const core=require('../services/adapter-probe-core.cjs');
const dir=fs.mkdtempSync(path.join(process.env.MEGULIT_TMP||os.tmpdir(),'sg-'));
try{fs.mkdirSync(path.join(dir,'g00'));
 for(let i=0;i<60;i++)fs.writeFileSync(path.join(dir,'g00','BG'+i+'.g00'),Buffer.alloc(5000,3));
 fs.writeFileSync(path.join(dir,'Scene.pck'),Buffer.alloc(8192,7));
 const inv=core.inventory(dir);
 assert.ok(!inv.archives.some(a=>/\.g00$/i.test(a.name)),'g00 images are not archives');
 assert.ok(inv.archives.some(a=>/scene\.pck$/i.test(a.name)));
 const c=core.classify({engines:[],inventory:inv,unsupported:null,preparing:null});
 assert.equal(c.detail,'siglus-scene-pck');
 console.log('ok');}finally{fs.rmSync(dir,{recursive:true,force:true});}
