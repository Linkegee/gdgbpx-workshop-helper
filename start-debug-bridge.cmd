@echo off
cd /d "%~dp0"
start "GBP Debug Bridge" /min python "%~dp0debug_bridge.py"
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { $h=Invoke-RestMethod 'http://127.0.0.1:17891/health' -TimeoutSec 2; Write-Host ('Debug bridge started: ' + $h.logFile) } catch { Write-Error 'Debug bridge failed to start. See logs/debug-bridge.stderr.log if available.' }"
