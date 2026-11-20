@echo off
rem MeguLit installer trial: installs to a test folder only, never touches E:\MeguLit. Throttled to ~40 s; add --full for full speed.
node "%~dp0try-server.cjs" %*
