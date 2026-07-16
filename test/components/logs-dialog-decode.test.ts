/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeLogsDialog } from "../../src/components/logs-dialog.js";
import { STALE_BUILD_LOG_LINE } from "../../src/util/crash-decode.js";

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
    await (el as any)._decodeChain;
    await el.updateComplete;
  };

  it("splices the decode in after the line that produced it", async () => {
    append(el, ["[12:00:00]boot", ...CRASH, "[12:00:02]rebooted"]);
    await flush();

    const at = lines(el).indexOf("Decoded 0x400d1a2c: loop() at main.cpp:42");
    // Directly under the Backtrace line it decodes, the way esphome logs
    // shows it, rather than appended after the reboot.
    expect(at).toBeGreaterThan(-1);
    expect(lines(el)[at - 1]).toContain("Backtrace:");
    expect(lines(el)[at + 1]).toContain("Rebooting...");
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

    const warn = lines(el).indexOf(STALE_BUILD_LOG_LINE);
    expect(warn).toBeGreaterThan(-1);
    expect(lines(el)[warn + 1]).toBe("Decoded 0x400d1a2c: loop()");
  });

  it("leaves the raw dump untouched when the decode fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    decodeBacktrace.mockRejectedValue(new Error("backend down"));

    try {
      append(el, CRASH);
      await flush();

      expect(lines(el)).toEqual(CRASH);
    } finally {
      warn.mockRestore();
    }
  });

  it("decodes a crash loop's repeat without asking the backend again", async () => {
    append(el, CRASH);
    await flush();
    append(el, CRASH);
    await flush();

    // Same backtrace, so one child pays for both; each crash still renders
    // its frames.
    expect(decodeBacktrace).toHaveBeenCalledTimes(1);
    expect(lines(el).filter((l) => l.startsWith("Decoded 0x400d1a2c"))).toHaveLength(2);
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
