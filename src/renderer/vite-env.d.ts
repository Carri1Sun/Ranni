/// <reference types="vite/client" />

declare global {
  interface Window {
    desktopBridge?: {
      getBackendUrl: () => string;
    };
  }
}

export {};
