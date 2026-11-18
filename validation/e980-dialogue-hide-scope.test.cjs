// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Execute the shipped TJS function bodies after translating its binding/undefined syntax.
function fixture(){
 const script=fs.readFileSync(path.join(__dirname,'../native/krkrtext/script.inc'),'utf8'),out=[];
 let layer={height:200,marginL:0,marginT:0,textLayer:{opacity:255}};
 const st={trT:undefined,trOp:undefined,trRec:undefined,trOwner:undefined,trText:'',trKey:'',trLine:0,charsSent:0,
  trLayer:()=>layer,screen:()=>[640,480],shown:()=>true,abs:()=>[0,280],hideOn:()=>true,report:s=>out.push(s)};
 const ctx=vm.createContext({st,int:Math.trunc});
 for(const name of ['trOwn','trRestore','trHide','trDone']){
  const body=new RegExp('st\\.'+name+'=function\\(([^)]*)\\)\\{([\\s\\S]*?)\\} incontextof st;').exec(script);
  assert.ok(body,name);
  const source=body[2].replace(/'Object'/g,"'object'").replace(/\.count\b/g,'.length').replace(/\bvoid\b/g,'undefined').replace(/isvalid this\.trT/g,'this.trT.valid!==false').replace(/\(inst\.getCharacters incontextof inst\)/g,'inst.getCharacters.bind(inst)');
  vm.runInContext('st.'+name+'=function('+body[1]+'){'+source+'};',ctx);
 }
 const renderer=target=>({textLayer:target.textLayer,getCharacters:()=>[..."これは台詞です"].map((text,i)=>({text,x:20*i,y:0,cw:20,size:24}))});
 return {st,out,renderer,get layer(){return layer;},set layer(v){layer=v;}};
}
test('title and menu TextRender instances cannot hide the current message layer',()=>{
 const f=fixture();f.st.trHide();assert.equal(f.layer.textLayer.opacity,255,'no confirmed record');
 const menu={textLayer:{opacity:255},getCharacters(){throw Error('menu must not be sampled');}};
 f.st.trDone(menu);assert.equal(f.layer.textLayer.opacity,255);assert.equal(f.out.length,0);
});
test('confirmed dialogue still hides, read mode and a layer switch restore its exact opacity',()=>{
 const f=fixture();f.layer.textLayer.opacity=192;f.st.trDone(f.renderer(f.layer));
 assert.equal(f.layer.textLayer.opacity,0);assert.ok(f.out.some(s=>s.includes('hidden=1')));
 f.st.hideOn=()=>false;f.st.trHide();assert.equal(f.layer.textLayer.opacity,192);
 f.st.hideOn=()=>true;f.st.trHide();assert.equal(f.layer.textLayer.opacity,0);
 const old=f.layer;f.layer={height:200,textLayer:{opacity:128}};f.st.trHide();
 assert.equal(old.textLayer.opacity,192);assert.equal(f.layer.textLayer.opacity,128,'unknown new layer kept');
});
test('a name plate with the same renderer ownership stays visible',()=>{
 const f=fixture();f.layer.height=40;f.st.trDone(f.renderer(f.layer));assert.equal(f.layer.textLayer.opacity,255);assert.equal(f.out.length,0);
});
test('saved Chinese content metadata and chinese-only script verdict reach the hide bridge without an ini',()=>{
 const {Reader}=require('../services/reader.cjs'),{HookNative}=require('../core/hook-native.cjs');
 function run(lib,japanese){
  const sent=[],hooks=Object.create(HookNative.prototype);Object.assign(hooks,{process:{},send:m=>sent.push(m)});
  const modules={
   './original-text.cjs':{providerKey:()=>'',provider:()=>({})},
   './store.cjs':{openStore:()=>({close(){}})},
   './library.cjs':{activeGameForProgram:()=>({id:'game',original:JSON.stringify({library:lib})})},
   './japanese-presence.cjs':{verdict:()=>({japanese})}
  };
  const refresh=vm.runInNewContext('({'+Reader.prototype.refreshTextSource.toString()+'}).refreshTextSource',{require:id=>{assert.ok(modules[id],id);return modules[id];}});
  refresh.call({root:'H:\\fixture',gal:{hooks},prefs:()=>({})},{exe:'H:\\fixture\\game.exe'});
  return {hooks,sent};
 }
 assert.equal(run({contentLanguage:'zh'},null).sent[0]?.value,'zh');
 assert.equal(run({},false).sent[0]?.value,'zh','chinese-only script verdict also blocks default hiding');
 assert.equal(run({contentLanguage:'ja',originalExecutableVerified:true},true).sent[0]?.value,'ja');
 assert.equal(run({},null).sent.length,0,'unknown language grants no Chinese/Japanese override');
 const f=run({contentLanguage:'zh'},false);f.hooks.setSourceLanguage('zh');assert.equal(f.sent.length,1,'unchanged metadata cannot undo live Japanese confirmation');
 f.hooks.setSourceLanguage('ja');assert.equal(f.sent.at(-1)?.value,'ja','restoring Japanese changes the live bridge policy');
});
