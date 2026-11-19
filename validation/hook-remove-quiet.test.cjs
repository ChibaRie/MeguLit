'use strict';
/* 2026-11-19 (死に逝く君、館に芽吹く憎悪 exited with 0xC000041D at one fixed non-module address when Alt+M bound the game
   about 9 s after start): removing a text hook freed MinHook's trampoline while the game thread was still in the hook
   stub (useCount only covers the body of Send). RemoveHookCode must wait for every thread to be out of the stub, the
   trampoline and Send before MH_RemoveHook. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','native','megulithook','texthook.cc'),'utf8');
const body=name=>{const at=src.indexOf(name);assert.ok(at>0,name);const open=src.indexOf('{',at);let depth=0;for(let i=open;i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'&&--depth===0)return src.slice(open,i+1);}return '';};
test('hook removal waits until no thread can still return into the freed trampoline',()=>{
 const remove=body('void TextHook::RemoveHookCode()');
 const disable=remove.indexOf('MH_DisableHook'),quiet=remove.indexOf('HookQuiet('),free=remove.indexOf('MH_RemoveHook');
 assert.ok(disable>=0&&quiet>disable&&free>quiet,'disable, then wait for quiet threads, then free');
 assert.match(remove,/trampoline \+ original_offset/);
});
test('the quiet check suspends every other thread at once and looks at ip, trampoline, stack and useCount',()=>{
 const quiet=body('bool HookQuiet(');
 assert.match(quiet,/SuspendThread/);assert.match(quiet,/ResumeThread/);
 assert.ok(quiet.indexOf('Thread32First')<quiet.indexOf('SuspendThread'),'threads are listed before any is suspended');
 assert.doesNotMatch(quiet,/std::vector|new |malloc|HeapAlloc/,'no heap use while threads are suspended');
 assert.match(quiet,/\*useCount != 0/);assert.match(quiet,/original \+ 64/);assert.match(quiet,/v == ret/);
});
