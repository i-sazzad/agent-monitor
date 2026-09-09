@echo off
:: Agent Monitor -- silent runner (used by Task Scheduler; no pause, no output)
cd /d "%~dp0"
echo [%date% %time%] Running agent capture... >> agent-monitor.log 2>&1
node agent.js >> agent-monitor.log 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] agent.js exited with code %ERRORLEVEL% >> agent-monitor.log 2>&1
)
