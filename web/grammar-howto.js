/* SPDX-License-Identifier: GPL-3.0-or-later */
/* 语法 › 怎么接 (2026-11-14, user: 「怎么做部分太空了 完全不知道啥意思」 — a 蓝宝书 lesson showed one box saying する).
   Built at run time from what every lesson already has, by rules, for all points alike (MeguLit's own N5–N0 and the
   learner's 蓝宝书 cards, which are read from their Anki and never shipped):
   - the connection in plain words: 蓝宝书 shorthand (動辞書形, ナ形語幹, 名詞修飾形 …) spelled out in Chinese, and when
     a card has no connection field, the 接在…之后 sentence of its explanation turned into a formula;
   - for verb patterns, which form the verb takes, shown on 行く and 食べる (行く → 行き + がてら → 行きがてら);
   - two or three example lines with their Chinese; furigana come from the shared renderer (example-ruby.js: game ruby,
     then dictionary readings, off when 假名注音 is off); one line from the learner's own reading when there is one;
   - one 注意 line from the lesson's pitfalls or the card's notes.
   2026-11-15 (user: 「一个接法对一个正确的来自随机出来的玩过的gal里的正确范例」): every connection row gets exactly one line
   from a game the learner played that really uses that connection (rowSpecs → bridge grammar_form_lines →
   services/grammar-forms.cjs checks it with the tokenizer), picked at random on every visit and by 换一句, never the
   same line on two rows, with its game named 原名（译名）, furigana and Chinese, and ▶ 播放 (the game's own voice when
   MeguLit has it). A row nothing matches says so instead of showing a made-up line. A verb demo shown on one row is
   not repeated on the next. */
import {exAttr} from './example-ruby.js';

const VERBS=[
 {word:'行く',zh:'去',dict:'行く',masu:'行き',te:'行って',ta:'行った',nai:'行か',vol:'行こう',ba:'行けば',mai:'行くまい'},
 {word:'食べる',zh:'吃',dict:'食べる',masu:'食べ',te:'食べて',ta:'食べた',nai:'食べ',vol:'食べよう',ba:'食べれば',mai:'食べまい'}
];
const OTHERS={noun:{word:'学生',form:'学生'},i:{word:'高い',form:'高い',stem:'高'},na:{word:'静か',form:'静か'}};
/* what the verb (or word) in front must look like; checked in this order */
const KINDS=[
 {k:'vol',re:/意向形/,zh:'动词意向形（～よう／～おう）'},
 {k:'mai',re:/まい形/,zh:'动词＋まい（一类用原形，二类去る）'},
 {k:'naiStem',re:/ない形\s*(?:[－―]|去掉?)\s*ない/,zh:'动词ない形去掉ない'},
 {k:'masu',re:/ます形|連用形|连用形/,zh:'动词ます形去掉ます'},
 {k:'te',re:/て形/,zh:'动词て形'},
 {k:'ta',re:/た形/,zh:'动词た形'},
 {k:'nai',re:/ない形/,zh:'动词ない形'},
 {k:'ba',re:/ば形|仮定形|假定形|条件形/,zh:'动词假定形（～ば）'},
 {k:'dict',re:/辞書形|辞书形|原形|基本形/,zh:'动词原形（辞书形）'},
 {k:'plain',re:/普通形|名詞修飾形|名词修饰形|简体/,zh:'普通形（简体）'}
];
/* 蓝宝书 shorthand → plain Chinese; longer keys first */
const PLAIN=[[/名詞修飾形/g,'修饰名词的形式（普通形，な形用な、名词用の）'],[/動/g,'动词'],[/名詞/g,'名词'],[/名(?![词詞])/g,'名词'],[/イ形/g,'い形容词'],
 [/ナ形語幹/g,'な形容词词干'],[/ナ形/g,'な形容词'],[/語幹/g,'词干'],[/辞書形/g,'辞书形（原形）'],[/[－―]\s*(ない|ます|る|い|な)/g,'去掉$1'],[/[－―]/g,''],
 [/\s*[＋+]\s*/g,' + '],[/[·・]/g,'、']];
export const plainFormula=s=>PLAIN.reduce((t,[re,to])=>t.replace(re,to),String(s||'')).replace(/\s+/g,' ').trim();
/* the grammar itself: the part after the last +, first of its alternatives, without brackets or ～ */
export function headOf(formula){const parts=String(formula||'').split(/\s*[＋+]\s*/);if(parts.length<2)return '';
 return parts.at(-1).replace(/[（(][^）)]*[）)]/g,'').split(/\s*[／/]\s*/)[0].replace(/[～~〜…]/g,'').trim();}
/* 行く → 行き + がてら → 行きがてら. Kana parts between the verb and the grammar join in (普通形 + の + はおろか →
   行くのはおろか); 「Ⅰ类／Ⅱ类动词」 shows only that class; ない形 before れる／せる／ず… is the form without ない */
const kanaOnly=t=>/^[\u3040-\u30ff]+$/.test(t);
const firstAlt=t=>String(t||'').replace(/[「」『』]/g,'').replace(/[（(][^）)]*[）)]/g,'').split(/\s*[／/、]\s*/)[0].replace(/[～~〜…]/g,'').trim();
export function demoOf(formula){
 const parts=String(formula||'').split(/\s*[＋+]\s*/);if(parts.length<2)return [];
 const at=parts.slice(0,-1).findIndex(p=>KINDS.some(x=>x.re.test(p)));if(at<0)return [];
 const kind=KINDS.find(x=>x.re.test(parts[at]));let tail='';
 for(const p of parts.slice(at+1)){const t=firstAlt(p);if(!t||!kanaOnly(t))return [];tail+=t;}
 if(!tail)return [];
 const stem=kind.k==='naiStem'||kind.k==='nai'&&/^(られる|れる|させる|せる|ずに|ず|ぬ|ん)/.test(tail);
 const verbs=/Ⅰ类|一类|五段/.test(parts[at])?VERBS.slice(0,1):/Ⅱ类|二类|一段/.test(parts[at])?VERBS.slice(1):/Ⅲ类|三类|サ变|カ变/.test(parts[at])?[]:VERBS;
 if(kind.k==='plain')return [{from:'行く',to:'行く'+tail},{from:'行った',to:'行った'+tail}];
 const pick=v=>stem?v.nai:kind.k==='nai'?v.nai+'ない':v[kind.k==='naiStem'?'nai':kind.k];
 return verbs.map(v=>({from:v.word,mid:pick(v),to:pick(v)+tail}));}
/* a 蓝宝书 card without a connection field: 「以「をする」形式接在表示动作或行为的名词之后」 → 名词 + をする */
export function formulaFromExplain(lines,word){
 for(const line of lines||[]){const m=/接在([^。；;]*?)(?:之后|后面|后边|的后面|后)/.exec(line)||/前接([^。；;，,]*)/.exec(line);if(!m)continue;
  const cat=(m[1].match(/名词|动词[^，。、]{0,6}?形|动词|い形容词|な形容词|形容词|数量词|疑问词|句子|句末|普通形/g)||[]).pop();if(!cat)continue;
  const pat=(/「([^」]+)」/.exec(line)||[])[1]||word;return {formula:`${cat} + ${pat.replace(/^[～~〜]/,'')}`,rule:line};}
 return null;}
/* the line with the grammar marked; the furigana are added later by example-ruby.js around this markup */
export function markHTML(text,{start=-1,end=-1,esc}){const c=[...String(text||'')];if(start<0||end<=start)return esc(c.join(''));
 return esc(c.slice(0,start).join(''))+'<mark class="gm-hl">'+esc(c.slice(start,end).join(''))+'</mark>'+esc(c.slice(end).join(''));}
const span=(text,hl)=>{if(!hl)return [-1,-1];const at=text.indexOf(hl);if(at<0)return [-1,-1];const s=[...text.slice(0,at)].length;return [s,s+[...hl].length];};
const LABEL={zh:{speak:'朗读',place:'在句子里的位置',start:'句首',end:'句末',rule:'接法',demo:'动词这样变',examples:'参考例句',mine:'你读过的台词',note:'注意',from:'来自',play:'播放',again:'换一句',finding:'正在从你玩过的游戏里找这种接法…',none:'你玩过的游戏里还没出现这种接法',noDict:'装好离线词典（设置 › 学习）后，这里会放你玩过的游戏里的原句',noTr:'这句还没有中文翻译'},ja:{speak:'読み上げ',place:'文の中の位置',start:'文頭',end:'文末',rule:'接続',demo:'動詞の形',examples:'参考例文',mine:'あなたが読んだセリフ',note:'注意',from:'',play:'再生',again:'別の文',finding:'プレイしたゲームから探しています…',none:'プレイしたゲームにはまだこの接続が出ていません',noDict:'オフライン辞書を入れると、プレイしたゲームの原文がここに出ます',noTr:'まだ訳がありません'},
 en:{speak:'Read aloud',place:'Where it sits',start:'start',end:'end',rule:'How it attaches',demo:'The verb becomes',examples:'Reference examples',mine:'From your reading',note:'Watch out',from:'from',play:'Play',again:'Another line',finding:'Looking through the games you played…',none:'This connection has not come up in the games you played yet',noDict:'Install the offline dictionary to see original lines from your games here',noTr:'No translation yet'}};
/* all the pieces of 怎么接 for one lesson; never empty: at least one rule and one example */
export function howTo(point,real=[]){
 const cards=point.source==='anki'?[]:point.anki||[];
 /* examples: lines with a translation, the grammar marked */
 const ex=[];const add=(ja,zh,hl)=>{if(!ja||ex.some(e=>e.ja===ja)||ex.length>=3)return;const [s,e]=span(ja,hl);ex.push({ja,zh:zh||'',start:s,end:e});};
 for(const b of point.builtin||[])add(b.ja,b.zh,b.hl);
 const hits=[...(point.hits||[]),...(point.choices||[])].filter(Boolean);
 for(const u of point.uses||[])add(u.ja,u.zh,hits.find(h=>u.ja?.includes(h))||'');
 for(const c of cards)for(const e of c.examples||[])add(e.ja,e.zh,e.hl);
 const rows=[];
 for(const [a,b] of point.form||[]){const raw=String(a||'').trim();if(!raw)continue;const isWord=!/[＋+]|形|词|詞|名|動|作为|念作/.test(raw);
  if(isWord&&point.source==='anki')continue;rows.push({formula:plainFormula(raw),raw,example:b||'',demo:demoOf(raw)});}
 if(point.source==='anki'&&!rows.length){const f=formulaFromExplain([point.gist?.zh,...(point.explain||[])],point.title?.ja||'');
  /* no connection field and no 接在… sentence (これ／それ, しかし, いつ …): show where it sits in its first example */
  const e=ex.find(x=>x.start>=0),word=String(point.title?.ja||'').replace(/^[～~〜]/,'');
  if(f)rows.push({formula:f.formula,raw:f.formula,example:'',demo:demoOf(f.formula),rule:f.rule});
  else if(e){const c=[...e.ja],before=c.slice(0,e.start).join('').replace(/[、，,\s]+$/,''),after=c.slice(e.end).join('').replace(/^[、，,\s]+/,'').replace(/[。！？!?]+$/,'');
   rows.push({formula:[before?'…'+[...before].slice(-5).join(''):'{start}',c.slice(e.start,e.end).join(''),after?[...after].slice(0,5).join('')+'…':'{end}'].join(' + '),raw:'',example:'',demo:[],rule:point.gist?.zh||'',place:true});}
  else rows.push({formula:`～ + ${word}`,raw:'',example:'',demo:[],rule:point.gist?.zh||''});}
 for(const c of cards)for(const f of c.form.slice(0,2)){if(!/[＋+]/.test(f))continue;const p=plainFormula(f);if(!rows.some(r=>r.formula===p))rows.push({formula:p,raw:f,example:'',demo:demoOf(f),anki:true});}
 const mine=(real||[]).find(e=>e&&e.text&&e.origin!=='anki'&&e.origin!=='builtin'&&(e.title||e.label))||null;
 const note=String((point.pitfalls||[])[0]||cards.flatMap(c=>c.notes||[])[0]||'').trim();
 return {rows,examples:ex,mine,note};
}
/* ---- one real line per row ---- */
/* what the word right before the grammar must be, from the row's own words (Chinese plain formula or 蓝宝书 shorthand) */
const NEED_RE=[[/名詞修飾形|名词修饰形/,['plain','noun','na']],[/普通形|简体/,['plain']],[/名词|名詞|人名|^名$|名(?![词詞修])|^人$/,['noun']],[/な形|ナ形|形容动词|形状词/,['na']],
 [/い形|イ形/,['i']],[/(?<![なナい])形容词|(?<![なナイ])形容詞/,['i','na']]];
export function needOf(part){const p=String(part||'');if(!p)return [];const out=new Set();
 for(const k of KINDS)if(k.re.test(p)&&k.k!=='plain')out.add('v:'+k.k);
 for(const [re,n] of NEED_RE)if(re.test(p))n.forEach(x=>out.add(x));
 if(/动词|動詞|動/.test(p)&&![...out].some(n=>n.startsWith('v:')))out.add('verb');
 /* 一类 (五段) / 二类 (一段) narrow the verb, they are not a choice of their own */
 if(/一类|Ⅰ类|五段/.test(p))out.add('c:godan');if(/二类|Ⅱ类|一段/.test(p))out.add('c:ichidan');
 return [...out];}
/* the lesson's own forms (never its wrong-answer options) */
const hitsOf=point=>[...new Set((point.hits?.length?point.hits:point.source==='anki'?[]:point.choices?.slice(0,1)||[]).filter(h=>h&&!/\s/.test(h)))];
/* the rows of 怎么接 as the bridge wants them: {find, need, lit, avoid} (services/grammar-forms.cjs) */
export function rowSpecs(point,rows=howTo(point).rows){
 const hits=hitsOf(point),out=rows.map(r=>{
  /* 名词 / な形 + だったら: the word side is before the last +, the grammar side after it; 二类：る → れば and
     い形容词 → かったら have an arrow instead; 古风：とあらば only a label */
  const raw=String(r.raw||r.formula||''),plus=raw.split(/\s*[＋+]\s*/),arrow=raw.split(/\s*[→⇒]\s*/);
  const side=plus.length>1?plus.at(-1):arrow.length>1?arrow.at(-1):raw.replace(/^[^：:]*[：:]/,''),word=plus.length>1?plus.slice(0,-1).join(' + '):arrow.length>1?arrow[0]:'';
  /* what is looked for: the whole kana run of the grammar side that holds one of the lesson's forms (だったら, のように,
     ますように, かったら), else the form itself when the side is its ending (た形 + ら → たら) */
  const runs=String(side).replace(/[（(][^）)]*[）)]/g,'').match(/[\u3041-\u3096\u30a1-\u30fa\u30fcー]+/g)||[];
  let find=[...new Set(hits.flatMap(h=>runs.filter(x=>x.includes(h))))];
  if(!find.length)find=hits.filter(h=>runs.some(x=>h.endsWith(x)));
  if(!find.length)find=hits.filter(h=>raw.includes(h)||String(r.example||'').includes(h));
  if(!find.length){const head=headOf(raw);find=head&&!hits.length?[head]:hits;}
  const core=hits.filter(h=>find.some(f=>f.includes(h)));
  return {find,core:core.length?core:find,need:r.place?[]:needOf(word)};});
 /* a row about ので must not take a line that is really another row's longer form (なので) */
 for(const r of out)r.avoid=[...new Set(out.filter(o=>o!==r).flatMap(o=>o.find).filter(x=>r.find.some(f=>x!==f&&x.includes(f))))];
 return out;
}
/* one line per row, at random, no line twice; rows with fewer lines choose first. keep: {row:text} to leave as is */
export function pickLines(lists,{keep={},random=Math.random}={}){
 const used=new Set(Object.values(keep)),pick=lists.map(()=>null);
 for(const [i,t] of Object.entries(keep)){const e=(lists[i]||[]).find(x=>x.text===t);if(e)pick[i]=e;}
 const order=lists.map((l,i)=>i).filter(i=>!pick[i]).sort((a,b)=>(lists[a]||[]).length-(lists[b]||[]).length);
 for(const i of order){const free=(lists[i]||[]).filter(e=>!used.has(e.text));if(!free.length)continue;
  /* translated lines first: a line the learner cannot check is a weaker example */
  const good=free.filter(e=>e.translation),from=good.length?good:free,e=from[Math.floor(random()*from.length)];pick[i]=e;used.add(e.text);}
 return pick;
}
export function gameLineHTML(e,{esc,locale='zh',more=false}){
 const L=LABEL[locale]||LABEL.zh;if(!e)return '';
 const tr=e.translation?`<p class="gm-tr">${esc(e.translation)}</p>`:`<p class="gm-tr gm-none">${esc(L.noTr)}</p>`;
 return `<p class="gm-ja" lang="ja"${exAttr(e.text,e.ruby,esc)}>${markHTML(e.text,{start:e.start,end:e.end,esc})}</p>${tr}<div class="gm-how-game-meta"><span class="gm-cap">${esc(L.from)}《${esc(e.label||e.title||'')}》</span><span class="gm-ex-actions"><button type="button" class="gm-link" data-speak="${esc(e.text)}">${esc(L.play)}</button>${more?`<button type="button" class="gm-link" data-how-again>${esc(L.again)}</button>`:''}</span></div>`;
}
export const gameNoneHTML=({esc,locale='zh',dict=true})=>{const L=LABEL[locale]||LABEL.zh;return `<p class="gm-how-none">${esc(dict?L.none:L.noDict)}</p>`;};
export function howToHTML(point,real,{esc,locale='zh'}){
 const L=LABEL[locale]||LABEL.zh,h=howTo(point,real),shown=new Set();
 /* the same verb demo twice (名词 / 普通形 + とあれば and 动词普通形 … + とあれば) is shown once, on the first row */
 const demoOnce=r=>{const k=r.demo.map(d=>d.from+'>'+d.to).join('|');if(!k||shown.has(k))return [];shown.add(k);return r.demo;};
 const rows=h.rows.map((r,i)=>{const demo=demoOnce(r);return `<li class="gm-how-row" style="--row:${i}">${r.place?`<p class="gm-how-demo"><small>${esc(L.place)}</small></p>`:''}<div class="gm-formula">${r.formula.split(/\s+\+\s+/).map((part,k)=>`${k?'<i class="gm-plus" aria-hidden="true">+</i>':''}<span class="gm-block" style="--i:${k}"${r.place?' lang="ja"':''}>${esc(part==='{start}'?L.start:part==='{end}'?L.end:part)}</span>`).join('')}</div>${demo.length?`<p class="gm-how-demo"><small>${esc(L.demo)}</small>${demo.map(d=>`<span lang="ja">${esc(d.from)}${d.mid&&d.mid+''!==d.from?` → ${esc(d.mid)}`:''} → <b>${esc(d.to)}</b></span>`).join('')}</p>`:''}${r.rule?`<p class="gm-how-rule">${esc(r.rule)}</p>`:''}<div class="gm-how-game" data-how-row="${i}" aria-live="polite"><p class="gm-cap">${esc(L.finding)}</p></div></li>`;}).join('');
 const exs=h.examples.map(e=>`<li><p class="gm-ja" lang="ja"${exAttr(e.ja,null,esc)}>${markHTML(e.ja,{start:e.start,end:e.end,esc})}</p>${e.zh?`<p class="gm-tr">${esc(e.zh)}</p>`:''}<button type="button" class="gm-link" data-speak="${esc(e.ja)}">${esc(L.speak)}</button></li>`).join('');
 return `<section class="gm-how"><h4>${esc(L.rule)}</h4><ol class="gm-formulas gm-how-rows">${rows}</ol>${exs?`<h4>${esc(L.examples)}</h4><ol class="gm-how-ex">${exs}</ol>`:''}${h.note?`<p class="gm-how-note"><b>${esc(L.note)}</b>${esc(h.note)}</p>`:''}</section>`;
}
