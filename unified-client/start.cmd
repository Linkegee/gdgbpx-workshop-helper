@echo off
cd /d "%~dp0"
call npm run build
if errorlevel 1 exit /b 1
set ELECTRON_RUN_AS_NODE=
node_modules\electron\dist\electron.exe .
