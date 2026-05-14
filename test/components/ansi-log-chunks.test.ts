import { describe, expect, it } from "vitest";
import { chunksToVisualLines } from "../../src/components/ansi-log.js";

describe("chunksToVisualLines", () => {
  it("appends \\n-terminated chunks as discrete lines", () => {
    const chunks = ["INFO ESPHome 2026.6.0-dev\n", "INFO Reading config\n"];
    expect(chunksToVisualLines(chunks)).toEqual([
      "INFO ESPHome 2026.6.0-dev",
      "INFO Reading config",
    ]);
  });

  it("coalesces \\r\\n the same as \\n (Windows print)", () => {
    const chunks = ["WARNING GPIO5\r\n", "Attaching resistors\r\n"];
    expect(chunksToVisualLines(chunks)).toEqual(["WARNING GPIO5", "Attaching resistors"]);
  });

  it("overwrites the previous progress tick on consecutive \\r chunks", () => {
    const chunks = [
      "Downloading [#] 1%\r",
      "Downloading [##] 2%\r",
      "Downloading [###] 3%\r",
    ];
    expect(chunksToVisualLines(chunks)).toEqual(["Downloading [###] 3%"]);
  });

  it("appends the first \\r chunk after a \\n line — no over-pop (regression: #840)", () => {
    /* The bug: when a control-only chunk like ``\x1b[K\r`` arrived
       between a real log line and the first progress tick, the
       prevEndedInCR flag was set without anything pushed; the next
       progress chunk would then pop the real log line above it
       instead of starting a fresh progress slot. Repeated across
       every tick, the WARNING block above the bar disappeared one
       line per tick. */
    const chunks = [
      "INFO ESPHome 2026.6.0-dev\n",
      "INFO Reading config\n",
      "WARNING GPIO5 is a strapping PIN\n",
      "Attaching external pullup/down resistors\n",
      "\u001b[K\r", // pure cursor-home + erase, between print and first tick
      "Downloading [#] 1%\r",
      "\u001b[K\r",
      "Downloading [##] 2%\r",
      "\u001b[K\r",
      "Downloading [###] 3%\r",
    ];
    expect(chunksToVisualLines(chunks)).toEqual([
      "INFO ESPHome 2026.6.0-dev",
      "INFO Reading config",
      "WARNING GPIO5 is a strapping PIN",
      "Attaching external pullup/down resistors",
      "Downloading [###] 3%",
    ]);
  });

  it("treats a bare \\r chunk as a no-op (no pop, no push, prev unchanged)", () => {
    const chunks = ["Downloading 1%\r", "\r", "Downloading 2%\r"];
    expect(chunksToVisualLines(chunks)).toEqual(["Downloading 2%"]);
  });

  it("a bare \\n chunk after a \\r-terminated line finalises the overwrite", () => {
    /* If a standalone \n arrives after a \r-terminated content line
       (i.e. the chunker couldn't coalesce the pair), it should
       finalise the prior line rather than pop it on the next chunk. */
    const chunks = ["Downloading 100%\r", "\n", "INFO Build finished\n"];
    expect(chunksToVisualLines(chunks)).toEqual([
      "Downloading 100%",
      "INFO Build finished",
    ]);
  });

  it("strips leading non-SGR ANSI sequences but keeps SGR colour codes", () => {
    /* Leading erase-line / cursor-move escapes are noise; leading SGR
       (``\u001b[33m``) carries the WARNING colour that ESPHome opens on
       the first line of a multi-line record. */
    const chunks = ["\u001b[K\u001b[33mWARNING something\n"];
    expect(chunksToVisualLines(chunks)).toEqual(["\u001b[33mWARNING something"]);
  });

  it("drops empty-after-cleanup chunks", () => {
    const chunks = ["INFO a\n", "   \n", "INFO b\n"];
    expect(chunksToVisualLines(chunks)).toEqual(["INFO a", "INFO b"]);
  });
});
