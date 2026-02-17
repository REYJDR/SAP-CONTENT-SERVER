# SAP Content Server – Release Notes

Date: 2026-02-16
Version: 1.0.0 (installer + metadata-driven replication update)

## Highlights

- Drive replication now happens only when required metadata exists.
- Metadata endpoint accepts and persists `originalFileName`.
- Drive folder hierarchy now follows:
  - `<GOOGLE_DRIVE_FOLDER_ID>/<businessObjectType>/<businessObjectId>/<originalFileName>`
- If file is uploaded first, later metadata submission triggers replication.
- Added cross-platform installer flow:
  - Interactive CLI installer
  - Native executables for Windows and macOS
  - Non-interactive CI mode
  - Dry-run mode
  - JSON machine-readable output
  - Phase-based exit codes

## API Behavior Changes

### Metadata endpoint

`POST /sap/metadata` now supports:

- `documentId` (or `docId`)
- `businessObjectType`
- `businessObjectId`
- `originalFileName` (or `fileName` alias)
- `sourceSystem`
- `attributes`

When replication is enabled, metadata must include:

- `businessObjectType`
- `businessObjectId`
- `originalFileName` (or `fileName`)

### Replication flow

- Upload without metadata -> `replicatedToDrive=false`
- Metadata after upload -> triggers replication of existing stored file
- Metadata first + upload after -> replication occurs on upload

## Installer Deliverables

Native binaries are generated in `installer/dist`:

- `setup-wizard-win-x64.exe`
- `setup-wizard-macos-x64`
- `setup-wizard-macos-arm64`

## Installer Modes

### Interactive

Run wizard:

- `npm run installer:run`

### Build executables

- `npm run installer:build`

### Non-interactive (CI)

Example:

- `installer/dist/setup-wizard-macos-arm64 --non-interactive --project <project-id> --region us-central1 --replicate-to-drive true --drive-folder-id <drive-folder-id> --deploy true --output-json installer-output.json`

### Dry-run

- `installer/dist/setup-wizard-win-x64.exe --non-interactive --dry-run --project <project-id> --output-json`

## Installer Exit Codes

- `10` prerequisites/auth/tools
- `20` configuration/runtime setup
- `30` deployment
- `99` unexpected errors

## Validation Summary

Completed checks:

- TypeScript build: pass
- Deployed endpoint smoke tests: pass
  - metadata-first path
  - upload-first then metadata path
- Installer dry-run: pass
- JSON output generation: pass

## Release Checklist (Publish)

1. `npm install`
2. `npm run build`
3. `npm run installer:build`
4. `npm run verify:deployed`
5. Verify installer dry-run with JSON output
6. Publish binaries from `installer/dist`
7. Share README + this release note with ops/support

## SAP Integration Reminder

Use SM59 destination to host:

- `us-central1-<firebase-project-id>.cloudfunctions.net`

Main endpoints:

- `/api/sap/metadata`
- `/api/sap/content/raw`

PPF adapter sequence:

1. Send metadata first
2. Upload binary with same `documentId`
