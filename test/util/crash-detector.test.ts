import { describe, expect, it } from "vitest";
import {
  CRASH_BANNER_LINE,
  CRASH_BLOCK,
  CRASH_BLOCK_ESP8266,
  CRASH_BLOCK_REPEATED_ADDRESS,
  CRASH_BLOCK_STACK_SCAN,
  CRASH_BLOCK_TASK_WDT,
  CRASH_BLOCK_UNWOUND,
} from "../_crash-lines.js";
import {
  crashReason,
  isCrashMarker,
  latchCrashKind,
  unwoundFrames,
} from "../../src/util/crash-detector.js";
import { crashSymbol } from "../../src/util/crash-report-title.js";
import { scrapeCrashData } from "../../src/util/crash-report.js";

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

describe("latchCrashKind", () => {
  it("latches the first detected kind", () => {
    expect(latchCrashKind(null, "previous-boot")).toBe("previous-boot");
    expect(latchCrashKind(null, "live")).toBe("live");
  });

  it("upgrades previous-boot to live", () => {
    expect(latchCrashKind("previous-boot", "live")).toBe("live");
  });

  it("never downgrades live to a later previous-boot marker", () => {
    expect(latchCrashKind("live", "previous-boot")).toBe("live");
  });

  it("keeps the current kind across non-crash lines", () => {
    expect(latchCrashKind("live", null)).toBe("live");
    expect(latchCrashKind("previous-boot", null)).toBe("previous-boot");
    expect(latchCrashKind(null, null)).toBeNull();
  });
});

const unwoundFramesOf = (s: ReturnType<typeof scrapeCrashData>) =>
  unwoundFrames(s.excerpt, s.decodedFrames);

describe("crashReason", () => {
  const reasonOf = (line: string) =>
    crashReason(
      scrapeCrashData([
        "[E][esp32.crash:332]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
        `[E][esp32.crash:335]:   Reason: ${line}`,
        "Rebooting...",
      ]).excerpt
    );

  it("prefers the specific cause over the exception class", () => {
    expect(reasonOf("Fault - Store access fault")).toBe("Store access fault");
    expect(reasonOf("Fault - LoadStoreError")).toBe("LoadStoreError");
  });

  it("names the watchdog rather than the trap it fired", () => {
    // "Level1Int" is the interrupt; the watchdog is the story.
    expect(reasonOf("Soft WDT - Level1Int (exccause=4)")).toBe("Soft WDT");
    expect(reasonOf("Task wdt")).toBe("Task wdt");
  });

  it("drops the raw cause code the handler appends", () => {
    expect(reasonOf("Fault - IllegalInstruction (cause 0)")).toBe("IllegalInstruction");
  });

  it("reads the reason esp8266 replays under its own bare tag", () => {
    // Pinned against filed issues #17825 / #17955: esp8266 logs the stored
    // report as `[E][esp8266:186]:`, with no `.crash` segment. Requiring one
    // dropped every esp8266 reason — including the watchdogs the type/detail
    // split above was written for.
    expect(
      crashReason([
        "[E][esp8266:171]: *** CRASH DETECTED ON PREVIOUS BOOT ***",
        "[E][esp8266:186]:   Reason: Soft WDT - Level1Int (exccause=4)",
      ])
    ).toBe("Soft WDT");
    expect(
      crashReason(["[E][esp8266:186]:   Reason: Exception - LoadProhibit (exccause=28)"])
    ).toBe("LoadProhibit");
  });

  it("treats an undecoded cause as no reason at all", () => {
    // Titling a crash "Unknown in foo" says less than naming the frame alone.
    expect(reasonOf("Fault - Unknown")).toBe("");
    expect(crashReason(scrapeCrashData(CRASH_BLOCK).excerpt)).toBe("");
  });

  it("tells two crashes sharing a frame apart", () => {
    // Both of these decode to Action::play_next_; only the reason differs.
    const store = scrapeCrashData(CRASH_BLOCK_UNWOUND);
    const wdt = scrapeCrashData(CRASH_BLOCK_TASK_WDT);
    expect(crashReason(store.excerpt)).toBe("Store access fault");
    expect(crashReason(wdt.excerpt)).toBe("Task wdt");
    expect(crashSymbol(unwoundFrames(store.excerpt, store.decodedFrames))).toBe(
      crashSymbol(unwoundFrames(wdt.excerpt, wdt.decodedFrames))
    );
  });
});

describe("unwoundFrames", () => {
  it("drops the frames the handler found by scanning the stack", () => {
    // Pinned against a real c3test abort: BT3's stack-scan hit decodes to an
    // mdns symbol, which titled the issue after a component the crash never
    // entered. Only the two unwound frames survive.
    const frames = unwoundFramesOf(scrapeCrashData(CRASH_BLOCK_STACK_SCAN));
    expect(frames).toHaveLength(3);
    expect(frames.join("\n")).not.toContain("mdns_priv_browse_result_add_ip");
    expect(frames.join("\n")).not.toContain("IntervalSyncer");
    expect(crashSymbol(frames)).toBe("");
  });

  it("keeps an unwound frame that names something", () => {
    const frames = unwoundFramesOf(scrapeCrashData(CRASH_BLOCK_UNWOUND));
    expect(crashSymbol(frames)).toBe("Action::play_next_");
    // The button below it is a stack-scan hit, so it is not what gets named.
    expect(frames.join("\n")).not.toContain("Button::press");
  });

  it("keeps an address the unwinder vouched for, however often it is scanned", () => {
    // A recursive frame's return address litters the stack, so the scan
    // re-finds it. Filtering on the address alone dropped both occurrences
    // and left the recursion the feature exists for with no title at all.
    const scrape = scrapeCrashData(CRASH_BLOCK_REPEATED_ADDRESS);
    expect(unwoundFramesOf(scrape)).toHaveLength(2);
    expect(crashSymbol(unwoundFramesOf(scrape))).toBe("APIServer::loop");
  });

  it("keeps every frame when the dump draws no distinction", () => {
    // Live panics and esp8266 print no (backtrace) / (stack scan) label.
    const scrape = scrapeCrashData(CRASH_BLOCK);
    expect(unwoundFramesOf(scrape)).toEqual(scrape.decodedFrames);
    const esp8266 = scrapeCrashData(CRASH_BLOCK_ESP8266);
    expect(unwoundFramesOf(esp8266)).toEqual(esp8266.decodedFrames);
  });
});
