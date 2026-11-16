const test=require('node:test'),assert=require('node:assert');
const {RepeatNormalizer}=require('../core/repeat-normalizer.cjs');
test('2026-11-16: a stream learned as drawing lines twice keeps repeated stretches inside a sentence',()=>{
 const r=new RepeatNormalizer();
 for(const l of ['だが、それは現れた。　だが、それは現れた。　','唐突に出現して、人間の世界を全てひっくり返した。　唐突に出現して、人間の世界を全てひっくり返した。　','そこには普段と変わらない日常の姿があった。そこには普段と変わらない日常の姿があった。'])r.normalize('s',l);
 assert.strictEqual(r.normalize('s','今日も明日も明後日も、こんな日々が永遠に続くと信じない理由がなかった。'),'今日も明日も明後日も、こんな日々が永遠に続くと信じない理由がなかった。');
 assert.strictEqual(r.normalize('s','誰もが信じていた。誰もが信じていた。'),'誰もが信じていた。','whole copies are still undone');
});
