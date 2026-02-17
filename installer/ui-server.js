#!/usr/bin/env node

const { startInstallerUiServer } = require("./ui-server-core");

const PORT = Number(process.env.INSTALLER_UI_PORT || 5055);
const HOST = "127.0.0.1";
startInstallerUiServer({
  host: HOST,
  port: PORT,
  root: process.cwd()
}).catch((error) => {
  if (error && error.code === "EADDRINUSE") {
    console.log(`Installer UI is already running at http://${HOST}:${PORT}`);
    console.log("Open that URL in your browser or use start-here launcher.");
    process.exit(0);
    return;
  }

  console.error("Failed to start installer UI server:", error);
  process.exit(99);
});
