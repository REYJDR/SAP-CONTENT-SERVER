@echo off
setlocal

for %%I in ("%~dp0..\..\..") do set "ROOT_DIR=%%~fI"
set "TARGET=%ROOT_DIR%\installer\os\windows\start-installer-ui.bat"
set "SHORTCUT=%USERPROFILE%\Desktop\SAP Content Server Installer UI.lnk"

if not exist "%TARGET%" (
  echo [ERROR] Launcher not found: %TARGET%
  pause
  exit /b 20
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$WScriptShell = New-Object -ComObject WScript.Shell;" ^
  "$Shortcut = $WScriptShell.CreateShortcut('%SHORTCUT%');" ^
  "$Shortcut.TargetPath = '%TARGET%';" ^
  "$Shortcut.WorkingDirectory = '%ROOT_DIR%';" ^
  "$Shortcut.IconLocation = '%SystemRoot%\\System32\\SHELL32.dll,220';" ^
  "$Shortcut.Save();"

if errorlevel 1 (
  echo [ERROR] Failed to create desktop shortcut.
  pause
  exit /b 30
)

echo Desktop shortcut created:
echo %SHORTCUT%
exit /b 0
