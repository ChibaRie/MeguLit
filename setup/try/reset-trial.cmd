@echo off
rem wipes the trial install folder and the resume cache
node "%~dp0try-server.cjs" --reset --no-browser
pause
