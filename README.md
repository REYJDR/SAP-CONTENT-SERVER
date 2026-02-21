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

Security note: never commit `service-account.json` to Git.

### Build

```bash
npm run build
```

### Firebase deploy

```bash
npm run deploy:firebase
```

### Deploy validation

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
