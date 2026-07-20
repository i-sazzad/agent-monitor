@echo off
:: Agent Monitor -- interactive launcher (double-click to run once and see output)
cd /d "%~dp0"
call run.bat
echo.
echo === Last output ===
powershell -command "Get-Content agent-monitor.log -Tail 20"
echo.
pause
