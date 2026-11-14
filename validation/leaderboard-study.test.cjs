// SPDX-License-Identifier: GPL-3.0-or-later
/* 2026-11-15 学习练习 board (user: one board for every study practice, ranked by questions, hover shows the parts).
   Client: every practice source is counted per period (kana runs, grammar answers, Anki answers, other practice) with
   the study time. Relay: parts stored, study = their sum, older kana-only clients count kana as their whole study.
   Page: 学习练习 replaces 假名练习, cards carry no order code, the hover card lists the parts. */
process.env.MEGULIT_RELAY_BASE??='off';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),{DatabaseSync}=require('node:sqlite');
const lb=require('../services/leaderboard.cjs'),grammar=require('../services/grammar.cjs'),rewards=require('../services/learning-rewards.cjs'),{SCHEMA}=require('../services/store.cjs');
const relayDir=path.join(__dirname,'..','relay'),load=name=>import(pathToFileURL(path.join(relayDir,'src',name)).href);
const at=(y,m,d,h=12,min=0,s=0)=>Math.floor(new Date(y,m-1,d,h,min,s).getTime()/1000);
const NOW=new Date(2026,10,10,20,0,0);

test('client counts every study practice per period, with study time',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'megulit-study-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const db=new DatabaseSync(':memory:');db.exec(SCHEMA);t.after(()=>db.close());
 db.prepare("INSERT INTO vocabulary(id,spelling,reading,definitions,created_at,original) VALUES(1,'語','ご','[]',?,'{}')").run(at(2026,11,1));
 grammar.ensure(db);rewards.ensure(db);
 /* older right answers only in the 魔力 log (before the event table): counted until the first event */
 const mana=db.prepare('INSERT INTO learning_mana(kind,points,ref,at) VALUES(?,5,?,?)');
 mana.run('answer','n5-wa',at(2026,11,9,10));mana.run('answer','n5-wa',at(2026,11,2,10));mana.run('practice','n5-wa',at(2026,11,9,10,1));
 mana.run('answer','n5-wa',at(2026,11,10,9,0,30)); /* after the first event: the event row already counts it */
 mana.run('find','n5-ga',at(2026,11,10,15));
 const ev=db.prepare('INSERT INTO grammar_answer_events(point,correct,at) VALUES(?,?,?)');
 ev.run('n5-wa',1,at(2026,11,10,9,0,0));ev.run('n5-wa',0,at(2026,11,10,9,0,30));ev.run('n5-wa',1,at(2026,11,10,9,1,0));
 /* Anki: two in-app answers, one also synced back; one done only in Anki */
 db.exec('CREATE TABLE IF NOT EXISTS anki_review_events(operation_id TEXT PRIMARY KEY,card_id INTEGER NOT NULL,ease INTEGER NOT NULL,reviewed_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS anki_synced_reviews(review_id INTEGER PRIMARY KEY,word_id INTEGER NOT NULL);');
 const a=db.prepare('INSERT INTO anki_review_events VALUES(?,1,3,?)');a.run('o1',at(2026,11,10,11));a.run('o2',at(2026,11,10,11,0,20));
 const syncedT=at(2026,11,10,11,0,22),onlyAnki=at(2026,11,9,8);
 db.prepare('INSERT INTO anki_synced_reviews VALUES(?,1)').run(syncedT*1000);db.prepare('INSERT INTO anki_synced_reviews VALUES(?,1)').run(onlyAnki*1000);
 const r=db.prepare('INSERT INTO review_events(word_id,reviewed_at) VALUES(1,?)');r.run(syncedT);r.run(onlyAnki); /* rows the sync copied */
 r.run(at(2026,11,10,16));r.run(at(2026,10,5)); /* MeguLit's own 复习 */
 fs.mkdirSync(path.join(root,'data'),{recursive:true});
 const ms=(y,m,d)=>new Date(y,m-1,d,12).getTime(),log=n=>Array.from({length:n},()=>({show:'あ',ok:true}));
 fs.writeFileSync(path.join(root,'data','kana-progress.json'),JSON.stringify({version:1,runs:[{id:ms(2026,11,10),secs:95.5,log:log(10)},{id:ms(2026,9,1),secs:40,log:log(5)}]}));
 const s=lb.collectStats(db,NOW,root),w=s.stats.week;
 assert.deepEqual({kana:w.kana,grammar:w.grammar,anki:w.anki,practice:w.practice,study:w.study},{kana:10,grammar:4,anki:3,practice:2,study:19});
 assert.deepEqual([s.stats.month.grammar,s.stats.all.grammar],[5,5],'the 2 Nov right answer is this month');
 assert.equal(s.stats.all.kana,15);assert.equal(s.stats.all.practice,3);assert.equal(s.stats.all.study,15+5+3+3);
 /* study time: kana run secs + answers timed by the gap (at most 120 s) or 20 s alone.
    week answers: 9 Nov 08:00 anki, 10:00 grammar (mana), 10 Nov 09:00:00 / 09:00:30 / 09:01:00 grammar,
    11:00:00 / 11:00:20 / 11:00:22 anki, 15:00 find, 16:00 review → 20+20+20+30+30+20+20+2+20+20 = 202, plus 95.5 */
 assert.equal(w.studySeconds,298);
 /* sent per part; study itself is the relay's sum */
 assert.ok(!lb.METRICS.includes('study'));
 assert.deepEqual(['kana','grammar','anki','practice','studySeconds'].map(k=>lb.METRICS.includes(k)&&w[k]),[10,4,3,2,298]);
 /* grammar answers are logged with a time from now on */
 grammar.recordAnswer(db,grammar.POINTS[0],true);assert.equal(db.prepare('SELECT COUNT(*) n FROM grammar_answer_events').get().n,4);
});

const MIGRATION=fs.readdirSync(path.join(relayDir,'migrations')).filter(f=>f.endsWith('.sql')).sort().map(f=>fs.readFileSync(path.join(relayDir,'migrations',f),'utf8')).join('');
function d1(){
 const db=new DatabaseSync(':memory:');db.exec(MIGRATION);
 const stmt=(sql,args=[])=>({bind:(...a)=>stmt(sql,a),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>{db.prepare(sql).run(...args);return {success:true};}});
 return {prepare:sql=>stmt(sql),batch:async list=>{db.exec('BEGIN');try{for(const s of list)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}},raw:db};
}
const RNOW=new Date('2026-11-10T04:00:00Z');
const per=o=>({week:o,month:o,all:o});
const base={characters:100,seconds:60,words:1,streak:1,reviews:0};
const req=(method,url,data,ip)=>new Request('https://relay.test'+url,{method,headers:{'cf-connecting-ip':ip,...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
const ID1='3f1c2b7a-1d2e-4f50-8a9b-0c1d2e3f4a5b',ID2='9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',ID3='11111111-2222-4333-8444-555555555555';

test('relay stores the parts, ranks 学习练习 by their sum, and counts an old kana-only client as kana',async()=>{
 const {handle}=await load('worker.js'),{validateLeaderboard}=await load('validate.js'),e={DB:d1(),BUCKET:null,LINK_SECRET:'x',HASH_SALT:'s'};
 const post=(id,name,stats,ip)=>handle(req('POST','/api/leaderboard',{version:1,id,name,keys:{week:'2026-W46',month:'2026-11'},stats:per(stats)},ip),e,RNOW);
 assert.equal((await post(ID1,'めぐみん',{...base,kana:7,grammar:30,anki:120,practice:3,studySeconds:5400},'198.51.100.7')).status,200);
 assert.equal((await post(ID2,'Kazuma',{...base,kana:40},'203.0.113.9')).status,200,'old client: kana only');
 assert.equal((await post(ID3,'Aqua',{...base,kana:0,grammar:0,anki:0,practice:0,studySeconds:0},'203.0.113.10')).status,200);
 const data=await (await handle(req('GET','/api/leaderboard?period=week&metric=study&key=2026-W46',null,'198.51.100.8'),e,RNOW)).json();
 assert.deepEqual(data.entries.map(x=>[x.rank,x.name,x.value]),[[1,'めぐみん',160],[2,'Kazuma',40]],'nobody with 0 is listed');
 assert.deepEqual(data.entries[0].detail,{kana:7,grammar:30,anki:120,practice:3,studySeconds:5400});
 assert.deepEqual(data.entries[1].detail,{kana:40,grammar:0,anki:0,practice:0,studySeconds:0});
 const kana=await (await handle(req('GET','/api/leaderboard?period=week&metric=kana&key=2026-W46',null,'198.51.100.8'),e,RNOW)).json();
 assert.deepEqual(kana.entries.map(x=>[x.name,x.value]),[['Kazuma',40],['めぐみん',7]],'the kana board still answers older clients');
 assert.equal(kana.entries[0].detail,undefined,'parts only on the study board');
 /* study is never taken from the client; caps hold for the parts */
 const body=stats=>({version:1,id:ID1,name:'めぐみん',keys:{week:'2026-W46',month:'2026-11'},stats:per(stats)});
 assert.equal(validateLeaderboard(body({...base,kana:1,grammar:2,study:999999}),RNOW).value.stats.week.study,3);
 assert.equal(validateLeaderboard(body({...base,studySeconds:8*86400}),RNOW).error,'STATS_OUT_OF_RANGE');
 assert.equal(validateLeaderboard(body({...base,anki:-1}),RNOW).error,'INVALID_STATS');
 /* rows from before 0017 start with study = kana */
 assert.ok(MIGRATION.includes('UPDATE leaderboard_stats SET study=kana'));
});

test('page: 学习练习 tab instead of 假名练习, no order codes, hover card lists the parts',async()=>{
 const view=await import(pathToFileURL(path.join(__dirname,'..','web','leaderboard-view.js')).href);
 const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
 view.setView({tab:'board',period:'week',metric:'study',game:''});
 const entries=[{rank:1,name:'めぐみん',value:160,me:true,detail:{kana:7,grammar:30,anki:120,practice:3,studySeconds:5400}},{rank:2,name:'Kazuma',value:40,detail:{kana:40}}];
 const html=view.leaderboardHTML({configured:true,joined:true,name:'めぐみん',board:{state:'ok',entries,total:2},local:{stats:{week:{study:160}}}},'zh',esc);
 assert.ok(html.includes('data-lb-metric="study"')&&html.includes('学习练习'));
 assert.ok(!html.includes('data-lb-metric="kana"'),'no separate kana tab');
 assert.ok(!/No\.\d/.test(html),'no No.01 order code');
 assert.equal((html.match(/data-lb-detail="/g)||[]).length,2);
 assert.equal(view.formatValue('study',160,'zh'),'160 题');
 const w={...view.leaderboardWords('zh'),dAnki:'Anki 背词',dGrammar:'语法练习',dKana:'假名练习',dPractice:'其他练习',dTime:'学习时长',dTotal:'合计'};
 const card=view.detailHTML(entries[0],w,'zh',esc,{});
 for(const s of ['Anki 背词','120 个','语法练习','30 题','假名练习','7 题','其他练习','3 题','学习时长','1 小时 30 分钟','合计','160 题'])assert.ok(card.includes(s),s);
 assert.equal(view.detailHTML({name:'x',value:1},w,'zh',esc,{}),'','no parts, no card');
});
