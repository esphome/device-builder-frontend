import { isCrashMarker, normalizeLogLine } from "./crash-detector.js";
import { isCliLogLine } from "./validation-log.js";

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

// Terminators of a crash dump — the excerpt window closes here.
const CRASH_END_RE = /<<<stack<<<|^ELF file SHA256:|^Rebooting\.\.\./;

// Total pre-filled URL budget. GitHub's server returns 414 past roughly
// 8 KB of URL; 8000 keeps a small margin for their redirect/query
// additions while fitting as much of the report as possible.
const MAX_ISSUE_URL_LENGTH = 8000;

// Cap on decoded frames placed in the issue's `problem` field; the full
// list always rides in the clipboard report.
const MAX_PROBLEM_FRAMES = 40;

// Prefilling the YAML Config box must still leave room for a meaningful
// crash-log excerpt in the `logs` field.
const MIN_LOGS_BUDGET = 1500;

const ISSUE_URL_BASE =
  "https://github.com/esphome/esphome/issues/new?template=bug_report.yml";

// esphome logs' inline decoder emits `WARNING Decoded 0x...: func at
// file:line`, with ` (inlined by) ...` continuation lines for inlined frames.
const DECODED_RE = /^(?:WARNING )?Decoded (0x[0-9a-fA-F]{8}.*)$/;
const DECODED_CONTINUATION_RE = /^\s*\(inlined by\)/;

// Lines that merely echo the backtrace the `problem` field already
// carries in decoded form: the decode output itself, its progress
// chatter, and the raw BT<n> address lines (optionally logger-tagged).
const DECODE_ECHO_RES = [
  DECODED_RE,
  DECODED_CONTINUATION_RE,
  /^(?:WARNING )?Found stack trace/,
  /^(?:\[[A-Z]{1,2}\]\[[^\]]*\]:\s*)?BT\d+:\s*0x[0-9a-fA-F]{8}/,
];

const isDecodeEcho = (line: string): boolean =>
  DECODE_ECHO_RES.some((re) => re.test(line));

// A line that carries crash payload past the marker: any 8-hex-digit
// address (registers, stack dumps, backtrace continuations) or a
// decoded frame.
const CRASH_RELATED_RE = /(?:0x)?[0-9a-fA-F]{8}(?::|\b)|Decoded 0x/;

const TAGGED_LINE_RE = /^\[([CWE])\]\[[^\]]*\]/;

// `target_platform` → the bug form's platform dropdown values. ESP32 is a
// prefix match (variants like ESP32S3 report as ESP32).
const ISSUE_PLATFORMS: Record<string, string> = {
  ESP8266: "ESP8266",
  RP2040: "RP2040",
  BK72XX: "BK72XX",
  RTL87XX: "RTL87XX",
  LN882X: "LN882X",
  HOST: "Host",
};

export function issuePlatform(targetPlatform: string): string {
  if (!targetPlatform) return "";
  const upper = targetPlatform.toUpperCase();
  if (upper.startsWith("ESP32")) return "ESP32";
  return ISSUE_PLATFORMS[upper] ?? "Other";
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
  /** Bug-form installation dropdown value; "" when unknown (desktop). */
  installation: string;
}

export interface CrashScrape {
  /** Normalized crash excerpt (context + crash block); [] when the crash
   *  scrolled out of the capped buffer. */
  excerpt: string[];
  /** Index of the first crash marker within `excerpt`; -1 when none. */
  crashIndex: number;
  crashFound: boolean;
  /** `0x...: func at file:line` frames from the inline decoder. */
  decodedFrames: string[];
  /** All `[W]` / `[E]` lines (duplicates folded). */
  warnings: string[];
  /** All `[C]` dump_config lines. */
  configLines: string[];
}

/** Scrape everything the report needs out of the raw log buffer. */
export function scrapeCrashData(rawLines: string[]): CrashScrape {
  const lines = rawLines.map(normalizeLogLine);
  const excerpt = extractCrashExcerpt(lines);
  const { warnings, configLines } = extractTaggedLines(lines);
  return {
    excerpt: excerpt.lines,
    crashIndex: excerpt.crashIndex,
    crashFound: excerpt.crashIndex !== -1,
    decodedFrames: extractDecodedFrames(excerpt.lines),
    warnings,
    configLines,
  };
}

/**
 * Clean YAML from a `devices/validate` stream: normalize each line and
 * drop the esphome CLI log records interleaved on the merged stream.
 */
export function distillValidatedConfig(lines: string[]): string {
  return lines
    .map(normalizeLogLine)
    .filter((line) => !isCliLogLine(line))
    .join("\n")
    .trim();
}

function extractCrashExcerpt(lines: string[]): { lines: string[]; crashIndex: number } {
  const start = lines.findIndex((line) => isCrashMarker(line));
  if (start === -1) return { lines: [], crashIndex: -1 };
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
  const from = Math.max(0, start - CONTEXT_LINES_BEFORE);
  return { lines: lines.slice(from, end + 1), crashIndex: start - from };
}

function extractDecodedFrames(excerpt: string[]): string[] {
  const frames: string[] = [];
  let inFrame = false;
  for (const line of excerpt) {
    const match = DECODED_RE.exec(line);
    if (match) {
      frames.push(match[1]);
      inFrame = true;
    } else if (inFrame && DECODED_CONTINUATION_RE.test(line)) {
      frames[frames.length - 1] += `\n  ${line.trim()}`;
    } else {
      inFrame = false;
    }
  }
  return frames;
}

// A bare tag match covers multi-line records too: both transports re-apply
// the entry's `[L][tag]:` prefix to every continuation line before it
// reaches the buffer (ESPHomeLogParser client-side, aioesphomeapi's
// LogParser behind `esphome logs`).
function extractTaggedLines(lines: string[]): {
  warnings: string[];
  configLines: string[];
} {
  const warnings: string[] = [];
  const configLines: string[] = [];
  for (const line of lines) {
    const match = TAGGED_LINE_RE.exec(line);
    if (match) appendFolded(match[1] === "C" ? configLines : warnings, line);
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
  /** The user's own account of what the device was doing when it crashed. */
  userDescription: string;
}

// Every platform component that can appear in `loaded_integrations`;
// fallback source for devices whose `target_platform` field is empty.
const PLATFORM_INTEGRATIONS = [
  "esp32",
  "esp8266",
  "rp2040",
  "bk72xx",
  "rtl87xx",
  "ln882x",
  "host",
];

/** Platform name from the integration list, for empty `target_platform`. */
export function platformFromIntegrations(integrations: string[]): string {
  return PLATFORM_INTEGRATIONS.find((platform) => integrations.includes(platform)) ?? "";
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
  if (report.userDescription) {
    sections.push("## What happened", report.userDescription);
  }
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
  sections.push("## Environment", environmentSection(meta));
  return `${sections.join("\n\n")}\n`;
}

function environmentSection(meta: CrashReportMeta): string {
  return [
    `- Device: ${meta.deviceName} (${meta.configuration})`,
    `- Board: ${meta.board || "unknown"}`,
    `- Platform: ${meta.targetPlatform || "unknown"}`,
    `- ESPHome (compiled): ${meta.esphomeVersion || "unknown"}`,
    `- ESPHome (running): ${meta.deployedVersion || "unknown"}`,
    `- Device Builder: ${meta.dashboardVersion || "unknown"}` +
      (meta.installation ? ` (${meta.installation})` : ""),
  ].join("\n");
}

/** Issue title: the crash banner line when present, else a generic one. */
function buildIssueTitle(report: CrashReport): string {
  const { excerpt, crashIndex } = report.scrape;
  const banner = crashIndex === -1 ? "" : excerpt[crashIndex];
  const title = banner ? `Crash: ${banner}` : `Device crash on ${report.meta.deviceName}`;
  return title.length > 100 ? `${title.slice(0, 97)}...` : title;
}

export interface IssueUrl {
  url: string;
  /** False when some report content was truncated to fit the URL. */
  complete: boolean;
}

/**
 * Pre-filled issue-form URL — the sole delivery channel (URL prefill
 * survives GitHub's form rehydration; manual pasting does not). Field
 * priority under the budget: problem (description + decoded backtrace,
 * fixed), config (truncated with a marker when needed), logs (crash
 * excerpt, elastic), then the supplementary sections (environment,
 * warnings, config dump) packed whole-section-at-a-time into
 * `additional`. Truncated content stays available via the downloadable
 * report.
 */
export function buildIssueUrl(report: CrashReport): IssueUrl {
  const { scrape, meta } = report;
  const url = new URL(ISSUE_URL_BASE);
  const params = url.searchParams;
  params.set("title", buildIssueTitle(report));
  // Only `input` / `textarea` form fields accept a URL prefill; GitHub
  // ignores it on `dropdown` fields (installation / platform), so those
  // are surfaced inside `problem` instead of set as dead params.
  const version = meta.esphomeVersion || meta.deployedVersion;
  if (version) params.set("version", version);
  const component = inferComponentName(scrape.decodedFrames);
  if (component) params.set("component_name", component);
  const platform = issuePlatform(meta.targetPlatform);
  let missing = scrape.decodedFrames.length > MAX_PROBLEM_FRAMES;

  // The user's own context leads the problem field, then the platform /
  // installation the dropdowns can't be prefilled with, then the trace.
  const problem: string[] = report.userDescription
    ? [report.userDescription, "", "(Crash detected in the Device Builder log viewer.)"]
    : [`The device crashed (crash detected in the Device Builder log viewer).`];
  const facts = [
    platform && `Platform: ${platform}`,
    meta.installation && `Installation: ${meta.installation}`,
    `ESPHome ${meta.esphomeVersion || "unknown"} (compiled)`,
    meta.deployedVersion && `${meta.deployedVersion} (running)`,
    meta.board && `Board: ${meta.board}`,
  ].filter(Boolean);
  problem.push("", ...facts.map((fact) => `- ${fact}`));
  if (scrape.decodedFrames.length > 0) {
    problem.push(
      "",
      "Decoded backtrace:",
      ...scrape.decodedFrames.slice(0, MAX_PROBLEM_FRAMES)
    );
  }
  params.set("problem", problem.join("\n"));

  // The sanitized YAML goes into the form's YAML Config box, truncated
  // line-wise with a marker when it can't fit whole alongside a useful
  // log excerpt — the downloadable report always carries the full dump.
  const configYaml = report.configYaml.trimEnd();
  if (configYaml) {
    const configBudget = MAX_ISSUE_URL_LENGTH - url.toString().length - MIN_LOGS_BUDGET;
    const fitted = fitConfig(configYaml, configBudget);
    if (fitted.text) params.set("config", fitted.text);
    if (fitted.truncated) missing = true;
  }

  // The `logs` field fits the crash block first, then as many preceding
  // context lines as the budget allows. When the decoded backtrace
  // already rides in `problem`, its echo lines are dropped here so the
  // trace appears only once in the issue.
  const { lines: logLines, anchor } =
    scrape.decodedFrames.length > 0
      ? excerptWithoutDecodeEchoes(scrape.excerpt, scrape.crashIndex)
      : { lines: scrape.excerpt, anchor: Math.max(0, scrape.crashIndex) };
  params.set("logs", "");
  const logs = fitLines(logLines, anchor, MAX_ISSUE_URL_LENGTH - url.toString().length);
  if (logs) {
    params.set("logs", logs);
    if (logs.includes(TRIM_MARKER)) missing = true;
  } else {
    params.delete("logs");
    if (logLines.length > 0) missing = true;
  }

  // Pack the supplementary sections into `additional`, whole sections
  // at a time, so the common case needs no manual paste at all.
  const extras: string[] = [];
  const tryAddSection = (text: string): void => {
    params.set("additional", [...extras, text].join("\n\n"));
    if (url.toString().length <= MAX_ISSUE_URL_LENGTH) {
      extras.push(text);
      return;
    }
    missing = true;
    if (extras.length > 0) {
      params.set("additional", extras.join("\n\n"));
    } else {
      params.delete("additional");
    }
  };
  tryAddSection(`Environment:\n${environmentSection(meta)}`);
  if (scrape.warnings.length > 0) {
    tryAddSection(`Warnings and errors:\n${fence(scrape.warnings)}`);
  }
  if (scrape.configLines.length > 0) {
    tryAddSection(`Config dump:\n${fence(scrape.configLines)}`);
  }

  // When content was truncated, a note (for the maintainer reading the
  // issue) leads the additional field; the reporter can attach the
  // downloaded report on request. Drop trailing sections until the note
  // fits so prepending it can't push the URL over budget.
  if (missing) {
    const note = "(Truncated to fit; full report available on request.)";
    for (;;) {
      params.set("additional", [note, ...extras].join("\n\n"));
      if (url.toString().length <= MAX_ISSUE_URL_LENGTH || extras.length === 0) break;
      extras.pop();
    }
  }
  return { url: url.toString(), complete: !missing };
}

const CONFIG_TRUNCATED_NOTE = "# [config truncated to fit the pre-filled URL]";

function fitConfig(yaml: string, budget: number): { text: string; truncated: boolean } {
  if (budget <= 0) return { text: "", truncated: true };
  if (encodeURIComponent(yaml).length <= budget) return { text: yaml, truncated: false };
  const kept: string[] = [];
  let spent = encodedCost(CONFIG_TRUNCATED_NOTE);
  for (const line of yaml.split("\n")) {
    const lineCost = encodedCost(line);
    if (spent + lineCost > budget) break;
    kept.push(line);
    spent += lineCost;
  }
  if (kept.length === 0) return { text: "", truncated: true };
  kept.push(CONFIG_TRUNCATED_NOTE);
  return { text: kept.join("\n"), truncated: true };
}

function excerptWithoutDecodeEchoes(
  excerpt: string[],
  crashIndex: number
): { lines: string[]; anchor: number } {
  const lines: string[] = [];
  let anchor = 0;
  for (let i = 0; i < excerpt.length; i++) {
    if (isDecodeEcho(excerpt[i])) continue;
    if (i <= crashIndex) anchor = lines.length;
    lines.push(excerpt[i]);
  }
  return { lines, anchor: Math.min(anchor, Math.max(0, lines.length - 1)) };
}

const TRIM_MARKER = "[log excerpt trimmed; full logs in the attached report]";

const encodedCost = (line: string): number => encodeURIComponent(`${line}\n`).length;

/**
 * Join as much of *lines* as fits *budget* once URL-encoded: the block
 * from *anchor* to the end first (truncating its tail if even that
 * overflows), then context lines walking backwards from the anchor.
 *
 * Two passes: the first spends the whole budget on content; only when
 * that truncates does the second re-fit with the trim marker's cost
 * reserved, so the marker never pushes the result past the budget and
 * an untrimmed excerpt never sacrifices content to an unused reserve.
 */
function fitLines(lines: string[], anchor: number, budget: number): string {
  if (lines.length === 0 || budget <= 0) return "";
  let fit = fitWithReserve(lines, anchor, budget, 0);
  if (fit.truncated) {
    fit = fitWithReserve(lines, anchor, budget, encodedCost(TRIM_MARKER));
    fit.kept.push(TRIM_MARKER);
  }
  return fit.kept.length > (fit.truncated ? 1 : 0) ? fit.kept.join("\n") : "";
}

function fitWithReserve(
  lines: string[],
  anchor: number,
  budget: number,
  reserve: number
): { kept: string[]; truncated: boolean } {
  const kept: string[] = [];
  let spent = reserve;
  let truncated = false;
  for (let i = anchor; i < lines.length; i++) {
    const lineCost = encodedCost(lines[i]);
    if (spent + lineCost > budget) {
      truncated = true;
      break;
    }
    kept.push(lines[i]);
    spent += lineCost;
  }
  for (let i = anchor - 1; i >= 0; i--) {
    const lineCost = encodedCost(lines[i]);
    if (spent + lineCost > budget) {
      truncated = true;
      break;
    }
    kept.unshift(lines[i]);
    spent += lineCost;
  }
  return { kept, truncated };
}
