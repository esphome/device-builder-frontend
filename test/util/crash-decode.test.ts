import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { DecodeBacktraceResponse } from "../../src/api/types/devices.js";
import {
  type CrashDecodeCache,
  CrashRegionCollector,
  STALE_BUILD_LOG_LINE,
  decodeCrashRegion,
  interleaveDecoded,
} from "../../src/util/crash-decode.js";
import { CRASH_BLOCK_UNDECODED } from "../_crash-lines.js";

const reply = (over: Partial<DecodeBacktraceResponse> = {}): DecodeBacktraceResponse => ({
  decoded: [{ index: 2, text: "Decoded 0x400d9150: setup() at application.cpp:59" }],
  stale_build: false,
  unavailable_reason: "",
  ...over,
});

const fakeApi = (
  decodeBacktrace: (
    configuration: string,
    lines: string[]
  ) => Promise<DecodeBacktraceResponse>
) => ({ decodeBacktrace }) as unknown as ESPHomeAPI;

describe("CrashRegionCollector", () => {
  const feed = (lines: string[]) => {
    const collector = new CrashRegionCollector();
    const regions = lines
      .map((line, i) => collector.push(line, i))
      .filter((r) => r !== null);
    return { collector, regions };
  };

  it("collects from the crash marker to the terminator", () => {
    const { regions } = feed([
      "[12:00:00]booting",
      ...CRASH_BLOCK_UNDECODED,
      "[12:00:11]booted",
    ]);

    expect(regions).toHaveLength(1);
    // Starts at the marker, not the line before it, and stops at Rebooting.
    expect(regions[0]!.raw[0]).toContain("Guru Meditation");
    expect(regions[0]!.raw[regions[0]!.raw.length - 1]).toBe("Rebooting...");
    expect(regions[0]!.startIndex).toBe(1);
  });

  it("yields nothing until the region terminates", () => {
    const { regions, collector } = feed([
      "Guru Meditation Error: crash",
      "PC: 0x400d1a2c",
    ]);

    expect(regions).toEqual([]);
    // Still held, so a half-streamed crash is never sent for decoding.
    expect(collector.take()!.raw).toHaveLength(2);
  });

  it("keeps raw lines so they can be found in the buffer again", () => {
    const { regions } = feed([
      "[12:00:01]Guru Meditation Error: crash",
      "[12:00:02]Rebooting...",
    ]);

    // Detection normalizes, but what comes back is verbatim.
    expect(regions[0]!.raw[0]).toBe("[12:00:01]Guru Meditation Error: crash");
  });

  it("cuts a runaway region off rather than buffering forever", () => {
    const { regions } = feed([
      "Guru Meditation Error: crash",
      ...Array.from({ length: 80 }, (_, i) => `filler ${i}`),
    ]);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.raw).toHaveLength(61);
  });

  it("collects a second crash after the first completes", () => {
    const { regions } = feed([
      "Guru Meditation Error: one",
      "Rebooting...",
      "Guru Meditation Error: two",
      "Rebooting...",
    ]);

    expect(regions).toHaveLength(2);
    expect(regions[1]!.startIndex).toBe(2);
  });
});

describe("interleaveDecoded", () => {
  it("puts the decoder's output after the line that produced it", () => {
    const raw = ["Guru Meditation Error: crash", "PC: 0x400d1a2c", "Rebooting..."];

    const out = interleaveDecoded(raw, {
      decoded: [{ index: 1, text: "Decoded 0x400d1a2c: loop()" }],
      staleBuild: false,
    });

    expect(out).toEqual([
      "Guru Meditation Error: crash",
      "PC: 0x400d1a2c",
      "Decoded 0x400d1a2c: loop()",
      "Rebooting...",
    ]);
  });

  it("captions a stale build once, above the frames it qualifies", () => {
    const raw = ["Guru Meditation Error: crash", "PC: 0x1", "BT: 0x2"];

    const out = interleaveDecoded(raw, {
      decoded: [
        { index: 1, text: "Decoded a" },
        { index: 2, text: "Decoded b" },
      ],
      staleBuild: true,
    });

    expect(out.filter((l) => l === STALE_BUILD_LOG_LINE)).toHaveLength(1);
    expect(out.indexOf(STALE_BUILD_LOG_LINE)).toBe(out.indexOf("Decoded a") - 1);
  });

  it("returns the region untouched when nothing decoded", () => {
    const raw = ["Guru Meditation Error: crash", "Rebooting..."];

    expect(interleaveDecoded(raw, { decoded: [], staleBuild: false })).toEqual(raw);
  });
});

describe("decodeCrashRegion", () => {
  let cache: CrashDecodeCache;

  beforeEach(() => {
    cache = new Map();
  });

  it("sends normalized lines and returns the decode", async () => {
    const seen: string[][] = [];
    const api = fakeApi(async (_configuration, lines) => {
      seen.push(lines);
      return reply();
    });

    const decode = await decodeCrashRegion(
      api,
      "a.yaml",
      [
        "[12:00:01]Guru Meditation Error: crash",
        "[12:00:01]PC: 0x400d1a2c",
        "[12:00:01]Backtrace: 0x400d9150:0x3ffb4f60",
      ],
      cache
    );

    // The backend's contract is ANSI- and timestamp-free lines.
    expect(seen[0]![0]).toBe("Guru Meditation Error: crash");
    expect(decode?.decoded).toHaveLength(1);
  });

  it("does not ask when the region carries no address", async () => {
    const decodeBacktrace = vi.fn();

    const decode = await decodeCrashRegion(
      fakeApi(decodeBacktrace),
      "a.yaml",
      ["abort() was called", "Rebooting..."],
      cache
    );

    expect(decodeBacktrace).not.toHaveBeenCalled();
    expect(decode).toBeNull();
  });

  it("reuses the decode for an identical region, so a crash loop pays once", async () => {
    const region = ["Guru Meditation Error: crash", "PC: 0x400d1a2c", "Rebooting..."];
    const decodeBacktrace = vi.fn(async () => reply());
    const api = fakeApi(decodeBacktrace);

    const first = await decodeCrashRegion(api, "loop.yaml", region, cache);
    const second = await decodeCrashRegion(api, "loop.yaml", region, cache);
    const third = await decodeCrashRegion(api, "loop.yaml", region, cache);

    // One spawn, but every crash still renders decoded.
    expect(decodeBacktrace).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("decodes a different crash in the same session", async () => {
    const decodeBacktrace = vi.fn(async () => reply());
    const api = fakeApi(decodeBacktrace);

    const a = ["Guru Meditation: a", "PC: 0x400d1a2c", "Rebooting..."];
    const b = ["Guru Meditation: b", "PC: 0x400d9999", "Rebooting..."];
    await decodeCrashRegion(api, "b.yaml", a, cache);
    await decodeCrashRegion(api, "b.yaml", b, cache);

    expect(decodeBacktrace).toHaveBeenCalledTimes(2);
  });

  it("returns null when the backend has no build to decode against", async () => {
    const api = fakeApi(async () =>
      reply({ decoded: [], unavailable_reason: "no_build" })
    );

    const region = ["Guru: x", "PC: 0x400d1a2c"];

    expect(await decodeCrashRegion(api, "c.yaml", region, cache)).toBeNull();
  });

  it("returns null rather than throwing when the command fails", async () => {
    // The raw dump stays readable without a decode.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = fakeApi(async () => {
      throw new Error("timed out");
    });

    try {
      const region = ["Guru: y", "PC: 0x400dffff"];

      expect(await decodeCrashRegion(api, "d.yaml", region, cache)).toBeNull();
    } finally {
      // No restoreMocks in the vitest config, so a spy outlives its test.
      warn.mockRestore();
    }
  });
});
