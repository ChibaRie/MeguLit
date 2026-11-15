'use strict';
// E595 a Chinese patch laid over the Japanese release in one folder (死に逝く君、館に芽吹く憎悪 汉化硬盘版 layout).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ov=require('../core/overlay-patch.cjs'),jr=require('../core/japanese-restore.cjs'),auto=require('../core/japanese-auto.cjs'),jio=require('../core/japanese-import-original.cjs');
const base=fs.existsSync('H:\MeguLit-Work')?path.join('H:\MeguLit-Work','tmp'):os.tmpdir();fs.mkdirSync(base,{recursive:true});
function game(name,files){const root=fs.mkdtempSync(path.join(base,'megulit-ov-')),g=path.join(root,name);fs.mkdirSync(g);for(const [f,c] of Object.entries(files))fs.writeFileSync(path.join(g,f),c);return g;}
const RELEASE={'data.xp3':'DATA','data.xp3.sig':'s','voice.xp3':'VOICE','voice.xp3.sig':'s','game.exe':Buffer.alloc(300000),'game.sig':'s'};

test('unsigned patch.xp3 over a signed release in a 汉化 folder: restorable overlay, never switched automatically',()=>{
 const g=game('作品 [汉化硬盘版]',{...RELEASE,'patch.xp3':'PATCH'});
 const d=ov.detect(g);assert.equal(d.translated,true);assert.deepEqual(d.overlays.map(o=>o.file),['patch.xp3']);assert.ok(d.evidence.includes('unsigned'));
 const r=jr.detect(g);assert.equal(r.state,'restorable');assert.equal(r.adapter,'overlay-patch');assert.deepEqual(r.overlays,['patch.xp3']);
 assert.equal(auto.decide(g).reason,'OVERLAY_PATCH_MANUAL');
});
test('import from the same folder turns the patch off with a backup, and undo puts it back byte for byte',async()=>{
 const g=game('作品 [汉化硬盘版]',{...RELEASE,'patch.xp3':'PATCH'});
 const p=await jio.preview(g,path.join(g,'game.exe'));assert.equal(p.state,'preview');assert.deepEqual(p.remove.map(x=>x.file),['patch.xp3']);assert.equal(p.replace.length+p.add.length,0);
 assert.ok(fs.existsSync(path.join(g,'patch.xp3')),'preview writes nothing');
 const a=await jio.apply(g,g,path.join(g,'game.exe'));assert.equal(a.removed,1);
 assert.ok(!fs.existsSync(path.join(g,'patch.xp3')));for(const f of Object.keys(RELEASE))assert.ok(fs.existsSync(path.join(g,f)),f+' untouched');
 jio.restore(g);assert.equal(fs.readFileSync(path.join(g,'patch.xp3'),'utf8'),'PATCH');assert.ok(!fs.existsSync(path.join(g,'.megulit-japanese-import')));
});
test('no overlay: the same folder is still refused; an unmarked patch over an unsigned release is left alone',async()=>{
 const g=game('Game',{'data.xp3':'DATA','game.exe':Buffer.alloc(300000)});
 await assert.rejects(jio.preview(g,path.join(g,'game.exe')),/IMPORT_SOURCE_SAME_FOLDER/);
 const official=game('Game',{'data.xp3':'DATA','patch.xp3':'UPDATE','game.exe':Buffer.alloc(300000)});
 assert.equal(ov.detect(official).translated,false,'an official update patch is not a translation');
 assert.notEqual(jr.detect(official).adapter,'overlay-patch');
});
