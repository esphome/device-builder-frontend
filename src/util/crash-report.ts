import { CRASH_END_RE, isCrashMarker, normalizeLogLine } from "./crash-detector.js";

/**
 * Crash-report assembly: scrape the log buffer the user is already
 * looking at into a structured report, then render it two ways — a
 * complete markdown document (clipboard / download) and a pre-filled
 * GitHub issue URL against esphome/esphome's bug-report form.
 */

// Context kept ahead of the first crash marker, and the hard cap on how
// far past it the excerpt extends when no explicit end marker arrives.
const CONTEXT_LINES_BEFORE = 25;
const MAX_LINES_AFTER_MARKER = 60;

// Total pre-filled URL budget. GitHub 414s somewhere past ~8k; staying
// at 6k leaves headroom for their own redirect/query additions.
const MAX_ISSUE_URL_LENGTH = 6000;

// Cap on decoded frames placed in the issue's `problem` field; the full
// list always rides in the clipboard report.
const MAX_PROBLEM_FRAMES = 40;

const ISSUE_URL_BASE =
  "https://github.com/esphome/esphome/issues/new?template=bug_report.yml";

// esphome logs' inline decoder emits `WARNING Decoded 0x...: func at file:line`.
const DECODED_RE = /^(?:WARNING )?Decoded (0x[0-9a-fA-F]{8}.*)$/;

// A line that carries crash payload past the marker: any 8-hex-digit
// address (registers, stack dumps, backtrace continuations) or a
// decoded frame.
const CRASH_RELATED_RE = /(?:0x)?[0-9a-fA-F]{8}(?::|\b)|Decoded 0x/;

const TAGGED_LINE_RE = /^\[([CWE])\]\[[^\]]*\]/;

/** `target_platform` → the bug form's platform dropdown values. */
export const ISSUE_PLATFORM_MAP: ReadonlyArray<[RegExp, string]> = [
  [/^ESP32/i, "ESP32"],
  [/^ESP8266$/i, "ESP8266"],
  [/^RP2040$/i, "RP2040"],
  [/^BK72XX$/i, "BK72XX"],
  [/^RTL87XX$/i, "RTL87XX"],
  [/^LN882X$/i, "LN882X"],
  [/^HOST$/i, "Host"],
];

export function issuePlatform(targetPlatform: string): string {
  if (!targetPlatform) return "";
  for (const [re, value] of ISSUE_PLATFORM_MAP) {
    if (re.test(targetPlatform)) return value;
  }
  return "Other";
}

export interface CrashReportMeta {
  deviceName: string;
  configuration: string;
  /** ESPHome version the firmware was compiled with. */
  esphomeVersion: string;
  /** Version the device reports it is running ("" unknown). */
  deployedVersion: string;
  dashboardVersion: string;
  targetPlatform: string;
  board: string;
  isHaAddon: boolean;
}

export interface CrashScrape {
  /** Normalized crash excerpt (context + crash block); [] when the crash
   *  scrolled out of the capped buffer. */
  excerpt: string[];
  crashFound: boolean;
  /** `0x...: func at file:line` frames from the inline decoder. */
  decodedFrames: string[];
  /** All `[W]` / `[E]` lines (continuations attached, duplicates folded). */
  warnings: string[];
  /** All `[C]` dump_config lines (continuations attached). */
  configLines: string[];
}

/** Scrape everything the report needs out of the raw log buffer. */
export function scrapeCrashData(rawLines: string[]): CrashScrape {
  const lines = rawLines.map(normalizeLogLine);
  const excerpt = extractCrashExcerpt(lines);
  const { warnings, configLines } = extractTaggedLines(lines);
  return {
    excerpt: excerpt.lines,
    crashFound: excerpt.found,
    decodedFrames: extractDecodedFrames(excerpt.lines),
    warnings,
    configLines,
  };
}

function extractCrashExcerpt(lines: string[]): { lines: string[]; found: boolean } {
  const start = lines.findIndex((line) => isCrashMarker(line));
  if (start === -1) return { lines: [], found: false };
  const hardStop = Math.min(lines.length - 1, start + MAX_LINES_AFTER_MARKER);
  let end = start;
  for (let i = start; i <= hardStop; i++) {
    const line = lines[i];
    if (isCrashMarker(line) || CRASH_RELATED_RE.test(line)) end = i;
    if (i > start && CRASH_END_RE.test(line)) {
      end = i;
      break;
    }
  }
  return {
    lines: lines.slice(Math.max(0, start - CONTEXT_LINES_BEFORE), end + 1),
    found: true,
  };
}

function extractDecodedFrames(excerpt: string[]): string[] {
  const frames: string[] = [];
  for (const line of excerpt) {
    const match = DECODED_RE.exec(line);
    if (match) frames.push(match[1]);
  }
  return frames;
}

function extractTaggedLines(lines: string[]): {
  warnings: string[];
  configLines: string[];
} {
  const warnings: string[] = [];
  const configLines: string[] = [];
  let bucket: string[] | null = null;
  for (const line of lines) {
    const match = TAGGED_LINE_RE.exec(line);
    if (match) {
      bucket = match[1] === "C" ? configLines : warnings;
      appendFolded(bucket, line);
    } else if (bucket !== null && /^\s/.test(line)) {
      // Raw-UART continuations of a multi-line record are indented and
      // untagged; keep them with their entry line.
      bucket.push(line);
    } else {
      bucket = null;
    }
  }
  return { warnings, configLines };
}

// Fold an immediate repeat (a warning spamming every loop iteration)
// into a `(xN)` suffix instead of N rows.
const FOLD_RE = / \(x(\d+)\)$/;

function appendFolded(bucket: string[], line: string): void {
  const previous = bucket[bucket.length - 1];
  if (previous === undefined) {
    bucket.push(line);
    return;
  }
  const folded = FOLD_RE.exec(previous);
  const base = folded ? previous.slice(0, -folded[0].length) : previous;
  if (base !== line) {
    bucket.push(line);
    return;
  }
  const count = folded ? Number(folded[1]) + 1 : 2;
  bucket[bucket.length - 1] = `${line} (x${count})`;
}

export interface CrashReport {
  scrape: CrashScrape;
  meta: CrashReportMeta;
  /** Sanitized `esphome config` dump; "" when unavailable. */
  configYaml: string;
}

/** Component owning the top decoded frame, for the form's component field. */
export function inferComponentName(decodedFrames: string[]): string {
  for (const frame of decodedFrames) {
    const match = /esphome\/components\/([a-z0-9_]+)\//.exec(frame);
    if (match) return match[1];
  }
  return "";
}

const fence = (lines: string[], language = "text"): string =>
  `\`\`\`${language}\n${lines.join("\n")}\n\`\`\``;

/**
 * The complete report, ordered decoded-backtrace-first per the issue
 * triage workflow. Deliberately English-only — it is pasted into a
 * GitHub issue, not rendered in the dashboard.
 */
export function buildFullReport(report: CrashReport): string {
  const { scrape, meta, configYaml } = report;
  const sections: string[] = [`# Crash report: ${meta.deviceName}`];
  sections.push("## Decoded backtrace");
  if (scrape.decodedFrames.length > 0) {
    sections.push(fence(scrape.decodedFrames));
  } else if (scrape.crashFound) {
    sections.push(
      "The backtrace was not decoded in this log session (captured over " +
        "Web Serial, or decoding was unavailable). Raw crash output is below."
    );
  } else {
    sections.push(
      "The crash scrolled out of the log buffer before the report was created."
    );
  }
  if (scrape.excerpt.length > 0) {
    sections.push("## Crash log", fence(scrape.excerpt));
  }
  if (scrape.warnings.length > 0) {
    sections.push("## Warnings and errors", fence(scrape.warnings));
  }
  if (scrape.configLines.length > 0) {
    sections.push("## Config dump", fence(scrape.configLines));
  }
  sections.push("## Configuration (secrets redacted)");
  sections.push(
    configYaml
      ? fence([configYaml.trimEnd()], "yaml")
      : "The configuration could not be validated when this report was created."
  );
  sections.push(
    "## Environment",
    [
      `- Device: ${meta.deviceName} (${meta.configuration})`,
      `- Board: ${meta.board || "unknown"}`,
      `- Platform: ${meta.targetPlatform || "unknown"}`,
      `- ESPHome (compiled): ${meta.esphomeVersion || "unknown"}`,
      `- ESPHome (running): ${meta.deployedVersion || "unknown"}`,
      `- Device Builder: ${meta.dashboardVersion || "unknown"}` +
        (meta.isHaAddon ? " (Home Assistant add-on)" : ""),
    ].join("\n")
  );
  return `${sections.join("\n\n")}\n`;
}

/** Issue title: the crash banner line when present, else a generic one. */
export function buildIssueTitle(report: CrashReport): string {
  const banner = report.scrape.excerpt.find((line) => isCrashMarker(line)) ?? "";
  const title = banner ? `Crash: ${banner}` : `Device crash on ${report.meta.deviceName}`;
  return title.length > 100 ? `${title.slice(0, 97)}...` : title;
}

/**
 * Pre-filled issue-form URL. Everything except the crash excerpt is
 * fixed; the excerpt fills whatever budget remains under
 * MAX_ISSUE_URL_LENGTH, prioritizing the crash block over the context
 * lines that precede it.
 */
export function buildIssueUrl(
  report: CrashReport,
  fullReportDelivery: "clipboard" | "download"
): string {
  const { scrape, meta } = report;
  const url = new URL(ISSUE_URL_BASE);
  const params = url.searchParams;
  params.set("title", buildIssueTitle(report));
  const version = meta.esphomeVersion || meta.deployedVersion;
  if (version) params.set("version", version);
  if (meta.isHaAddon) params.set("installation", "Home Assistant Add-on");
  const platform = issuePlatform(meta.targetPlatform);
  if (platform) params.set("platform", platform);
  const component = inferComponentName(scrape.decodedFrames);
  if (component) params.set("component_name", component);

  const problem: string[] = [
    `The device crashed (crash detected in the Device Builder log viewer).`,
  ];
  if (scrape.decodedFrames.length > 0) {
    problem.push(
      "",
      "Decoded backtrace:",
      ...scrape.decodedFrames.slice(0, MAX_PROBLEM_FRAMES)
    );
  }
  params.set("problem", problem.join("\n"));
  params.set(
    "additional",
    fullReportDelivery === "clipboard"
      ? "The full crash report (decoded backtrace, warnings/errors, config dump, " +
          "sanitized YAML config) was copied to the clipboard by ESPHome Device " +
          "Builder. Please paste it here."
      : "The full crash report was saved as a markdown file by ESPHome Device " +
          "Builder. Please attach or paste it here."
  );

  // The `logs` field is the elastic part: fit the crash block first,
  // then as many preceding context lines as the budget allows.
  params.set("logs", "");
  const overhead = url.toString().length;
  const budget = MAX_ISSUE_URL_LENGTH - overhead;
  const crashStart = scrape.excerpt.findIndex((line) => isCrashMarker(line));
  const logs = fitLines(scrape.excerpt, Math.max(0, crashStart), budget);
  if (logs) {
    params.set("logs", logs);
  } else {
    params.delete("logs");
  }
  return url.toString();
}

/**
 * Join as much of *lines* as fits *budget* once URL-encoded: the block
 * from *anchor* to the end first (truncating its tail if even that
 * overflows), then context lines walking backwards from the anchor.
 */
function fitLines(lines: string[], anchor: number, budget: number): string {
  if (lines.length === 0 || budget <= 0) return "";
  const cost = (line: string): number => encodeURIComponent(`${line}\n`).length;
  const kept: string[] = [];
  let spent = 0;
  let truncated = false;
  for (let i = anchor; i < lines.length; i++) {
    const lineCost = cost(lines[i]);
    if (spent + lineCost > budget) {
      truncated = true;
      break;
    }
    kept.push(lines[i]);
    spent += lineCost;
  }
  for (let i = anchor - 1; i >= 0; i--) {
    const lineCost = cost(lines[i]);
    if (spent + lineCost > budget) {
      truncated = true;
      break;
    }
    kept.unshift(lines[i]);
    spent += lineCost;
  }
  if (kept.length === 0) return "";
  if (truncated) kept.push("[log excerpt trimmed; full logs in the attached report]");
  return kept.join("\n");
}
