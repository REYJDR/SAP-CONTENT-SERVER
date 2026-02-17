# SAP Content Server (Firebase + Google Storage/Drive)

## Support / Donations

If this project helps your team and you want to support ongoing improvements, you can donate here:

- PayPal: [https://paypal.me/reinaldodaou?locale.x=es_XC&country.x=MX](https://paypal.me/reinaldodaou?locale.x=es_XC&country.x=MX)

MVP content service designed for SAP integrations.

It stores document metadata in Firestore and file binaries in one of these backends:
- Google Cloud Storage (`STORAGE_BACKEND=gcs`)
- Google Drive (`STORAGE_BACKEND=drive`)

Optional mode: keep `gcs` as primary and replicate each uploaded file to Google Drive.

For operations handoff and first-time rollout, see [QUICK_START_OPS.md](QUICK_START_OPS.md).

For non-technical users, distribute only these start files:

- Windows: `.exe` from `installer/releases/windows`
- macOS: `.dmg` from `installer/releases/macos`

All helper launchers/scripts are now organized by OS under:

- `installer/os/windows`
- `installer/os/macos`

## 1) Setup

1. Copy `.env.example` to `.env` and fill values.
2. Ensure your service account has:
   - Firestore access
   - Storage Object Admin (if GCS backend)
   - Drive file access (if Drive backend)
3. Install dependencies:

```bash
npm install
```

### Guided installer (Windows + macOS)

After creating your Firebase project, run the interactive bootstrap installer:

```bash
npm run bootstrap
```

### Recommended distribution model (admin + end-user)

Use these modes depending on who runs setup:

- `admin` mode: technical owner runs provisioning (gcloud/firebase), deploys, and exports a config file.
- `managed` mode: provide `firebaseConfig` + `service-account.json`; installer configures Firebase runtime and deploys functions (no `gcloud` required).
- `bootstrap` mode: like managed, plus enables required Google APIs automatically via Service Usage API before deploy.
- `end-user` mode: final user only validates connectivity using `baseUrl` or a provided config file (no `gcloud`/`firebase` required).

Prerequisites by mode:

- `admin`
  - `node`, `npm`, `firebase`, `gcloud` installed and authenticated
  - permissions to enable APIs and deploy Functions
- `managed`
  - `node` and `npm`
  - `firebase-tools` available via `firebase` or `npx`
  - `firebaseConfig` JSON (must include `projectId`)
  - `service-account.json` with permissions to configure and deploy Functions
- `end-user`
  - installer executable + `end-user-config.json` in same folder
  - internet access to `<project>.cloudfunctions.net`

Admin example (export config for users):

```bash
npm run installer:run -- --mode admin --project <project-id> --region us-central1 --export-config installer/end-user-config.json
```

Managed example (firebaseConfig + service account):

```bash
npm run installer:run -- \
  --mode managed \
  --firebase-config ./installer/firebase-config.json \
  --service-account ./installer/service-account.json \
  --drive-folder-id <drive-folder-id> \
  --replicate-to-drive true \
  --deploy true \
  --export-config installer/end-user-config.json
```

Bootstrap example (end-to-end from existing Firebase project):

```bash
npm run installer:run -- \
  --mode bootstrap \
  --firebase-config ./installer/firebase-config.json \
  --service-account ./installer/service-account.json \
  --drive-folder-id <drive-folder-id> \
  --replicate-to-drive true \
  --deploy true \
  --export-config installer/end-user-config.json
```

Security note: never commit `service-account.json` to Git.

End-user example (no cloud CLIs required):

```bash
npm run installer:run -- --mode end-user --config-file installer/end-user-config.json
```

Or with direct URL:

```bash
npm run installer:run -- --mode end-user --base-url https://us-central1-<project>.cloudfunctions.net/api
```

Ready-to-share package output (generated locally):

- `installer/releases/end-user/windows/setup-wizard-win-x64.exe`
- `installer/releases/end-user/windows/end-user-config.json`
- `installer/releases/end-user/macos/setup-wizard-macos-arm64`
- `installer/releases/end-user/macos/end-user-config.json`
- `installer/releases/end-user/README_END_USER.md`

### Native executable installer (Windows + macOS)

Build native installer binaries:

```bash
npm install
npm run installer:build
```

Generated files are placed in `installer/dist`:
- `setup-wizard-win-x64.exe` (Windows)
- `setup-wizard-macos-x64` (macOS Intel)
- `setup-wizard-macos-arm64` (macOS Apple Silicon)

Run the installer binary from the project root (or move it and run it in the repository folder). The wizard asks for:
- Firebase project id
- Functions region
- Drive replication settings
- Google Drive folder id
- optional OAuth Drive credentials

It then configures Firebase/GCP prerequisites and can deploy Functions.

For local dry-run without building binaries:

```bash
npm run installer:run
```

The installer now installs project dependencies automatically before configuration (`npm install`).
You can disable this with:

```bash
--install-deps false
```

### Local UI installer tool

You can run a local browser UI to manage installation and configuration:

```bash
npm run installer:ui
```

Then open:

```txt
http://127.0.0.1:5055
```

The UI runs the same installer with your selected options and shows stdout/stderr output, exit code, and completion status.

Program initiator wrappers (double-click):

- Windows: `installer/os/windows/start-installer-ui.bat`
- macOS: `installer/os/macos/start-installer-ui.command`

Both wrappers start the local UI server and open `http://127.0.0.1:5055` automatically.

Non-interactive mode (CI/automation):

```bash
installer/dist/setup-wizard-macos-arm64 \
  --non-interactive \
  --project sap-content-server-ad957 \
  --region us-central1 \
  --replicate-to-drive true \
  --drive-folder-id <drive-folder-id> \
  --replicate-strict false \
  --use-oauth false \
  --deploy true
```

Dry-run mode (prints commands only):

```bash
installer/dist/setup-wizard-win-x64.exe --non-interactive --dry-run --project <project-id>
```

Machine-readable output for CI:

```bash
installer/dist/setup-wizard-macos-arm64 --non-interactive --dry-run --project <project-id> --output-json
```

Write JSON summary to file:

```bash
installer/dist/setup-wizard-macos-arm64 --non-interactive --dry-run --project <project-id> --output-json installer-output.json
```

You can also use environment variables instead of flags:

```bash
INSTALLER_NON_INTERACTIVE=true
INSTALLER_PROJECT_ID=sap-content-server-ad957
INSTALLER_REGION=us-central1
INSTALLER_REPLICATE_TO_DRIVE=true
INSTALLER_DRIVE_FOLDER_ID=<drive-folder-id>
INSTALLER_REPLICATE_STRICT=false
INSTALLER_USE_OAUTH=false
INSTALLER_DEPLOY=true
INSTALLER_OUTPUT_JSON=installer-output.json
```

Installer exit codes:
- `10` prerequisites/auth/tools
- `20` configuration/runtime setup
- `30` deployment
- `99` unexpected failure

### Release checklist

Before sharing this solution with your team:
- run `npm run build`
- rebuild binaries with `npm run installer:build`
- run `npm run verify:deployed` against target project
- verify installer JSON output with `--non-interactive --dry-run --output-json`
- publish binaries from `installer/dist` and this README

What it automates:
- checks required CLIs (`node`, `npm`, `firebase`, `gcloud`)
- sets `.firebaserc` default project
- sets active `gcloud` project
- enables required Google APIs
- configures Firebase runtime config for Drive replication
- optionally deploys Functions

Then validate deployed behavior with smoke tests:

```bash
npm run verify:deployed
```

Optional overrides:

```bash
npm run verify:deployed -- --project <firebase-project-id> --region us-central1
# or
npm run verify:deployed -- --base-url https://us-central1-<project>.cloudfunctions.net/api
```

## 2) Run

```bash
npm run dev
```

Server starts at `http://localhost:8080` (or your `PORT`).

## 3) API

### Health

```bash
curl http://localhost:8080/health
```

### Storage health probe (GCS write/read/delete)

```bash
curl http://localhost:8080/health/storage
```

### Upload document

```bash
curl -X POST http://localhost:8080/sap/content \
  -F "file=@/path/to/file.pdf" \
  -F "documentId=DOC-1001" \
  -F "attachmentSource=/SCMTMS/TOR"
```

When `attachmentSource` (or `source`, `businessObjectType`, `objectType`, `className`) is provided, GCS files are stored under:

```txt
sap-content/<source-folder>/<documentId>
```

Example: Freight Order (`/SCMTMS/TOR`) is normalized to `sap-content/freight-order/<documentId>`.

### Enrich with business metadata (recommended)

When SAP Content Server calls do not include business context, push metadata explicitly:

```bash
curl -X POST http://localhost:8080/sap/metadata \
  -H "Content-Type: application/json" \
  -d '{
    "documents": [
      {
        "documentId": "DOC-1001",
        "businessObjectType": "FO-TYPE-A",
        "businessObjectId": "6100001234",
        "sourceLocation": "MIA",
        "destinationLocation": "BOG",
        "originalFileName": "freight-order-6100001234.pdf",
        "sourceSystem": "S4TM3"
      },
      {
        "documentId": "DOC-1002",
        "businessObjectType": "FO-TYPE-A",
        "businessObjectId": "6100001235",
        "sourceLocation": "MIA",
        "destinationLocation": "BOG",
        "originalFileName": "freight-order-6100001235.pdf",
        "sourceSystem": "S4TM3",
        "attributes": {
          "torUuid": "35C9D565D3D81FE182D123643F330016"
        }
      }
    ]
  }'
```

`POST /sap/metadata` now supports:
- one document object (backward compatible)
- `documents: []`
- direct array `[]`

For request tracing, send `x-request-id` from SAP. The API echoes it back in response header/body and writes it in `[SAP-METADATA]` logs.

ABAP HTTP client example:

```abap
DATA(lv_request_id) = |PPF-{ sy-datum }-{ sy-uzeit }-{ sy-uname }|.
lo_http->request->set_header_field( name = 'x-request-id' value = lv_request_id ).
```

Then upload binary as usual with the same `documentId`. The server will use metadata fallback to resolve folder source when upload request lacks source hints.

When Drive replication is enabled (`STORAGE_BACKEND=gcs` + `REPLICATE_TO_DRIVE=true`), replication runs only when metadata exists and includes:
- `businessObjectType`
- `businessObjectId`
- `originalFileName` (or `fileName` as alias)

In Share Drive hierarchy becomes:

```txt
<GOOGLE_DRIVE_FOLDER_ID>/<FO TYPE>/<FO ID (source - destination)>/Attachment/<originalFileName>
```

`sourceLocation` and `destinationLocation` can also be provided via metadata attributes (`sourceLoc`/`sour_loc` and `destinationLoc`/`dest_loc`).

If metadata arrives after upload, `POST /sap/metadata` triggers replication for the already stored binary (same `documentId`).

Firebase Storage structure remains unchanged.

### Upload document (raw body)

```bash
curl -X POST "http://localhost:8080/sap/content/raw?documentId=DOC-1002&fileName=file.pdf" \
  -H "Content-Type: application/pdf" \
  --data-binary @/path/to/file.pdf
```

### Download document

```bash
curl http://localhost:8080/sap/content/DOC-1001 --output downloaded.pdf
```

### Delete document

```bash
curl -X DELETE http://localhost:8080/sap/content/DOC-1001
```

## 4) SAP classic alias (ContentServer.dll style)

These aliases are provided for easier SAP-style integration patterns.

### Server info / ping

```bash
curl "http://localhost:8080/ContentServer/ContentServer.dll?cmd=PING"
```

### PUT (upload)

```bash
curl -X POST "http://localhost:8080/ContentServer/ContentServer.dll?cmd=PUT&docId=DOC-2001" \
  -F "file=@/path/to/file.pdf"
```

### GET (download)

```bash
curl "http://localhost:8080/ContentServer/ContentServer.dll?cmd=GET&docId=DOC-2001" --output downloaded.pdf
```

### DELETE

```bash
curl -X GET "http://localhost:8080/ContentServer/ContentServer.dll?cmd=DELETE&docId=DOC-2001"
```

## Notes

- This is an SAP-oriented MVP API, not a full SAP certified Content Server protocol implementation.
- Metadata collection: `sapDocuments` in Firestore.

## SAP request tracing

To capture every inbound SAP request URL/method in function logs:

```bash
SAP_TRACE_ALL_REQUESTS=true
SAP_TRACE_USER_AGENT="SAP NetWeaver Application Server"
```

- Logs are emitted as `[SAP-TRACE-ALL]`.
- Sensitive query params like `secKey` and `authId` are redacted.
- Keep this disabled in normal operation to reduce log volume.

## Drive replication (GCS primary)

To mirror every uploaded object from GCS into Drive:

```bash
STORAGE_BACKEND=gcs
GOOGLE_DRIVE_FOLDER_ID=<your-drive-folder-id>
REPLICATE_TO_DRIVE=true
REPLICATE_TO_DRIVE_STRICT=false
```

- `REPLICATE_TO_DRIVE=false`: replication disabled (default)
- `REPLICATE_TO_DRIVE=true`: upload/delete attempts also run on Drive
- `REPLICATE_TO_DRIVE_STRICT=false`: GCS success is kept even if Drive replication fails
- `REPLICATE_TO_DRIVE_STRICT=true`: API returns error when Drive replication fails

### Option C: OAuth2 user Drive access (no Shared Drive required)

If Shared Drives are not available in your Google account, use OAuth2 user credentials:

```bash
GOOGLE_DRIVE_CLIENT_ID=<oauth-client-id>
GOOGLE_DRIVE_CLIENT_SECRET=<oauth-client-secret>
GOOGLE_DRIVE_REFRESH_TOKEN=<oauth-refresh-token>
GOOGLE_DRIVE_FOLDER_ID=<folder-id-in-your-drive>
REPLICATE_TO_DRIVE=true
```

When these OAuth variables are present, the service uses them for Drive API calls instead of service-account auth.

Quick setup:

1. Export client credentials and generate refresh token:

```bash
export GOOGLE_DRIVE_CLIENT_ID=<oauth-client-id>
export GOOGLE_DRIVE_CLIENT_SECRET=<oauth-client-secret>
npm run drive:token
```

2. Set runtime config and deploy:

```bash
firebase functions:config:set \
  app.google_drive_folder_id="<drive-folder-id>" \
  app.replicate_to_drive="true" \
  app.replicate_to_drive_strict="false" \
  app.google_drive_client_id="<oauth-client-id>" \
  app.google_drive_client_secret="<oauth-client-secret>" \
  app.google_drive_refresh_token="<refresh-token>"

npm run deploy:firebase
```

## Deploy (Google Cloud Run)

1. Install Google Cloud CLI (`gcloud`).
2. Authenticate and select project:

```bash
gcloud auth login
gcloud config set project sap-content-server-ad957
```

3. Enable APIs (first time only):

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

4. Deploy:

```bash
npm run deploy:cloudrun
```

After deploy, set runtime env vars in Cloud Run service:
- `STORAGE_BACKEND=gcs`
- `FIREBASE_PROJECT_ID=sap-content-server-ad957`
- `FIREBASE_STORAGE_BUCKET=sap-content-server-ad957.firebasestorage.app`

For production, attach a service account with Firestore + Storage permissions.

## Contributing

Contributions, issues, and feedback are welcome.

If you want to support ongoing maintenance and improvements, you can donate via PayPal:

- [https://paypal.me/reinaldodaou?locale.x=es_XC&country.x=MX](https://paypal.me/reinaldodaou?locale.x=es_XC&country.x=MX)
