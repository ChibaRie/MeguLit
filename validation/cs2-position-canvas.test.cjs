'use strict';
/* 2026-11-19 (ISLAND with its own CatSystem2 hook, rig2 live): every line sat at the style box's default place next to the name
   plate (left 637) because the CS2 line position (ToMe_CS2_LAYOUT x0=234 y0=598) was only followed once a calibration had
   stored a map, and none ever had (game-position-maps.json empty on every rig; the same since v1.4.16). The CS2 lines are
   1280x720 canvas pixels after cs2Canvas (+63/+8, measured: 「覚えてない」 starts near client x 294 for x0 234), so they map like
   an ADV canvas until a calibration exists. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');const gs=require('../core/game-style.js');
function loadTextPosition(layout){
 const classes=new Set(),vars={};
 const doc={readyState:'complete',addEventListener(){},querySelector:()=>null,body:{classes,classList:{toggle:(c,on)=>{if(on)classes.add(c);else classes.delete(c);return on;},contains:c=>classes.has(c)}},
  documentElement:{style:{setProperty:(k,v)=>{vars[k]=v;},removeProperty:k=>{delete vars[k];}}},vars};
 const prefs={textColor:'#ffffff',autoGameStyle:true};
 const b={previewed:[],galPreferences:()=>prefs,galLayoutInfo:()=>layout,previewGalPosition:v=>b.previewed.push(v)};
 const ctx={window:{__tomoyoChinese:b,TomoyoGameStyle:gs,devicePixelRatio:1,__tomoyoTranslateRequest(){}},document:doc,getComputedStyle:()=>({getPropertyValue:()=>'',fontSize:'26px'}),Date,Math,Number,String,Map,JSON,Object};
 vm.runInNewContext(read('web/reader/modules/text-position.js'),ctx);return {api:ctx.window.__tomeTextPosition,b};}

test('an ISLAND line follows its canvas position without a calibration map',()=>{
 const {api,b}=loadTextPosition({clientWidth:1280,clientHeight:720});
 b.galStatus?.({hookSource:'「覚えてない」',hookSequence:1});
 b.textPosition({type:'hookTextPos',engine:'cs2_screen_v2',line:136,token:2885161822,x0:234,y0:598,x1:416,y1:598,size:26,count:8,color:'#b0e2ff'});
 assert.equal(b.previewed.length,1,'the box follows the line');
 assert.equal(api.state().calibrated,true);
 const p=b.previewed[0];assert.ok(Math.abs(p.x-Math.round((297*100/1280)*10)/10)<0.11,JSON.stringify(p));assert.ok(Math.abs(p.y-Math.round((606*100/720)*10)/10)<0.11,JSON.stringify(p));
});
test('a scaled game window keeps the canvas aspect (letterbox) and a calibrated map still wins',()=>{
 const {api,b}=loadTextPosition({clientWidth:1920,clientHeight:1080});
 b.textPosition({type:'hookTextPos',engine:'cs2_screen_v2',line:1,token:7,x0:234,y0:598,x1:416,y1:598,size:26,count:8,color:'#b0e2ff'});
 assert.ok(Math.abs(b.previewed.at(-1).x-Math.round((297*1.5*100/1920)*10)/10)<0.11);
 api.setMap({engine:'cs2_screen_v3',s:1,bx:100,by:0,dx:0,dy:0,cw:1920,ch:1080});
 b.textPosition({type:'hookTextPos',engine:'cs2_screen_v2',line:2,token:8,x0:234,y0:598,x1:416,y1:598,size:26,count:8,color:'#b0e2ff'});
 assert.ok(Math.abs(b.previewed.at(-1).x-Math.round(((297+100)*100/1920)*10)/10)<0.11,'calibrated map: '+JSON.stringify(b.previewed.at(-1)));
});
