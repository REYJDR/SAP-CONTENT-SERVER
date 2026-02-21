# Windows Deploy Wizard (Isolated)

This folder contains a Windows-only deployment wizard that deploys Functions using **Firebase CLI** (`firebase deploy --only functions`).

## What is included

- `deploy-wizard.bat` - launcher
- `deploy-wizard.ps1` - API-based deploy logic
- `start-web-wizard.bat` - launcher for local web UI mode
- `web-wizard.ps1` - local HTTP server (UI + deploy API)
- `web/index.html` - frontend page
- `deploy-core.ps1` - shared deploy engine
- `deploy-worker.ps1` - background deployment worker for web mode
- `function-source/` - bundled deployable function source (`dist` + `package.json`)

## Requirements on target Windows machine

- Windows PowerShell 5.1+
- Firebase CLI (`firebase`) available in PATH, or `npx` available to run `firebase-tools`
- Internet access to Google APIs
- A Service Account JSON with permissions for:
  - Firebase Admin / Functions deploy permissions on target project

## How to run

1. Copy the full `windows-wizard` folder to the Windows machine.
2. Double-click `deploy-wizard.bat`.
3. Enter:
   - GCP/Firebase Project ID
   - Region (default `us-central1`)
   - Service account JSON path
   - Memory MB and timeout seconds
  - Required runtime `.env` values (backend, bucket, and Drive credentials when needed)

The wizard will run Firebase Tools deploy in a temporary project wrapper:

1. Prepare temporary Firebase project files (`firebase.json`, `.firebaserc`)
2. Install runtime dependencies in temporary `functions/` (`npm install --omit=dev`)
3. Generate temporary `functions/.env` from wizard inputs
4. Set `GOOGLE_APPLICATION_CREDENTIALS` from provided service-account path
5. Execute `firebase deploy --only functions --project <projectId> --non-interactive --force`
6. Stream logs live in UI

Validation rules in web mode:

- `STORAGE_BACKEND` must be `gcs` or `drive`
- For `gcs`, `FIREBASE_STORAGE_BUCKET` is required (auto-defaults to `<projectId>.firebasestorage.app` when empty)
- For `drive` or when `REPLICATE_TO_DRIVE=true`, these are required:
  - `GOOGLE_DRIVE_FOLDER_ID`
  - `GOOGLE_DRIVE_CLIENT_ID`
  - `GOOGLE_DRIVE_CLIENT_SECRET`
  - `GOOGLE_DRIVE_REFRESH_TOKEN`

## Local web page mode (UI frontend)

1. Double-click `start-web-wizard.bat`
2. Browser opens at `http://127.0.0.1:5065`
3. Fill deployment fields and click **Start Deploy**
4. Watch live logs and final URL in the page

Web mode endpoints:

- `GET /` UI page
- `GET /api/health` server health
- `POST /api/deploy` queue deployment job
- `GET /api/logs?runId=<id>` fetch job status + logs

## Notes

- This is fully isolated from repo root and does not require any dev tooling on runtime machine.
- If you update backend code, regenerate `function-source/dist` from the latest build before distributing this folder.
- Port `5065` must be available on the local machine.
