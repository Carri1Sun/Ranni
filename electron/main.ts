import { app, BrowserWindow, Menu } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const isDevelopment = !app.isPackaged;
const backendPort = process.env.BACKEND_PORT?.trim() || "3001";
const managedBackendUrl = `http://127.0.0.1:${backendPort}`;
const externalBackendUrl = process.env.ELECTRON_BACKEND_URL?.trim() || "";
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL?.trim() || "";

let backendProcess: ChildProcess | null = null;

function getBackendUrl() {
  return externalBackendUrl || managedBackendUrl;
}

function getPreloadPath() {
  return path.join(__dirname, "preload.js");
}

function getRendererPath() {
  return path.join(__dirname, "..", "renderer", "index.html");
}

function getBackendEntryPath() {
  return path.join(__dirname, "..", "src", "server", "index.js");
}

function startManagedBackend() {
  if (externalBackendUrl || isDevelopment || backendProcess) {
    return;
  }

  backendProcess = spawn(process.execPath, [getBackendEntryPath()], {
    env: {
      ...process.env,
      BACKEND_PORT: backendPort,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
  });

  backendProcess.on("exit", () => {
    backendProcess = null;
  });
}

function stopManagedBackend() {
  if (!backendProcess || backendProcess.killed) {
    return;
  }

  backendProcess.kill("SIGTERM");
  backendProcess = null;
}

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#ffffff",
    title: "Ranni",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--backend-url=${getBackendUrl()}`],
    },
  });

  if (rendererDevUrl) {
    await window.loadURL(rendererDevUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await window.loadFile(getRendererPath());
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  startManagedBackend();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopManagedBackend();
});
