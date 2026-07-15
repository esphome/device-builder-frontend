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

/** Terminators of a crash dump — the excerpt window closes here. */
export const CRASH_END_RE = /<<<stack<<<|^ELF file SHA256:|^Rebooting\.\.\./;

/**
 * Session-scoped crash latch fed from the log dialog's append path.
 *
 * Stays cheap on hot streams: one pass over each appended batch and a
 * full short-circuit once a crash has been seen.
 */
export class CrashDetector {
  private _detected = false;

  /** Scan a batch of raw (ANSI/timestamped) lines. */
  feed(lines: string[]): void {
    if (this._detected) return;
    for (const line of lines) {
      if (isCrashMarker(normalizeLogLine(line))) {
        this._detected = true;
        return;
      }
    }
  }

  get detected(): boolean {
    return this._detected;
  }

  reset(): void {
    this._detected = false;
  }
}
