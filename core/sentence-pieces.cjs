// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-19 (user, 素晴らしき日々 BGI: 「やっぱり……いい女には、」「たばこと」「屋上と」「……そして」「ヒラヒラ服だわね……」」 is one sentence the game adds to
   its box piece by piece, one click each; the reader showed four sentences replacing each other). The grown line also
   resolves in the script as one capture (Matcher steps over the resource lines between the messages), so its translation
   is the whole sentence's. Any engine.
   Engine evidence first: a \x05 continuation is joined in the bridge (HookSourceFrames), a page the engine turns or leaving
   the dialogue screen ends the sentence (reset), a new speaker name starts a new one. The text rule is only the fallback
   and stays narrow: the previous line of the same stream is inside an open 「『 (narration without a full stop never joins),
   and the piece does not open a new line (indent, bracket, a name before a bracket). */
const flat=s=>String(s||'').replace(/[\s　]+/g,'');
const NEW_LINE=/^[　 「『（(【［[]/,NAMED_QUOTE=/^[^「『」』。、\s]{1,16}[「『]/;
function unfinished(text){const t=String(text||'').replace(/\s+$/,'');if(!t||/[。．！？!?」』）)】]$/.test(t))return false;
 const o=Math.max(t.lastIndexOf('「'),t.lastIndexOf('『')),c=Math.max(t.lastIndexOf('」'),t.lastIndexOf('』'));return o>c;}
function continues(piece){const t=String(piece||'').replace(/^\n+/,'');return !!t.trim()&&!NEW_LINE.test(t)&&!NAMED_QUOTE.test(t);}
class SentencePieces{
 constructor(now=()=>Date.now(),{within=60000,max=400}={}){this.now=now;this.within=within;this.max=max;this.last=null;}
 /* The line to deliver for this piece: the grown sentence, or the piece itself. speaker: the name the engine gave with it. */
 take(stream,piece,speaker=''){const now=this.now(),L=this.last,p=String(piece??''),who=String(speaker||'');let out=p;
  if(L&&L.stream===stream&&now-L.at<this.within&&!(who&&who!==L.speaker)&&unfinished(L.text)&&continues(p)){const a=flat(L.text),b=flat(p);
   if(b.startsWith(a))out=p; /* the engine sent the grown sentence itself */
   else if(a.endsWith(b))out=L.text; /* the last piece again (a redraw): nothing new */
   else if(L.text.length+p.length<=this.max)out=L.text+p;}
  this.last={stream,text:out,at:now,speaker:out!==p&&L?L.speaker||who:who};return out;}
 reset(){this.last=null;}
}
module.exports={SentencePieces,unfinished,continues};
