import fs from "node:fs/promises";
import path from "node:path";

export async function readTextFile(filePath: string) {
  return fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
}

export async function writeTextFile(filePath: string, content: string) {
  const resolved = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");
}

export async function writeJsonFile(filePath: string, value: unknown) {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function resolveOutputPath(filePath: string) {
  return path.resolve(process.cwd(), filePath);
}
