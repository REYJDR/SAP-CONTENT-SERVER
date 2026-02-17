#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { createInterface } = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");

const EXIT_CODES = {
  PREREQUISITES: 10,
  CONFIGURATION: 20,
  DEPLOYMENT: 30,
  UNEXPECTED: 99
};

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex > 0) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      args[key] = value;
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

function findAutoConfigFile(cwd) {
  const execDir = path.dirname(process.execPath || "");
  const candidates = [
    path.join(cwd, "installer", "end-user-config.json"),
    path.join(cwd, "end-user-config.json"),
    path.join(execDir, "end-user-config.json")
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function findAutoFirebaseConfigFile(cwd) {
  const execDir = path.dirname(process.execPath || "");
  const candidates = [
    path.join(cwd, "installer", "firebase-config.json"),
    path.join(cwd, "firebase-config.json"),
    path.join(execDir, "firebase-config.json")
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function findAutoServiceAccountFile(cwd) {
  const execDir = path.dirname(process.execPath || "");
  const candidates = [
    path.join(cwd, "installer", "service-account.json"),
    path.join(cwd, "service-account.json"),
    path.join(execDir, "service-account.json")
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function readFirebaserc(cwd) {
  const filePath = path.join(cwd, ".firebaserc");
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeFirebaserc(cwd, projectId) {
  const filePath = path.join(cwd, ".firebaserc");
  const current = readFirebaserc(cwd);

  const next = {
    ...current,
    projects: {
      ...(current.projects || {}),
      default: projectId
    }
  };

  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function runCommand(command, args, options = {}) {
  const captureOutput = options.captureOutput || false;
  const result = spawnSync(command, args, {
    shell: true,
    stdio: captureOutput ? "pipe" : "inherit",
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env || {})
    }
  });

  const success = result.status === 0;
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();

  if (!success && !options.allowFailure) {
    const exitCode = options.phaseExitCode || result.status || 1;
    console.error(`Command failed (${command} ${args.join(" ")})`);
    process.exit(exitCode);
  }

  return { success, stdout, stderr };
}

function hasBinary(command) {
  const result = runCommand(command, ["--version"], { allowFailure: true, captureOutput: true });
  return result.success;
}

function normalizeYesNo(value, defaultValue) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) {
    return defaultValue;
  }

  return ["y", "yes", "true", "1"].includes(trimmed);
}

function getStringSetting(args, key, envKey) {
  const argValue = args[key];
  if (typeof argValue === "string" && argValue.trim()) {
    return argValue.trim();
  }

  const envValue = process.env[envKey];
  if (typeof envValue === "string" && envValue.trim()) {
    return envValue.trim();
  }

  return "";
}

function getBooleanSetting(args, key, envKey, defaultValue) {
  if (Object.prototype.hasOwnProperty.call(args, key)) {
    return normalizeYesNo(args[key], defaultValue);
  }

  if (typeof process.env[envKey] === "string") {
    return normalizeYesNo(process.env[envKey], defaultValue);
  }

  return defaultValue;
}

function quoteConfigValue(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function resolvePathFromCwd(inputPath) {
  if (!inputPath) {
    return "";
  }

  return path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), inputPath);
}

function readJsonFile(inputPath, fallback = {}) {
  const resolvedPath = resolvePathFromCwd(inputPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch {
    return fallback;
  }
}

function parseJsonContent(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function readJsonInput(value, fallback = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  if (raw.startsWith("{") || raw.startsWith("[")) {
    return parseJsonContent(raw, fallback);
  }

  return readJsonFile(raw, fallback);
}

function writeJsonFile(outputPath, payload) {
  const resolvedPath = resolvePathFromCwd(outputPath);
  if (!resolvedPath) {
    return;
  }

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Config file written to: ${resolvedPath}`);
}

function parseBaseUrl(input) {
  const normalized = String(input || "").trim();
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function base64UrlEncode(value) {
  const asBuffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return asBuffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function readServiceAccount(serviceAccountPath) {
  const parsed = readJsonFile(serviceAccountPath, {});
  if (
    !parsed ||
    typeof parsed.client_email !== "string" ||
    typeof parsed.private_key !== "string" ||
    typeof parsed.token_uri !== "string"
  ) {
    return null;
  }

  return parsed;
}

function httpPostForm(urlValue, formBody, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = String(formBody || "");
    const req = https.request(
      {
        method: "POST",
        hostname: urlValue.hostname,
        path: `${urlValue.pathname}${urlValue.search}`,
        port: urlValue.port || 443,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          ...headers
        }
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk.toString();
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: responseBody
          });
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function googleApiRequest(method, urlValue, accessToken, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const req = https.request(
      {
        method,
        hostname: urlValue.hostname,
        path: `${urlValue.pathname}${urlValue.search}`,
        port: urlValue.port || 443,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
              }
            : {})
        }
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk.toString();
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: responseBody
          });
        });
      }
    );

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function getAccessTokenFromServiceAccount(serviceAccount, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: scopes.join(" "),
    aud: serviceAccount.token_uri,
    exp: now + 3600,
    iat: now
  };

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claimSet))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsignedToken).end().sign(serviceAccount.private_key);
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const tokenUrl = new URL(serviceAccount.token_uri);
  const tokenResponse = await httpPostForm(
    tokenUrl,
    `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(assertion)}`
  );

  if (tokenResponse.statusCode < 200 || tokenResponse.statusCode >= 300) {
    return null;
  }

  const parsed = parseJsonContent(tokenResponse.body, {});
  if (typeof parsed.access_token !== "string" || !parsed.access_token) {
    return null;
  }

  return parsed.access_token;
}

async function ensureRequiredApisEnabled(projectId, accessToken, dryRun) {
  const apis = [
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "firebase.googleapis.com",
    "storage.googleapis.com"
  ];

  for (const apiName of apis) {
    const endpoint = new URL(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${apiName}:enable`);
    if (dryRun) {
      console.log(`[dry-run] enable API ${apiName}`);
      continue;
    }

    const response = await googleApiRequest("POST", endpoint, accessToken, {});
    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log(`API enabled: ${apiName}`);
      continue;
    }

    if (response.statusCode === 409 || response.statusCode === 400) {
      console.log(`API already enabled or pending: ${apiName}`);
      continue;
    }

    console.error(`Failed enabling API ${apiName}: HTTP ${response.statusCode}`);
    if (response.body) {
      console.error(response.body);
    }
    process.exit(EXIT_CODES.CONFIGURATION);
  }
}

function buildEndpointUrl(baseUrl, suffix) {
  const normalizedSuffix = String(suffix || "").replace(/^\/+/, "");
  const normalizedBasePath = baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`;
  const endpointPath = `${normalizedBasePath}${normalizedSuffix}`;
  return new URL(endpointPath, `${baseUrl.protocol}//${baseUrl.host}`);
}

function httpGetJson(urlValue) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "GET",
        hostname: urlValue.hostname,
        path: `${urlValue.pathname}${urlValue.search}`,
        port: urlValue.port || 443,
        headers: {
          Accept: "application/json"
        }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            body
          });
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

function resolveFirebaseCommand() {
  if (hasBinary("firebase")) {
    return { command: "firebase", prefixArgs: [] };
  }

  if (hasBinary("npx")) {
    return { command: "npx", prefixArgs: ["--yes", "firebase-tools"] };
  }

  return null;
}

async function maybeWaitOnExit(waitOnExit) {
  if (!waitOnExit || !process.stdin || !process.stdout) {
    return;
  }

  process.stdout.write("\nPress Enter to close...\n");

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
    process.stdin.once("error", () => resolve());
    setTimeout(() => resolve(), 30000);
  });
}

function printUsage() {
  console.log(`
Usage:
  setup-wizard [--non-interactive] [options]

Options:
  --mode <admin|managed|bootstrap|end-user>  Installer mode (default: admin)
  --project <id>                    Firebase project id
  --region <region>                 Functions region (default: us-central1)
  --base-url <url>                  API base URL (end-user mode)
  --config-file <path>              Read prebuilt installer config JSON (end-user mode)
  --firebase-config <json-or-path>  Firebase web config JSON or file path (managed mode)
  --service-account <path>          Service account JSON path (managed mode)
  --export-config [path]            Write end-user config JSON after admin run
  --replicate-to-drive <true|false> Enable Drive replication
  --drive-folder-id <id>            Drive root folder id (required if replication=true)
  --replicate-strict <true|false>   Strict replication mode
  --use-oauth <true|false>          Configure OAuth Drive credentials
  --drive-client-id <id>            OAuth client id
  --drive-client-secret <secret>    OAuth client secret
  --drive-refresh-token <token>     OAuth refresh token
  --deploy <true|false>             Deploy functions at end
  --install-deps <true|false>       Run npm install before configuration (default: true)
  --output-json [path]              Print JSON summary to stdout or write to file path
  --dry-run                         Print commands without executing
  --help                            Show this help

Environment fallbacks:
  INSTALLER_PROJECT_ID
  INSTALLER_REGION
  INSTALLER_MODE
  INSTALLER_BASE_URL
  INSTALLER_CONFIG_FILE
  INSTALLER_FIREBASE_CONFIG
  INSTALLER_SERVICE_ACCOUNT
  INSTALLER_BOOTSTRAP
  INSTALLER_EXPORT_CONFIG
  INSTALLER_REPLICATE_TO_DRIVE
  INSTALLER_DRIVE_FOLDER_ID
  INSTALLER_REPLICATE_STRICT
  INSTALLER_USE_OAUTH
  INSTALLER_DRIVE_CLIENT_ID
  INSTALLER_DRIVE_CLIENT_SECRET
  INSTALLER_DRIVE_REFRESH_TOKEN
  INSTALLER_DEPLOY
  INSTALLER_INSTALL_DEPS
  INSTALLER_OUTPUT_JSON
  INSTALLER_DRY_RUN

Exit codes:
  10 prerequisites/auth/tools
  20 configuration/runtime setup
  30 deployment
  99 unexpected errors
`);
}

function writeJsonSummary(outputJsonValue, summary) {
  const json = `${JSON.stringify(summary, null, 2)}\n`;
  if (!outputJsonValue || outputJsonValue === "true") {
    console.log(json);
    return;
  }

  const targetPath = path.isAbsolute(outputJsonValue)
    ? outputJsonValue
    : path.join(process.cwd(), outputJsonValue);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, json, "utf8");
  console.log(`JSON summary written to: ${targetPath}`);
}

function printBootstrapInputGuide() {
  console.log("\nBootstrap required files:");
  console.log("- firebase-config.json (Firebase Console > Project settings > Your apps > Web app config)");
  console.log("- service-account.json (Firebase Console > Project settings > Service accounts > Generate new private key)");
  console.log("Place both files in the same folder as the installer executable, or pass --firebase-config and --service-account.");
}

async function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));

  if (args.help === "true") {
    printUsage();
    return;
  }

  const nonInteractive = getBooleanSetting(args, "non-interactive", "INSTALLER_NON_INTERACTIVE", false);
  const dryRun = getBooleanSetting(args, "dry-run", "INSTALLER_DRY_RUN", false);
  const installDeps = getBooleanSetting(args, "install-deps", "INSTALLER_INSTALL_DEPS", true);
  const hasExplicitMode =
    Object.prototype.hasOwnProperty.call(args, "mode") || typeof process.env.INSTALLER_MODE === "string";
  const hasProjectInput =
    Object.prototype.hasOwnProperty.call(args, "project") || typeof process.env.INSTALLER_PROJECT_ID === "string";
  const hasBaseUrlInput =
    Object.prototype.hasOwnProperty.call(args, "base-url") || typeof process.env.INSTALLER_BASE_URL === "string";
  const hasFirebaseConfigInput =
    Object.prototype.hasOwnProperty.call(args, "firebase-config") ||
    typeof process.env.INSTALLER_FIREBASE_CONFIG === "string";
  const hasServiceAccountInput =
    Object.prototype.hasOwnProperty.call(args, "service-account") ||
    typeof process.env.INSTALLER_SERVICE_ACCOUNT === "string";

  const autoConfigPath = findAutoConfigFile(cwd);
  const autoFirebaseConfigPath = findAutoFirebaseConfigFile(cwd);
  const autoServiceAccountPath = findAutoServiceAccountFile(cwd);
  const configFilePath =
    getStringSetting(args, "config-file", "INSTALLER_CONFIG_FILE") ||
    (!hasExplicitMode && autoConfigPath ? autoConfigPath : "");

  const firebaseConfigPath =
    getStringSetting(args, "firebase-config", "INSTALLER_FIREBASE_CONFIG") ||
    (!hasExplicitMode && autoFirebaseConfigPath ? autoFirebaseConfigPath : "");
  const serviceAccountPathFromInput =
    getStringSetting(args, "service-account", "INSTALLER_SERVICE_ACCOUNT") ||
    (!hasExplicitMode && autoServiceAccountPath ? autoServiceAccountPath : "");

  const shouldAutoBootstrap =
    !hasExplicitMode &&
    !hasProjectInput &&
    !hasBaseUrlInput &&
    (hasFirebaseConfigInput || autoFirebaseConfigPath) &&
    (hasServiceAccountInput || autoServiceAccountPath);

  const installerModeRaw =
    getStringSetting(args, "mode", "INSTALLER_MODE") ||
    (shouldAutoBootstrap
      ? "bootstrap"
      : !hasExplicitMode && !hasProjectInput && (hasBaseUrlInput || configFilePath)
        ? "end-user"
        : "admin");
  const installerMode =
    installerModeRaw.toLowerCase() === "end-user"
      ? "end-user"
      : installerModeRaw.toLowerCase() === "bootstrap"
        ? "bootstrap"
      : installerModeRaw.toLowerCase() === "managed"
        ? "managed"
        : "admin";
  const shouldAutoWaitOnExit =
    process.platform === "win32" &&
    Boolean(process.pkg) &&
    !hasExplicitMode &&
    !hasProjectInput &&
    (hasBaseUrlInput || Boolean(configFilePath));
  const waitOnExit = getBooleanSetting(args, "wait-on-exit", "INSTALLER_WAIT_ON_EXIT", shouldAutoWaitOnExit);
  const exportConfigValue =
    Object.prototype.hasOwnProperty.call(args, "export-config")
      ? args["export-config"]
      : process.env.INSTALLER_EXPORT_CONFIG;
  const outputJsonValue = Object.prototype.hasOwnProperty.call(args, "output-json")
    ? args["output-json"]
    : process.env.INSTALLER_OUTPUT_JSON;
  const rl = createInterface({ input, output });

  const run = (command, commandArgs, phaseExitCode, options = {}) => {
    if (dryRun) {
      console.log(`[dry-run] ${command} ${commandArgs.join(" ")}`);
      return { success: true, stdout: "", stderr: "" };
    }

    return runCommand(command, commandArgs, {
      ...options,
      phaseExitCode
    });
  };

  const runFirebase = (firebaseInfo, commandArgs, phaseExitCode, options = {}) => {
    const mergedArgs = [...firebaseInfo.prefixArgs, ...commandArgs];
    return run(firebaseInfo.command, mergedArgs, phaseExitCode, options);
  };

  try {
    console.log("\nSAP Content Server native installer\n");
    console.log("This wizard configures Firebase + GCP prerequisites and can deploy Functions.\n");

    const configFile = readJsonFile(configFilePath, {});

    if (installerMode === "end-user") {
      const baseUrlFromArgs = getStringSetting(args, "base-url", "INSTALLER_BASE_URL");
      const baseUrl =
        baseUrlFromArgs ||
        (typeof configFile.baseUrl === "string" ? configFile.baseUrl : "") ||
        (typeof configFile?.endUser?.baseUrl === "string" ? configFile.endUser.baseUrl : "");

      const parsedBaseUrl = parseBaseUrl(baseUrl);
      if (!parsedBaseUrl) {
        console.error("End-user mode requires --base-url or --config-file with baseUrl.");
        console.error("Tip: place end-user-config.json next to the installer executable.");
        process.exit(EXIT_CODES.CONFIGURATION);
      }

      const healthUrl = buildEndpointUrl(parsedBaseUrl, "health");
      console.log(`Validating connectivity to: ${healthUrl.toString()}`);

      if (!dryRun) {
        const probe = await httpGetJson(healthUrl);
        if (probe.statusCode < 200 || probe.statusCode >= 300) {
          console.error(`Health probe failed with HTTP ${probe.statusCode}`);
          console.error(probe.body || "No response body");
          process.exit(EXIT_CODES.CONFIGURATION);
        }
      }

      console.log("\nEnd-user setup completed successfully.");
      console.log(`Base URL: ${parsedBaseUrl.toString().replace(/\/$/, "")}`);
      console.log(`Health: ${healthUrl.toString()}`);
      console.log(`Metadata endpoint: ${buildEndpointUrl(parsedBaseUrl, "sap/metadata").toString()}`);
      console.log(`Raw upload endpoint: ${buildEndpointUrl(parsedBaseUrl, "sap/content/raw").toString()}`);
      console.log("No gcloud/firebase tooling was required in end-user mode.");

      if (outputJsonValue) {
        writeJsonSummary(outputJsonValue, {
          ok: true,
          mode: installerMode,
          baseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
          endpoints: {
            health: healthUrl.toString(),
            metadata: buildEndpointUrl(parsedBaseUrl, "sap/metadata").toString(),
            uploadRaw: buildEndpointUrl(parsedBaseUrl, "sap/content/raw").toString()
          },
          settings: {
            nonInteractive,
            dryRun,
            configFilePath: configFilePath || undefined
          },
          generatedAt: new Date().toISOString()
        });
      }

      await maybeWaitOnExit(waitOnExit);

      return;
    }

    if (installerMode === "managed" || installerMode === "bootstrap") {
      const firebaseConfigInput =
        firebaseConfigPath ||
        (typeof configFile.firebaseConfig === "object" ? JSON.stringify(configFile.firebaseConfig) : "");
      const firebaseConfig = readJsonInput(firebaseConfigInput, {});

      const serviceAccountPathInput =
        serviceAccountPathFromInput ||
        (typeof configFile.serviceAccountPath === "string" ? configFile.serviceAccountPath : "");
      const serviceAccountPath = resolvePathFromCwd(serviceAccountPathInput);

      if (!serviceAccountPath || !fs.existsSync(serviceAccountPath)) {
        console.error("Managed/bootstrap mode requires --service-account with a valid JSON file path.");
        printBootstrapInputGuide();
        process.exit(EXIT_CODES.CONFIGURATION);
      }

      const serviceAccount = readServiceAccount(serviceAccountPath);
      if (!serviceAccount) {
        console.error("Invalid service-account.json. Expected client_email, private_key and token_uri.");
        printBootstrapInputGuide();
        process.exit(EXIT_CODES.CONFIGURATION);
      }

      const projectFromConfig = typeof firebaseConfig.projectId === "string" ? firebaseConfig.projectId : "";
      const projectFromArgs = getStringSetting(args, "project", "INSTALLER_PROJECT_ID");
      const projectId = projectFromArgs || projectFromConfig || readFirebaserc(cwd)?.projects?.default || "";
      if (!projectId) {
        console.error("Managed mode requires projectId in firebaseConfig or --project.");
        console.error("Tip: verify firebase-config.json includes projectId.");
        printBootstrapInputGuide();
        process.exit(EXIT_CODES.CONFIGURATION);
      }

      const region =
        getStringSetting(args, "region", "INSTALLER_REGION") ||
        (typeof configFile.region === "string" ? configFile.region : "") ||
        "us-central1";

      const firebaseInfo = dryRun ? { command: "firebase", prefixArgs: [] } : resolveFirebaseCommand();
      if (!firebaseInfo) {
        console.error("Managed mode requires firebase CLI or npx to run firebase-tools.");
        process.exit(EXIT_CODES.PREREQUISITES);
      }

      const authEnv = {
        GOOGLE_APPLICATION_CREDENTIALS: serviceAccountPath,
        FIREBASE_CLI_EXPERIMENTS: "webframeworks"
      };

      if (installerMode === "bootstrap") {
        console.log("Enabling required Google APIs (bootstrap mode)...");
        const accessToken = dryRun
          ? "dry-run-token"
          : await getAccessTokenFromServiceAccount(serviceAccount, [
              "https://www.googleapis.com/auth/cloud-platform",
              "https://www.googleapis.com/auth/firebase"
            ]);

        if (!accessToken && !dryRun) {
          console.error("Failed to obtain access token from service-account.json");
          process.exit(EXIT_CODES.CONFIGURATION);
        }

        await ensureRequiredApisEnabled(projectId, accessToken || "", dryRun);
      }

      if (installDeps) {
        console.log("Installing project dependencies...");
        run("npm", ["install"], EXIT_CODES.PREREQUISITES);
      }

      console.log("Writing .firebaserc default project...");
      writeFirebaserc(cwd, projectId);

      const replicateToDrive = getBooleanSetting(args, "replicate-to-drive", "INSTALLER_REPLICATE_TO_DRIVE", false);
      const replicateStrict = getBooleanSetting(args, "replicate-strict", "INSTALLER_REPLICATE_STRICT", false);
      const useOAuth = getBooleanSetting(args, "use-oauth", "INSTALLER_USE_OAUTH", false);
      const shouldDeploy = getBooleanSetting(args, "deploy", "INSTALLER_DEPLOY", true);
      const driveFolderId =
        getStringSetting(args, "drive-folder-id", "INSTALLER_DRIVE_FOLDER_ID") ||
        (typeof configFile.driveFolderId === "string" ? configFile.driveFolderId : "");
      const driveClientId = getStringSetting(args, "drive-client-id", "INSTALLER_DRIVE_CLIENT_ID");
      const driveClientSecret = getStringSetting(args, "drive-client-secret", "INSTALLER_DRIVE_CLIENT_SECRET");
      const driveRefreshToken = getStringSetting(args, "drive-refresh-token", "INSTALLER_DRIVE_REFRESH_TOKEN");

      const configArgs = [];
      if (replicateToDrive) {
        if (!driveFolderId) {
          console.error("Managed mode requires drive folder id when replicate-to-drive is enabled.");
          process.exit(EXIT_CODES.CONFIGURATION);
        }

        configArgs.push(`app.google_drive_folder_id=${quoteConfigValue(driveFolderId)}`);
        configArgs.push("app.replicate_to_drive=true");
        configArgs.push(`app.replicate_to_drive_strict=${replicateStrict ? "true" : "false"}`);

        if (useOAuth) {
          if (!driveClientId || !driveClientSecret || !driveRefreshToken) {
            console.error("Managed mode with OAuth requires drive client id/secret/refresh token.");
            process.exit(EXIT_CODES.CONFIGURATION);
          }

          configArgs.push(`app.google_drive_client_id=${quoteConfigValue(driveClientId)}`);
          configArgs.push(`app.google_drive_client_secret=${quoteConfigValue(driveClientSecret)}`);
          configArgs.push(`app.google_drive_refresh_token=${quoteConfigValue(driveRefreshToken)}`);
        }
      } else {
        configArgs.push("app.replicate_to_drive=false");
        configArgs.push("app.replicate_to_drive_strict=false");
      }

      console.log("Applying Firebase Functions runtime config...");
      runFirebase(firebaseInfo, ["functions:config:set", ...configArgs, "--project", projectId], EXIT_CODES.CONFIGURATION, {
        env: authEnv
      });

      if (shouldDeploy) {
        console.log("Deploying functions...");
        runFirebase(firebaseInfo, ["deploy", "--only", "functions", "--project", projectId], EXIT_CODES.DEPLOYMENT, {
          env: authEnv
        });
      }

      const baseUrl = `https://${region}-${projectId}.cloudfunctions.net/api`;
      console.log(`\n${installerMode === "bootstrap" ? "Bootstrap" : "Managed"} setup completed successfully.`);
      console.log(`Base URL: ${baseUrl}`);
      console.log(`Health: ${baseUrl}/health`);
      console.log(`Metadata endpoint: ${baseUrl}/sap/metadata`);
      console.log(`Raw upload endpoint: ${baseUrl}/sap/content/raw`);

      const endUserConfigPath =
        exportConfigValue && exportConfigValue !== "true"
          ? exportConfigValue
          : exportConfigValue
            ? "installer/end-user-config.json"
            : "";

      if (endUserConfigPath) {
        writeJsonFile(endUserConfigPath, {
          mode: "end-user",
          projectId,
          region,
          baseUrl,
          endpoints: {
            health: `${baseUrl}/health`,
            metadata: `${baseUrl}/sap/metadata`,
            uploadRaw: `${baseUrl}/sap/content/raw`
          },
          generatedAt: new Date().toISOString()
        });
      }

      if (outputJsonValue) {
        writeJsonSummary(outputJsonValue, {
          ok: true,
          mode: installerMode,
          projectId,
          region,
          baseUrl,
          firebaseConfig,
          endpoints: {
            health: `${baseUrl}/health`,
            metadata: `${baseUrl}/sap/metadata`,
            uploadRaw: `${baseUrl}/sap/content/raw`
          },
          settings: {
            replicateToDrive,
            replicateStrict,
            useOAuth,
            deploy: shouldDeploy,
            installDeps,
            nonInteractive,
            dryRun
          },
          generatedAt: new Date().toISOString()
        });
      }

      await maybeWaitOnExit(waitOnExit);
      return;
    }

    const requiredBinaries = ["node", "npm", "firebase", "gcloud"];
    if (!dryRun) {
      const missing = requiredBinaries.filter((binary) => !hasBinary(binary));
      if (missing.length > 0) {
        console.error(`Missing required tools: ${missing.join(", ")}`);
        console.error("Install missing tools, then run the installer again.");
        process.exit(EXIT_CODES.PREREQUISITES);
      }
    }

    if (installDeps) {
      console.log("Installing project dependencies...");
      run("npm", ["install"], EXIT_CODES.PREREQUISITES);
    }

    const currentProject = readFirebaserc(cwd)?.projects?.default || "";
    const projectFromArgs =
      getStringSetting(args, "project", "INSTALLER_PROJECT_ID") ||
      (typeof configFile.projectId === "string" ? configFile.projectId : "");
    const projectInput = nonInteractive
      ? ""
      : await rl.question(`Firebase project id${currentProject ? ` [${currentProject}]` : ""}: `);
    const projectId = projectFromArgs || (projectInput || "").trim() || currentProject;
    if (!projectId) {
      console.error("Project id is required.");
      process.exit(EXIT_CODES.CONFIGURATION);
    }

    const regionFromArgs =
      getStringSetting(args, "region", "INSTALLER_REGION") ||
      (typeof configFile.region === "string" ? configFile.region : "");
    const regionInput = nonInteractive ? "" : await rl.question("Functions region [us-central1]: ");
    const region = regionFromArgs || (regionInput || "").trim() || "us-central1";

    const replicateFromArgs = Object.prototype.hasOwnProperty.call(args, "replicate-to-drive")
      ? normalizeYesNo(args["replicate-to-drive"], true)
      : getBooleanSetting(args, "replicate-to-drive", "INSTALLER_REPLICATE_TO_DRIVE", true);
    const replicateInput = nonInteractive ? "" : await rl.question("Enable Drive replication [Y/n]: ");
    const replicateToDrive = nonInteractive ? replicateFromArgs : normalizeYesNo(replicateInput, replicateFromArgs);

    let driveFolderId = "";
    let replicateStrict = false;
    let useOAuth = false;
    let driveClientId = "";
    let driveClientSecret = "";
    let driveRefreshToken = "";

    if (replicateToDrive) {
      const driveFolderArg =
        getStringSetting(args, "drive-folder-id", "INSTALLER_DRIVE_FOLDER_ID") ||
        (typeof configFile.driveFolderId === "string" ? configFile.driveFolderId : "");
      driveFolderId = nonInteractive
        ? driveFolderArg
        : driveFolderArg || (await rl.question("Google Drive root folder ID: ")).trim();
      if (!driveFolderId) {
        console.error("Google Drive root folder ID is required when replication is enabled.");
        process.exit(EXIT_CODES.CONFIGURATION);
      }

      const strictDefault = getBooleanSetting(args, "replicate-strict", "INSTALLER_REPLICATE_STRICT", false);
      const strictInput = nonInteractive
        ? ""
        : await rl.question("Strict replication mode (fail API if Drive fails) [y/N]: ");
      replicateStrict = nonInteractive ? strictDefault : normalizeYesNo(strictInput, strictDefault);

      const oauthDefault = getBooleanSetting(args, "use-oauth", "INSTALLER_USE_OAUTH", false);
      const oauthInput = nonInteractive ? "" : await rl.question("Configure OAuth user Drive credentials now [y/N]: ");
      useOAuth = nonInteractive ? oauthDefault : normalizeYesNo(oauthInput, oauthDefault);

      if (useOAuth) {
        driveClientId = getStringSetting(args, "drive-client-id", "INSTALLER_DRIVE_CLIENT_ID");
        driveClientSecret = getStringSetting(args, "drive-client-secret", "INSTALLER_DRIVE_CLIENT_SECRET");
        driveRefreshToken = getStringSetting(args, "drive-refresh-token", "INSTALLER_DRIVE_REFRESH_TOKEN");

        if (!nonInteractive) {
          driveClientId = driveClientId || (await rl.question("GOOGLE_DRIVE_CLIENT_ID: ")).trim();
          driveClientSecret = driveClientSecret || (await rl.question("GOOGLE_DRIVE_CLIENT_SECRET: ")).trim();
          driveRefreshToken = driveRefreshToken || (await rl.question("GOOGLE_DRIVE_REFRESH_TOKEN: ")).trim();
        }

        if (!driveClientId || !driveClientSecret || !driveRefreshToken) {
          console.error("OAuth values are required when OAuth setup is selected.");
          process.exit(EXIT_CODES.CONFIGURATION);
        }
      }
    }

    const deployDefault = getBooleanSetting(args, "deploy", "INSTALLER_DEPLOY", true);
    const deployInput = nonInteractive ? "" : await rl.question("Deploy functions at the end [Y/n]: ");
    const shouldDeploy = nonInteractive ? deployDefault : normalizeYesNo(deployInput, deployDefault);

    console.log("\nWriting .firebaserc default project...");
    writeFirebaserc(cwd, projectId);

    console.log("Setting active gcloud project...");
    run("gcloud", ["config", "set", "project", projectId], EXIT_CODES.CONFIGURATION);

    console.log("Enabling required Google APIs...");
    run("gcloud", [
      "services",
      "enable",
      "cloudfunctions.googleapis.com",
      "cloudbuild.googleapis.com",
      "artifactregistry.googleapis.com",
      "firestore.googleapis.com",
      "firebase.googleapis.com",
      "storage.googleapis.com"
    ], EXIT_CODES.CONFIGURATION);

    const configArgs = [];
    if (replicateToDrive) {
      configArgs.push(`app.google_drive_folder_id=${quoteConfigValue(driveFolderId)}`);
      configArgs.push("app.replicate_to_drive=true");
      configArgs.push(`app.replicate_to_drive_strict=${replicateStrict ? "true" : "false"}`);

      if (useOAuth) {
        configArgs.push(`app.google_drive_client_id=${quoteConfigValue(driveClientId)}`);
        configArgs.push(`app.google_drive_client_secret=${quoteConfigValue(driveClientSecret)}`);
        configArgs.push(`app.google_drive_refresh_token=${quoteConfigValue(driveRefreshToken)}`);
      }
    } else {
      configArgs.push("app.replicate_to_drive=false");
      configArgs.push("app.replicate_to_drive_strict=false");
    }

    console.log("Applying Firebase Functions runtime config...");
    run("firebase", ["functions:config:set", ...configArgs], EXIT_CODES.CONFIGURATION);

    if (shouldDeploy) {
      console.log("Deploying functions...");
      run("npm", ["run", "deploy:firebase"], EXIT_CODES.DEPLOYMENT);
    }

    const baseUrl = `https://${region}-${projectId}.cloudfunctions.net/api`;
    console.log("\nInstaller completed successfully.");
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Health: ${baseUrl}/health`);
    console.log(`Metadata endpoint: ${baseUrl}/sap/metadata`);
    console.log(`Raw upload endpoint: ${baseUrl}/sap/content/raw`);
    console.log("Run verification: npm run verify:deployed");

    const endUserConfigPath =
      exportConfigValue && exportConfigValue !== "true"
        ? exportConfigValue
        : exportConfigValue
          ? "installer/end-user-config.json"
          : "";

    if (endUserConfigPath) {
      writeJsonFile(endUserConfigPath, {
        mode: "end-user",
        projectId,
        region,
        baseUrl,
        endpoints: {
          health: `${baseUrl}/health`,
          metadata: `${baseUrl}/sap/metadata`,
          uploadRaw: `${baseUrl}/sap/content/raw`
        },
        generatedAt: new Date().toISOString()
      });
    }

    if (nonInteractive) {
      console.log("Mode: non-interactive");
    }
    if (dryRun) {
      console.log("Mode: dry-run (no commands executed)");
    }

    if (outputJsonValue) {
      writeJsonSummary(outputJsonValue, {
        ok: true,
        mode: installerMode,
        projectId,
        region,
        baseUrl,
        endpoints: {
          health: `${baseUrl}/health`,
          metadata: `${baseUrl}/sap/metadata`,
          uploadRaw: `${baseUrl}/sap/content/raw`
        },
        settings: {
          replicateToDrive,
          replicateStrict,
          useOAuth,
          deploy: shouldDeploy,
          installDeps,
          nonInteractive,
          dryRun
        },
        generatedAt: new Date().toISOString()
      });
    }

    await maybeWaitOnExit(waitOnExit);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error("Installer failed:", error);
  process.exit(EXIT_CODES.UNEXPECTED);
});
