@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0web-wizard.ps1"
if errorlevel 1 (
  echo.
  echo Web wizard stopped with errors.
  pause
  exit /b 1
)

echo.
echo Web wizard stopped.
pause
exit /b 0
