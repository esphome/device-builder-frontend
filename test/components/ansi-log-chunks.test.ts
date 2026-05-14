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

  it("keeps lines above the progress bar despite empty-CR chunks (regression: #840)", () => {
    const chunks = [
      "INFO ESPHome 2026.6.0-dev\n",
      "INFO Reading config\n",
      "WARNING GPIO5 is a strapping PIN\n",
      "Attaching external pullup/down resistors\n",
      "\u001b[K\r",
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
    const chunks = ["Downloading 100%\r", "\n", "INFO Build finished\n"];
    expect(chunksToVisualLines(chunks)).toEqual([
      "Downloading 100%",
      "INFO Build finished",
    ]);
  });

  it("strips leading non-SGR ANSI sequences but keeps SGR colour codes", () => {
    const chunks = ["\u001b[K\u001b[33mWARNING something\n"];
    expect(chunksToVisualLines(chunks)).toEqual(["\u001b[33mWARNING something"]);
  });

  it("drops empty-after-cleanup chunks", () => {
    const chunks = ["INFO a\n", "   \n", "INFO b\n"];
    expect(chunksToVisualLines(chunks)).toEqual(["INFO a", "INFO b"]);
  });
});
