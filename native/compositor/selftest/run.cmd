@echo off
rem DotFinder synthetic-frame self-test (built by ..\build.cmd into %MEGULIT_BUILD_OUT% or ..\obj).
setlocal
set "OUT=%MEGULIT_BUILD_OUT%"
if "%OUT%"=="" set "OUT=%~dp0..\obj"
"%OUT%\DotSelfTest.exe" || exit /b 1
