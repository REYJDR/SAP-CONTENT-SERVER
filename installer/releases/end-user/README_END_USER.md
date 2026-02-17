# End-User Package (No gcloud/firebase required)

This package is for final users.
No cloud CLI setup is required.

## Windows

1. Open `windows/setup-wizard-win-x64.exe`
2. Run in end-user mode with config file:

```bash
setup-wizard-win-x64.exe --non-interactive --mode end-user --config-file end-user-config.json
```

## macOS (Apple Silicon)

1. Open `macos/setup-wizard-macos-arm64`
2. If needed, allow execution:

```bash
chmod +x setup-wizard-macos-arm64
```

3. Run in end-user mode with config file:

```bash
./setup-wizard-macos-arm64 --non-interactive --mode end-user --config-file end-user-config.json
```

## Expected result

- Installer validates `baseUrl` and `/api/health`
- Returns `ok: true`
- No `gcloud`/`firebase` prerequisites
