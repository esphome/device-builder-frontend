import { tagged } from "./log-line.js";

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

/**
 * "live" = the panic scrolled past in this session; "previous-boot" =
 * the crash handler's stored report replayed at boot. The callout wording
 * differs — one is happening now, the other already rebooted.
 */
export type CrashKind = "live" | "previous-boot";

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

// Where a crash dump stops. The report scraper closes its excerpt here and
// the log viewer's collector ends its region here, so they describe one
// window and can't drift into disagreeing about a crash's extent.
export const CRASH_END_RE = /<<<stack<<<|^ELF file SHA256:|^Rebooting\.\.\./;

// How far past the marker a dump can run before it's cut off, for a crash
// that never prints a terminator.
export const MAX_LINES_AFTER_MARKER = 60;

// Any 8-hex-digit address, optionally 0x-prefixed: a register value, a
// backtrace frame, an esp8266 stack-dump word. The primitive both the
// excerpt window and the decode gate are built from.
export const ADDRESS_RE = /(?:0x)?[0-9a-fA-F]{8}(?::|\b)/;

// esphome logs' inline decoder output, which an OTA session already carries.
export const DECODED_RE = /^(?:WARNING )?Decoded (0x[0-9a-fA-F]{8}.*)$/;

/** True when a normalized line is a crash marker (either kind). */
export function isCrashMarker(line: string): boolean {
  return CRASH_MARKERS.some(([re]) => re.test(line));
}

/** Classify one already-normalized line; null when no marker matched. */
export function classifyLine(normalized: string): CrashKind | null {
  let kind: CrashKind | null = null;
  for (const [re, markerKind] of CRASH_MARKERS) {
    if (!re.test(normalized)) continue;
    if (markerKind === "live") return "live";
    kind = markerKind;
  }
  return kind;
}
