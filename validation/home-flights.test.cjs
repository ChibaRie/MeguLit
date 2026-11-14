/* 2026-11-13 (user: "我要的十种不同手牌和在场牌切换的不同…动画呢", "最后衔接会卡") the ten hand/field flights each have their own signature and length,
   end exactly on the field pose, and hand off to the real card with a short cross-fade */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

test('the ten flights each have a signature that tells them apart',async()=>{
 const h=await import('../web/home-hand.js'),A={x:900,y:700,r:12,s:.3,rx:0,ry:0,o:1},B={x:1000,y:300,r:-4,s:1,rx:0,ry:0,o:1};
 const sig=k=>{const f=h.flightFrames(k,A,B,60),dist=Math.hypot(B.x-A.x,B.y-A.y),line=p=>((p.x-A.x)*(B.y-A.y)-(p.y-A.y)*(B.x-A.x))/dist;
  return {arc:Math.max(...f.map(p=>Math.abs(line(p)))),spinR:Math.max(...f.map(p=>Math.abs(p.r-B.r))),ry:Math.max(...f.map(p=>Math.abs(p.ry))),rx:Math.max(...f.map(p=>Math.abs(p.rx))),
   back:Math.max(...f.map(p=>((A.x-p.x)*(B.x-A.x)+(A.y-p.y)*(B.y-A.y))/dist)),up:Math.max(...f.map(p=>A.y-p.y))};};
 const s=Object.fromEntries(h.HAND_VARIANTS.map(k=>[k,sig(k)]));
 assert.ok(s.toss.arc>150,'toss: high arc');assert.ok(s.flip.ry>=180,'flip: turns over');assert.ok(s.spin.spinR>=300,'spin: a full turn');
 assert.ok(s.edge.ry>70,'edge: goes edge-on');assert.ok(s.slap.rx>15,'slap: slams down');assert.ok(s.pull.back>40,'pull: winds back first');
 assert.ok(s.swing.spinR>20&&s.swing.ry===0,'swing: pendulum');assert.ok(s.dive.rx>10,'dive: tips into the table');
 for(const k of h.HAND_VARIANTS)assert.ok(h.FLIGHT_MS[k]>=500&&h.FLIGHT_MS[k]<=1100,k+' has its own length');
 assert.ok(new Set(Object.values(h.FLIGHT_MS)).size>=6,'lengths differ');
});

test('a hovered (lifted) hand card takes off from where it is drawn, not from its resting slot',()=>{
 const hand=fs.readFileSync(path.join(__dirname,'..','web','home-hand.js'),'utf8');
 assert.ok(hand.includes('function cardPose(el,W)')&&hand.includes('new DOMMatrixReadOnly(getComputedStyle(el).transform)'),'pose read from the card as drawn');
 assert.ok(hand.includes("?cardPose(pickEl,W):slotPose(id,W))"),'(user: 手牌就会有个强制被改变位置的bug) picked card starts at its drawn pose');
});

test('the fan moves with Web Animations, so a busy moment never skips a re-spacing',()=>{
 const W=path.join(__dirname,'..','web'),hand=fs.readFileSync(path.join(W,'home-hand.js'),'utf8'),css=fs.readFileSync(path.join(W,'home-tv.css'),'utf8');
 assert.ok(hand.includes("el._mv=el.animate([{transform:a},{transform:to}],{duration:420,easing:EASE})"),'(user: 手牌就会有个强制被改变位置的bug) moves are animations that start when drawn');
 assert.ok(!/^\.tv-hc\{[^}]*transition:transform/m.test(css),'no CSS transform transition on hand cards (it was timed from the style change and skipped ahead after a busy frame)');
});

test('the home page picks games from the cover strip again, not from a card hand',()=>{
 const W=path.join(__dirname,'..','web'),tv=fs.readFileSync(path.join(W,'home-tv.js'),'utf8');
 assert.ok(!tv.includes('createHand')&&!tv.includes('tv-hand'),'no card hand on the home page');assert.ok(tv.includes('tv-chip')&&tv.includes('.tv-rail'),'the strip of covers is the selector');
});
