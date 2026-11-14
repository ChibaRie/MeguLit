// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-15 学习 › 单词 now uses the game page's 关联单词 layout (detail-collect.js mountWords, scope 'all') over every game:
   study_words sums the lines met in all games, names each line's game, keeps words saved without a line, and marks 常查单词
   (lookup counts; looked-up surfaces never saved come back as lookup-only rows). Status picker and delete sit in the detail
   column; rows load in batches. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'megulit-study-words-'));process.env.MEGULIT_ROOT=root;
const {dispatch}=require('../services/bridge.cjs'),{openStore}=require('../services/store.cjs');
const web=f=>fs.readFileSync(path.join(__dirname,'..','web',f),'utf8');
test.after(()=>{try{fs.rmSync(root,{recursive:true,force:true});}catch{}});
fs.mkdirSync(path.join(root,'data','config'),{recursive:true});
{const db=openStore(root);
 db.prepare("INSERT INTO games(id,title) VALUES('g1','First Game'),('g2','Second Game')").run();
 const word=db.prepare("INSERT INTO vocabulary(spelling,reading,definitions,status,created_at,original) VALUES(?,?,?,?,?,'{}')");
 word.run('船','ふね','["船"]',0,100);word.run('遠ざかる','とおざかる','["远去"]',3,200);word.run('孤独','こどく','["孤独"]',1,300);
 const ex=db.prepare("INSERT INTO examples(word_id,game_id,text,highlight_start,highlight_end,created_at,original) VALUES(?,?,?,?,?,?,'{}')");
 ex.run(1,'g1','古い船だ',2,3,1000);ex.run(1,'g2','船が来る',0,1,2000);ex.run(1,'g2','また船',2,3,3000);ex.run(2,'g1','遠ざかる音',0,4,1500);
 const look=db.prepare("INSERT INTO lookup_events(surface,occurred_at,operation_id) VALUES(?,?,?)");
 let n=0;for(const s of ['船','船','船','水没','水没'])look.run(s,4000+n,'op'+(n++));
 db.close();}

test('study_words covers every game: ×N summed, lines name their game, unsaved look-ups kept apart',async()=>{
 const data=await dispatch({action:'study_words'});
 assert.equal(data.counts.total,3);
 assert.deepEqual(data.counts.byStatus,{0:1,1:1,3:1});
 const by=Object.fromEntries(data.words.map(w=>[w.spelling,w]));
 assert.equal(by['船'].met,3,'lines from both games');
 assert.equal(by['船'].first.game,'First Game');assert.equal(by['船'].latest.game,'Second Game');assert.equal(by['船'].latest.gameId,'g2');
 assert.equal(by['孤独'].met,0,'a saved word without a line still shows');
 assert.deepEqual(data.words.map(w=>w.spelling),['船','遠ざかる','孤独'],'most recently met first, unmet by save time');
 assert.equal(by['船'].lookups,3);assert.equal(by['遠ざかる'].lookups,undefined);
 assert.equal(data.lookupOnly.length,1);assert.equal(data.lookupOnly[0].spelling,'水没');assert.equal(data.lookupOnly[0].lookupOnly,true);
 assert.match(String(data.lookupOnly[0].id),/^q:/,'lookup-only ids never collide with word ids');
});

test('学习 › 单词 mounts the shared 关联单词 component, not a copy',()=>{
 const app=web('app.js');
 assert.match(app,/if\(subtab==='words'\)\{let data;try\{data=await api\('study_words'\)/);
 assert.match(app,/mountWords\(target,\{scope:'all'/);
 assert.match(app,/onStatus:/);assert.match(app,/onDelete:\(word,done\)=>confirmDelete\(word,\{onDone:done\}\)/);
 assert.match(app,/'game_detail','study_words'/,'quick action');
 const dc=web('detail-collect.js');
 assert.match(dc,/\['often',t\.often,oftenCount\]/,'常查单词 is a filter next to 全部 / 新词 / 学习中 / 已掌握');
 assert.match(dc,/function appendRows\(\)/,'rows are added in batches');
 assert.match(dc,/while\(next>=state\.shown-8&&state\.shown<list\.length\)appendRows\(\)/,'stepping near the end loads the next batch');
 assert.match(dc,/data-status/);assert.match(dc,/data-del/);assert.match(dc,/data-game/);
 assert.doesNotMatch(dc,/>\s*0\d\s*</,'no 01/02 numbering');
 assert.match(web('detail-collect.css'),/:is\(\.game-detail-content,\.study-words\)/,'same styles on both pages');
});

test('words list: click-only switching, same height on every row, native wheel scroll',()=>{
 const dc=web('detail-collect.js'),words=dc.slice(dc.indexOf('export function mountWords'),dc.indexOf('/* =================================================================== sentences'));
 assert.doesNotMatch(words,/addEventListener\('mouseover'/,'hover never changes the current word');
 assert.doesNotMatch(words,/addEventListener\('wheel'/,'the wheel is not intercepted');
 assert.doesNotMatch(words,/悬停预览|hover to preview|ホバーでプレビュー/);
 const css=web('detail-collect.css');
 assert.match(css,/\.esr-vp\{[^}]*overflow-y:auto;overscroll-behavior:contain/);
 assert.doesNotMatch(css,/\.esr-row\.is-cur\{padding-top/,'no extra ruby room on the current row only');
 assert.doesNotMatch(css,/\.esr-row:focus-visible\{padding-bottom/);
});

test('the detail-collect module still parses as an ES module',async()=>{
 const {pathToFileURL}=require('node:url');const mod=await import(pathToFileURL(path.join(__dirname,'..','web','detail-collect.js')));
 assert.equal(typeof mod.mountWords,'function');
});
