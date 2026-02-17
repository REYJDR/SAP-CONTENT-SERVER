const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

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

function buildInstallerArgs(input, setupScript) {
  const args = [setupScript, "--non-interactive"];

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
      args = buildInstallerArgs(payload, options.setupScript);
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

    const child = spawn(options.runtimeExecutable || process.execPath, args, {
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

  const runtimeExecutable = config.runtimeExecutable || process.execPath;
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
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("installer UI not found");
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
          setupScript,
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
