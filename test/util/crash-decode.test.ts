import { describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { DecodeBacktraceResponse } from "../../src/api/types/devices.js";
import { decodeCrashBacktrace, needsBackendDecode } from "../../src/util/crash-decode.js";
import { scrapeCrashData } from "../../src/util/crash-report.js";
import { CRASH_BLOCK, CRASH_BLOCK_UNDECODED } from "../_crash-lines.js";

const SERIAL = scrapeCrashData(CRASH_BLOCK_UNDECODED);

const reply = (over: Partial<DecodeBacktraceResponse> = {}): DecodeBacktraceResponse => ({
  decoded: [
    {
      index: 3,
      text: "Decoded 0x400d9150: esphome::Application::setup() at esphome/core/application.cpp:59",
    },
  ],
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

describe("needsBackendDecode", () => {
  it("asks when a serial crash carries addresses but no inline decode", () => {
    expect(needsBackendDecode(SERIAL)).toBe(true);
  });

  it("does not ask when the session already decoded inline", () => {
    // esphome logs decodes on the way in, so the backtrace is already there.
    expect(needsBackendDecode(scrapeCrashData(CRASH_BLOCK))).toBe(false);
  });

  it("does not ask when no crash was found", () => {
    expect(needsBackendDecode(scrapeCrashData(["[I][app:029]: booted"]))).toBe(false);
  });

  it("does not ask when the crash carries no address to decode", () => {
    expect(
      needsBackendDecode(scrapeCrashData(["abort() was called", "Rebooting..."]))
    ).toBe(false);
  });
});

describe("decodeCrashBacktrace", () => {
  it("sends the normalized excerpt and returns the decoded frames", async () => {
    const seen: string[][] = [];
    const api = fakeApi(async (_configuration, lines) => {
      seen.push(lines);
      return reply();
    });

    const decode = await decodeCrashBacktrace(api, "kitchen.yaml", SERIAL);

    expect(seen[0]).toEqual(SERIAL.excerpt);
    // Same shape scrape.decodedFrames carries for an inline decode: the
    // `Decoded ` prefix stripped, ready to merge.
    expect(decode?.frames).toEqual([
      "0x400d9150: esphome::Application::setup() at esphome/core/application.cpp:59",
    ]);
    expect(decode?.staleBuild).toBe(false);
  });

  it("folds inlined-frame continuations into their frame", async () => {
    const api = fakeApi(async () =>
      reply({
        decoded: [
          { index: 3, text: "Decoded 0x400d9150: setup() at application.cpp:59" },
          { index: 3, text: " (inlined by) tick() at application.cpp:11" },
        ],
      })
    );

    const decode = await decodeCrashBacktrace(api, "kitchen.yaml", SERIAL);

    expect(decode?.frames).toEqual([
      "0x400d9150: setup() at application.cpp:59\n  (inlined by) tick() at application.cpp:11",
    ]);
  });

  it("reports a stale build so the report can caption the frames", async () => {
    const api = fakeApi(async () => reply({ stale_build: true }));

    const decode = await decodeCrashBacktrace(api, "kitchen.yaml", SERIAL);

    expect(decode?.staleBuild).toBe(true);
  });

  it("skips the call entirely when the session already decoded", async () => {
    const decodeBacktrace = vi.fn();

    const decode = await decodeCrashBacktrace(
      fakeApi(decodeBacktrace),
      "kitchen.yaml",
      scrapeCrashData(CRASH_BLOCK)
    );

    expect(decodeBacktrace).not.toHaveBeenCalled();
    expect(decode).toBeNull();
  });

  it("returns null when the backend has no build to decode against", async () => {
    const api = fakeApi(async () =>
      reply({ decoded: [], unavailable_reason: "no_build" })
    );

    expect(await decodeCrashBacktrace(api, "kitchen.yaml", SERIAL)).toBeNull();
  });

  it("returns null rather than throwing when the command fails", async () => {
    // The report is still worth filing without a decode.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = fakeApi(async () => {
      throw new Error("timed out");
    });

    expect(await decodeCrashBacktrace(api, "kitchen.yaml", SERIAL)).toBeNull();
  });
});
