const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
/* 2026-11-15 (user: 每日热点不要出现《我的英雄学院》) filtered at the source, and again when the page picks the covers */
test('daily news drops My Hero Academia stories at the source',()=>{
 const src=fs.readFileSync(path.join(__dirname,'..','services','daily.cjs'),'utf8');
 assert.match(src,/BLOCKED=.*ヒロアカ/);assert.match(src,/filter\(n=>!blocked\(n\)\)/);
});
test('home headline pick skips My Hero Academia and fills from the next story',async()=>{
 const {pickHeadline}=await import('../web/home-today.js');
 const pic=(t,i)=>({title:t,link:'https://x/'+i,image:'data:image/png;base64,AAAA',cat:'gal'});
 const items=[pic('僕のヒーローアカデミア 新作',1),pic('ヒロアカ 展',2),pic('My Hero Academia figure',3),...[4,5,6,7,8].map(i=>pic('ギャルゲ '+i,i))];
 const r=pickHeadline(items,'gal',3);
 assert.equal(r.top.title,'ギャルゲ 4');assert.equal(r.small.length,3);
 assert.ok([r.top,...r.small].every(x=>!/ヒーロー|ヒロアカ|Hero/i.test(x.title)));
});
