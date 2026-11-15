'use strict';
// 2026-11-15 学习 › 词典 MOJi entry (user: moji辞书的单词n几标 平常使用程度 还有用户笔记都给我加进去啊！！！怎么都给我删了).
// d8aeb3b moved the results onto mountEntries and dropped the public notes; the detail never carried JLPT or the lookup count.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../services/moji-dictionary.cjs');
const reply=body=>({ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)});

test('the MOJi detail carries JLPT, lookup count and the public notes with their total',async()=>{
 const fetcher=async url=>{url=String(url);
  if(url.includes('detailInfo?wordId=198919434'))return reply({word:[{objectId:'198919434',spell:'茄子',pron:'なす',accent:'①',excerpt:'[名] 茄子',tags:'N3',viewedNum:1551}],details:[],subdetails:[],examples:[],notes:[]});
  if(url.endsWith('comment-list'))return reply({result:{result:{comments:[{content:'茄子 なす',likedNum:98,createdAt:'2022-08-28T00:00:00Z',author:{name:'猫猫'},sub:{count:3,comments:[{content:'辣死了',author:{name:'a'}}]}}],count:41}}});
  throw Error('unexpected '+url);};
 const d=await M.wordDetail('198919434',{fetcher});
 assert.equal(d.jlpt,'N3');assert.equal(d.views,1551);assert.equal(d.commentCount,41);
 assert.equal(d.comments.length,1);assert.equal(d.comments[0].likes,98);assert.equal(d.comments[0].replyCount,3);
});

test('an entry found by its reading lists its written form first',async()=>{
 const fetcher=async url=>{url=String(url);
  if(url.endsWith('union-api'))return reply({result:{results:{'search-all':{result:{word:{searchResult:[{title:'成す | なす ①',targetId:'1',excerpt:'[他动] 形成'},{title:'なす | 茄子 ①',targetId:'2',excerpt:'[名] 茄子'},{title:'なす | ナス ①',targetId:'3',excerpt:'[名] 茄子'}]}}}}}});
  return reply({result:{}});};
 const r=await M.lookupMoji('なす',fetcher);
 assert.deepEqual(r.map(w=>[w.spelling,w.pron,w.accent]),[['成す','なす','①'],['茄子','なす','①'],['ナス','なす','①']]);
});

test('the entry panel paints JLPT, 常用度, MOJi notes and one action group',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../web/detail-collect.js'),'utf8');
 for(const needle of ['class="ent-jlpt"','class="ent-use"','class="ent-notes"','data-notes-open','data-notes-more','class="ent-btn${cls}"',"' is-primary'"])assert.ok(js.includes(needle),needle);
 assert.match(js,/d\.comments\|\|\[\]/);
 const app=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
 assert.match(app,/loadNotes:lastOnline&&onlineSource==='moji'\?\(item,page\)=>api\('moji_comments',\{id:item\.id,page\}\)/);
 const css=fs.readFileSync(path.join(__dirname,'../web/detail-collect.css'),'utf8');
 assert.match(css,/& \.ent-btn::before,& \.ent-btn::after\{content:none!important/);
 assert.match(css,/& \.ent-btn \.dc-ic\{width:16px;height:16px/);
});
