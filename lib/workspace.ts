import path from "node:path";

const SKIPPABLE_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

export function getWorkspaceRoot() {
  if (process.env.AGENT_WORKSPACE_ROOT) {
    return path.resolve(process.env.AGENT_WORKSPACE_ROOT);
  }

  return path.resolve(/* turbopackIgnore: true */ process.cwd());
}

export function isSkippableDir(name: string) {
  return SKIPPABLE_DIRS.has(name);
}

export function resolveWorkspacePath(inputPath = ".") {
  const workspaceRoot = getWorkspaceRoot();
  const trimmed = inputPath.trim() || ".";
  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceRoot, trimmed);
  const relativePath = path.relative(workspaceRoot, candidate);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  ) {
    return candidate;
  }

  throw new Error("路径超出当前允许的工作目录范围。");
}

export function toWorkspaceRelative(absolutePath: string) {
  const relativePath = path.relative(getWorkspaceRoot(), absolutePath);
  return relativePath === "" ? "." : relativePath;
}
