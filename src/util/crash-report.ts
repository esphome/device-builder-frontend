import { isCrashMarker } from "./crash-detector.js";
import { normalizeLogLine, parseLogLine, tagged } from "./log-line.js";
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
// list always rides in the downloadable report.
const MAX_PROBLEM_FRAMES = 40;

const ISSUE_URL_BASE =
  "https://github.com/esphome/esphome/issues/new?template=bug_report.yml";

// esphome logs' inline decoder emits `WARNING Decoded 0x...: func at
// file:line`, with ` (inlined by) ...` continuation lines for inlined frames.
const DECODED_RE = /^(?:WARNING )?Decoded (0x[0-9a-fA-F]{8}.*)$/;
const DECODED_CONTINUATION_RE = /^\s*\(inlined by\)/;

// Lines that merely echo the backtrace the `problem` field already
// carries in decoded form: the decode output itself, its progress
// chatter, and the raw BT<n> address lines (optionally logger-tagged —
// the shared `tagged` grammar keeps the prefix in one place).
const DECODE_ECHO_RES = [
  DECODED_RE,
  DECODED_CONTINUATION_RE,
  /^(?:WARNING )?Found stack trace/,
  tagged("BT\\d+:\\s*0x[0-9a-fA-F]{8}"),
];

const isDecodeEcho = (line: string): boolean =>
  DECODE_ECHO_RES.some((re) => re.test(line));

// A line that carries crash payload past the marker: any 8-hex-digit
// address (registers, stack dumps, backtrace continuations) or a
// decoded frame.
const CRASH_RELATED_RE = /(?:0x)?[0-9a-fA-F]{8}(?::|\b)|Decoded 0x/;

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
    const level = parseLogLine(line)?.level;
    if (level === "C") {
      // Config-dump lines are structured output, not spam — keep them
      // verbatim (folding would silently collapse repeated values).
      configLines.push(line);
    } else if (level === "W" || level === "E") {
      appendFolded(warnings, line);
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

// Wrap *lines* in a code fence longer than any backtick run they contain,
// so user-controlled content (YAML strings, logs, descriptions) with a
// ``` sequence can't close the fence early and corrupt the markdown.
const fence = (lines: string[], language = "text"): string => {
  const body = lines.join("\n");
  const longestRun = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const bar = "`".repeat(Math.max(3, longestRun + 1));
  return `${bar}${language}\n${body}\n${bar}`;
};

/**
 * The complete report, ordered decoded-backtrace-first per the issue
 * triage workflow. Deliberately English-only — it is pasted into a
 * GitHub issue, not rendered in the dashboard.
 */
export function buildFullReport(report: CrashReport): string {
  const { scrape, meta, configYaml } = report;
  const sections: string[] = [`# Crash report: ${meta.deviceName}`];
  if (report.userDescription) {
    // Fence the user's prose so a stray ``` run in it can't close the
    // surrounding markdown and hide the sections below.
    sections.push("## What happened", fence([report.userDescription], ""));
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
  let missing = false;

  // The user's own context leads the problem field, then the platform /
  // installation the dropdowns can't be prefilled with, then the trace.
  const head: string[] = report.userDescription
    ? [
        // Fenced so a stray ``` in the prose can't swallow the facts and
        // backtrace that follow it in this field.
        fence([report.userDescription], ""),
        "",
        "(Crash detected in the Device Builder log viewer.)",
      ]
    : [`The device crashed (crash detected in the Device Builder log viewer).`];
  const facts = [
    platform && `Platform: ${platform}`,
    meta.installation && `Installation: ${meta.installation}`,
    `ESPHome ${meta.esphomeVersion || "unknown"} (compiled)`,
    meta.deployedVersion && `${meta.deployedVersion} (running)`,
    meta.board && `Board: ${meta.board}`,
  ].filter(Boolean);
  head.push("", ...facts.map((fact) => `- ${fact}`));
  // `problem` is set first but still bounded: a long description and/or
  // many long decoded frames could blow the budget before logs/config
  // trim. Drop trailing frames (then hard-truncate) until it fits.
  if (fitProblem(url, params, head, scrape.decodedFrames)) missing = true;

  // The crash logs get first claim on the budget: they're a one-time
  // capture, whereas the config can always be re-obtained from the YAML
  // later. The `logs` field fits the crash block first, then as many
  // preceding context lines as the budget allows. When the decoded
  // backtrace already rides in `problem`, its echo lines are dropped
  // here so the trace appears only once in the issue.
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

  // The sanitized YAML takes whatever budget the logs left, truncated
  // (with a marker) when it can't fit whole — the full dump is always in
  // the downloadable report, and the config is recoverable from the YAML
  // regardless. Secrets are already redacted to `<removed>`. Set an empty
  // `config` param first so the `&config=` key overhead is counted in the
  // measured budget, keeping the final URL reliably under the cap.
  const configYaml = report.configYaml.trimEnd();
  if (configYaml) {
    params.set("config", "");
    const fitted = fitConfig(configYaml, MAX_ISSUE_URL_LENGTH - url.toString().length);
    if (fitted.text) {
      params.set("config", fitted.text);
    } else {
      params.delete("config");
    }
    if (fitted.truncated) missing = true;
  }

  // Pack the supplementary sections into `additional`, whole sections at
  // a time, so the common case needs no manual paste. Only sections that
  // aren't already elsewhere in the URL — environment (in `problem`),
  // backtrace (in `problem`), config (in `config`) are deliberately not
  // repeated here, since the budget is tight.
  const sections = [
    scrape.warnings.length > 0 && `Warnings and errors:\n${fence(scrape.warnings)}`,
    scrape.configLines.length > 0 && `Config dump:\n${fence(scrape.configLines)}`,
  ].filter((s): s is string => Boolean(s));
  let kept = packParam(url, params, "additional", sections);
  if (kept.length < sections.length) missing = true;

  // When anything was truncated (here or in logs/config), lead `additional`
  // with a note for the maintainer; re-pack so the note can't push the URL
  // over budget (dropping trailing sections, or `additional` itself).
  if (missing) {
    kept = packParam(url, params, "additional", [
      "(Truncated to fit; full report available on request.)",
      ...kept,
    ]);
  }
  return { url: url.toString(), complete: !missing };
}

/**
 * Set `params[key]` to the longest run of *parts* (joined by blank lines)
 * that keeps the whole URL within budget, deleting the param when none
 * fit. Returns the parts that were kept.
 */
function packParam(
  url: URL,
  params: URLSearchParams,
  key: string,
  parts: string[]
): string[] {
  const kept: string[] = [];
  for (const part of parts) {
    params.set(key, [...kept, part].join("\n\n"));
    if (url.toString().length <= MAX_ISSUE_URL_LENGTH) kept.push(part);
  }
  if (kept.length > 0) params.set(key, kept.join("\n\n"));
  else params.delete(key);
  return kept;
}

/**
 * Set the `problem` param to *head* plus as many decoded *frames* as the
 * URL budget allows, dropping trailing frames (then hard-truncating the
 * text) until it fits. Returns true when anything was dropped/truncated.
 */
function fitProblem(
  url: URL,
  params: URLSearchParams,
  head: string[],
  frames: string[]
): boolean {
  let used = Math.min(frames.length, MAX_PROBLEM_FRAMES);
  let dropped = frames.length > used;
  for (;;) {
    const body = used > 0 ? ["", "Decoded backtrace:", ...frames.slice(0, used)] : [];
    const note =
      frames.length > used
        ? ["", `(+${frames.length - used} more frames in the report)`]
        : [];
    params.set("problem", [...head, ...body, ...note].join("\n"));
    if (url.toString().length <= MAX_ISSUE_URL_LENGTH || used === 0) break;
    used = Math.max(0, used - 4);
    dropped = true;
  }
  if (url.toString().length <= MAX_ISSUE_URL_LENGTH) return dropped;
  // Even head-only overflows (a huge description): hard-truncate to fit.
  params.set("problem", "");
  const budget = MAX_ISSUE_URL_LENGTH - url.toString().length;
  const text = head.join("\n");
  let end = Math.max(0, Math.min(text.length, budget - 20));
  while (end > 0 && formEncodedLength(`${text.slice(0, end)}\n…[truncated]`) > budget) {
    end -= 32;
  }
  params.set("problem", `${text.slice(0, Math.max(0, end))}\n…[truncated]`);
  return true;
}

const CONFIG_TRUNCATED_NOTE = "# [config truncated to fit the pre-filled URL]";

function fitConfig(yaml: string, budget: number): { text: string; truncated: boolean } {
  if (budget <= 0) return { text: "", truncated: true };
  if (formEncodedLength(yaml) <= budget) return { text: yaml, truncated: false };
  const { kept } = takeLinesUnderBudget(
    yaml.split("\n"),
    budget,
    encodedCost(CONFIG_TRUNCATED_NOTE)
  );
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

// Encoded length of *s* the way the prefilled URL actually serializes it:
// URLSearchParams uses application/x-www-form-urlencoded, which differs
// from encodeURIComponent for `! ~ ' ( )` (3 chars vs 1) — and ESPHome
// backtraces are full of parens, so encodeURIComponent under-counts and
// can produce a >8000-char URL (414). Measuring via URLSearchParams is
// exact; the trailing "v=" (2 chars) is subtracted off.
const formEncodedLength = (s: string): number =>
  new URLSearchParams({ v: s }).toString().length - 2;

const encodedCost = (line: string): number => formEncodedLength(`${line}\n`);

/**
 * Greedily take the longest prefix of *lines* whose per-line
 * `encodedCost` fits `budget - spent`. Returns the kept prefix, the
 * running spend, and whether any line was dropped.
 */
function takeLinesUnderBudget(
  lines: string[],
  budget: number,
  spent: number
): { kept: string[]; spent: number; truncated: boolean } {
  const kept: string[] = [];
  for (const line of lines) {
    const cost = encodedCost(line);
    if (spent + cost > budget) return { kept, spent, truncated: true };
    kept.push(line);
    spent += cost;
  }
  return { kept, spent, truncated: false };
}

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

// Fit forward from *anchor* to the end, then walk backward over the
// preceding context, sharing one budget and marker reserve.
function fitWithReserve(
  lines: string[],
  anchor: number,
  budget: number,
  reserve: number
): { kept: string[]; truncated: boolean } {
  const forward = takeLinesUnderBudget(lines.slice(anchor), budget, reserve);
  const back = takeLinesUnderBudget(
    lines.slice(0, anchor).reverse(),
    budget,
    forward.spent
  );
  return {
    kept: [...back.kept.reverse(), ...forward.kept],
    truncated: forward.truncated || back.truncated,
  };
}
