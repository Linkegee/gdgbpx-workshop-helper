@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0chrome-debug.ps1" -Action start
if errorlevel 1 pause
