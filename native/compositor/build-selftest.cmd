@echo off
rem Builds and runs the DotFinder synthetic-frame self-test (x64). Output goes to %MEGULIT_BUILD_OUT% (default obj-test\).
setlocal
cd /d "%~dp0"
if "%MEGULIT_VS%"=="" set "MEGULIT_VS=E:\Apps\build-tools\vs2022\Common7\Tools\VsDevCmd.bat"
if "%MEGULIT_BUILD_OUT%"=="" set "MEGULIT_BUILD_OUT=%~dp0obj-test"
if not exist "%MEGULIT_BUILD_OUT%" mkdir "%MEGULIT_BUILD_OUT%"
call "%MEGULIT_VS%" -arch=x64 -host_arch=x64 -no_logo >nul || exit /b 1
cl /nologo /std:c++17 /O2 /EHsc /W3 /utf-8 /Fo"%MEGULIT_BUILD_OUT%\\" selftest\DotSelfTest.cpp /Fe:"%MEGULIT_BUILD_OUT%\DotSelfTest.exe" >"%MEGULIT_BUILD_OUT%\build.log" || (type "%MEGULIT_BUILD_OUT%\build.log" & exit /b 1)
"%MEGULIT_BUILD_OUT%\DotSelfTest.exe"
