const path = require("node:path");
const { app, BrowserWindow, dialog } = require("electron");
const { startInstallerUiServer } = require("../ui-server-core");

let mainWindow = null;
let uiServer = null;

async function bootstrapDesktopInstaller() {
  const root = path.resolve(__dirname, "..", "..");

  uiServer = await startInstallerUiServer({
    host: "127.0.0.1",
    port: 0,
    root,
    runtimeExecutable: process.execPath,
    runAsNodeProcess: true,
    logger: () => undefined,
    setupScript: path.join(root, "installer", "setup-wizard.js"),
    uiFile: path.join(root, "installer", "ui", "index.html")
  });

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 980,
    minHeight: 700,
    title: "SAP Content Server Installer",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const url = `http://${uiServer.host}:${uiServer.port}`;
  await mainWindow.loadURL(url);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await bootstrapDesktopInstaller();
  } catch (error) {
    dialog.showErrorBox(
      "Installer failed to start",
      error instanceof Error ? error.message : String(error)
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && uiServer) {
      const reopenWindow = new BrowserWindow({
        width: 1100,
        height: 780,
        minWidth: 980,
        minHeight: 700,
        title: "SAP Content Server Installer",
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      reopenWindow.loadURL(`http://${uiServer.host}:${uiServer.port}`);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (uiServer && uiServer.server) {
    try {
      uiServer.server.close();
    } catch {
      // no-op
    }
  }
});
