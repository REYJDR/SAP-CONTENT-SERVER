@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-wizard.ps1"
if errorlevel 1 (
  echo.
  echo Deployment finished with errors.
  pause
  exit /b 1
)

echo.
echo Deployment finished successfully.
pause
exit /b 0
