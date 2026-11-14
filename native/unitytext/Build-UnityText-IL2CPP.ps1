param([string]$OutputPath,[string]$Shadow=$env:MEGULIT_IL2CPP_SHADOW)
$ErrorActionPreference='Stop'
# Builds MeguLitUnityText.IL2CPP.dll (BepInEx 6 IL2CPP plugin). References only, none shipped: a game folder (or MeguLit
# shadow folder) after BepInEx 6 ran once there: its dotnet\ runtime, BepInEx\core and the generated BepInEx\interop.
if(-not $Shadow -or -not (Test-Path (Join-Path $Shadow 'BepInEx\interop\UnityEngine.CoreModule.dll'))){throw 'Set MEGULIT_IL2CPP_SHADOW to a folder where BepInEx 6 IL2CPP generated its interop assemblies'}
$csc=@($env:MEGULIT_ROSLYN_CSC,'E:\Apps\build-tools\vs2022\MSBuild\Current\Bin\Roslyn\csc.exe')|?{$_ -and (Test-Path $_)}|select -First 1
if(-not $OutputPath){$OutputPath=Join-Path (Split-Path $PSScriptRoot) 'MeguLitUnityText.IL2CPP.dll'}
$net=Join-Path $Shadow 'dotnet'; $core=Join-Path $Shadow 'BepInEx\core'; $interop=Join-Path $Shadow 'BepInEx\interop'
$refs=@()
foreach($f in Get-ChildItem $net -Filter 'System*.dll'){ if($f.Name -notmatch 'Native|IO.Compression.Native'){ $refs+='/reference:'+$f.FullName } }
$refs+='/reference:'+(Join-Path $net 'netstandard.dll')
foreach($n in 'BepInEx.Core','BepInEx.Unity.IL2CPP','Il2CppInterop.Runtime','Il2CppInterop.Common'){ $refs+='/reference:'+(Join-Path $core "$n.dll") }
foreach($n in 'Il2Cppmscorlib','UnityEngine.CoreModule','UnityEngine.UIModule','UnityEngine.UI','UnityEngine.TextRenderingModule','Unity.TextMeshPro','Il2CppSystem'){ $p=Join-Path $interop "$n.dll"; if(Test-Path $p){ $refs+='/reference:'+$p } }
& $csc /nologo /noconfig /nostdlib+ /langversion:10 /optimize+ /target:library /platform:anycpu /nowarn:CS1701,CS1702 "/out:$OutputPath" @refs (Join-Path $PSScriptRoot 'MeguLitUnityText.IL2CPP.cs')
if($LASTEXITCODE -ne 0){throw 'MeguLitUnityText.IL2CPP compilation failed'}
