#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "SAP Content Server Bootstrap Installer"
echo ""
echo "Required files in this folder:"
echo "- setup-wizard-macos-arm64"
echo "- firebase-config.json"
echo "- service-account.json"
echo ""
echo "How to get firebase-config.json:"
echo "- Firebase Console > Project Settings > Your apps > Web app config"
echo "- You can start from firebase-config.template.json"
echo ""
echo "How to get service-account.json:"
echo "- Firebase Console > Project Settings > Service accounts"
echo "- Click \"Generate new private key\""
echo ""

if [ ! -f "firebase-config.json" ]; then
  echo "Missing firebase-config.json"
  echo "Tip: copy firebase-config.template.json to firebase-config.json and fill values."
  read -r -p "Press Enter to close..." _
  exit 20
fi

if [ ! -f "service-account.json" ]; then
  echo "Missing service-account.json"
  read -r -p "Press Enter to close..." _
  exit 20
fi

chmod +x ./setup-wizard-macos-arm64
./setup-wizard-macos-arm64 --non-interactive --mode bootstrap --firebase-config firebase-config.json --service-account service-account.json --deploy true

echo ""
read -r -p "Finished. Press Enter to close..." _
