# SAP Content Server – Release Notes

Date: 2026-02-19
Version: 1.0.1 (core backend cleanup)

## Highlights

- Repository cleaned to main backend development structure only.
- Non-core packaging artifacts removed.
- Firebase deploy flow aligned to deploy directly from project root.
- Documentation simplified to backend-only setup/deploy workflow.

## API Behavior (Current)

### Metadata endpoint

`POST /sap/metadata` supports:

- single document object (`documentId` / `docId`)
- batch (`documents: []`) or direct array (`[]`)
- `businessObjectType`
- `businessObjectId`
- `sourceLocation`
- `destinationLocation`
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

## Validation Summary

Completed checks:

- TypeScript build: pass
- Deployed endpoint smoke tests: pass
  - metadata-first path
  - upload-first then metadata path

## Release Checklist (Publish)

1. `npm install`
2. `npm run build`
3. `npm run deploy:firebase`
4. `npm run verify:deployed`
5. Share README + this release note with ops/support

## SAP Integration Reminder

Use SM59 destination host:

- `us-central1-<firebase-project-id>.cloudfunctions.net`

Main endpoints:

- `/api/sap/metadata`
- `/api/sap/content/raw`

PPF adapter sequence:

1. Send metadata first
2. Upload binary with same `documentId`
