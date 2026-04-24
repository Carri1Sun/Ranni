import { createServerApp } from "./app";
import { loadEnvFiles } from "./env";

loadEnvFiles();

const port = Number(process.env.BACKEND_PORT ?? "3001");
const host = process.env.BACKEND_HOST?.trim() || "127.0.0.1";

const app = createServerApp();

app.listen(port, host, () => {
  console.log(`Node backend listening on http://${host}:${port}`);
});
