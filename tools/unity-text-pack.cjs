// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
/* Builds the on-demand runtime pack "unity-text" (text architecture ③, core/text-paths-unity.cjs):
     runtime/unity-text/x86|x64/   BepInEx 5.4.23.6 win_x86 / win_x64 as released (LGPL-2.1; UnityDoorstop LGPL-2.1,
                                   HarmonyX / MonoMod MIT), checked against the SHA-256 below
     runtime/unity-text/MeguLitUnityText.dll   native/unitytext (GPL-3.0-or-later), built by Build-UnityText.ps1
     runtime/unity-text/LICENSES.txt
     runtime/unity-text/il2cpp-x86|il2cpp-x64/   BepInEx 6.0.0-be.793 IL2CPP builds (LGPL-2.1, own .NET runtime; Il2CppInterop,
                                   Cpp2IL, HarmonyX MIT), SHA-256 pinned, for Unity IL2CPP games (interop generated on first start)
     runtime/unity-text/MeguLitUnityText.IL2CPP.dll   native/unitytext, built by Build-UnityText-IL2CPP.ps1
   Usage: node tools/unity-text-pack.cjs <MeguLitUnityText.dll> <MeguLitUnityText.IL2CPP.dll> <out.zip> [work dir]
   Prints size / unpacked / sha256 for setup/runtime.json ("unity-text": onDemand, hidden, files). Nothing is uploaded. */
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const VERSION='5.4.23.6';
const BEPINEX={x86:{file:'BepInEx_win_x86_'+VERSION+'.zip',sha256:'a4024dafaca5d3784097e34b3c2921415030c0b461e52f30053ed8914be9622d'},
 x64:{file:'BepInEx_win_x64_'+VERSION+'.zip',sha256:'6c57a714a892efb4e9e1fef63d608a3391f30ec984031c465404e4ee381a0755'},
 'il2cpp-x86':{file:'BepInEx-Unity.IL2CPP-win-x86-6.0.0-be.793%2Bdbc82f0.zip',url:'https://builds.bepinex.dev/projects/bepinex_be/793/',sha256:'6eb35cec828f16836674231b2ab4ab1db6c9953b7a11b34b8c8badba14218ed2'},
 'il2cpp-x64':{file:'BepInEx-Unity.IL2CPP-win-x64-6.0.0-be.793%2Bdbc82f0.zip',url:'https://builds.bepinex.dev/projects/bepinex_be/793/',sha256:'5b63d7d0e92a2448ccd13b738ff95ff1cc1026c6d718555d4df8e6c824953ac4'}};
const get=(url,hops=0)=>new Promise((resolve,reject)=>https.get(url,{headers:{'User-Agent':'MeguLit-pack'}},res=>{if([301,302,303,307,308].includes(res.statusCode)&&hops<8){res.resume();return resolve(get(new URL(res.headers.location,url).toString(),hops+1));}if(res.statusCode!==200){res.resume();return reject(Error('HTTP '+res.statusCode));}const b=[];res.on('data',d=>b.push(d));res.on('end',()=>resolve(Buffer.concat(b)));}).on('error',reject));
const tar=path.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe');
function du(d){let n=0;for(const e of fs.readdirSync(d,{withFileTypes:true}))n+=e.isDirectory()?du(path.join(d,e.name)):fs.statSync(path.join(d,e.name)).size;return n;}
(async()=>{
 const [dll,dllIl2cpp,out,work0]=process.argv.slice(2);if(!dll||!dllIl2cpp||!out)throw Error('usage: unity-text-pack.cjs <MeguLitUnityText.dll> <MeguLitUnityText.IL2CPP.dll> <out.zip> [work]');
 const work=work0||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'unity-text-'));const dest=path.join(work,'runtime','unity-text');fs.rmSync(path.join(work,'runtime'),{recursive:true,force:true});fs.mkdirSync(dest,{recursive:true});
 for(const [arch,b] of Object.entries(BEPINEX)){const zip=path.join(work,b.file);
  if(!fs.existsSync(zip))fs.writeFileSync(zip,await get((b.url||'https://github.com/BepInEx/BepInEx/releases/download/v'+VERSION+'/')+b.file));
  const sum=createHash('sha256').update(fs.readFileSync(zip)).digest('hex');if(sum!==b.sha256)throw Error(b.file+' sha256 '+sum);
  fs.mkdirSync(path.join(dest,arch));const r=spawnSync(tar,['-xf',zip,'-C',path.join(dest,arch)]);if(r.status!==0)throw Error('unpack '+b.file);}
 fs.copyFileSync(dll,path.join(dest,'MeguLitUnityText.dll'));fs.copyFileSync(dllIl2cpp,path.join(dest,'MeguLitUnityText.IL2CPP.dll'));
 fs.writeFileSync(path.join(dest,'LICENSES.txt'),['MeguLitUnityText.dll: MeguLit, GPL-3.0-or-later (https://github.com/ilynthn/MeguLit)','il2cpp-x86/, il2cpp-x64/: BepInEx 6.0.0-be.793 IL2CPP (https://builds.bepinex.dev), LGPL-2.1; includes Il2CppInterop, Cpp2IL, HarmonyX (MIT) and a .NET runtime (MIT). Unmodified build archives.','x86/, x64/: BepInEx '+VERSION+' (https://github.com/BepInEx/BepInEx), LGPL-2.1; includes UnityDoorstop (LGPL-2.1), HarmonyX and MonoMod (MIT), Mono.Cecil (MIT). Unmodified release archives.',''].join('\r\n'));
 fs.rmSync(out,{force:true});const r=spawnSync(tar,['-a','-cf',path.resolve(out),'runtime'],{cwd:work});if(r.status!==0)throw Error('zip failed');
 const buf=fs.readFileSync(out);console.log(JSON.stringify({size:buf.length,unpacked:du(dest),sha256:createHash('sha256').update(buf).digest('hex').toUpperCase(),onDemand:true,hidden:true,license:'BepInEx '+VERSION+' (LGPL-2.1), MeguLit (GPL-3.0-or-later)'},null,1));
})().catch(e=>{console.error(e.message);process.exit(1);});
