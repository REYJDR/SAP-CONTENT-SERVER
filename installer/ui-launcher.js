#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");
const { startInstallerUiServer } = require("./ui-server-core");

const HOST = "127.0.0.1";
const PORT = Number(process.env.INSTALLER_UI_PORT || 5055);

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args =
    platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

  const child = spawn(command, args, {
    stdio: "ignore",
    shell: false,
    detached: true
  });

  child.unref();
}

async function main() {
  try {
    const result = await startInstallerUiServer({
      host: HOST,
      port: PORT,
      root: process.cwd(),
      uiFile: path.join(__dirname, "ui", "index.html"),
      setupExecutable:
        process.platform === "win32"
          ? path.join(path.dirname(process.execPath), "setup-wizard-win-x64.exe")
          : path.join(path.dirname(process.execPath), "setup-wizard-macos-arm64")
    });

    const url = `http://${result.host}:${result.port}`;
    console.log(`Installer UI is running at ${url}`);
    openBrowser(url);
  } catch (error) {
    if (error && error.code === "EADDRINUSE") {
      const url = `http://${HOST}:${PORT}`;
      console.log(`Installer UI is already running at ${url}`);
      openBrowser(url);
      process.exit(0);
      return;
    }

    console.error("Failed to start installer UI launcher:", error);
    process.exit(99);
  }
}

main();
