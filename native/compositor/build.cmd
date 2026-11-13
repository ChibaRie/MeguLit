@echo off
rem Builds native\MeguLitCompositor.exe (x64; it runs as its own process, so one build serves 32- and 64-bit games) and
rem runs the DotFinder synthetic-frame self-test. Objects go to %MEGULIT_BUILD_OUT% (default obj\ here).
setlocal
cd /d "%~dp0"
if "%MEGULIT_VS%"=="" set "MEGULIT_VS=E:\Apps\build-tools\vs2022\Common7\Tools\VsDevCmd.bat"
if "%MEGULIT_BUILD_OUT%"=="" set "MEGULIT_BUILD_OUT=%~dp0obj"
if not exist "%MEGULIT_BUILD_OUT%" mkdir "%MEGULIT_BUILD_OUT%"
call "%MEGULIT_VS%" -arch=x64 -host_arch=x64 -no_logo >nul 2>nul || exit /b 1
set FLAGS=/nologo /std:c++17 /O2 /EHsc /W3 /utf-8 /MT /bigobj /permissive- /DUNICODE /D_UNICODE
cl %FLAGS% /Fo"%MEGULIT_BUILD_OUT%\\" Compositor.cpp /Fe:..\MeguLitCompositor.exe /link /SUBSYSTEM:CONSOLE d3d11.lib dxgi.lib d2d1.lib dwrite.lib d3dcompiler.lib windowscodecs.lib dwmapi.lib user32.lib gdi32.lib ole32.lib windowsapp.lib >"%MEGULIT_BUILD_OUT%\compositor.log" || (type "%MEGULIT_BUILD_OUT%\compositor.log" & exit /b 1)
cl /nologo /std:c++17 /O2 /EHsc /W3 /utf-8 /Fo"%MEGULIT_BUILD_OUT%\\" selftest\DotSelfTest.cpp /Fe:"%MEGULIT_BUILD_OUT%\DotSelfTest.exe" >"%MEGULIT_BUILD_OUT%\selftest.log" || (type "%MEGULIT_BUILD_OUT%\selftest.log" & exit /b 1)
cl /nologo /std:c++17 /O2 /EHsc /W3 /utf-8 /DUNICODE /D_UNICODE /Fo"%MEGULIT_BUILD_OUT%\\" selftest\FramePlayer.cpp /Fe:"%MEGULIT_BUILD_OUT%\FramePlayer.exe" /link /SUBSYSTEM:CONSOLE >"%MEGULIT_BUILD_OUT%\player.log" || (type "%MEGULIT_BUILD_OUT%\player.log" & exit /b 1)
echo MeguLitCompositor built
