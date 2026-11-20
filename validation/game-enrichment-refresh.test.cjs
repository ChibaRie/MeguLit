'use strict';
// The VNDB entry corrected in the edit dialog while the details panel is still fetching the old match: the forced refresh
// save_game asks for must run after that fetch, not be folded into it.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'megulit-refresh-'));process.env.MEGULIT_ROOT=root;
const store=require('../services/store.cjs'),{GameEnrichment}=require('../services/game-enrichment.cjs');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

test('a forced refresh asked during a run is not lost',async()=>{
 const exe=path.join(root,'game','game.exe');fs.mkdirSync(path.dirname(exe),{recursive:true});fs.writeFileSync(exe,'MZ');
 const db=store.openStore(root);try{db.prepare('INSERT INTO games(id,title,executable,cover,source,original) VALUES(?,?,?,?,?,?)').run('game-1','月影的幻影',exe,'','folder',JSON.stringify({library:{names:['月影的幻影'],vndbId:'v1'}}));}finally{db.close();}
 const original=()=>{const d=store.openStore(root);try{return JSON.parse(d.prepare('SELECT original FROM games WHERE id=?').get('game-1').original);}finally{d.close();}};
 let release;const gate=new Promise(r=>release=r),asked=[];
 const network=async(url,options={})=>{url=String(url);const body=options.body?JSON.parse(options.body):{};
  if(url==='https://api.vndb.org/kana/vn'){const id=body.filters?.[2];asked.push(id);if(id==='v1')await gate;
   return Response.json({results:[{id,title:'Tsukikage no Simulacre',alttitle:'月影のシミュラクル',titles:[],image:{url:'https://t.vndb.org/cv/00/'+id+'.jpg'},developers:[]}]});}
  if(url==='https://api.vndb.org/kana/release')return Response.json({results:[]});
  if(url.startsWith('https://t.vndb.org/'))return new Response(Buffer.from([0xff,0xd8,0xff,0xe0]));
  return new Response('',{status:404});};
 const realFetch=globalThis.fetch;globalThis.fetch=network;
 try{
  const meta=new GameEnrichment(root,()=>{},network,async()=>'');
  const opened=meta.ensure('game-1','en');/* details panel: fetching v1 */
  await new Promise(r=>setTimeout(r,20));
  {const d=store.openStore(root);try{const o=original();o.vndbManual='v2';d.prepare('UPDATE games SET original=? WHERE id=?').run(JSON.stringify(o),'game-1');}finally{d.close();}}/* save_game's write */
  const corrected=meta.ensure('game-1','en',true);/* what save_game's refresh does */
  release();await opened;await corrected;
 }finally{globalThis.fetch=realFetch;}
 assert.deepEqual([...new Set(asked)],['v1','v2']);/* the old run, then one for the corrected entry */
 assert.equal(original().library.vndbId,'v2');
});
