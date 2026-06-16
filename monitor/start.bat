@echo off
:: Agent Monitor — Windows launcher
:: Run this file manually or add it to Task Scheduler to auto-report.
:: Task Scheduler: Action = "Start a program", Program = this .bat file

cd /d "%~dp0"
node agent.js
