import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

const sampleDeckManifestSchema = z.object({
  description: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1).default("v1"),
});

export type HtmlToPptxSampleDeckManifest = z.infer<
  typeof sampleDeckManifestSchema
>;

export type HtmlToPptxSampleDeckSummary = HtmlToPptxSampleDeckManifest & {
  directoryName: string;
};

function getSampleDecksRoot() {
  return path.resolve(process.cwd(), "skills", "html-to-pptx", "examples");
}

function readJsonFile(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function isDirectory(filePath: string) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function readSampleDeckManifest(directoryPath: string) {
  const manifestPath = path.join(directoryPath, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }

  const parsed = sampleDeckManifestSchema.parse(readJsonFile(manifestPath));

  return {
    ...parsed,
    directoryName: path.basename(directoryPath),
  } satisfies HtmlToPptxSampleDeckSummary;
}

export function listHtmlToPptxSampleDecks() {
  const sampleDecksRoot = getSampleDecksRoot();

  if (!fs.existsSync(sampleDecksRoot)) {
    return [];
  }

  return fs
    .readdirSync(sampleDecksRoot)
    .map((entry) => path.join(sampleDecksRoot, entry))
    .filter(isDirectory)
    .map(readSampleDeckManifest)
    .filter((item): item is HtmlToPptxSampleDeckSummary => Boolean(item))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getDefaultHtmlToPptxSampleDeckId() {
  return listHtmlToPptxSampleDecks()[0]?.id ?? "default-business";
}

export function findHtmlToPptxSampleDeck(sampleDeckId?: string) {
  const sampleDecks = listHtmlToPptxSampleDecks();
  const normalizedId = sampleDeckId?.trim();

  if (normalizedId) {
    return sampleDecks.find((sampleDeck) => sampleDeck.id === normalizedId);
  }

  return sampleDecks[0];
}

export function getHtmlToPptxSampleDeckDirectory(sampleDeckId?: string) {
  const sampleDeck = findHtmlToPptxSampleDeck(sampleDeckId);

  if (!sampleDeck) {
    throw new Error("未找到可用 HTML-to-PPTX 示例 deck。");
  }

  return path.join(getSampleDecksRoot(), sampleDeck.directoryName);
}
