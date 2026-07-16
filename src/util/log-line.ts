import { stripAnsi } from "./ansi-escapes.js";

/**
 * The rendered log-record grammar — ``[timestamp][LEVEL][tag]`` — in one
 * place, so the doc-link parser, crash detector, and crash-report
 * extraction can't drift apart on the timestamp shape or level alphabet.
 */

// The transport-prepended wall-clock stamp. Both prepend paths emit exactly
// this shape: the backend's `esphome logs` stamp (optionally with millis)
// and the Web Serial path's formatSerialTimestamp (seconds only).
const TIMESTAMP_SOURCE = /\[\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\]/.source;

// Firmware log levels plus `S`: state lines client-side reconstructed by
// aioesphomeapi's state_log_formatter, carrying a bare entity-domain tag
// with no line number where firmware levels always append `:<line>`.
const LEVEL_SOURCE = /[EWICDV]V?|S/.source;

// A rendered log record: optional timestamp (present on buffered dialog
// lines, already stripped on normalized ones), then the `[LEVEL][tag]`
// header. Group 1 is the level, group 2 the `tag:line` token.
const LOG_LINE_RE = new RegExp(
  `^(?:${TIMESTAMP_SOURCE})?\\[(${LEVEL_SOURCE})\\]\\[([^\\]]+)\\]`
);

// The dialog prepends the timestamp to every line. Trailing whitespace
// stays: on a continuation line the indent after the timestamp is content
// (it's what marks the line as a continuation).
const TIMESTAMP_RE = new RegExp(`^${TIMESTAMP_SOURCE}`);

// The stored previous-boot crash report replays through ESPHome's logger,
// so those lines carry a `[E][esp32.crash:NNN]:` header. Anchored crash
// markers tolerate one optional level/tag prefix so both raw panic output
// and the logger-replayed form match.
export const TAG = `(?:\\[(?:${LEVEL_SOURCE})\\]\\[[^\\]]*\\]:\\s*)?`;
export const tagged = (source: string): RegExp => new RegExp(`^${TAG}${source}`);

export interface ParsedLogLine {
  level: string;
  tag: string;
  tagStart: number;
  tagEnd: number;
}

/** Parse level + tag (and the tag's char range) from a clean log line. */
export function parseLogLine(clean: string): ParsedLogLine | undefined {
  const match = clean.match(LOG_LINE_RE);
  if (!match) return undefined;
  const inner = match[2];
  const tag = inner.replace(/:\d+$/, "");
  // match[0] ends with `[` + inner + `]`, so the inner token starts one
  // char before the closing bracket; the tag is inner's leading slice.
  const tagStart = match[0].length - inner.length - 1;
  return { level: match[1], tag, tagStart, tagEnd: tagStart + tag.length };
}

/** Strip ANSI (both escape forms), trailing CR/LF, and the timestamp prefix. */
export function normalizeLogLine(line: string): string {
  return stripAnsi(line)
    .replace(/[\r\n]+$/, "")
    .replace(TIMESTAMP_RE, "");
}
