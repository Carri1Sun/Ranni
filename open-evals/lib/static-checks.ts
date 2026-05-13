import type { DeterministicFinalChecks, OpenEvalTraceEvent } from "./types";

function countMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].length;
}

function extractDomains(text: string) {
  const domains = new Set<string>();
  const urlMatches = text.matchAll(/https?:\/\/[^\s)\]>"]+/g);

  for (const match of urlMatches) {
    try {
      domains.add(new URL(match[0]).hostname.replace(/^www\./, ""));
    } catch {
      // Ignore malformed URLs in static checks.
    }
  }

  return domains;
}

export function analyzeFinalAnswer(finalMarkdown: string): DeterministicFinalChecks {
  const hardFailures: string[] = [];
  const warnings: string[] = [];
  const trimmed = finalMarkdown.trim();
  const firstScreen = trimmed.slice(0, 1200);
  const hasDanglingProtocolToken = /RANNI_FINAL_|tool_call|trace\.ndjson|```json\s*\{\s*"tool/i.test(
    trimmed,
  );
  const fenceCount = countMatches(trimmed, /```/g);
  const hasTruncationMarker =
    hasDanglingProtocolToken ||
    fenceCount % 2 === 1 ||
    /\b(truncated|continue|continued|未完待续|继续输出)\b/i.test(trimmed.slice(-500));
  const citationCount =
    countMatches(trimmed, /https?:\/\/[^\s)\]>"]+/g) +
    countMatches(trimmed, /\[[^\]]+\]\([^)]+\)/g) +
    countMatches(trimmed, /\[\d+\]/g);
  const uniqueDomainCount = extractDomains(trimmed).size;
  const sourceSectionPresent = /(^|\n)#{1,4}\s*(来源|参考|References|Sources|Bibliography)\b/i.test(
    trimmed,
  );
  const firstScreenHasThesisSignal =
    /(核心判断|总体判断|我的判断|结论|关键变化|最重要的是|the core thesis|bottom line|overall)/i.test(
      firstScreen,
    );
  const processLeakage =
    /(我搜索了|抓取了\s*\d+|工具调用|trace|guard|finalization|chunked final|RANNI_FINAL_)/i.test(
      firstScreen,
    );
  const headingCount = countMatches(trimmed, /^#{1,4}\s+/gm);
  const tableCount = countMatches(trimmed, /^\s*\|.*\|\s*$/gm);
  const listItemCount = countMatches(trimmed, /^\s*(-|\*|\d+\.)\s+/gm);

  if (!trimmed) {
    hardFailures.push("empty_final");
  }

  if (hasDanglingProtocolToken) {
    hardFailures.push("internal_protocol_leakage");
  }

  if (hasTruncationMarker) {
    hardFailures.push("possible_truncation");
  }

  if (trimmed.length > 3000 && citationCount === 0) {
    hardFailures.push("long_research_without_visible_sources");
  }

  if (citationCount < 5) {
    warnings.push("low_visible_citation_count");
  }

  if (!firstScreenHasThesisSignal) {
    warnings.push("weak_first_screen_thesis");
  }

  if (processLeakage) {
    warnings.push("process_leakage_in_opening");
  }

  if (tableCount > 20 || listItemCount > 80) {
    warnings.push("high_format_load");
  }

  if (uniqueDomainCount > 0 && uniqueDomainCount < 3 && trimmed.length > 5000) {
    warnings.push("low_source_domain_diversity");
  }

  return {
    features: {
      citationCount,
      finalCharCount: trimmed.length,
      firstScreenHasThesisSignal,
      hasDanglingProtocolToken,
      hasTruncationMarker,
      headingCount,
      listItemCount,
      processLeakage,
      sourceSectionPresent,
      tableCount,
      uniqueDomainCount,
    },
    hardFailures,
    passed: hardFailures.length === 0,
    warnings,
  };
}

function eventToSearchableText(event: OpenEvalTraceEvent) {
  return [
    event.type,
    event.name,
    event.content,
    JSON.stringify(event.input ?? {}),
    JSON.stringify(event.output ?? {}),
    JSON.stringify(event.metadata ?? {}),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function analyzeTraceEvents(events: OpenEvalTraceEvent[]) {
  const searchableEvents = events.map(eventToSearchableText);
  const searchCallCount = searchableEvents.filter((text) =>
    /\b(search_web|web_search|search query|tavily|serp|google|bing)\b/.test(text),
  ).length;
  const fetchCallCount = searchableEvents.filter((text) =>
    /\b(fetch_url|fetch|open url|readability|browser open|scrape|crawl)\b/.test(text),
  ).length;
  const evidenceRecordCount = searchableEvents.filter((text) =>
    /\b(record_research_finding|record_task_evidence|evidence|finding|claim-ledger)\b/.test(text),
  ).length;
  const coverageReviewCount = searchableEvents.filter((text) =>
    /\b(review_research_state|coverage|gap|source mix|low-confidence|conflict)\b/.test(text),
  ).length;
  const memoryWriteCount = searchableEvents.filter((text) =>
    /\b(write_file|file_write|source-ledger|claim-ledger|coverage-matrix|synthesis-brief)\b/.test(
      text,
    ),
  ).length;
  const memoryReadbackSignal = searchableEvents.some((text) =>
    /\b(read_file|file_read|context_snapshot|source-ledger|claim-ledger|coverage-matrix|synthesis-brief)\b/.test(
      text,
    ),
  );
  const guardCount = searchableEvents.filter((text) => /\bguard|repair|finalization\b/.test(text))
    .length;
  const errorCount = searchableEvents.filter((text) => /\berror|timeout|terminated|failed\b/.test(text))
    .length;
  const chunkSignals = searchableEvents.filter((text) => /\bchunk|part \d+\/\d+|continue\b/.test(text))
    .length;

  return {
    chunkSignals,
    coverageReviewCount,
    errorCount,
    evidenceRecordCount,
    fetchCallCount,
    fetchSearchRatio: searchCallCount > 0 ? fetchCallCount / searchCallCount : null,
    guardCount,
    memoryReadbackSignal,
    memoryWriteCount,
    searchCallCount,
    traceEventCount: events.length,
  };
}
