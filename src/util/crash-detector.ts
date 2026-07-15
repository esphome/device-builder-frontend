import { stripAnsi } from "./ansi-escapes.js";

/**
 * Crash detection over device log lines.
 *
 * The marker patterns are ported from the regexes ESPHome's own
 * stacktrace decoders key on (`esphome/components/{esp32,esp8266}/
 * __init__.py`: `Backtrace:`, `BT<n>:`, register dumps, the esp8266
 * `>>>stack>>>` dump) plus the panic banners those decoders assume
 * scrolled past first (`Guru Meditation Error`, `abort() was called`,
 * ...). Matching runs against `normalizeLogLine` output so the same
 * pattern hits regardless of transport (raw UART bytes vs the
 * backend's `\033`-literal ANSI vs the dialog's timestamp prefix).
 * The logs dialog latches on the first hit, so on hot streams this is
 * one batch scan until a crash is seen and zero cost after.
 */

// The dialog prepends `[HH:MM:SS]` (optionally with millis) to every line.
// Trailing whitespace stays: on a continuation line the indent after the
// timestamp is content (it's what marks the line as a continuation).
const TIMESTAMP_RE = /^\[\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\]/;

/** Strip ANSI (both escape forms), trailing CR/LF, and the timestamp prefix. */
export function normalizeLogLine(line: string): string {
  return stripAnsi(line)
    .replace(/[\r\n]+$/, "")
    .replace(TIMESTAMP_RE, "");
}

// One entry per crash shape; tested per normalized line. Anchored patterns
// stay anchored (a prose sentence mentioning "Backtrace" must not trip the
// detector — the address pair requirement guards the unanchored ones).
const CRASH_MARKERS: readonly RegExp[] = [
  /Guru Meditation Error/, // esp32 panic banner
  /Backtrace:\s*0x[0-9a-fA-F]{8}:0x[0-9a-fA-F]{8}/, // esp32 single-line backtrace
  /^BT\d+:\s*0x[0-9a-fA-F]{8}/, // stored previous-boot backtrace (crash handler)
  /^last failed alloc call: 4[0-9a-fA-F]{7}\(\d+\)/, // esp32 bad-alloc
  /abort\(\) was called/, // esp-idf abort
  /^assert failed:/, // esp-idf assertion
  /^Core\s+\d+ register dump:/, // xtensa/riscv register dump header
  /^MEPC\s*:\s*0x/, // riscv register dump
  /CORRUPT HEAP/, // esp-idf heap poisoning check
  /^Exception \(\d+\):/, // esp8266 exception header
  />>>stack>>>/, // esp8266 stack dump start
  /^Fatal exception/, // esp8266 postmortem banner
  /Soft WDT reset/, // esp8266 software watchdog
  /Stack smashing protect failure/, // esp8266 stack smashing
];

/** True when a normalized line is a crash marker. */
export function isCrashMarker(line: string): boolean {
  return CRASH_MARKERS.some((re) => re.test(line));
}

/** True when any raw (ANSI/timestamped) line in the batch is a crash marker. */
export function hasCrashMarker(lines: string[]): boolean {
  return lines.some((line) => isCrashMarker(normalizeLogLine(line)));
}
