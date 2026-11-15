'use strict';
// E592 one verdict for a Chinese translation launcher beside the Japanese data (みにくいモジカの子 layout).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const tl=require('../core/translated-launcher.cjs'),auto=require('../core/japanese-auto.cjs');
const base=fs.existsSync('H:\MeguLit-Work')?path.join('H:\MeguLit-Work','tmp'):os.tmpdir();fs.mkdirSync(base,{recursive:true});
const tmp=p=>fs.mkdtempSync(path.join(base,'megulit-tl-'+p));
function folder(files,dirs=[]){const g=tmp('g');for(const f of files)fs.writeFileSync(path.join(g,f),'x');for(const d of dirs)fs.mkdirSync(path.join(g,d));return g;}

test('Chinese-named launcher + translation files: translated, original = the launcher the patch backed up',()=>{
 const g=folder(['mojika.exe','mojika.exe.org','mojika_cn.dll','mojika_cn.mys','readme_cn.txt','script.npk','patch_install.exe','丑小鸭与文字祸.exe'],['原版备份','汉化补丁备份']);
 const r=tl.inspect(path.join(g,'丑小鸭与文字祸.exe'));
 assert.equal(r.translated,true);assert.equal(path.basename(r.original),'mojika.exe');
 assert.equal(tl.inspect(path.join(g,'mojika.exe')).translated,false,'the Japanese launcher itself is not translated');
 const s=auto.status(tmp('root'),'m1',g,{executable:path.join(g,'丑小鸭与文字祸.exe')});
 assert.equal(s.state,'translated');assert.equal(path.basename(s.original),'mojika.exe');
 assert.equal(auto.status(tmp('root'),'m2',g,{executable:path.join(g,'mojika.exe')}).state,'no-japanese');
});
test('name tag alone (game_chs.exe) is translated; plain Japanese installs and kana names are not',()=>{
 const g=folder(['game.exe','game_chs.exe']);
 assert.equal(tl.inspect(path.join(g,'game_chs.exe')).translated,true);assert.equal(path.basename(tl.inspect(path.join(g,'game_chs.exe')).original),'game.exe');
 const j=folder(['ゲーム.exe','data.xp3','readme_cn.txt']);
 assert.equal(tl.inspect(path.join(j,'ゲーム.exe')).translated,false,'kana name is a Japanese launcher');
 const k=folder(['恋爱游戏.exe','data.xp3']);
 assert.equal(tl.inspect(path.join(k,'恋爱游戏.exe')).translated,false,'Chinese name without translation files: no verdict');
});
test('japanese-presence: a translation launcher is never "already Japanese"',()=>{
 const g=folder(['mojika.exe','mojika_cn.dll','汉化版.exe']);
 const v=require('../services/japanese-presence.cjs').verdict(tmp('root'),{prepare:()=>({all:()=>[]})},'x',{executable:path.join(g,'汉化版.exe')});
 assert.deepEqual(v,{japanese:false,by:'translated-launcher'});
});
