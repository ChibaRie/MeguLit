// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Hide layer 4, the "fake GPU" (docs/hide-layers.md, owner 2026-11-14: MeguLit draws all game text). MeguLitGpu<bit>.dll
   leaves the glyph quads of the dialogue line out of Direct3D 9 draws and GDI blits, after learning where the line is
   drawn; it never writes game memory, buffers or textures. Native self-test: native/gpuhide/selftest/run.cmd. */
const test=require('node:test'),assert=require('node:assert'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('learner is API-independent, generic and hides only after learning, inside the area, while armed',()=>{
 const g=read('native/gpuhide/GlyphQuads.h');
 assert.doesNotMatch(g,/#include <windows\.h>|d3d9/i,'no Windows / Direct3D in the decision core');
 assert.doesNotMatch(g,/kirikiri|krkr|siglus|bgi|yuris|bruns|unity|renpy|leaf|clannad|dustmania/i,'no engine or game names');
 assert.match(g,/armedUntil = now \+ 60000/,'a line stays armed 60 s after the last push');
 assert.match(g,/sameAtlas = rt == areaRt && atlases\.count\(AtlasKey\(rt, tex\)\)/,'learned atlas (by texture, not size) on the learned target');
 assert.match(g,/sheet = freshTex && LineSized\(tw, th\)/,'per-line glyph sheets: new and sized to the line only');
 assert.match(g,/if \(learned && armed && !readOnly && glyphSize && \(sameAtlas \|\| sheet\)\)/,'hides only after learning, while armed, at glyph height');
 assert.match(g,/cx >= area\.x0 && cx <= area\.x1 && cy >= area\.y0 && cy <= area\.y1/,'only inside the text area');
 assert.match(g,/on >= 1 && on \* 10 >= in \* 6/,'an atlas is learned only when its quads line up with the glyphs (never a UI sheet under the text)');
 assert.match(g,/if \(a\.size\(\) == n\) return &a; if \(b\.size\(\) == n\) return &b;/,'learns only when the glyph count equals the characters');
 assert.match(g,/bool Blanks\(const std::vector<Rect> &r, std::vector<Rect> &keep\) const/,'blank glyphs drawn for spaces are matched and dropped from the rects');
 assert.match(g,/ToMe_CHARS engine=gpu line=/,'reports rectangles in the text-architecture record');});

test('DLL never writes game data: dropped quads are draws not made, buffers are only read',()=>{
 const c=read('native/gpuhide/GpuHide.cpp');
 assert.match(c,/MH_CreateHook/,'functions hooked in place (per-device interface tables on Windows 10/11)');
 assert.match(c,/D3DCREATE_MULTITHREADED : 0/,'multithreaded device classes covered');
 assert.match(c,/SafeCopy\(&s\.data\[p\.off\], p\.ptr, size\)/,'vertex / index data copied into a shadow at Unlock');
 assert.doesNotMatch(c,/memcpy\(p\.ptr|WriteProcessMemory|VirtualProtect/,'nothing written into game buffers or code tables');
 assert.match(c,/CloseHandle\(p\); \{ Guard g; Learner\.Off\(\); \}/,'HookBridge gone: nothing stays hidden');
 assert.match(c,/MeguLitGpu version=1/,'version marker');
 const d=read('native/gpuhide/GpuHide11.h');
 assert.match(d,/D3D11CreateDeviceAndSwapChain/);assert.match(d,/c->IAGetInputLayout\(&l\)/,'pipeline state read with the context getters (state set before the DLL arrived)');
 assert.match(d,/L\.uv = \(int\)Ctx\.vbStride - 8/,'input layout made before the DLL arrived is guessed');
 assert.doesNotMatch(read('native/gpuhide/build.cmd'),/d3d11\.lib/,'the DLL never imports d3d11.dll (a D3D9 game must not load it)');
 assert.match(c,/HMODULE d = SystemModule\(L"d3d9\.dll"\)/,'throwaway devices only through the system d3d9.dll (WHITE ALBUM2 ships a wrapper d3d9.dll; using it crashed the game)');
 assert.match(c,/DeclInfo ParseDecl\(IDirect3DVertexDeclaration9 \*x\)/,'vertex declarations decoded (MAGES atlas draws)');});

test('HookBridge loads the layer, arms it for glyph-fallback streams and treats a hit like the GDI hide',()=>{
 const b=read('native/HookBridge.cs'),l=read('native/GpuHideLayer.cs'),i=read('native/HookInjector.cs'),s=read('native/Build-HookBridge.ps1');
 assert.match(b,/public static partial class HookBridge/);
 assert.match(b,/GpuHide\(bit,loader,args\);/);
 assert.match(b,/static void GlyphLine\(string text\)\{GpuLine\(text\);/);
 assert.match(b,/static void GlyphOff\(\)\{GpuDisarm\(\);/);
 assert.match(s,/'GpuHideLayer\.cs'/);
 assert.match(i,/"MeguLitGpu64\.dll"/);assert.match(i,/"MeguLitGpu32\.dll"/);
 for(const m of ['GpuCapabilities()','GpuArm(string streamId,string line)','GpuDisarm()','GpuReadOnly(bool on)','event Action<string,int,int,int> GpuHit'])assert.ok(l.includes(m),'orchestrator interface: '+m);
 assert.match(l,/GdiHideHit\("gpu "/,'hide-only only after a confirmed hit');
 assert.match(l,/type="hookChars",line=s/,'ToMe_CHARS passed on like the engine paths');
 assert.match(l,/if\(!GpuCanaryArm\(\)\)return;/,'crash canary checked before the DLL is loaded');
 assert.match(l,/if\(code>=0xC0000000u\)\{e\["off"\]=true;/,'an exception exit turns layer 4 off for that game');
 assert.match(l,/public static void GpuCanaryReset\(\)/,'turning it on again is the user\'s call');});

test('built, self-tested and shipped like every native binary',()=>{
 const nb=JSON.parse(read('native/native-builds.json')).find(e=>e.name==='gpuhide');
 assert.ok(nb,'native-builds.json entry');assert.deepStrictEqual(nb.outputs,['native/MeguLitGpu32.dll','native/MeguLitGpu64.dll']);
 assert.equal(nb.marker,'MeguLitGpu version=1');assert.equal(nb.ci,true);assert.deepStrictEqual(nb.selftests,['native/gpuhide/selftest/run.cmd']);
 const r=read('Release.ps1');assert.match(r,/'native\/MeguLitGpu32\.dll','native\/MeguLitGpu64\.dll'/);assert.match(r,/'native\/MeguLitGpu64\.dll','MeguLitGpu version=1'/);
 const h=read('native/gpuhide/selftest/host.cpp');
 for(const m of ['d3d9-up','d3d9-vb','d3d9-ivb','d3d9-decl','d3d11','gdi'])assert.ok(read('native/gpuhide/selftest/run.cmd').includes(m),'self-test mode '+m);
 assert.match(h,/dialogue glyphs %s \(%d\/8 white\), name kept \(%d\/3\), scene and box frame kept/,'pixels: line gone, name and scene kept');
 assert.ok(read('docs/hide-layers.md').includes('GpuArm(string streamId, string line)'),'interface documented');});
