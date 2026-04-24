import { contextBridge } from "electron";

const backendUrl =
  process.env.ELECTRON_BACKEND_URL?.trim() ||
  `http://127.0.0.1:${process.env.BACKEND_PORT?.trim() || "3001"}`;

contextBridge.exposeInMainWorld("desktopBridge", {
  getBackendUrl: () => backendUrl,
});
