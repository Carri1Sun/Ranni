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

export function getWorkspaceRoot(workspaceRoot?: string) {
  if (workspaceRoot?.trim()) {
    return path.resolve(workspaceRoot.trim());
  }

  if (process.env.AGENT_WORKSPACE_ROOT) {
    return path.resolve(process.env.AGENT_WORKSPACE_ROOT);
  }

  return path.resolve(/* turbopackIgnore: true */ process.cwd());
}

export function isSkippableDir(name: string) {
  return SKIPPABLE_DIRS.has(name);
}

export function resolveWorkspacePath(inputPath = ".", workspaceRoot?: string) {
  const resolvedWorkspaceRoot = getWorkspaceRoot(workspaceRoot);
  const trimmed = inputPath.trim() || ".";
  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(resolvedWorkspaceRoot, trimmed);
  const relativePath = path.relative(resolvedWorkspaceRoot, candidate);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  ) {
    return candidate;
  }

  throw new Error("路径超出当前允许的工作目录范围。");
}

export function toWorkspaceRelative(absolutePath: string, workspaceRoot?: string) {
  const relativePath = path.relative(getWorkspaceRoot(workspaceRoot), absolutePath);
  return relativePath === "" ? "." : relativePath;
}
