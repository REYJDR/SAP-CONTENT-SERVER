# Quick Start for Ops (Core Backend)

This is the fastest path to build, deploy, and verify the SAP Content Server backend.

## Prerequisites

- Node.js + npm
- Firebase CLI
- Google Cloud CLI (`gcloud`)
- Access to target Firebase/GCP project

## 8-command rollout

1. Install dependencies

```bash
npm install
```

2. Build app

```bash
npm run build
```

3. Authenticate Firebase

```bash
firebase login
```

4. Authenticate GCP

```bash
gcloud auth login
```

5. Deploy Functions

```bash
npm run deploy:firebase
```

6. Verify deployed API behavior

```bash
npm run verify:deployed
```

7. Optional explicit project/region verify

```bash
npm run verify:deployed -- --project <project-id> --region us-central1
```

8. Capture deployment summary for handoff

```bash
cat RELEASE_NOTES.md
```

## Smoke test endpoints (post-deploy)

- `https://<region>-<project-id>.cloudfunctions.net/api/health`
- `https://<region>-<project-id>.cloudfunctions.net/api/sap/metadata`
- `https://<region>-<project-id>.cloudfunctions.net/api/sap/content/raw`

## SAP reminder

In SM59 set host to:

- `<region>-<project-id>.cloudfunctions.net`

And call paths:

- `/api/sap/metadata`
- `/api/sap/content/raw`
