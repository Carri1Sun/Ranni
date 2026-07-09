import fs from "node:fs/promises";
import path from "node:path";

import {
  listHtmlDesignStyles,
  listHtmlPageTemplates,
  type HtmlDesignOption,
  type HtmlPageTemplateOption,
} from "../lib/html-design/catalog";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stylePreview(option: HtmlDesignOption) {
  const title = escapeXml(option.name);
  const description = escapeXml(option.description);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" role="img" aria-label="${title}">
  <rect width="320" height="180" rx="18" fill="${option.surfaceColor}"/>
  <rect x="20" y="22" width="280" height="136" rx="14" fill="rgba(255,255,255,.72)" stroke="rgba(15,23,42,.16)"/>
  <circle cx="264" cy="54" r="22" fill="${option.accentColor}" opacity=".9"/>
  <rect x="38" y="42" width="118" height="12" rx="6" fill="${option.accentColor}"/>
  <rect x="38" y="68" width="190" height="8" rx="4" fill="rgba(15,23,42,.64)"/>
  <rect x="38" y="86" width="154" height="8" rx="4" fill="rgba(15,23,42,.34)"/>
  <rect x="38" y="116" width="68" height="22" rx="7" fill="${option.accentColor}"/>
  <rect x="118" y="116" width="54" height="22" rx="7" fill="transparent" stroke="rgba(15,23,42,.24)"/>
  <text x="20" y="174" fill="rgba(15,23,42,.72)" font-family="Inter, Arial, sans-serif" font-size="12">${title} · ${description}</text>
</svg>
`;
}

function templatePreview(option: HtmlPageTemplateOption) {
  const title = escapeXml(option.name);
  const sectionLabels = option.sections.slice(0, 4).map(escapeXml);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" role="img" aria-label="${title}">
  <rect width="320" height="180" rx="18" fill="${option.surfaceColor}"/>
  <rect x="22" y="22" width="276" height="34" rx="10" fill="${option.accentColor}" opacity=".9"/>
  <text x="38" y="44" fill="white" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="700">${title}</text>
  <rect x="22" y="70" width="132" height="82" rx="12" fill="rgba(255,255,255,.8)" stroke="rgba(15,23,42,.14)"/>
  <rect x="170" y="70" width="128" height="36" rx="10" fill="rgba(255,255,255,.76)" stroke="rgba(15,23,42,.12)"/>
  <rect x="170" y="116" width="128" height="36" rx="10" fill="rgba(255,255,255,.76)" stroke="rgba(15,23,42,.12)"/>
  <rect x="40" y="92" width="72" height="9" rx="4.5" fill="${option.accentColor}"/>
  <rect x="40" y="112" width="92" height="7" rx="3.5" fill="rgba(15,23,42,.52)"/>
  <rect x="40" y="128" width="74" height="7" rx="3.5" fill="rgba(15,23,42,.3)"/>
  <text x="184" y="92" fill="rgba(15,23,42,.72)" font-family="Inter, Arial, sans-serif" font-size="10">${sectionLabels[0] ?? ""}</text>
  <text x="184" y="138" fill="rgba(15,23,42,.72)" font-family="Inter, Arial, sans-serif" font-size="10">${sectionLabels[1] ?? ""}</text>
  <text x="22" y="174" fill="rgba(15,23,42,.62)" font-family="Inter, Arial, sans-serif" font-size="11">${sectionLabels.join(" / ")}</text>
</svg>
`;
}

async function writePreview(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function main() {
  const publicRoot = path.resolve(process.cwd(), "public", "html-design-previews");
  const htmlDesignStyles = listHtmlDesignStyles();
  const htmlPageTemplates = listHtmlPageTemplates();

  await Promise.all([
    ...htmlDesignStyles.map((style) =>
      writePreview(
        path.join(publicRoot, "styles", `${style.id}.svg`),
        stylePreview(style),
      ),
    ),
    ...htmlPageTemplates.map((template) =>
      writePreview(
        path.join(publicRoot, "templates", `${template.id}.svg`),
        templatePreview(template),
      ),
    ),
  ]);

  console.log(
    `Generated ${htmlDesignStyles.length + htmlPageTemplates.length} HTML design previews.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
