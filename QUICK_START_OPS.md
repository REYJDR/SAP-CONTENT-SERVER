# Quick Start for Ops (10 Commands)

This is the fastest path to bootstrap and verify SAP Content Server in a new Firebase project.

## Prerequisites

- Node.js + npm
- Firebase CLI
- Google Cloud CLI (`gcloud`)
- Access to target Firebase/GCP project

## 10-command rollout

1. Install dependencies

```bash
npm install
```

2. Build app

```bash
npm run build
```

3. Build native installers

```bash
npm run installer:build
```

4. Authenticate Firebase

```bash
firebase login
```

5. Authenticate GCP

```bash
gcloud auth login
```

6. Run installer (interactive)

```bash
npm run installer:run
```

Optional: run browser-based local UI installer

```bash
npm run installer:ui
```

7. Verify deployed API behavior

```bash
npm run verify:deployed
```

8. Optional CI-style dry-run check

```bash
node installer/setup-wizard.js --non-interactive --dry-run --project <project-id> --output-json
```

9. Generate release artifacts list

```bash
ls -la installer/dist
```

10. Capture deployment summary for handoff

```bash
cat RELEASE_NOTES.md
```

## If you prefer native executable installer

- Windows: `.exe` from `installer/releases/windows`
- macOS: `.dmg` from `installer/releases/macos`

OS helper launchers (internal/admin use):

- `installer/os/windows/*`
- `installer/os/macos/*`

Run from repository root so `.firebaserc` and npm scripts are available.

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
ZENH_FU_OUTPUT