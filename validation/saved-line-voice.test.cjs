// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-15 user: 我游戏里有cv的例句怎么出来朗读还是ai合成？ — a voiced line of 沙耶の唄 saved on the game page played the
   synthesized voice. Cause: the N4 reader never handed its <voice SRC> on (the voice index had 0 voiced lines for the
   game) and NPK2 voice.npk had no key, so the text lookup missed; the save itself kept no voice. Now a saved line keeps
   its voice (script reference, or a clip cut from the game's loopback ring), plays it, and older lines are filled in. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const SAYA=process.env.SAYA_DIR||'E:/Steam/steamapps/common/The Song of Saya';
const have=fs.existsSync(path.join(SAYA,'voice.npk'))&&fs.existsSync(path.join(SAYA,'script.npk'));
const VOICED='「ねぇねぇ、今度のスキーだけどさ。今年は、どっかスケートも遊べる所にしない？」';
const svc=f=>path.join(__dirname,'..','services',f);

function fresh(){const root=fs.mkdtempSync(path.join(process.env.MEGULIT_TEST_TMP||os.tmpdir(),'slv-'));delete require.cache[svc('game-voice.cjs')];const gv=require(svc('game-voice.cjs'));gv._reset();
 const store=require(svc('store.cjs')),db=store.openStore(root);db.prepare("INSERT INTO games(id,title,executable) VALUES('g-saya','The Song of Saya',?)").run(path.join(SAYA,'Saya_Steam.exe'));db.close();
 return {root,gv,open:()=>store.openStore(root)};}
const saveLine=(open,text)=>{const db=open();try{return require(svc('saved-sentences.cjs')).save(db,{gameId:'g-saya',text,translation:''});}finally{db.close();}};
const originalOf=(open,id)=>{const db=open();try{return JSON.parse(db.prepare('SELECT original FROM saved_sentences WHERE id=?').get(id).original);}finally{db.close();}};
// a short RIFF/WAVE clip
function wav(){const n=2400,b=Buffer.alloc(44+n*2);b.write('RIFF',0,'latin1');b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8,'latin1');b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36,'latin1');b.writeUInt32LE(n*2,40);return b;}

test('the N4 reader pairs each spoken Saya line with its voice.npk clip',{skip:!have&&'Saya not installed'},()=>{
 const n4=require(svc('original-engines/nitroplus-n4.cjs')),scene=n4.scenes(SAYA).find(s=>s.name==='sy010.nps'),p=n4.parse(scene.read());
 const i=p.lines.indexOf(VOICED);assert.ok(i>=0);assert.equal(p.voices[i],'3/000104');
 const {gv}=fresh();assert.equal(gv.kind(gv.catalog(SAYA).get('3/000104')()).mime,'audio/ogg');});

test('saving a voiced line keeps its script voice; 朗读 plays the game clip',{skip:!have&&'Saya not installed'},async()=>{
 const {root,open}=fresh(),slv=require(svc('saved-line-voice.cjs'));const row=saveLine(open,VOICED);
 const v=await slv.attach({root,reader:null},row.id,VOICED);
 assert.deepEqual(v,{kind:'scan',g:require(svc('game-voice.cjs')).gameKey(SAYA),ref:'3/000104'});
 assert.deepEqual(originalOf(open,row.id).voice,v);assert.equal(originalOf(open,row.id).source,'reader');
 const r=await slv.play(root,{id:row.id,text:VOICED});assert.equal(r.source,'game');assert.equal(r.mime,'audio/ogg');assert.ok(r.data.length>10000);
 assert.deepEqual(slv.has(root,[{id:row.id,text:VOICED}]),[true]);});

test('a stale index (scanned before the N4 reader paired voices) is scanned again for a saved line',{skip:!have&&'Saya not installed'},async()=>{
 const {root,gv,open}=fresh();const k=gv.gameKey(SAYA);fs.mkdirSync(path.join(root,'data','voice-cache'),{recursive:true});
 fs.writeFileSync(path.join(root,'data','voice-cache','lines.json'),JSON.stringify({schema:1,games:{[k]:{v:2,dir:path.resolve(SAYA),engine:'nitroplus-n4',scanned:Date.now(),lines:3520,voiced:0,found:0,missing:0,from:k}},lines:{}}));gv._reset();
 const row=saveLine(open,VOICED);/* an old saved line: no voice record */assert.equal(originalOf(open,row.id).voice,undefined);
 const slv=require(svc('saved-line-voice.cjs')),r=await slv.play(root,{id:row.id,text:VOICED});
 assert.equal(r?.source,'game');assert.equal(originalOf(open,row.id).voice.ref,'3/000104');/* filled in for next time */});

test('an unvoiced line stays synthesized (no record, play gives null)',{skip:!have&&'Saya not installed'},async()=>{
 const {root,open}=fresh(),slv=require(svc('saved-line-voice.cjs'));const text='そう、何もかも変わり果ててしまった。';const row=saveLine(open,text);
 const quiet={gameId:'g-saya',gal:{gameMedia:async()=>({matched:true,audio:null,recording:true})}};
 assert.equal((await slv.attach({root,reader:quiet},row.id,text)).kind,'none');
 assert.equal(await slv.play(root,{id:row.id,text}),null);assert.deepEqual(slv.has(root,[{id:row.id,text}]),[false]);});

test('no script voice: the clip cut from the game loopback ring at save time is kept and played',async()=>{
 const {root,open}=fresh(),slv=require(svc('saved-line-voice.cjs'));const text='「録音だけで分かる台詞」';const row=saveLine(open,text);const clip=wav();
 const reader={gameId:'g-saya',gal:{gameMedia:async t=>{assert.equal(t,text);return {matched:true,audio:{data:clip.toString('base64')}};}}};
 const v=await slv.attach({root,reader},row.id,text);assert.equal(v.kind,'file');assert.equal(v.from,'capture');
 const file=path.join(root,'data','saved-voice',v.file);assert.ok(fs.existsSync(file));
 const r=await slv.play(root,{id:row.id,text});assert.equal(r.source,'game');assert.equal(r.mime,'audio/wav');assert.equal(r.origin,'capture');
 /* removing the line removes its clip */const db=open();try{require(svc('saved-sentences.cjs')).remove(db,{id:row.id},{root});}finally{db.close();}assert.ok(!fs.existsSync(file));});

test('every read-aloud of a game line goes through sentence_voice; buttons are labelled 原声 / 朗读',()=>{
 const web=f=>fs.readFileSync(path.join(__dirname,'..','web',f),'utf8');
 assert.match(web('detail-collect.js'),/playSentence\(api,cur\(\)\.text,b,\{id:cur\(\)\.id\}\)/);assert.match(web('detail-collect.js'),/labelVoices/);
 assert.match(web('sentences-page.js'),/playSentence\(api,item\.text,b,\{id:item\.id\}\)/);assert.match(web('sentences-page.js'),/labelVoices/);
 assert.match(web('grammar.js'),/labelSpeak\(slot\)/);assert.match(web('grammar.js'),/labelSpeak\(root\)/);
 assert.match(web('sentence-voice.js'),/'原声'/);
 const rt=fs.readFileSync(svc('runtime.cjs'),'utf8');assert.match(rt,/case 'sentence_voice_has'/);assert.match(rt,/saved-line-voice\.cjs'\)\.play/);
 assert.match(fs.readFileSync(svc('bridge.cjs'),'utf8'),/'sentence_voice_has'/);
 const reader=fs.readFileSync(svc('reader.cjs'),'utf8');assert.equal((reader.match(/saved-line-voice\.cjs'\)\.attach/g)||[]).length,2);});
