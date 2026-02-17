const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function getFallbackUiHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SAP Content Server Installer UI</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; background: #f7f9fc; color: #1f2937; }
      .card { background: white; border: 1px solid #dbe3ef; border-radius: 10px; padding: 16px; max-width: 900px; }
      label { display:block; margin: 10px 0 6px; font-size: 13px; }
      input, select, textarea { width:100%; box-sizing:border-box; padding:8px; border:1px solid #cdd6e4; border-radius: 6px; }
      textarea { min-height: 110px; }
      button { margin-top: 12px; padding: 10px 14px; border: 0; border-radius: 6px; background: #2563eb; color: white; }
      pre { margin-top:12px; background:#0f172a; color:#e2e8f0; padding:12px; border-radius:8px; white-space:pre-wrap; }
      .muted { font-size: 12px; color:#6b7280; margin-top: 8px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Installer UI (Fallback)</h2>
      <div class="muted">Primary HTML asset was not found; fallback UI is running.</div>
      <label>Mode</label>
      <select id="mode">
        <option value="bootstrap" selected>bootstrap</option>
        <option value="managed">managed</option>
        <option value="admin">admin</option>
        <option value="end-user">end-user</option>
      </select>
      <label>Firebase config JSON (bootstrap/managed)</label>
      <textarea id="firebaseConfig" placeholder='{"projectId":"..."}'></textarea>
      <label>Service account JSON path (bootstrap/managed)</label>
      <input id="serviceAccount" type="text" placeholder="/path/to/service-account.json" />
      <label>Base URL (end-user)</label>
      <input id="baseUrl" type="text" placeholder="https://us-central1-<project>.cloudfunctions.net/api" />
      <label>Region</label>
      <input id="region" type="text" value="us-central1" />
      <label>Drive folder ID (optional)</label>
      <input id="driveFolderId" type="text" placeholder="Drive folder id" />
      <label><input id="deploy" type="checkbox" checked /> Deploy</label>
      <label><input id="installDeps" type="checkbox" checked /> Install dependencies</label>
      <label><input id="dryRun" type="checkbox" /> Dry run</label>
      <button id="runBtn">Run installer</button>
      <pre id="output"></pre>
    </div>
    <script>
      const byId = (id) => document.getElementById(id);
      byId('runBtn').addEventListener('click', async () => {
        const payload = {
          mode: byId('mode').value,
          firebaseConfig: byId('firebaseConfig').value,
          serviceAccount: byId('serviceAccount').value,
          baseUrl: byId('baseUrl').value,
          region: byId('region').value,
          driveFolderId: byId('driveFolderId').value,
          deploy: byId('deploy').checked,
          installDeps: byId('installDeps').checked,
          dryRun: byId('dryRun').checked
        };
        const res = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        byId('output').textContent = [
          'ok: ' + data.ok,
          'exitCode: ' + data.exitCode,
          '',
          '--- STDOUT ---',
          data.stdout || '',
          '',
          '--- STDERR ---',
          data.stderr || ''
        ].join('\n');
      });
    </script>
  </body>
</html>`;
}

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates.find(Boolean) || "";
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function toBool(value, defaultValue) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return defaultValue;
    }
    return ["1", "true", "yes", "y", "on"].includes(normalized);
  }
  return defaultValue;
}

function buildInstallerArgs(input, options = {}) {
  const args = [];
  if (options.setupScript) {
    args.push(options.setupScript);
  }
  args.push("--non-interactive");

  const modeRaw = String(input.mode || "admin").trim().toLowerCase();
  const mode = ["admin", "managed", "bootstrap", "end-user"].includes(modeRaw) ? modeRaw : "admin";
  args.push("--mode", mode);

  const configFile = String(input.configFile || "").trim();
  if (configFile) {
    args.push("--config-file", configFile);
  }

  const baseUrl = String(input.baseUrl || "").trim();
  if (baseUrl) {
    args.push("--base-url", baseUrl);
  }

  if (mode === "end-user") {
    const dryRun = toBool(input.dryRun, false);
    if (dryRun) {
      args.push("--dry-run");
    }
    args.push("--output-json");
    return args;
  }

  if (mode === "managed" || mode === "bootstrap") {
    const firebaseConfig = String(input.firebaseConfig || "").trim();
    const serviceAccount = String(input.serviceAccount || "").trim();
    const region = String(input.region || "us-central1").trim() || "us-central1";
    const deploy = toBool(input.deploy, true);
    const installDeps = toBool(input.installDeps, true);
    const replicateToDrive = toBool(input.replicateToDrive, true);
    const replicateStrict = toBool(input.replicateStrict, false);
    const useOAuth = toBool(input.useOAuth, false);
    const dryRun = toBool(input.dryRun, false);
    const driveFolderId = String(input.driveFolderId || "").trim();

    if (!serviceAccount) {
      throw new Error("serviceAccount is required in managed mode");
    }

    args.push("--region", region);
    args.push("--deploy", String(deploy));
    args.push("--install-deps", String(installDeps));
    args.push("--replicate-to-drive", String(replicateToDrive));
    args.push("--replicate-strict", String(replicateStrict));
    args.push("--use-oauth", String(useOAuth));
    args.push("--service-account", serviceAccount);
    args.push("--output-json");

    if (firebaseConfig) {
      args.push("--firebase-config", firebaseConfig);
    }

    if (replicateToDrive) {
      if (!driveFolderId) {
        throw new Error("driveFolderId is required when replicateToDrive is true");
      }
      args.push("--drive-folder-id", driveFolderId);
    }

    if (useOAuth) {
      const clientId = String(input.driveClientId || "").trim();
      const clientSecret = String(input.driveClientSecret || "").trim();
      const refreshToken = String(input.driveRefreshToken || "").trim();

      if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("driveClientId, driveClientSecret and driveRefreshToken are required when useOAuth is true");
      }

      args.push("--drive-client-id", clientId);
      args.push("--drive-client-secret", clientSecret);
      args.push("--drive-refresh-token", refreshToken);
    }

    if (dryRun) {
      args.push("--dry-run");
    }

    return args;
  }

  const project = String(input.project || "").trim();
  const region = String(input.region || "us-central1").trim() || "us-central1";
  const driveFolderId = String(input.driveFolderId || "").trim();

  if (!project) {
    throw new Error("project is required");
  }

  const replicateToDrive = toBool(input.replicateToDrive, true);
  const replicateStrict = toBool(input.replicateStrict, false);
  const useOAuth = toBool(input.useOAuth, false);
  const deploy = toBool(input.deploy, true);
  const installDeps = toBool(input.installDeps, true);
  const dryRun = toBool(input.dryRun, false);

  args.push("--project", project);
  args.push("--region", region);
  args.push("--replicate-to-drive", String(replicateToDrive));
  args.push("--replicate-strict", String(replicateStrict));
  args.push("--use-oauth", String(useOAuth));
  args.push("--deploy", String(deploy));
  args.push("--install-deps", String(installDeps));
  args.push("--output-json");

  if (dryRun) {
    args.push("--dry-run");
  }

  if (replicateToDrive) {
    if (!driveFolderId) {
      throw new Error("driveFolderId is required when replicateToDrive is true");
    }
    args.push("--drive-folder-id", driveFolderId);
  }

  if (useOAuth) {
    const clientId = String(input.driveClientId || "").trim();
    const clientSecret = String(input.driveClientSecret || "").trim();
    const refreshToken = String(input.driveRefreshToken || "").trim();

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("driveClientId, driveClientSecret and driveRefreshToken are required when useOAuth is true");
    }

    args.push("--drive-client-id", clientId);
    args.push("--drive-client-secret", clientSecret);
    args.push("--drive-refresh-token", refreshToken);
  }

  return args;
}

function runInstaller(payload, options) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    let args;
    try {
      args = buildInstallerArgs(payload, { setupScript: options.setupScript });
    } catch (error) {
      resolve({
        ok: false,
        exitCode: 20,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    const childEnv = { ...process.env, ...(options.env || {}) };
    if (options.runAsNodeProcess) {
      childEnv.ELECTRON_RUN_AS_NODE = "1";
    }

    const command = options.runtimeExecutable || process.execPath;
    const child = spawn(command, args, {
      cwd: options.root,
      shell: false,
      env: childEnv
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        exitCode: 99,
        stdout,
        stderr: `${stderr}${error.message}`
      });
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exitCode: code ?? 99,
        stdout,
        stderr
      });
    });
  });
}

function startInstallerUiServer(config = {}) {
  const host = config.host || "127.0.0.1";
  const port = Number(config.port || 5055);
  const root = config.root || process.cwd();

  const rootCandidates = [
    root,
    process.cwd(),
    path.resolve(__dirname, "..")
  ];

  const uiFile = firstExistingPath([
    config.uiFile,
    ...rootCandidates.map((candidateRoot) => path.join(candidateRoot, "installer", "ui", "index.html")),
    path.join(__dirname, "ui", "index.html")
  ]);

  const setupScript = firstExistingPath([
    config.setupScript,
    ...rootCandidates.map((candidateRoot) => path.join(candidateRoot, "installer", "setup-wizard.js")),
    path.join(__dirname, "setup-wizard.js")
  ]);

  const setupExecutable = firstExistingPath([
    config.setupExecutable,
    ...rootCandidates.map((candidateRoot) => path.join(candidateRoot, "installer", "releases", "end-user", "windows", "setup-wizard-win-x64.exe")),
    ...rootCandidates.map((candidateRoot) => path.join(candidateRoot, "installer", "releases", "end-user", "macos", "setup-wizard-macos-arm64")),
    path.join(path.dirname(process.execPath), "setup-wizard-win-x64.exe"),
    path.join(path.dirname(process.execPath), "setup-wizard-macos-arm64")
  ]);

  const runtimeExecutable = config.runtimeExecutable || setupExecutable || process.execPath;
  const effectiveSetupScript = runtimeExecutable === process.execPath ? setupScript : "";
  const runAsNodeProcess = Boolean(config.runAsNodeProcess);
  const logger = typeof config.logger === "function" ? config.logger : console.log;

  const effectiveRoot = firstExistingPath(rootCandidates);

  const server = http.createServer(async (req, res) => {
    const currentPort = server.address() && typeof server.address() === "object" ? server.address().port : port;
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${currentPort}`}`);

    if (req.method === "GET" && url.pathname === "/") {
      try {
        const html = fs.readFileSync(uiFile, "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        const fallbackHtml = getFallbackUiHtml();
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "x-installer-ui-fallback": "true"
        });
        res.end(fallbackHtml);
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          sendJson(res, 400, { ok: false, error: "invalid JSON payload" });
          return;
        }

        const result = await runInstaller(payload, {
          root: effectiveRoot,
          setupScript: effectiveSetupScript,
          runtimeExecutable,
          runAsNodeProcess
        });
        sendJson(res, result.ok ? 200 : 400, result);
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, status: "up" });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const activePort = address && typeof address === "object" ? address.port : port;
      logger(`Installer UI is running at http://${host}:${activePort}`);
      resolve({ server, host, port: activePort });
    });
  });
}

module.exports = {
  startInstallerUiServer
};
