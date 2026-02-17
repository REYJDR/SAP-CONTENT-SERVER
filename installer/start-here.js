#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const UI_URL = "http://127.0.0.1:5055";

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    ...options
  });

  child.on("error", (error) => {
    console.error(error.message);
    process.exit(99);
  });

  return child;
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function findFirstFile(relativeDir, matcher) {
  const fullDir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(fullDir)) {
    return null;
  }

  const entries = fs.readdirSync(fullDir);
  const match = entries.find(matcher);
  return match ? path.join(relativeDir, match) : null;
}

function getDesktopBinary() {
  if (isWin) {
    const winApp = findFirstFile("installer/releases/windows/win-unpacked", (name) => /\.exe$/i.test(name));
    if (winApp) {
      return winApp;
    }

    const winSetup = findFirstFile("installer/releases/windows", (name) =>
      /setup.*\.exe$/i.test(name)
    );
    if (winSetup) {
      return winSetup;
    }
  }

  if (isMac) {
    const dmg = findFirstFile("installer/releases/macos", (name) => /\.dmg$/i.test(name));
    if (dmg) {
      return dmg;
    }
  }

  return null;
}

function runDesktopDev() {
  console.log("Starting desktop installer app (dev mode)...");
  return run("npm", ["run", "installer:desktop:dev"]);
}

function runUiServerFallback() {
  console.log("Starting local installer UI fallback...");
  return run("npm", ["run", "installer:ui"]);
}

function openDesktopArtifact(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (isWin) {
    return run("cmd", ["/c", "start", "", fullPath], { detached: true });
  }

  if (isMac) {
    return run("open", [fullPath], { detached: true });
  }

  return null;
}

function openUrl(url) {
  if (isWin) {
    return run("cmd", ["/c", "start", "", url], { detached: true });
  }

  if (isMac) {
    return run("open", [url], { detached: true });
  }

  return null;
}

function isUiAlreadyRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${UI_URL}/health`, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });

    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });

    req.on("error", () => resolve(false));
  });
}

async function main() {
  const uiRunning = await isUiAlreadyRunning();
  if (uiRunning) {
    console.log(`Installer UI already running at ${UI_URL}. Reusing existing instance...`);
    openUrl(UI_URL);
    return;
  }

  const desktopArtifact = getDesktopBinary();
  if (desktopArtifact) {
    console.log(`Opening packaged desktop installer: ${desktopArtifact}`);
    openDesktopArtifact(desktopArtifact);
    return;
  }

  const hasElectron = fileExists("node_modules/electron");
  if (hasElectron) {
    runDesktopDev();
    return;
  }

  runUiServerFallback();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(99);
});
