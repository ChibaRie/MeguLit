// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 语法 › 怎么接 (2026-11-15, user: 「一个接法对一个正确的来自随机出来的玩过的gal里的正确范例」): for each connection row of a
   lesson, real lines from the games the learner played that use exactly that connection. Works for every lesson
   (MeguLit's own and 蓝宝书 cards) because the page sends each row as data:
     find  the strings the row is about: とあらば for 「古风：とあらば」, だったら for 「名词 / な形 + だったら」;
     core  the lesson's own forms inside them (たら in だったら): the part the grammar check runs on, which must start
           and end on word boundaries (not た|らしい);
     avoid longer forms another row is about (なので when this row is ので);
     need  what must stand right before it: noun, na (な adjective stem), i (い adjective), verb, plain (普通形) or a
           verb form v:masu / v:te / v:ta / v:nai / v:naiStem / v:vol / v:ba / v:dict / v:mai; empty = anything; c:godan / c:ichidan narrow
           the verb to 一类 / 二类.
   A line counts only when the tokenizer agrees twice: the grammar passes the same check the lesson examples use
   (grammar.confirmHit: on word boundaries, not a name or a moan) and the word before it is of the kind the row asks
   for. No tokenizer, no example (a wrong line is worse than none). Candidates are the lines read and the script
   reached (grammar.candidatesCached), in random order, translated ones first. */
const grammar=require('./grammar.cjs');
const {gameTitle,libraryNames}=require('../core/game-title.cjs');
const NEEDS=new Set(['noun','na','i','verb','plain','v:masu','v:te','v:ta','v:nai','v:naiStem','v:vol','v:ba','v:dict','v:mai','c:godan','c:ichidan']);
const g=t=>Array.isArray(t?.grammar)?t.grammar:[],P=t=>t?.pos||g(t)[0]||'',F=t=>g(t)[5]||'';
const plainForm=t=>/終止形|連体形/.test(F(t));
/* does the word before the grammar fit one of the needs? prev = the token that ends where the grammar starts */
function fits(need,prev,first){
 if(!need?.length)return true;if(!prev)return false;
 const p=P(prev),s=prev.surface,cls=need.filter(n=>n.startsWith('c:')),kinds=need.filter(n=>!n.startsWith('c:'));
 /* 一类／二类: the verb's conjugation type (Sudachi 五段-カ行, 下一段-バ行 …) */
 if(cls.length&&!(p==='動詞'&&cls.some(c=>c==='c:godan'?/五段/.test(g(prev)[4]||''):/一段/.test(g(prev)[4]||''))))return false;
 /* だっ／でし before たら／て is the noun's copula (雨だったら), not a verb's た形 */
 const copula=p==='助動詞'&&/^(だっ|でし|だ|で|です|でしょ)$/.test(s),polite=p==='助動詞'&&/^(です|でし|でしょ|ます|まし|ましょ)$/.test(s);
 return !kinds.length||kinds.some(n=>{switch(n){
  case 'noun':return ['名詞','代名詞'].includes(p)||p==='接尾辞'&&/名詞/.test(g(prev)[1]||'');
  case 'na':return p==='形状詞'||p==='名詞'&&g(prev)[2]==='形状詞可能';
  /* not the ない of じゃない (嫌いじゃなかったら is な adjective + ない) */
  case 'i':return p==='形容詞'&&g(prev)[1]!=='非自立可能';
  case 'verb':return p==='動詞'||p==='助動詞'&&!copula&&!polite;
  case 'plain':return ['動詞','形容詞','助動詞'].includes(p)&&plainForm(prev)&&!polite;
  case 'v:dict':return p==='動詞'&&plainForm(prev);
  case 'v:masu':return p==='動詞'&&/連用形/.test(F(prev));
  /* て／た forms: the て or た is either the token before the grammar or the grammar's own first sound (行っ|てもいい, 行っ|たら) */
  case 'v:te':return !copula&&(p==='助詞'&&/^(て|で)$/.test(s)||/^(て|で)/.test(first?.surface||'')&&['動詞','助動詞'].includes(p)&&/連用形/.test(F(prev)));
  case 'v:ta':return !copula&&(p==='助動詞'&&/^(た|だ)$/.test(s)||/^(た|だ)/.test(first?.surface||'')&&['動詞','助動詞'].includes(p)&&/連用形/.test(F(prev)));
  case 'v:nai':return p==='助動詞'&&/^(ない|ぬ|ん)$/.test(s)||p==='動詞'&&/未然形/.test(F(prev))&&/^な/.test(first?.surface||'');
  case 'v:naiStem':return p==='動詞'&&/未然形/.test(F(prev));
  case 'v:vol':return p==='助動詞'&&/^(う|よう)$/.test(s)||/意志推量形/.test(F(prev));
  case 'v:ba':return /仮定形/.test(F(prev))||p==='助詞'&&s==='ば';
  case 'v:mai':return p==='動詞'&&(plainForm(prev)||/未然形/.test(F(prev)));
  default:return false;}});
}
/* every place a row's string occurs, as code-point spans */
function spans(text,find){const s=String(text),out=[];
 for(const f of find)for(let at=s.indexOf(f);at>=0;at=s.indexOf(f,at+1)){const start=[...s.slice(0,at)].length;out.push({start,end:start+[...f].length,text:f});}
 return out.sort((a,b)=>a.start-b.start);}
/* the row check on one tokenized line: the first span whose core is confirmed grammar on word boundaries and whose
   word before fits the row */
function matchRow(point,text,tokens,row){
 const T=(tokens||[]).filter(t=>t&&typeof t.surface==='string'&&Number.isFinite(t.start));if(!T.length)return null;
 const chars=[...String(text)],at=(i,s)=>chars.slice(i,i+[...s].length).join('')===s;
 const starts=new Set(T.map(t=>t.start)),ends=new Set(T.map(t=>t.end));
 for(const sp of spans(text,row.find)){
  /* なので while this row is ので (another row is about なので) */
  if((row.avoid||[]).some(a=>{const k=[...a].length;for(let i=Math.max(0,sp.end-k);i<=sp.start;i++)if(at(i,a))return true;return false;}))continue;
  const cores=(row.core?.length?row.core:row.find).flatMap(c=>{const out=[],f=[...sp.text];for(let i=0;i+[...c].length<=f.length;i++)if(f.slice(i,i+[...c].length).join('')===c)out.push({start:sp.start+i,end:sp.start+i+[...c].length,text:c});return out;});
  const ok=cores.some(c=>starts.has(c.start)&&ends.has(c.end)&&grammar.confirmHit(point,text,c,T)>=grammar.MIN_CONF);if(!ok)continue;
  const first=T.find(t=>t.start<=sp.start&&t.end>sp.start),prev=first&&first.start<sp.start?first:[...T].reverse().find(t=>t.end<=sp.start&&P(t)!=='空白');
  if(!fits(row.need,prev,first))continue;
  return {start:sp.start,end:sp.end};}
 return null;
}
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const strings=v=>[...new Set((Array.isArray(v)?v:[]).map(String).map(s=>s.trim()).filter(s=>s&&[...s].length<=12))].slice(0,8);
const clean=row=>({find:strings(row?.find),core:strings(row?.core),avoid:strings(row?.avoid),need:(Array.isArray(row?.need)?row.need:[]).filter(n=>NEEDS.has(n))});
/* {rows:[[line…]…], counting}: up to `max` matching lines per row; the page picks one per row at random */
async function formLines(db,{root=null,scriptPairs=null,tokenize=null,point={},rows=[],max=16,perRow=60,deadline=Date.now()+8000}={}){
 const pt={id:String(point.id||''),group:String(point.group||''),final:point.final===true},R=(rows||[]).slice(0,8).map(clean);
 if(!tokenize)return {rows:R.map(()=>[]),counting:false};
 const list=await grammar.candidatesCached(db,{root,scriptPairs});
 let safe=false;try{safe=!!root&&require('./store.cjs').readJSON(require('node:path').join(root,'data','config','native-preferences.json')).safe_examples===true;}catch{}
 const names=libraryNames(root),titles=new Map();try{for(const r of db.prepare('SELECT id,title,executable FROM games').all())titles.set(r.id,gameTitle(r.title,names.get(String(r.executable||'').toLowerCase())||[]));}catch{}
 const breathe=require('./cooperative.cjs').breather(),out=[];let pending=false;
 for(const row of R){const found=[];if(!row.find.length){out.push(found);continue;}
  const pool=list.filter(c=>row.find.some(f=>c.text.includes(f))&&!(safe&&grammar.isExplicit(c.text)));
  /* random, but a line with a translation, not explicit and with some words around the grammar (not ……もしかしたら……)
     before the rest */
  const words=t=>String(t).replace(/[\s「」『』（）()、。…‥―ー！？!?♪〜～“”]/g,'').length;
  const rank=c=>(c.translation?0:4)+(grammar.isExplicit(c.text)?2:0)+(words(c.text)<10?1:0),order=shuffle(pool).sort((a,b)=>rank(a)-rank(b));let tried=0;
  for(const c of order){if(found.length>=max||tried>=perRow)break;if(Date.now()>deadline){pending=true;break;}await breathe();tried++;
   let tokens;try{tokens=await tokenize(c.text);}catch{continue;}
   const m=matchRow(pt,c.text,tokens,row);if(!m)continue;
   const t=titles.get(c.gameId)||gameTitle(c.title);
   found.push({text:c.text,start:m.start,end:m.end,ruby:c.ruby||[],translation:c.translation||'',translationSource:c.translationSource||'',origin:c.origin,gameId:c.gameId,title:c.title,label:t.label||c.title||''});}
  out.push(found);}
 return {rows:out,counting:true,pending};
}
module.exports={formLines,matchRow,fits,spans,NEEDS};
