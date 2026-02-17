@echo off
setlocal
cd /d "%~dp0"

echo SAP Content Server Bootstrap Installer

echo Required files in this folder:
echo - setup-wizard-win-x64.exe
echo - firebase-config.json
echo - service-account.json
echo.
echo How to get firebase-config.json:
echo - Firebase Console ^> Project Settings ^> Your apps ^> Web app config
echo - You can start from firebase-config.template.json
echo.
echo How to get service-account.json:
echo - Firebase Console ^> Project Settings ^> Service accounts
echo - Click "Generate new private key"

if not exist "firebase-config.json" (
  echo Missing firebase-config.json
  echo Tip: copy firebase-config.template.json to firebase-config.json and fill values.
  pause
  exit /b 20
)
if not exist "service-account.json" (
  echo Missing service-account.json
  pause
  exit /b 20
)

setup-wizard-win-x64.exe --non-interactive --mode bootstrap --firebase-config firebase-config.json --service-account service-account.json --deploy true

echo.
echo Finished. Press any key to close.
pause >nul
