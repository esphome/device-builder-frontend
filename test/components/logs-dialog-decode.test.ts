/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";
import { STALE_BUILD_LOG_LINE } from "../../src/util/crash-decode.js";
import { stripAnsi } from "../../src/util/ansi-escapes.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const append = (el: ESPHomeLogsDialog, lines: string[]) =>
  (el as any)._appendCapped(lines);
const lines = (el: ESPHomeLogsDialog): string[] => (el as any)._lines;

// A Web Serial crash: no decoder attached, so no Decoded lines arrive.
const CRASH = [
  "[12:00:01]Guru Meditation Error: Core 1 panic'ed (StoreProhibited).",
  "[12:00:01]PC      : 0x400d1a2c  PS      : 0x00060e30",
  "[12:00:01]Backtrace: 0x400d1a2c:0x3ffc3f40 0x40154879:0x3ffc3f60",
  "[12:00:01]Rebooting...",
];

describe("logs-dialog inline backtrace decode", () => {
  let el: ESPHomeLogsDialog;
  let decodeBacktrace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    el = new ESPHomeLogsDialog();
    decodeBacktrace = vi.fn(async () => ({
      decoded: [{ index: 2, text: "Decoded 0x400d1a2c: loop() at main.cpp:42" }],
      stale_build: false,
      unavailable_reason: "",
    }));
    (el as any)._api = {
      logs: () => "s1",
      stopStream: () => Promise.resolve(),
      decodeBacktrace,
    };
    el.configuration = "ol.yaml";
    document.body.appendChild(el);
    el.open("OTA");
  });

  const flush = async () => {
    await (el as any)._crashDecode._chain;
    await el.updateComplete;
  };

  it("splices the decode in after the line that produced it", async () => {
    append(el, ["[12:00:00]boot", ...CRASH, "[12:00:02]rebooted"]);
    await flush();

    const plain = lines(el).map(stripAnsi);
    const at = plain.indexOf("WARNING Decoded 0x400d1a2c: loop() at main.cpp:42");
    // Directly under the Backtrace line it decodes, the way esphome logs
    // shows it, rather than appended after the reboot.
    expect(at).toBeGreaterThan(-1);
    expect(plain[at - 1]).toContain("Backtrace:");
    expect(plain[at + 1]).toContain("Rebooting...");
    // Yellow, like the WARNING record it is over OTA; the panic stays red.
    expect(lines(el)[at]).toContain("\u001b[0;33m");
    expect(lines(el)[at - 1]).toContain("\u001b[1;31m");
  });

  it("sends the crash region only, normalized, once it terminates", async () => {
    append(el, ["[12:00:00]boot", ...CRASH, "[12:00:02]rebooted"]);
    await flush();

    const [configuration, sent] = decodeBacktrace.mock.calls[0]!;
    expect(configuration).toBe("ol.yaml");
    // From the marker to the terminator; no leading boot line, no trailing
    // reboot chatter, and no timestamps.
    expect(sent[0]).toBe("Guru Meditation Error: Core 1 panic'ed (StoreProhibited).");
    expect(sent[sent.length - 1]).toBe("Rebooting...");
  });

  it("does not decode a crash that is still streaming in", async () => {
    append(el, CRASH.slice(0, 3));
    await flush();

    // No terminator yet, so the region is incomplete and must not be sent.
    expect(decodeBacktrace).not.toHaveBeenCalled();
  });

  it("captions a stale build inline, above the frames", async () => {
    decodeBacktrace.mockResolvedValue({
      decoded: [{ index: 2, text: "Decoded 0x400d1a2c: loop()" }],
      stale_build: true,
      unavailable_reason: "",
    });

    append(el, CRASH);
    await flush();

    const plain = lines(el).map(stripAnsi);
    const warn = plain.indexOf(STALE_BUILD_LOG_LINE);
    expect(warn).toBeGreaterThan(-1);
    expect(plain[warn + 1]).toBe("WARNING Decoded 0x400d1a2c: loop()");
  });

  it("leaves the dump readable when the decode fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    decodeBacktrace.mockRejectedValue(new Error("backend down"));

    try {
      append(el, CRASH);
      await flush();

      // Still painted (that needs no backend) but no frames invented.
      expect(lines(el).map(stripAnsi)).toEqual(CRASH);
    } finally {
      warn.mockRestore();
    }
  });

  it("paints a serial crash red, the way an OTA one already arrives", async () => {
    append(el, ["[12:00:00]boot", ...CRASH]);
    await flush();

    // The raw UART panic handler emits no colour, so it would otherwise
    // scroll past looking like ordinary output.
    const guru = lines(el).find((l) => l.includes("Guru Meditation"))!;
    expect(guru.startsWith("\u001b[1;31m")).toBe(true);
    expect(guru.endsWith("\u001b[0m")).toBe(true);
    // Only the crash, not the line before it.
    expect(lines(el)[0]).toBe("[12:00:00]boot");
  });

  it("does not repaint a crash that already carries colour", async () => {
    const red = CRASH.map((l) => `\u001b[1;31m${l}\u001b[0m`);

    append(el, red);
    await flush();

    expect(lines(el).filter((l) => l.includes("Guru Meditation"))[0]).toBe(red[0]);
  });

  it("does not decode a crash esphome already decoded inline", async () => {
    append(el, [
      "[12:00:01]Guru Meditation Error: crash",
      "[12:00:01]Backtrace: 0x400d1a2c:0x3ffc3f40",
      "[12:00:01]WARNING Decoded 0x400d1a2c: loop() at main.cpp:42",
      "[12:00:01]Rebooting...",
    ]);
    await flush();

    // An OTA session arrives decoded; asking again would splice a second
    // copy of the frames it already shows.
    expect(decodeBacktrace).not.toHaveBeenCalled();
  });

  it("decodes a crash loop's repeat without asking the backend again", async () => {
    append(el, CRASH);
    await flush();
    append(el, CRASH);
    await flush();

    // Same backtrace, so one child pays for both; each crash still renders
    // its frames.
    expect(decodeBacktrace).toHaveBeenCalledTimes(1);
    expect(
      lines(el)
        .map(stripAnsi)
        .filter((l) => l.startsWith("WARNING Decoded 0x400d1a2c"))
    ).toHaveLength(2);
  });

  it("splices correctly after the cap dropped lines off the front", async () => {
    // Overflow the 5000-line cap while the decode is in flight, so the region
    // sits at a lower index by the time the frames come back than it did when
    // it was collected. A crash loop on a chatty device is exactly this.
    let land: (v: unknown) => void = () => {};
    let started: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => (started = resolve));
    decodeBacktrace.mockImplementationOnce(async () => {
      started();
      await new Promise((resolve) => (land = resolve));
      return {
        decoded: [{ index: 2, text: "Decoded 0x400d1a2c: loop() at main.cpp:42" }],
        stale_build: false,
        unavailable_reason: "",
      };
    });

    append(
      el,
      Array.from({ length: 4900 }, (_, i) => `[12:00:00]before ${i}`)
    );
    append(el, CRASH);
    await inFlight;
    // Enough to push the cap and drop lines from the front, but not so much
    // that the crash itself scrolls out — it must still be there to decorate.
    append(
      el,
      Array.from({ length: 200 }, (_, i) => `[12:00:03]after ${i}`)
    );
    land(null);
    await flush();

    const plain = lines(el).map(stripAnsi);
    const at = plain.indexOf("WARNING Decoded 0x400d1a2c: loop() at main.cpp:42");
    expect(at).toBeGreaterThan(-1);
    // Still under the Backtrace line that produced it, not at the stale index.
    expect(plain[at - 1]).toContain("Backtrace:");
  });

  it("refuses to decorate a region the index no longer points at", async () => {
    // Fault injection: the index shift is correct in practice, so the only way
    // to reach the verify is to corrupt it. A crash loop repeats one dump with
    // the same marker and terminator, so the ends match at the wrong region
    // too — only the middle proves the position is stale.
    let land: (v: unknown) => void = () => {};
    let started: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => (started = resolve));
    decodeBacktrace.mockImplementationOnce(async () => {
      started();
      await new Promise((resolve) => (land = resolve));
      return {
        decoded: [{ index: 1, text: "Decoded 0x400d1111: first() at a.cpp:1" }],
        stale_build: false,
        unavailable_reason: "",
      };
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      append(el, ["Guru Meditation Error: crash", "PC: 0x400d1111", "Rebooting..."]);
      await inFlight;
      append(el, ["Guru Meditation Error: crash", "PC: 0x400d2222", "Rebooting..."]);
      // Point the first region's splice at the second one.
      (el as any)._crashDecode._indexShift = 3;
      land(null);
      await flush();

      // The frames name the first crash's addresses; landing them under the
      // second would attribute one crash's decode to another.
      expect(lines(el).map(stripAnsi)).not.toContain(
        "WARNING Decoded 0x400d1111: first() at a.cpp:1"
      );
      // And it says so: in bounds but not there is a drifted shift, which
      // would otherwise read as decoding quietly ceasing to work.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("not at its tracked position"),
        expect.anything()
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("does not decode a region the cap dropped before it terminated", async () => {
    // A flooding device: the region straddles a batch big enough that its head
    // is trimmed off the front before its terminator arrives. The splice can
    // never land, so buying a backend child for it is pure waste.
    append(
      el,
      Array.from({ length: 4990 }, (_, i) => `[12:00:00]before ${i}`)
    );
    append(el, CRASH.slice(0, 3));
    append(el, [
      CRASH[3],
      ...Array.from({ length: 4998 }, (_, i) => `[12:00:03]flood ${i}`),
    ]);
    await flush();

    expect(lines(el).some((l) => l.includes("Guru Meditation"))).toBe(false);
    expect(decodeBacktrace).not.toHaveBeenCalled();
  });

  it("hands the stale-build verdict to the report as a value", async () => {
    decodeBacktrace.mockResolvedValue({
      decoded: [{ index: 2, text: "Decoded 0x400d1a2c: loop()" }],
      stale_build: true,
      unavailable_reason: "",
    });
    const open = vi.fn();
    Object.defineProperty(el, "_crashReportDialog", { value: { open } });

    append(el, CRASH);
    await flush();
    (el as any)._openCrashReport();

    // Not re-read out of the warning line it injected: that would make report
    // copy load-bearing data.
    expect(open.mock.calls[0]![3]).toBe(true);
  });

  it("does not queue the next session behind a decode it will discard", async () => {
    let land: (v: unknown) => void = () => {};
    let started: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => (started = resolve));
    decodeBacktrace.mockImplementationOnce(async () => {
      started();
      await new Promise((resolve) => (land = resolve));
      return { decoded: [], stale_build: false, unavailable_reason: "" };
    });

    append(el, CRASH);
    await inFlight;
    (el as any)._clearLogs();

    // The abandoned decode is still hanging (a real one has up to 90s to go).
    // The new session's crash must not wait it out to be decorated.
    append(el, CRASH);
    await flush();

    expect(lines(el).map(stripAnsi)).toContain(
      "WARNING Decoded 0x400d1a2c: loop() at main.cpp:42"
    );
    land(null);
  });

  it("does not let a decode in flight at reset seed the next session", async () => {
    let land: (v: unknown) => void = () => {};
    let started: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => (started = resolve));
    decodeBacktrace.mockImplementationOnce(async () => {
      started();
      await new Promise((resolve) => (land = resolve));
      return {
        decoded: [{ index: 2, text: "Decoded 0x400d1a2c: stale() at old.cpp:1" }],
        stale_build: false,
        unavailable_reason: "",
      };
    });

    append(el, CRASH);
    // Reset only once the decode is genuinely in flight, so it is holding the
    // cache it was handed across the reset rather than racing to reach it.
    await inFlight;
    (el as any)._clearLogs();
    land(null);
    await flush();

    // The reset stands for a reflash: the same addresses now mean different
    // lines, so the pre-reflash decode must not answer for the new firmware.
    append(el, CRASH);
    await flush();
    expect(lines(el).map(stripAnsi)).not.toContain(
      "WARNING Decoded 0x400d1a2c: stale() at old.cpp:1"
    );
  });

  it("drops a decode that lands after the buffer was cleared", async () => {
    append(el, CRASH);
    (el as any)._clearLogs();
    await flush();

    // The lines it was decoding are gone; splicing into the new buffer would
    // put frames under whatever now sits at that index.
    expect(lines(el)).toEqual([]);
  });
});
