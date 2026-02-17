@echo off
setlocal

for %%I in ("%~dp0..\..\..") do set "ROOT_DIR=%%~fI"
cd /d "%ROOT_DIR%"

rem Prefer native packaged installers when present (no Node.js required)
if exist "%ROOT_DIR%\installer\releases\windows\win-unpacked" (
  for %%F in ("%ROOT_DIR%\installer\releases\windows\win-unpacked\*.exe") do (
    if exist "%%~fF" (
      echo Starting packaged desktop app: %%~nxF
      start "" "%%~fF"
      exit /b 0
    )
  )
)

if exist "%ROOT_DIR%\installer\releases\windows" (
  for %%F in ("%ROOT_DIR%\installer\releases\windows\*.exe") do (
    if exist "%%~fF" (
      echo Starting Windows installer executable: %%~nxF
      start "" "%%~fF"
      exit /b 0
    )
  )
)

if exist "%ROOT_DIR%\installer\dist\setup-wizard-win-x64.exe" (
  echo Starting standalone installer executable...
  start "" "%ROOT_DIR%\installer\dist\setup-wizard-win-x64.exe"
  exit /b 0
)

if exist "%ROOT_DIR%\installer\desktop-dist" (
  for %%F in ("%ROOT_DIR%\installer\desktop-dist\*Setup*.exe") do (
    if exist "%%~fF" (
      echo Starting packaged desktop setup installer: %%~nxF
      echo If setup closes quickly, run start-here.bat again after installation.
      start "" "%%~fF"
      exit /b 0
    )
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found and no packaged installer executable was found.
  echo Build one of these first:
  echo   npm run installer:build
  echo   npm run installer:desktop:build:win
  pause
  exit /b 10
)

echo Starting SAP Content Server Installer...
node installer\start-here.js

exit /b %errorlevel%
