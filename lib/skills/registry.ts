import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ToolDefinition } from "../tools";

export type SkillIndex = {
  bodyHash: string;
  description: string;
  name: string;
  resourcePaths: string[];
  version: string;
};

export type SkillManifest = SkillIndex & {
  body: string;
  dir: string;
  tools?: ToolDefinition[];
};

type SkillToolModule = {
  default?: unknown;
  tools?: unknown;
};

const SKILL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const requireFromRegistry = createRequire(__filename);

let cachedManifests: SkillManifest[] | null = null;

function resolveSkillRoot() {
  return path.resolve(process.cwd(), "skills");
}

function parseFrontmatter(content: string, filePath: string) {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    throw new Error(`${filePath} 缺少 frontmatter。`);
  }

  const endIndex = normalized.indexOf("\n---", 4);

  if (endIndex === -1) {
    throw new Error(`${filePath} 的 frontmatter 未闭合。`);
  }

  const frontmatter = normalized.slice(4, endIndex).trim();
  const body = normalized.slice(endIndex + "\n---".length).replace(/^\s*\n/, "");
  const fields = new Map<string, string>();

  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    fields.set(key, value);
  }

  const name = fields.get("name")?.trim() ?? "";
  const description = fields.get("description")?.trim() ?? "";
  const version = fields.get("version")?.trim() || "v1";

  if (!name || !description) {
    throw new Error(`${filePath} 必须声明 name 和 description。`);
  }

  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`${filePath} 的 skill name 只能包含字母、数字、下划线和连字符。`);
  }

  return {
    body: body.trim(),
    description,
    name,
    version,
  };
}

function hashBody(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

function listSkillResources(skillDir: string) {
  const resources: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".DS_Store" || entry.name === "node_modules") continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.name !== "SKILL.md" && !/^tools\.[cm]?[jt]s$/.test(entry.name)) {
        resources.push(path.relative(skillDir, absolutePath));
      }
    }
  };
  visit(skillDir);
  return resources.sort();
}

function hasToolShape(value: unknown): value is ToolDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ToolDefinition>;

  return (
    typeof candidate.execute === "function" &&
    typeof candidate.schema === "object" &&
    typeof candidate.tool === "object" &&
    candidate.tool !== null &&
    typeof candidate.tool.name === "string"
  );
}

function readSkillTools(skillDir: string, skillName: string) {
  const sourceToolPath = path.join(skillDir, "tools.ts");
  const sourceToolJsPath = path.join(skillDir, "tools.js");

  if (!fs.existsSync(sourceToolPath) && !fs.existsSync(sourceToolJsPath)) {
    return [];
  }

  const compiledToolPath = path.resolve(
    process.cwd(),
    "dist",
    "skills",
    skillName,
    "tools.js",
  );
  const isCompiledRuntime = path.relative(process.cwd(), __dirname).startsWith(
    `dist${path.sep}`,
  );
  const importCandidates = isCompiledRuntime
    ? [compiledToolPath, sourceToolJsPath, sourceToolPath]
    : [sourceToolPath, sourceToolJsPath, compiledToolPath];

  for (const candidatePath of importCandidates) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    try {
      const module = requireFromRegistry(candidatePath) as SkillToolModule;
      const exportedTools = Array.isArray(module.tools)
        ? module.tools
        : Array.isArray(module.default)
          ? module.default
          : [];

      return exportedTools.filter(hasToolShape);
    } catch (error) {
      if (candidatePath === importCandidates.at(-1)) {
        console.warn(
          `Failed to load tools for skill ${skillName}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  return [];
}

function scanSkills() {
  const skillRoot = resolveSkillRoot();

  if (!fs.existsSync(skillRoot)) {
    return [];
  }

  const entries = fs
    .readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const manifests: SkillManifest[] = [];
  const seenNames = new Set<string>();

  for (const entry of entries) {
    const skillDir = path.join(skillRoot, entry.name);
    const skillFile = path.join(skillDir, "SKILL.md");

    if (!fs.existsSync(skillFile)) {
      continue;
    }

    try {
      const parsed = parseFrontmatter(fs.readFileSync(skillFile, "utf8"), skillFile);

      if (seenNames.has(parsed.name)) {
        console.warn(`Duplicate skill name ignored: ${parsed.name}`);
        continue;
      }

      seenNames.add(parsed.name);
      manifests.push({
        ...parsed,
        bodyHash: hashBody(parsed.body),
        dir: skillDir,
        resourcePaths: listSkillResources(skillDir),
        tools: readSkillTools(skillDir, parsed.name),
      });
    } catch (error) {
      console.warn(
        `Failed to load skill from ${skillFile}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return manifests;
}

function getManifests() {
  cachedManifests ??= scanSkills();

  return cachedManifests;
}

function getSkillManifest(name: string) {
  return getManifests().find((skill) => skill.name === name);
}

export function listSkillIndices(): SkillIndex[] {
  return getManifests().map(({ bodyHash, description, name, resourcePaths, version }) => ({
    bodyHash,
    description,
    name,
    resourcePaths,
    version,
  }));
}

export function hasSkill(name: string) {
  return Boolean(getSkillManifest(name));
}

export function getSkillBody(name: string) {
  return getSkillManifest(name)?.body ?? "";
}

export function getSkillTools(name: string): ToolDefinition[] {
  return getSkillManifest(name)?.tools ?? [];
}

export function normalizeSkillNames(skillNames: readonly string[] = []) {
  const normalized = new Set<string>();

  for (const name of skillNames) {
    const trimmed = name.trim();

    if (trimmed && hasSkill(trimmed)) {
      normalized.add(trimmed);
    }
  }

  return [...normalized];
}
