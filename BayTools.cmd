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
call :prepare >> "Doc\logs\baytools.log" 2>&1
if errorlevel 1 exit /b %errorlevel%
call :serve
exit /b %errorlevel%

:restart_background
if not exist "Doc\logs" mkdir "Doc\logs" >nul 2>nul
call :stop_stale
call :prepare >> "Doc\logs\baytools.log" 2>&1
if errorlevel 1 exit /b %errorlevel%
call :serve
exit /b %errorlevel%

:console
call :prepare
if errorlevel 1 (
  pause
  exit /b %errorlevel%
)
call :serve
if errorlevel 1 pause
exit /b %errorlevel%

:prepare
call :status checking
where node >nul 2>nul || (
  echo [BayTools] Node.js is required.
  call :status missing-node
  exit /b 1
)
where npm.cmd >nul 2>nul || (
  echo [BayTools] npm is required. Please reinstall Node.js with npm enabled.
  call :status missing-npm
  exit /b 1
)

set "package_hash="
for /f "usebackq delims=" %%H in (`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "BayTools.Launcher.ps1" -PackageHash`) do set "package_hash=%%H"
set "installed_hash="
if exist "node_modules\.baytools-package-hash" set /p "installed_hash="<"node_modules\.baytools-package-hash"
set "install_required="
if not exist "node_modules\.bin\vite.cmd" set "install_required=1"
if not defined package_hash set "install_required=1"
if /i not "%installed_hash%"=="%package_hash%" set "install_required=1"
if defined install_required (
  call :status installing
  echo [BayTools] Installing or updating dependencies...
  call npm.cmd install --no-package-lock
  if errorlevel 1 (
    echo [BayTools] Dependency installation failed.
    call :status install-failed
    exit /b 1
  )
  > "node_modules\.baytools-package-hash" echo %package_hash%
)

set "NODE_ENV=production"
call :status building
call npm.cmd run build
if errorlevel 1 (
  echo [BayTools] Build failed.
  call :status build-failed
    exit /b 1
)
exit /b 0

:serve
set "NODE_ENV=production"
call :status starting
node dist-server\server\index.js
set "launch_exit=%errorlevel%"
if not "%launch_exit%"=="0" call :status service-failed
if "%launch_exit%"=="0" call :status stopped
exit /b %launch_exit%

:stop_stale
call :status stopping
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:"127.0.0.1:4319" ^| findstr /C:"LISTENING"') do (
  echo [BayTools] Stopping outdated local service on PID %%P...
  taskkill /PID %%P /F >nul 2>nul
)
timeout /t 1 /nobreak >nul
exit /b 0

:status
if not exist "Doc\logs" mkdir "Doc\logs" >nul 2>nul
if defined BAYTOOLS_SOURCE_VERSION (
  > "Doc\logs\baytools-startup.status.tmp" echo %BAYTOOLS_SOURCE_VERSION%^|%~1
) else (
  > "Doc\logs\baytools-startup.status.tmp" echo manual^|%~1
)
move /y "Doc\logs\baytools-startup.status.tmp" "Doc\logs\baytools-startup.status" >nul 2>nul
exit /b 0
