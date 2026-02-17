# End-User Package (Bootstrap Only)

This package is focused on one flow:

- **Bootstrap (full setup + deploy Functions)**

## Prerequisites

- `end-user-config.json` must be in the same folder as the executable.
- Internet access to reach the configured `baseUrl`.
- Outbound HTTPS access to `https://*.cloudfunctions.net`.
- For Windows: run `start-end-user-installer.bat` (recommended).
- For macOS: allow execution if needed (`chmod +x setup-wizard-macos-arm64`).

## Bootstrap (recommended)

Use this when the user already has a Firebase project and wants the installer to deploy everything.

Required files in OS folder:

- executable (`setup-wizard-...`)
- `firebase-config.json` (create from `firebase-config.template.json`)
- `service-account.json`

How to get `firebase-config.json`:

- Firebase Console > Project Settings > Your apps > Web app config

How to get `service-account.json`:

- Firebase Console > Project Settings > Service accounts
- Click `Generate new private key`

### Windows

1. Open `windows/start-bootstrap-installer.bat`

### macOS (Apple Silicon)

1. Open `macos/start-bootstrap-installer.command`

## Expected result

- Installer enables required APIs
- Installer configures Firebase Functions runtime
- Installer deploys Functions
- Endpoints are printed at the end
