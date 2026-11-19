'use strict';
/* 2026-11-19 (user, 素晴らしき日々: 「默认的位置贼偏」, the menu showed 上边距 43): the anchored offset written by 千恋＊万花's field bug
   (anchorDY 43) sat in the global preferences and came along to the next game, whose own profile had none. The offset is a
   per-game position value: the defaults carry 0, so a game without its own offset starts on the game's place. */
const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const gs=require('../core/game-style.js');const {GameStyleSync}=require('../core/game-style-sync.cjs');
const KEY_A='a'.repeat(64),KEY_B='b'.repeat(64);
test('the defaults carry no offset, in both copies',()=>{
 assert.equal(gs.defaults.anchorDX,0);assert.equal(gs.defaults.anchorDY,0);
 assert.match(fs.readFileSync(path.join(__dirname,'..','web','reader','modules','game-style.js'),'utf8'),/anchorDX: 0, anchorDY: 0/);
});
test('a game without its own offset starts at 0 although the global preferences hold one; a game with one keeps it',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'megulit-offset-'));const native=path.join(dir,'native');fs.mkdirSync(native);fs.mkdirSync(path.join(dir,'data','config'),{recursive:true});
 const seen=[];const sync=new GameStyleSync({native},m=>{if(m.gameStyleState==='profile')seen.push(m.gameStyleEffectivePrefs);},()=>({on(){},stdin:{write(){}},kill(){}}));
 sync.profiles[KEY_B]={name:'B',savedAt:1,positionSavedAt:1,textSavedAt:1,prefs:{x:20,y:77,anchorDX:2,anchorDY:-1}};
 const global={...gs.defaults,x:19.3,y:79.6,anchorDX:0,anchorDY:43};
 sync.configure(global,{gameProcessId:1,gameStarted:'1',gameStyleKey:KEY_A});assert.equal(seen.at(-1).anchorDY,0,'no profile: back to 0');assert.equal(seen.at(-1).anchorDX,0);
 sync.configure(global,{gameProcessId:2,gameStarted:'2',gameStyleKey:KEY_B});assert.equal(seen.at(-1).anchorDY,-1,'its own offset');assert.equal(seen.at(-1).anchorDX,2);
 fs.rmSync(dir,{recursive:true,force:true});
});
