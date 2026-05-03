import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendHost = env.BACKEND_HOST?.trim() || "127.0.0.1";
  const backendPort = env.BACKEND_PORT?.trim() || "3001";
  const backendUrl = `http://${backendHost}:${backendPort}`;

  return {
    plugins: [react()],
    build: {
      outDir: "dist/client",
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": backendUrl,
        "/health": backendUrl,
      },
    },
  };
});
