// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* 2026-11-14 (月姬 v1.4 / v1.6, Chinese NScripter builds): a Chinese patch keeps the engine's ANSI text calls (TextOutA and
   the like) but feeds them GBK bytes. LunaHook reads hooks that carry no code page of their own as Shift-JIS (932), so the
   dialogue reached MeguLit as half-width katakana noise (｡ｸ｡ｭ｡ｭｲｻﾌｫﾇ・ｳ), no stream was chosen and nothing was shown; the
   misreading is lossy (bytes Shift-JIS cannot map become ・), so it cannot be repaired afterwards. The bound game's script
   tells which code page its text is in: an engine reader that can tell (codepage(dir) -> 'gbk' | 'shift_jis') decides. */
const path=require('node:path');
const READERS=[()=>require('../services/original-engines/nscripter.cjs')];
const memo=new Map();
function hookCodepage(exe){const dir=path.dirname(String(exe||''));if(!exe||!dir||dir==='.')return 932;
 if(memo.has(dir))return memo.get(dir);let cp=932;
 for(const load of READERS){let r;try{r=load();}catch{continue;}if(typeof r.codepage!=='function')continue;let enc='';try{enc=r.codepage(dir);}catch{}if(enc==='gbk'){cp=936;break;}if(enc)break;}
 memo.set(dir,cp);if(memo.size>32)memo.delete(memo.keys().next().value);return cp;}
module.exports={hookCodepage};
