# START HERE (Bootstrap)

If you want full Firebase setup + function deployment from a clean project, use **bootstrap**.

## Minimum files per OS folder

- executable (`setup-wizard-...`)
- `firebase-config.json` (copy from `firebase-config.template.json` and fill values)
- `service-account.json`
- bootstrap launcher (`start-bootstrap-installer`)

## How to get required files

`firebase-config.json`
- Firebase Console -> Project Settings -> Your apps -> Web app config

`service-account.json`
- Firebase Console -> Project Settings -> Service accounts
- Click `Generate new private key`

## Windows

Double click:
- `windows/start-bootstrap-installer.bat`

Or open guided HTML UI:
- `windows/installer-ui-win.exe`

## macOS

Double click:
- `macos/start-bootstrap-installer.command`

Or open guided HTML UI:
- `macos/installer-ui-macos-arm64`

## Notes

- `end-user-config.json` is only for validation mode (no deploy).
- Bootstrap mode does deploy Functions.
