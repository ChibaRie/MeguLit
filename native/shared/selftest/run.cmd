@echo off
rem Stress test of native\shared\MeguLitSafeUnhook.h (unhook-stress.cpp) with MinHook, x86 and x64: 1000 hook/unhook
rem rounds under calling threads, a parked thread (memory kept, not freed), RetryKept. The old removal (--naive) must
rem fail, so the test can see a regression. Exit code 0 = passed.
setlocal
cd /d "%~dp0"
if "%MEGULIT_VS%"=="" set "MEGULIT_VS=E:\Apps\build-tools\vs2022\Common7\Tools\VsDevCmd.bat"
set "WORK=%TEMP%\megulit-safe-unhook"
if not exist "%WORK%" mkdir "%WORK%"
set "MH=..\..\scncapture\minhook"
set SRC=unhook-stress.cpp %MH%\src\hook.c %MH%\src\buffer.c %MH%\src\trampoline.c %MH%\src\hde\hde32.c %MH%\src\hde\hde64.c
set FLAGS=/nologo /O2 /MT /EHsc /W3 /utf-8 /DUNICODE /D_UNICODE /DWIN32_LEAN_AND_MEAN /I%MH%\include
for %%B in (32 64) do if not exist "%WORK%\%%B" mkdir "%WORK%\%%B"
setlocal
call "%MEGULIT_VS%" -arch=x86 -host_arch=x64 -no_logo >nul 2>&1
cl %FLAGS% /Fo"%WORK%\32\\" %SRC% /Fe:"%WORK%\stress32.exe" >nul || (echo build x86 failed& exit /b 1)
endlocal
setlocal
call "%MEGULIT_VS%" -arch=x64 -host_arch=x64 -no_logo >nul 2>&1
cl %FLAGS% /Fo"%WORK%\64\\" %SRC% /Fe:"%WORK%\stress64.exe" >nul || (echo build x64 failed& exit /b 1)
endlocal
for %%B in (32 64) do (
 echo [%%B-bit]
 "%WORK%\stress%%B.exe" || exit /b 1
 "%WORK%\stress%%B.exe" --naive >nul 2>&1
 if not errorlevel 1 (echo FAIL the old removal does not fail here: the test cannot see a regression& exit /b 1)
 echo ok   the old removal ^(MH_DisableHook + MH_RemoveHook^) fails this test
)
echo SAFE UNHOOK SELFTEST PASSED
endlocal
