@echo off
:: Agent Monitor -- register Task Scheduler entries:
::   AgentMonitorLogon : run at every user logon
::   AgentMonitor      : run every 15 minutes
cd /d "%~dp0"

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: node not found on PATH. Install Node.js first.
  pause & exit /b 1
)
if not exist "%~dp0.env" (
  echo ERROR: .env not found next to agent.js. Copy env.example to .env first.
  pause & exit /b 1
)

:: ONLOGON triggers need an elevated prompt; treat that task as best-effort.
:: The 15-minute task below works without elevation and covers logon within 15 min.
schtasks /Create /F /TN "AgentMonitorLogon" /TR "\"%~dp0run.bat\"" /SC ONLOGON
if %ERRORLEVEL% NEQ 0 (
  echo WARNING: could not create the logon task ^(needs "Run as administrator"^).
  echo          The 15-minute task still covers you; re-run elevated for at-logon runs.
)
schtasks /Create /F /TN "AgentMonitor"      /TR "\"%~dp0run.bat\"" /SC MINUTE /MO 15
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: could not register the 15-minute task.
  pause & exit /b 1
)

echo.
echo Installed. Verify with:  schtasks /Query /TN "AgentMonitor"
pause
