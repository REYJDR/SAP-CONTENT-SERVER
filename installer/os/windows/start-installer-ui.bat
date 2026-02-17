@echo off
setlocal

for %%I in ("%~dp0..\..\..") do set "ROOT_DIR=%%~fI"
cd /d "%ROOT_DIR%"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js and npm.
  pause
  exit /b 10
)

echo Starting SAP Content Server Installer UI...
start "Installer UI Server" cmd /k "cd /d "%ROOT_DIR%" && npm run installer:ui"

timeout /t 2 >nul
start "" "http://127.0.0.1:5055"

echo Installer UI launched at http://127.0.0.1:5055
exit /b 0
