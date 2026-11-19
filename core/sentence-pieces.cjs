// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-19 (user, 素晴らしき日々 BGI: 「やっぱり……いい女には、」「たばこと」「屋上と」「……そして」「ヒラヒラ服だわね……」」 is one sentence the game
   adds to its box piece by piece, one click each; the reader showed four sentences replacing each other). A piece that comes
   while the previous line of the same stream is an unfinished quotation (a 「『 left open, no sentence end) and that does not
   start a new one (indent, opening bracket) is the same sentence: the line grows by it. The grown line also resolves in the
   script as one capture (Matcher steps over the resource lines between the messages), so its translation is the whole
   sentence's. Any engine; only an open quotation joins, so ordinary narration and dialogue lines are untouched. */
const flat=s=>String(s||'').replace(/[\s　]+/g,'');
function unfinished(text){const t=String(text||'').replace(/\s+$/,'');if(!t||/[。．！？!?」』）)】]$/.test(t))return false;
 const o=Math.max(t.lastIndexOf('「'),t.lastIndexOf('『')),c=Math.max(t.lastIndexOf('」'),t.lastIndexOf('』'));return o>c;}
function continues(piece){const t=String(piece||'').replace(/^\n+/,'');return !!t.trim()&&!/^[　 「『（(【［\[]/.test(t);}
class SentencePieces{
 constructor(now=()=>Date.now(),{within=60000,max=400}={}){this.now=now;this.within=within;this.max=max;this.last=null;}
 /* The line to deliver for this piece: the grown sentence, or the piece itself. */
 take(stream,piece){const now=this.now(),L=this.last,p=String(piece??'');let out=p;
  if(L&&L.stream===stream&&now-L.at<this.within&&unfinished(L.text)&&continues(p)){const a=flat(L.text),b=flat(p);
   if(b.startsWith(a))out=p; /* the engine sent the grown sentence itself */
   else if(a.endsWith(b))out=L.text; /* the last piece again (a redraw): nothing new */
   else if(L.text.length+p.length<=this.max)out=L.text+p;}
  this.last={stream,text:out,at:now};return out;}
 reset(){this.last=null;}
}
module.exports={SentencePieces,unfinished,continues};
