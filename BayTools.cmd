@echo off
setlocal
cd /d "%~dp0"

if /i "%~1"=="--background" goto background
if /i "%~1"=="--restart-background" goto restart_background
if /i "%~1"=="--console" goto console

start "" wscript.exe "%~dp0BayTools.vbs"
exit /b 0

:background
if not exist "Doc\logs" mkdir "Doc\logs" >nul 2>nul
call :launch >> "Doc\logs\baytools.log" 2>&1
exit /b %errorlevel%

:restart_background
if not exist "Doc\logs" mkdir "Doc\logs" >nul 2>nul
call :stop_stale >> "Doc\logs\baytools.log" 2>&1
call :launch >> "Doc\logs\baytools.log" 2>&1
exit /b %errorlevel%

:console
call :launch
if errorlevel 1 pause
exit /b %errorlevel%

:launch
where node >nul 2>nul || (
  echo [BayTools] Node.js is required.
  exit /b 1
)
where npm.cmd >nul 2>nul || (
  echo [BayTools] npm is required. Please reinstall Node.js with npm enabled.
  exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
  echo [BayTools] Installing dependencies for the first run...
  call npm.cmd install --no-package-lock
  if errorlevel 1 (
    echo [BayTools] Dependency installation failed.
    exit /b 1
  )
)
set "NODE_ENV=production"
call npm.cmd run start
exit /b %errorlevel%

:stop_stale
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:"127.0.0.1:4319" ^| findstr /C:"LISTENING"') do (
  echo [BayTools] Stopping outdated local service on PID %%P...
  taskkill /PID %%P /F >nul 2>nul
)
timeout /t 1 /nobreak >nul
exit /b 0
