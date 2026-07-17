import { describe, expect, it } from "vitest";
import { isCrashMarker } from "../../src/util/crash-detector.js";
import { CRASH_BANNER_LINE } from "../_crash-lines.js";

// Realistic crash lines, one per supported shape.
const CRASH_LINES: ReadonlyArray<[string, string]> = [
  ["esp32 panic banner", CRASH_BANNER_LINE],
  [
    "crash handler previous-boot banner (logger-tagged)",
    "[E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
  ],
  ["esp32 backtrace", "Backtrace: 0x400d9150:0x3ffb4f60 0x400da73c:0x3ffb4f90"],
  ["stored previous-boot backtrace", "BT0: 0x400d9150"],
  [
    "stored backtrace replayed through the logger",
    "[E][esp32.crash:305]:   BT0: 0x4015482D  (backtrace)",
  ],
  ["esp32 bad-alloc", "last failed alloc call: 4009ac2c(1024)"],
  ["esp-idf abort", "abort() was called at PC 0x401a2b3c on core 1"],
  ["esp-idf assert", "assert failed: xQueueSemaphoreTake queue.c:1549 (( pxQueue ))"],
  ["register dump header", "Core  1 register dump:"],
  ["riscv register dump", "MEPC    : 0x4200b1a4  RA      : 0x4200b1a0"],
  ["heap poisoning", "CORRUPT HEAP: Bad head at 0x3ffb8f00. Expected 0xabba1234"],
  ["esp8266 exception", "Exception (28):"],
  ["esp8266 stack dump start", ">>>stack>>>"],
  ["esp8266 postmortem", "Fatal exception 28(LoadProhibitedCause):"],
  ["esp8266 soft WDT", "Soft WDT reset"],
  ["esp8266 stack smashing", "Stack smashing protect failure!"],
];

const NON_CRASH_LINES: ReadonlyArray<[string, string]> = [
  ["plain error log", "[E][component:214]: Component wifi took a long time (128 ms)"],
  ["prose mentioning Backtrace", "[I][app:100]: Backtrace decoding is available"],
  ["config dump line", "[C][logger:224]: Logger:"],
  ["esptool progress", "Writing at 0x00010000... (5 %)"],
  ["baud-mismatch mojibake", "����rl��"],
  ["BT prose without address", "BT scan finished"],
  ["empty line", ""],
];

describe("isCrashMarker", () => {
  it.each(CRASH_LINES)("matches %s", (_name, line) => {
    expect(isCrashMarker(line)).toBe(true);
  });

  it.each(NON_CRASH_LINES)("does not match %s", (_name, line) => {
    expect(isCrashMarker(line)).toBe(false);
  });
});
