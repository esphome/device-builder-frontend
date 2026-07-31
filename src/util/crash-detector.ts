import { tagged } from "./log-line.js";

/**
 * How ESPHome's crash output is spelled: where a dump starts and ends,
 * the shape of a decoded frame, and the annotations the handler puts on
 * its own report — the per-frame `(backtrace)` / `(stack scan)` label and
 * the `Reason:` line.
 *
 * The marker patterns are ported from the regexes ESPHome's own
 * stacktrace decoders key on (`esphome/components/{esp32,esp8266}/
 * __init__.py`: `Backtrace:`, `BT<n>:`, register dumps, the esp8266
 * `>>>stack>>>` dump) plus the panic banners those decoders assume
 * scrolled past first (`Guru Meditation Error`, `abort() was called`,
 * ...). Matching runs against `normalizeLogLine` output so the same
 * pattern hits regardless of transport (raw UART bytes vs the
 * backend's `\033`-literal ANSI vs the dialog's timestamp prefix).
 * Detection is the hot half: the logs dialog latches on the first hit,
 * so on hot streams that is one batch scan until a crash is seen and
 * zero cost after. Everything below it runs once, on a bounded excerpt,
 * when the user opens a report.
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

// What `DECODED_RE` captures, and what crash-decode builds for the hosted
// decoder: `0xADDR: symbol` plus esp-idf's ` at <path>:<line>` tail. esp8266
// emits the bare symbol, so the tail stays optional; it is eaten whole
// because gcc appends ` (discriminator N)` past the line number.
const DECODED_FRAME_RE = /^0x[0-9a-fA-F]+:\s*(.+?)(?:\s+at\s+.*)?$/;

// The same frame's address alone, for matching one against the `BT<n>:`
// line that labels it.
const DECODED_FRAME_ADDRESS_RE = /^0x([0-9a-fA-F]+):/;

/** The address a decoded frame carries, lowercased and without `0x`; ""
 *  when the entry isn't a decoded frame. */
export function decodedFrameAddress(frame: string): string {
  const match = DECODED_FRAME_ADDRESS_RE.exec(frame.split("\n")[0].trim());
  return match ? match[1].toLowerCase() : "";
}

/** The symbol a decoded frame names, without its address or location; ""
 *  when the entry isn't a decoded frame. */
export function decodedFrameSymbol(frame: string): string {
  // `(inlined by)` continuations are folded into the entry by
  // `extractDecodedFrames`; the outer frame is the one that owns the address.
  const match = DECODED_FRAME_RE.exec(frame.split("\n")[0].trim());
  return match ? match[1].trim() : "";
}

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

/** Session latch: "live" is terminal, previous-boot upgrades to live, nothing downgrades. */
export function latchCrashKind(
  current: CrashKind | null,
  next: CrashKind | null
): CrashKind | null {
  return current === "live" || next === null ? current : next;
}

// The label the esp32 crash handler puts on every stored frame:
// `(backtrace)` for one the unwinder produced, `(stack scan)` for a word
// that merely looks like a return address in stack memory. A scanned word
// decodes to whatever symbol owns that address, so it can name a component
// the crash never entered.
const BT_FRAME_RE = /BT\d+:\s*(?:0x)?([0-9a-fA-F]{8})\b.*\((backtrace|stack scan)\)/;

// The handler's own verdict, `Reason: <type>` or `<type> - <detail>`
// (`Task wdt`, `Fault - Store access fault`). Two crashes can share a frame
// and differ entirely in why they got there. Matched through the shared tag
// grammar rather than an `esp32.crash` one: esp8266 replays the same report
// under a bare `[E][esp8266:186]:`, and that is the platform whose watchdog
// reasons the split below exists for.
const CRASH_REASON_RE = tagged("\\s*Reason:\\s*(.+?)\\s*$");

// A watchdog exception class, and the raw cause the handler appends to a
// reason: "(exccause=4)", "(cause 0)".
const WATCHDOG_TYPE_RE = /wdt/i;
const TRAILING_CAUSE_RE = /\s*\([^)]*\)\s*$/;

/** What the crash handler blamed, preferring its specific cause over the
 *  exception class; "" when the dump carries no reason, or names one the
 *  handler itself couldn't decode. */
export function crashReason(excerpt: string[]): string {
  for (const line of excerpt) {
    const match = CRASH_REASON_RE.exec(line);
    if (!match) continue;
    const [type, detail] = match[1].split(" - ");
    // A watchdog names the condition itself; its detail is only the trap
    // that fired ("Soft WDT - Level1Int"), so there the type is what reads.
    const chosen = WATCHDOG_TYPE_RE.test(type) ? type : (detail ?? type);
    const reason = chosen.replace(TRAILING_CAUSE_RE, "").trim();
    // "Unknown" is the handler saying it couldn't decode the cause.
    return reason === "Unknown" ? "" : reason;
  }
  return "";
}

/**
 * The decoded frames the unwinder vouched for. All of them when the dump
 * draws no distinction — live panics and esp8266 print no such label.
 */
export function unwoundFrames(excerpt: string[], decodedFrames: string[]): string[] {
  const scanned = new Set<string>();
  const unwound = new Set<string>();
  for (const line of excerpt) {
    const match = BT_FRAME_RE.exec(line);
    if (match) {
      (match[2] === "backtrace" ? unwound : scanned).add(match[1].toLowerCase());
    }
  }
  // A recursive frame's return address litters the stack, so the scan
  // re-finds one the unwinder already vouched for. Filtering on the address
  // alone would then drop both occurrences and leave the crash unnamed —
  // exactly the recursion the stack-overflow case is made of.
  for (const address of unwound) scanned.delete(address);
  if (scanned.size === 0) return decodedFrames;
  return decodedFrames.filter((frame) => !scanned.has(decodedFrameAddress(frame)));
}
