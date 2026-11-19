@echo off
rem Builds and runs the MeguLitGdiHide.h, MeguLitEmbedWait.h (A6 embed wait replay) and MeguLitBgiSprite.h (BGI sprite text scan) self-tests as a 32-bit and as a 64-bit host process (the hook ships for both),
rem then checks that both shipped hook DLLs carry the GDI hide version marker. Exit code = failures (1 for a DLL miss).
setlocal
cd /d "%~dp0"
if "%MEGULIT_VS%"=="" set "MEGULIT_VS=E:\Apps\build-tools\vs2022\Common7\Tools\VsDevCmd.bat"
if not exist "%TEMP%\megulit-gdihide32" mkdir "%TEMP%\megulit-gdihide32"
if not exist "%TEMP%\megulit-gdihide64" mkdir "%TEMP%\megulit-gdihide64"
cmd /c "call "%MEGULIT_VS%" -arch=x86 -host_arch=x64 -no_logo >nul && cl /nologo /O2 /EHsc /std:c++17 /utf-8 gdihide.cpp /Fe:"%TEMP%\megulit-gdihide32\host.exe" /Fo"%TEMP%\megulit-gdihide32\\" /link gdi32.lib user32.lib >nul" || exit /b 1
cmd /c "call "%MEGULIT_VS%" -arch=x64 -host_arch=x64 -no_logo >nul && cl /nologo /O2 /EHsc /std:c++17 /utf-8 gdihide.cpp /Fe:"%TEMP%\megulit-gdihide64\host.exe" /Fo"%TEMP%\megulit-gdihide64\\" /link gdi32.lib user32.lib >nul" || exit /b 1
cmd /c "call "%MEGULIT_VS%" -arch=x86 -host_arch=x64 -no_logo >nul && cl /nologo /O2 /EHsc /std:c++17 /utf-8 embedwait.cpp /Fe:"%TEMP%\megulit-gdihide32\embedwait.exe" /Fo"%TEMP%\megulit-gdihide32\\" >nul" || exit /b 1
cmd /c "call "%MEGULIT_VS%" -arch=x64 -host_arch=x64 -no_logo >nul && cl /nologo /O2 /EHsc /std:c++17 /utf-8 embedwait.cpp /Fe:"%TEMP%\megulit-gdihide64\embedwait.exe" /Fo"%TEMP%\megulit-gdihide64\\" >nul" || exit /b 1
cmd /c "call "%MEGULIT_VS%" -arch=x86 -host_arch=x64 -no_logo >nul && cl /nologo /O2 /EHsc /std:c++17 /utf-8 bgisprite.cpp /Fe:"%TEMP%\megulit-gdihide32\bgisprite.exe" /Fo"%TEMP%\megulit-gdihide32\\" >nul" || exit /b 1
rem BGI sprite text scan (MeguLitBgiSprite.h, 32-bit like BGI): the built-in fixture, and a real BGI.exe when MEGULIT_BGI_EXE names one
echo [bgi sprite scan]
"%TEMP%\megulit-gdihide32\bgisprite.exe"
 if errorlevel 1 exit /b 1
rem A6 embed wait replay (MeguLitEmbedWait.h): must pass, and the old waiting (--old) must fail, so the test can see a regression
for %%B in (32 64) do (
 echo [embed wait %%B-bit]
 "%TEMP%\megulit-gdihide%%B\embedwait.exe"
 if errorlevel 1 exit /b 1
 "%TEMP%\megulit-gdihide%%B\embedwait.exe" --old >nul
 if not errorlevel 1 (echo FAIL embed wait replay does not catch the old waiting& exit /b 1)
 echo PASS embed wait replay catches the old waiting
)
echo [32-bit]
"%TEMP%\megulit-gdihide32\host.exe" || exit /b 1
echo [64-bit]
"%TEMP%\megulit-gdihide64\host.exe" || exit /b 1
for %%D in (MeguLitHook32.dll MeguLitHook64.dll) do (
 findstr /m /c:"MeguLit_GDIHIDE armed version=2" "%~dp0..\%%D" >nul && (echo PASS %%D carries MeguLit_GDIHIDE armed version=2) || (echo FAIL %%D lacks the GDI hide version marker & exit /b 1)
)
