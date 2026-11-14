// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* A game's name as MeguLit writes it in notices and examples: 原名（中文圈通用译名）, e.g. 千恋＊万花（千恋万花）.
   The original name is the Japanese one the library knows (a VNDB/Steam alias with kana, the folder's own name), the
   Chinese one comes from the library's aliases or, for well-known works whose Chinese name is not in the library,
   from the short table below. Without a Chinese name the original name stands alone. Shared by every page. */
const KNOWN=[
 [['summer pockets'],'Summer Pockets','夏日口袋'],
 [['senrenbanka','千恋＊万花','千恋*万花'],'千恋＊万花','千恋万花'],
 [['atri -my dear moments-','atri'],'ATRI -My Dear Moments-','亚托莉'],
 [['white album2','white album 2'],'WHITE ALBUM2','白色相簿2'],
 [['steins;gate'],'STEINS;GATE','命运石之门'],
 [['steins;gate 0'],'STEINS;GATE 0','命运石之门0'],
 [['chaos;child'],'CHAOS;CHILD','混沌之子'],
 [['サノバウィッチ','sanoba witch'],'サノバウィッチ','魔女的夜宴'],
 [['魔法使いの夜','witch on the holy night'],'魔法使いの夜','魔法使之夜'],
 [['素晴らしき日々～不連続存在～','素晴らしき日々'],'素晴らしき日々～不連続存在～','美好的每一天～不连续的存在～'],
 [['装甲悪鬼村正'],'装甲悪鬼村正','装甲恶鬼村正'],
 [['月に寄りそう乙女の作法'],'月に寄りそう乙女の作法','近月少女的礼仪'],
 [['ひぐらしのなく頃に'],'ひぐらしのなく頃に','寒蝉鸣泣之时'],
 [['沙耶の唄','the song of saya'],'沙耶の唄','沙耶之歌'],
 [['殻ノ少女'],'殻ノ少女','壳之少女'],[['虚ノ少女'],'虚ノ少女','虚之少女'],[['天ノ少女'],'天ノ少女','天之少女'],
 [['ましろ色シンフォニー'],'ましろ色シンフォニー','纯白交响曲'],
 [['ファタモルガーナの館'],'ファタモルガーナの館','海市蜃楼之馆'],
 [['魔法少女ノ魔女裁判'],'魔法少女ノ魔女裁判','魔法少女的魔女审判'],
 [['まいてつ'],'まいてつ','爱上火车'],
 [['アオイトリ'],'アオイトリ','青鸟'],
 [['いろとりどりのヒカリ'],'いろとりどりのヒカリ','五彩斑斓的曙光'],
 [['時計仕掛けのレイライン'],'時計仕掛けのレイライン','时钟机关之星'],
 [['女装山脈'],'女装山脈','女装山脉'],
 [['月姫','月姬'],'月姫','月姬'],
 [['ダンガンロンパ 希望の学園と絶望の高校生'],'ダンガンロンパ 希望の学園と絶望の高校生','弹丸论破 希望的学园和绝望的高中生'],
 [['スーパーダンガンロンパ2 さよなら絶望学園'],'スーパーダンガンロンパ2 さよなら絶望学園','超级弹丸论破2 再见了绝望学园'],
 [['ニューダンガンロンパv3 みんなのコロシアイ新学期'],'ニューダンガンロンパV3 みんなのコロシアイ新学期','新弹丸论破V3 大家的自相残杀新学期'],
 [['逆転検事'],'逆転検事','逆转检事'],[['9-nine-'],'9-nine-','9-nine-']];
const KANA=/[ぁ-ゖァ-ヺ]/,CJK=/[一-鿿]/;
const clean=s=>String(s||'').replace(/^(\s*\[[^\]]*\])+\s*/,'').replace(/\s*\((?:SD|iso)[^)]*\)\s*$/i,'').trim();
const key=s=>clean(s).toLowerCase().replace(/\s+/g,' ');
const known=names=>{const keys=names.map(key);return KNOWN.find(([k])=>k.some(x=>keys.some(n=>n===x||n.startsWith(x+' ')||n.startsWith(x+'～')||n.startsWith(x+' v'))))||null;};
/* {ja, zh, label}: label is 原名（译名） or just 原名 */
function gameTitle(title,names=[]){
 const all=[title,...(Array.isArray(names)?names:[])].map(clean).filter(Boolean);if(!all.length)return {ja:'',zh:'',label:''};
 const k=known(all);
 /* the Japanese name: one with kana and no Latin letters first (魔法少女ノ魔女裁判, not Magical Girl Witch Trials (魔法少女ノ魔女裁判)) */
 const ja=all.find(n=>KANA.test(n)&&!/[A-Za-z]/.test(n))||all.find(n=>KANA.test(n))||k?.[1]||all[0];
 let zh=k?.[2]||all.find(n=>CJK.test(n)&&!KANA.test(n)&&n!==ja)||'';
 if(zh&&(zh===ja||ja.includes(zh)))zh='';
 return {ja,zh,label:zh?`${ja}（${zh}）`:ja};
}
/* titles by executable from the library (data/config/library.json); the games table keeps only one title */
function libraryNames(root){
 const out=new Map();if(!root)return out;
 try{const lib=JSON.parse(require('node:fs').readFileSync(require('node:path').join(root,'data','config','library.json'),'utf8'));
  for(const g of lib.games||[])if(g?.exe)out.set(String(g.exe).toLowerCase(),[g.title,...(g.names||[])].filter(Boolean));}catch{}
 return out;
}
module.exports={gameTitle,libraryNames};
