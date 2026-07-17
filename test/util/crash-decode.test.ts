import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { DecodeBacktraceResponse } from "../../src/api/types/devices.js";
import {
  type CrashDecodeCache,
  CrashRegionCollector,
  STALE_BUILD_LOG_LINE,
  decodeCrashRegion,
  interleaveDecoded,
  resetElfCache,
} from "../../src/util/crash-decode.js";
import { hostedDecoder, resetHostedDecoder } from "../../src/util/stacktrace-decoder.js";
import { stripAnsi } from "../../src/util/ansi-escapes.js";
import { normalizeLogLine } from "../../src/util/log-line.js";
import { CRASH_BLOCK_UNDECODED } from "../_crash-lines.js";

const reply = (over: Partial<DecodeBacktraceResponse> = {}): DecodeBacktraceResponse => ({
  decoded: [{ index: 2, text: "Decoded 0x400d9150: setup() at application.cpp:59" }],
  stale_build: false,
  unavailable_reason: "",
  local_config_hash: "build-1",
  ...over,
});

const fakeApi = (
  decodeBacktrace: (
    configuration: string,
    lines: string[]
  ) => Promise<DecodeBacktraceResponse>,
  over: Partial<ESPHomeAPI> = {}
) =>
  ({
    decodeBacktrace,
    ...over,
  }) as unknown as ESPHomeAPI;

describe("CrashRegionCollector", () => {
  const feed = (lines: string[]) => {
    const collector = new CrashRegionCollector();
    const regions = lines
      .map((line, i) => collector.push(line, normalizeLogLine(line), i))
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

    // Dressed as esphome logs prints it over OTA: warning-prefixed, yellow.
    expect(out.map(stripAnsi)).toEqual([
      "Guru Meditation Error: crash",
      "PC: 0x400d1a2c",
      "WARNING Decoded 0x400d1a2c: loop()",
      "Rebooting...",
    ]);
    expect(out[2]).toContain("\u001b[0;33m");
  });

  it("carries the colour but not a second prefix onto a continuation", () => {
    const out = interleaveDecoded(["PC: 0x1"], {
      decoded: [
        { index: 0, text: "Decoded 0x1: loop()" },
        { index: 0, text: " (inlined by) tick() at main.cpp:11" },
      ],
      staleBuild: false,
    });

    // The continuation belongs to the record above it.
    expect(out.map(stripAnsi)).toEqual([
      "PC: 0x1",
      "WARNING Decoded 0x1: loop()",
      " (inlined by) tick() at main.cpp:11",
    ]);
    expect(out[2]).toContain("\u001b[0;33m");
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

    const plain = out.map(stripAnsi);
    expect(plain.filter((l) => l === STALE_BUILD_LOG_LINE)).toHaveLength(1);
    expect(plain.indexOf(STALE_BUILD_LOG_LINE)).toBe(
      plain.indexOf("WARNING Decoded a") - 1
    );
  });

  it("keeps frames whose index falls outside the region", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const out = interleaveDecoded(["Guru: crash", "PC: 0x1"], {
        decoded: [
          { index: 1, text: "Decoded 0x1: loop()" },
          { index: 9, text: "Decoded 0x2: setup()" },
        ],
        staleBuild: false,
      });

      // Host and child disagreeing about the lines that were sent is worth
      // saying out loud, but the frames are still what the reader came for.
      expect(out.map(stripAnsi)).toEqual([
        "Guru: crash",
        "PC: 0x1",
        "WARNING Decoded 0x1: loop()",
        "WARNING Decoded 0x2: setup()",
      ]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
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
    // Both outlive a single decode by design (an ELF and a framed decoder are
    // expensive, and a crash loop reuses them), so a test that didn't reset
    // them would inherit the previous one's.
    resetElfCache();
    resetHostedDecoder();
    vi.restoreAllMocks();
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

  it("does not ask when esphome already decoded it inline", async () => {
    const decodeBacktrace = vi.fn();

    // An OTA session's crash arrives decoded; asking again would splice a
    // second copy of frames the log already shows.
    const decode = await decodeCrashRegion(
      fakeApi(decodeBacktrace),
      "ota.yaml",
      [
        "Guru Meditation Error: crash",
        "Backtrace: 0x400d9150:0x3ffb4f60",
        "WARNING Decoded 0x400d9150: setup() at application.cpp:59",
        "Rebooting...",
      ],
      cache
    );

    expect(decodeBacktrace).not.toHaveBeenCalled();
    expect(decode).toBeNull();
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

  describe("hosted decoder fallback", () => {
    // The remote-build shape: no CMake tree here, so the backend can't decode,
    // but the ELF was materialised locally and is all a decoder needs.
    const remoteBuilt = () =>
      vi.fn(async () => reply({ decoded: [], unavailable_reason: "elf_only" }));
    const region = ["Guru Meditation Error", "PC: 0x400d1a2c", "Rebooting..."];

    /** Assert the reason never reaches the decoder: no frame, no download. */
    const expectNoFallback = async (
      unavailable_reason: string,
      decoded: DecodeBacktraceResponse["decoded"] = []
    ) => {
      const firmwareDownloadBytes = vi.fn();
      const available = vi.spyOn(hostedDecoder(), "available");
      const api = fakeApi(async () => reply({ decoded, unavailable_reason }), {
        firmwareDownloadBytes,
      });

      await decodeCrashRegion(api, "a.yaml", region, cache);

      // `available()` frames the page; the download moves megabytes. Neither is
      // worth spending on a reason the decoder can do nothing with.
      expect(available).not.toHaveBeenCalled();
      expect(firmwareDownloadBytes).not.toHaveBeenCalled();
    };

    it("is not consulted when the backend decoded the region itself", async () => {
      // The whole point of trying the backend first: a locally built device
      // must not pay a page load and a multi-megabyte ELF transfer.
      await expectNoFallback("", reply().decoded);
    });

    it("is not consulted when there is nothing to decode", async () => {
      await expectNoFallback("no_backtrace");
    });

    it("is not consulted for a platform it could not decode either", async () => {
      await expectNoFallback("unsupported_platform");
    });

    it("is not consulted when the device was never built here", async () => {
      // `no_build` means the ELF isn't here either, so there is nothing to send.
      // This is the reason that must never join the fallback set.
      await expectNoFallback("no_build");
    });

    it("gives up quietly when the decoder can't be reached", async () => {
      // GitHub down, or an install with no internet. The raw dump has to stand;
      // a decode is an embellishment on a log, never a prerequisite for one.
      const firmwareDownloadBytes = vi.fn();
      const api = fakeApi(remoteBuilt(), { firmwareDownloadBytes });
      vi.spyOn(hostedDecoder(), "available").mockResolvedValue(false);

      expect(await decodeCrashRegion(api, "c.yaml", region, cache)).toBeNull();
      // ...and without spending a multi-megabyte download to find that out.
      expect(firmwareDownloadBytes).not.toHaveBeenCalled();
    });

    it("decodes through the hosted decoder when the backend can't", async () => {
      const api = fakeApi(remoteBuilt(), {
        firmwareDownloadBytes: async () => new ArrayBuffer(8),
      });
      vi.spyOn(hostedDecoder(), "available").mockResolvedValue(true);
      vi.spyOn(hostedDecoder(), "decode").mockResolvedValue([
        { address: 0x400d1a2c, function_name: "setup()", location: "application.cpp:59" },
      ]);

      const decode = await decodeCrashRegion(api, "c.yaml", region, cache);

      // Attributed to the line carrying the address, so it renders under it.
      expect(decode).toEqual({
        decoded: [
          { index: 1, text: "Decoded 0x400d1a2c: setup() at application.cpp:59" },
        ],
        staleBuild: false,
      });
    });

    it("carries the backend's stale-build verdict onto a hosted decode", async () => {
      // The backend knows both hashes whether or not it can decode, and frames
      // resolved against a build the device isn't running are confidently wrong.
      const api = fakeApi(
        async () =>
          reply({
            decoded: [],
            unavailable_reason: "elf_only",
            stale_build: true,
          }),
        { firmwareDownloadBytes: async () => new ArrayBuffer(8) }
      );
      vi.spyOn(hostedDecoder(), "available").mockResolvedValue(true);
      vi.spyOn(hostedDecoder(), "decode").mockResolvedValue([
        { address: 0x400d1a2c, function_name: "setup()", location: "application.cpp:59" },
      ]);

      expect((await decodeCrashRegion(api, "c.yaml", region, cache))?.staleBuild).toBe(
        true
      );
    });

    it("drops a frame whose address is in no line rather than guessing", async () => {
      const api = fakeApi(remoteBuilt(), {
        firmwareDownloadBytes: async () => new ArrayBuffer(8),
      });
      vi.spyOn(hostedDecoder(), "available").mockResolvedValue(true);
      vi.spyOn(hostedDecoder(), "decode").mockResolvedValue([
        { address: 0xdeadbeef, function_name: "nowhere()", location: "" },
      ]);

      expect(await decodeCrashRegion(api, "c.yaml", region, cache)).toBeNull();
    });

    it("attributes a frame by whole address token, not a hex substring", async () => {
      // The address appears only inside a longer hex run (an ELF SHA line), never
      // as a token. Matching by substring would misattribute the frame there; it
      // must be dropped instead.
      const api = fakeApi(remoteBuilt(), {
        firmwareDownloadBytes: async () => new ArrayBuffer(8),
      });
      vi.spyOn(hostedDecoder(), "available").mockResolvedValue(true);
      vi.spyOn(hostedDecoder(), "decode").mockResolvedValue([
        { address: 0x4201b6e0, function_name: "setup()", location: "a.cpp:1" },
      ]);

      const noToken = [
        "Guru Meditation Error",
        // The hex sits inside a longer run, and once trailed by a word char
        // (which ADDRESS_RE's \b rejects too), so neither is a token.
        "ELF file SHA256: 0x4201b6e0abcdef1234567890",
        "note 0x4201b6e0x",
        "Rebooting...",
      ];
      expect(await decodeCrashRegion(api, "c.yaml", noToken, cache)).toBeNull();
    });

    it("attributes a frame to the line whose backtrace token carries its address", async () => {
      const api = fakeApi(remoteBuilt(), {
        firmwareDownloadBytes: async () => new ArrayBuffer(8),
      });
      vi.spyOn(hostedDecoder(), "available").mockResolvedValue(true);
      vi.spyOn(hostedDecoder(), "decode").mockResolvedValue([
        { address: 0x4201b6e0, function_name: "setup()", location: "a.cpp:1" },
      ]);

      const withToken = [
        "Guru Meditation Error",
        "Backtrace: 0x4201b6e0:0x3fca0000",
        "Rebooting...",
      ];
      const decode = await decodeCrashRegion(api, "c.yaml", withToken, cache);
      expect(decode?.decoded).toEqual([
        { index: 1, text: "Decoded 0x4201b6e0: setup() at a.cpp:1" },
      ]);
    });

    it("refetches the ELF after a rebuild rather than decoding the old one", async () => {
      // The scenario this feature lives in: the user is watching a crash loop,
      // edits the config, rebuilds and installs, and it crashes again. The
      // backend now reports stale_build false (the device matches the new local
      // build), so nothing else would catch us serving the previous build's
      // bytes, and the frames would name the wrong lines with no caveat.
      const firmwareDownloadBytes = vi.fn(async () => new ArrayBuffer(8));
      let hash = "build-1";
      const api = fakeApi(
        async () =>
          reply({
            decoded: [],
            unavailable_reason: "elf_only",
            local_config_hash: hash,
          }),
        { firmwareDownloadBytes }
      );
      vi.spyOn(hostedDecoder(), "available").mockResolvedValue(true);
      vi.spyOn(hostedDecoder(), "decode").mockResolvedValue([
        { address: 0x400d1a2c, function_name: "setup()", location: "application.cpp:59" },
      ]);

      await decodeCrashRegion(api, "r.yaml", [...region, "boot 1"], cache);
      hash = "build-2"; // the user rebuilt and installed
      await decodeCrashRegion(api, "r.yaml", [...region, "boot 2"], cache);

      expect(firmwareDownloadBytes).toHaveBeenCalledTimes(2);
    });

    it("keeps only the live build's ELF, not one per rebuild", async () => {
      // Each entry is 5-18MB, and every build but the newest is provably dead:
      // the key names the build, so nothing asks for the old one again. Keeping
      // them would strand a build's bytes per rebuild for the life of the tab.
      const firmwareDownloadBytes = vi.fn(async () => new ArrayBuffer(8));
      let hash = "build-1";
      const api = fakeApi(
        async () =>
          reply({
            decoded: [],
            unavailable_reason: "elf_only",
            local_config_hash: hash,
          }),
        { firmwareDownloadBytes }
      );
      vi.spyOn(hostedDecoder(), "available").mockResolvedValue(true);
      vi.spyOn(hostedDecoder(), "decode").mockResolvedValue([
        { address: 0x400d1a2c, function_name: "setup()", location: "application.cpp:59" },
      ]);

      await decodeCrashRegion(api, "e.yaml", [...region, "boot 1"], cache);
      hash = "build-2";
      await decodeCrashRegion(api, "e.yaml", [...region, "boot 2"], cache);
      hash = "build-1"; // back to the first build: its bytes must be gone
      await decodeCrashRegion(api, "e.yaml", [...region, "boot 3"], cache);

      expect(firmwareDownloadBytes).toHaveBeenCalledTimes(3);
    });

    it("does not cache the ELF when the build can't be identified", async () => {
      // An empty hash (ELF present, no build_info.json) can't tell two builds
      // apart, so caching under a hash-less key would serve stale bytes after a
      // rebuild. Fetch fresh instead.
      const firmwareDownloadBytes = vi.fn(async () => new ArrayBuffer(8));
      const api = fakeApi(
        async () =>
          reply({ decoded: [], unavailable_reason: "elf_only", local_config_hash: "" }),
        { firmwareDownloadBytes }
      );
      vi.spyOn(hostedDecoder(), "available").mockResolvedValue(true);
      vi.spyOn(hostedDecoder(), "decode").mockResolvedValue([
        { address: 0x400d1a2c, function_name: "setup()", location: "application.cpp:59" },
      ]);

      await decodeCrashRegion(api, "h.yaml", [...region, "boot 1"], cache);
      await decodeCrashRegion(api, "h.yaml", [...region, "boot 2"], cache);

      expect(firmwareDownloadBytes).toHaveBeenCalledTimes(2);
    });

    it("downloads the ELF once across a crash loop", async () => {
      const firmwareDownloadBytes = vi.fn(async () => new ArrayBuffer(8));
      const api = fakeApi(remoteBuilt(), { firmwareDownloadBytes });
      vi.spyOn(hostedDecoder(), "available").mockResolvedValue(true);
      vi.spyOn(hostedDecoder(), "decode").mockResolvedValue([
        { address: 0x400d1a2c, function_name: "setup()", location: "application.cpp:59" },
      ]);

      // Distinct regions, so the region cache can't be what saves the download.
      await decodeCrashRegion(api, "loop.yaml", [...region, "boot 1"], cache);
      await decodeCrashRegion(api, "loop.yaml", [...region, "boot 2"], cache);

      expect(firmwareDownloadBytes).toHaveBeenCalledTimes(1);
    });
  });

  it("does not re-ask for a region the backend already declined", async () => {
    const decodeBacktrace = vi.fn(async () =>
      reply({ decoded: [], unavailable_reason: "unsupported_platform" })
    );
    const api = fakeApi(decodeBacktrace);
    const region = ["Guru: x", "PC: 0x400d1a2c", "Rebooting..."];

    await decodeCrashRegion(api, "bk.yaml", region, cache);
    await decodeCrashRegion(api, "bk.yaml", region, cache);
    await decodeCrashRegion(api, "bk.yaml", region, cache);

    // A platform it can't decode still costs it a child to find that out, so
    // a crash loop on one must not pay per crash.
    expect(decodeBacktrace).toHaveBeenCalledTimes(1);
  });

  it("asks again after the backend failed to decode, as after a throw", async () => {
    const decodeBacktrace = vi
      .fn<() => Promise<DecodeBacktraceResponse>>()
      .mockResolvedValueOnce(reply({ decoded: [], unavailable_reason: "helper_failed" }))
      .mockResolvedValue(reply());
    const api = fakeApi(decodeBacktrace);
    const region = ["Guru: x", "PC: 0x400d1a2c", "Rebooting..."];

    expect(await decodeCrashRegion(api, "f.yaml", region, cache)).toBeNull();
    // A child killed under memory pressure reports through the reply rather
    // than by throwing, but it is the same fact about the backend: it says
    // nothing about whether this region can be decoded.
    expect(await decodeCrashRegion(api, "f.yaml", region, cache)).not.toBeNull();
    expect(decodeBacktrace).toHaveBeenCalledTimes(2);
  });

  it("keeps a partial decode rather than re-spawning for the same frames", async () => {
    const decodeBacktrace = vi.fn(async () =>
      reply({ unavailable_reason: "decode_failed" })
    );
    const api = fakeApi(decodeBacktrace);
    const region = ["Guru: x", "PC: 0x400d1a2c", "Rebooting..."];

    const first = await decodeCrashRegion(api, "g.yaml", region, cache);
    const second = await decodeCrashRegion(api, "g.yaml", region, cache);

    // The decoder latched off partway but returned the frames it had. Those
    // are real, so a repeat shows them again rather than buying a second child.
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(decodeBacktrace).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failure, which says nothing about the region", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const decodeBacktrace = vi
      .fn<() => Promise<DecodeBacktraceResponse>>()
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValue(reply());
    const api = fakeApi(decodeBacktrace);
    const region = ["Guru: x", "PC: 0x400d1a2c", "Rebooting..."];

    try {
      expect(await decodeCrashRegion(api, "e.yaml", region, cache)).toBeNull();
      // Unlike a decline, a failure is about the backend, not the region: the
      // next crash may land while it is healthy again.
      expect(await decodeCrashRegion(api, "e.yaml", region, cache)).not.toBeNull();
      expect(decodeBacktrace).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
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
