'use strict';
/* 2026-11-15 (user: 「学习这边一个接法对一个正确的来自随机出来的玩过的gal里的正确范例」): 学习 › 语法 › 怎么接 puts under every
   connection row exactly one line from the games the learner played that really uses that connection, picked at random
   (again on every visit and by 换一句), never the same line on two rows, named 原名（译名）, with furigana, Chinese and
   ▶ 播放. A row nothing matches says so. A verb demo is shown once. All lessons alike: the rows are sent as data. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const web=f=>pathToFileURL(path.join(__dirname,'..','web',f)).href;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const forms=require('../services/grammar-forms.cjs'),{gameTitle}=require('../core/game-title.cjs');
/* a tokenized line: [surface, pos, sub, type, form] … with code-point offsets */
const toks=(...parts)=>{let at=0;return parts.map(([surface,pos,sub='',type='',form=''])=>{const t={surface,pos,start:at,end:at+[...surface].length,grammar:[pos,sub,'','',type,form]};at=t.end;return t;});};
const text=T=>T.map(t=>t.surface).join('');
const TOAREBA={id:'bb-1',level:'N1',word:'～とあれば',form:['動普通形/イ形/ナ形語幹/名＋とあれば'],explain:['表示假设'],notes:[],examples:[{ja:'お金のためとあれば、引き受ける。',hl:'とあれば',zh:'若是为了钱'}],hits:['とあれば'],order:1};

test('rows say what they look for and what must stand before it, for every lesson',async()=>{
 const g=await import(web('grammar.js')),h=await import(web('grammar-howto.js'));g.useAnkiCards([TOAREBA]);
 const byId=id=>['N5','N4','N3','N2','N1','N0'].flatMap(g.pointsOf).find(p=>p.id===id);
 const toareba=h.rowSpecs(byId('n1-toareba'));
 assert.deepEqual(toareba.map(r=>r.find),[['とあれば'],['とあらば'],['とあれば']],'古风：とあらば looks for とあらば only');
 assert.deepEqual(toareba[0].need.sort(),['noun','plain']);assert.deepEqual(toareba[1].need,[]);
 assert.ok(['verb','plain','i','na','noun'].some(n=>toareba[2].need.includes(n)));
 const tara=h.rowSpecs(byId('n4-tara'));
 assert.deepEqual(tara.map(r=>r.find[0]),['たら','かったら','だったら'],'the whole kana run of the grammar side');
 assert.deepEqual(tara[2].core,['たら']);assert.deepEqual(tara[0].need,['v:ta']);assert.deepEqual(tara[1].need,['i']);
 const ba=h.rowSpecs(byId('n4-ba'));assert.ok(ba[0].need.includes('c:godan')&&ba[1].need.includes('c:ichidan'),'一类／二类 narrow the verb');
 const node=h.rowSpecs(byId('n4-node'));assert.ok(node[0].avoid.includes('なので'),'ので row leaves なので to the other row');
 /* never the lesson's wrong-answer options */
 for(const level of ['N4','N3','N2','N1','N0'])for(const p of g.pointsOf(level))for(const r of h.rowSpecs(p)){
  assert.ok(r.find.length,`${p.id}: a row looks for nothing`);
  if(p.hits?.length)assert.ok(r.core.every(c=>p.hits.includes(c)),`${p.id}: ${r.core} is not one of the lesson's forms`);}
 g.useAnkiCards([]);
});

test('each row has one slot for a game line; no made-up example in the card; the same verb demo once',async()=>{
 const g=await import(web('grammar.js')),h=await import(web('grammar-howto.js'));g.useAnkiCards([TOAREBA]);
 const p=g.pointsOf('N1').find(x=>x.id==='n1-toareba'),html=h.howToHTML(p,[],{esc});
 assert.equal((html.match(/data-how-row="/g)||[]).length,3,'three rows, three slots');
 assert.equal((html.match(/动词这样变/g)||[]).length,1,'名词 / 普通形 and 动词普通形 … rows share one demo');
 const cards=html.slice(0,html.indexOf('</ol>'));
 assert.doesNotMatch(cards,/gm-formula-ex|君のためとあれば|命令とあらば/,'no made-up line inside a connection card');
 assert.doesNotMatch(html,/gm-how-mine/);
 g.useAnkiCards([]);
});

test('lines are picked at random, one per row, never twice; 换一句 keeps the other rows',async()=>{
 const h=await import(web('grammar-howto.js'));
 const L=(...t)=>t.map(x=>({text:x,translation:x.endsWith('?')?'':'zh'}));
 const lists=[L('a','b','c'),L('a'),L(),L('d?','e')];
 for(let i=0;i<50;i++){const pick=h.pickLines(lists);const texts=pick.filter(Boolean).map(e=>e.text);
  assert.equal(new Set(texts).size,texts.length,'no line on two rows');assert.equal(pick[1].text,'a','the row with one line gets it');
  assert.equal(pick[2],null,'nothing found stays empty');assert.equal(pick[3].text,'e','a translated line first');}
 const seen=new Set();for(let i=0;i<60;i++)seen.add(h.pickLines(lists)[0].text);assert.deepEqual([...seen].sort(),['b','c'],'random over the rest');
 const again=h.pickLines([L('b','c'),L('a')].map((l,j)=>j===0?l.filter(x=>x.text!=='b'):l),{keep:{1:'a'}});
 assert.equal(again[0].text,'c');assert.equal(again[1].text,'a');
 assert.match(h.gameNoneHTML({esc}),/你玩过的游戏里还没出现这种接法/);
 const line=h.gameLineHTML({text:'雨だったら帰る',start:1,end:5,translation:'下雨就回去',label:'千恋＊万花（千恋万花）',ruby:[]},{esc,more:true});
 assert.match(line,/<mark class="gm-hl">だったら<\/mark>/);assert.match(line,/来自《千恋＊万花（千恋万花）》/);assert.match(line,/data-speak="雨だったら帰る">播放/);assert.match(line,/data-how-again/);
});

test('a line counts only when the tokenizer agrees: right word before it, grammar on word boundaries',()=>{
 const pt={id:'n4-tara',group:'cond'},row=(find,need,core=find,avoid=[])=>({find,need,core,avoid});
 const itta=toks(['行っ','動詞','一般','五段-カ行','連用形-促音便'],['たら','助動詞','','助動詞-タ','仮定形-一般'],['、','補助記号'],['帰る','動詞','一般','五段-ラ行','終止形-一般']);
 assert.ok(forms.matchRow(pt,text(itta),itta,row(['たら'],['v:ta'])),'行ったら is た形 + ら');
 const ame=toks(['雨','名詞','普通名詞'],['だっ','助動詞','','助動詞-ダ','連用形-促音便'],['たら','助動詞','','助動詞-タ','仮定形-一般'],['帰る','動詞','一般','五段-ラ行','終止形-一般']);
 assert.equal(forms.matchRow(pt,text(ame),ame,row(['たら'],['v:ta'])),null,'雨だったら is not a verb た形');
 assert.deepEqual(forms.matchRow(pt,text(ame),ame,row(['だったら'],['noun'],['たら'])),{start:1,end:5},'but it is 名词 + だったら');
 const rashii=toks(['殺さ','動詞','一般','五段-サ行','未然形-一般'],['れ','助動詞','','助動詞-レル','連用形-一般'],['た','助動詞','','助動詞-タ','終止形-一般'],['らしい','助動詞','','助動詞-ラシイ','終止形-一般']);
 assert.equal(forms.matchRow(pt,text(rashii),rashii,row(['たら'],['v:ta'])),null,'た|らしい is not たら');
 const iya=toks(['嫌い','形状詞','一般'],['じゃ','助詞','係助詞'],['なかっ','形容詞','非自立可能','形容詞','連用形-促音便'],['たら','助動詞','','助動詞-タ','仮定形-一般'],['帰る','動詞','一般','五段-ラ行','終止形-一般']);
 assert.equal(forms.matchRow(pt,text(iya),iya,row(['かったら'],['i'],['たら'])),null,'嫌いじゃなかったら is not an い adjective');
 const samu=toks(['寒かっ','形容詞','一般','形容詞','連用形-促音便'],['たら','助動詞','','助動詞-タ','仮定形-一般'],['帰る','動詞','一般','五段-ラ行','終止形-一般']);
 assert.ok(forms.matchRow(pt,text(samu),samu,row(['かったら'],['i'],['たら'])),'寒かったら is');
 const nano=toks(['雨','名詞','普通名詞'],['な','助動詞','','助動詞-ダ','連体形-一般'],['の','助詞','準体助詞'],['で','助動詞','','助動詞-ダ','連用形-一般'],['帰る','動詞','一般','五段-ラ行','終止形-一般']);
 assert.equal(forms.matchRow({id:'n4-node',group:'cond'},text(nano),nano,row(['ので'],['i','verb'],['ので'],['なので'])),null,'ので row leaves 雨なので alone');
 assert.ok(forms.fits(['c:godan'],{surface:'行け',pos:'動詞',grammar:['動詞','一般','','','五段-カ行','仮定形-一般']}),'一类');
 assert.ok(!forms.fits(['c:godan'],{surface:'食べれ',pos:'動詞',grammar:['動詞','一般','','','下一段-バ行','仮定形-一般']}),'not 二类');
 assert.ok(!forms.fits(['verb'],{surface:'です',pos:'助動詞',grammar:['助動詞','','','','助動詞-デス','終止形-一般']}),'です is not a verb');
});

test('no tokenizer, no example; the bridge and the page are wired',async()=>{
 const r=await forms.formLines(null,{rows:[{find:['たら']}],tokenize:null});assert.deepEqual(r,{rows:[[]],counting:false});
 const bridge=fs.readFileSync(path.join(__dirname,'..','services','bridge.cjs'),'utf8');assert.match(bridge,/case 'grammar_form_lines'/);
 const app=fs.readFileSync(path.join(__dirname,'..','web','app.js'),'utf8');assert.match(app,/slowReads=new Set\([^)]*'grammar_form_lines'/);
 const g=fs.readFileSync(path.join(__dirname,'..','web','grammar.js'),'utf8');assert.match(g,/api\('grammar_form_lines'/);assert.match(g,/fillHowTo\(\)/);
});

test('games are named 原名（中文圈通用译名）',()=>{
 assert.equal(gameTitle('SenrenBanka',['SenrenBanka']).label,'千恋＊万花（千恋万花）');
 assert.equal(gameTitle('Magical Girl Witch Trials (魔法少女ノ魔女裁判)',['魔法少女ノ魔女裁判']).label,'魔法少女ノ魔女裁判（魔法少女的魔女审判）');
 assert.equal(gameTitle('ましろ色シンフォニー',['纯白交响曲','[091030][ぱれっと] ましろ色シンフォニー -Love is pure white-']).label,'ましろ色シンフォニー（纯白交响曲）');
 assert.equal(gameTitle('Tsuki ni Yorisou Otome no Sahou',['月に寄りそう乙女の作法']).label,'月に寄りそう乙女の作法（近月少女的礼仪）');
 assert.equal(gameTitle('サイコロジック・ラブコメディ',[]).label,'サイコロジック・ラブコメディ','no Chinese name known: the original alone');
});
