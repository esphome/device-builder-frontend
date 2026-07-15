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

/**
 * "live" = the panic scrolled past in this session; "previous-boot" =
 * the crash handler's stored report replayed at boot. The callout wording
 * differs — one is happening now, the other already rebooted.
 */
export type CrashKind = "live" | "previous-boot";

// The stored previous-boot crash report replays through ESPHome's logger,
// so those lines carry a `[E][esp32.crash:NNN]:` header. Anchored markers
// tolerate one optional level/tag prefix so both raw panic output and the
// logger-replayed form match. Exported so crash-report can build the same
// tagged shapes without re-typing the grammar.
export const TAG = /(?:\[[A-Z]{1,2}\]\[[^\]]*\]:\s*)?/.source;
export const tagged = (source: string): RegExp => new RegExp(`^${TAG}${source}`);

// One entry per crash shape; tested per normalized line. Anchored patterns
// stay anchored (a prose sentence mentioning "Backtrace" must not trip the
// detector — the address pair requirement guards the unanchored ones).
const CRASH_MARKERS: ReadonlyArray<[RegExp, CrashKind]> = [
  [/Guru Meditation Error/, "live"], // esp32 panic banner
  [/\*\*\* CRASH DETECTED/, "previous-boot"], // crash handler's report banner
  [/Backtrace:\s*0x[0-9a-fA-F]{8}:0x[0-9a-fA-F]{8}/, "live"], // esp32 backtrace
  [tagged("BT\\d+:\\s*0x[0-9a-fA-F]{8}"), "previous-boot"], // stored backtrace
  [tagged("last failed alloc call: 4[0-9a-fA-F]{7}\\(\\d+\\)"), "live"], // bad-alloc
  [/abort\(\) was called/, "live"], // esp-idf abort
  [tagged("assert failed:"), "live"], // esp-idf assertion
  [tagged("Core\\s+\\d+ register dump:"), "live"], // xtensa/riscv register dump
  [tagged("MEPC\\s*:\\s*0x"), "live"], // riscv register dump
  [/CORRUPT HEAP/, "live"], // esp-idf heap poisoning check
  [tagged("Exception \\(\\d+\\):"), "live"], // esp8266 exception header
  [/>>>stack>>>/, "live"], // esp8266 stack dump start
  [tagged("Fatal exception"), "live"], // esp8266 postmortem banner
  [/Soft WDT reset/, "live"], // esp8266 software watchdog
  [/Stack smashing protect failure/, "live"], // esp8266 stack smashing
];

/** True when a normalized line is a crash marker (either kind). */
export function isCrashMarker(line: string): boolean {
  return CRASH_MARKERS.some(([re]) => re.test(line));
}

/**
 * Classify a batch of raw (ANSI/timestamped) lines. "live" wins over
 * "previous-boot" when both appear; null when no marker matched.
 */
export function detectCrashKind(lines: string[]): CrashKind | null {
  let kind: CrashKind | null = null;
  for (const line of lines) {
    const normalized = normalizeLogLine(line);
    for (const [re, markerKind] of CRASH_MARKERS) {
      if (!re.test(normalized)) continue;
      if (markerKind === "live") return "live";
      kind = markerKind;
    }
  }
  return kind;
}
