@echo off
rem Self-test of FontDotPatch.h on system fonts (no game): MS Gothic collection and a single TrueType font.
setlocal
cd /d "%~dp0"
if "%MEGULIT_VS%"=="" set "MEGULIT_VS=E:\Apps\build-tools\vs2022\Common7\Tools\VsDevCmd.bat"
set "WORK=%TEMP%\megulit-fontdot-selftest"
if not exist "%WORK%" mkdir "%WORK%"
call "%MEGULIT_VS%" -arch=x64 -host_arch=x64 -no_logo >nul 2>&1
cl /nologo /O2 /EHsc /W3 /utf-8 /DUNICODE /D_UNICODE patch.cpp /Fo"%WORK%\\" /Fe:"%WORK%\patch.exe" /link gdi32.lib >nul || exit /b 1
"%WORK%\patch.exe" "%WINDIR%\Fonts\msgothic.ttc" "MS Gothic" || exit /b 1
endlocal
