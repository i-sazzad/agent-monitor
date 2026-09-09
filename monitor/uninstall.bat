@echo off
schtasks /Delete /F /TN "AgentMonitorLogon" 2>nul
schtasks /Delete /F /TN "AgentMonitor" 2>nul
echo Removed Agent Monitor scheduled tasks.
pause
