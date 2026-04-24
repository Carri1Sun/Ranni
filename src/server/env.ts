import path from "node:path";

import { config as loadDotenv } from "dotenv";

let loaded = false;

export function loadEnvFiles() {
  if (loaded) {
    return;
  }

  const cwd = process.cwd();

  loadDotenv({
    path: path.join(cwd, ".env"),
  });
  loadDotenv({
    override: true,
    path: path.join(cwd, ".env.local"),
  });

  loaded = true;
}
