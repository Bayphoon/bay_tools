@echo off
setlocal
cd /d "%~dp0"

if /i "%~1"=="--console" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0BayTools.Launcher.ps1" -Console
  exit /b %errorlevel%
)

start "" wscript.exe "%~dp0BayTools.vbs"
exit /b 0
