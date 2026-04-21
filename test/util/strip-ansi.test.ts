import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../src/util/strip-ansi.js";

describe("stripAnsi", () => {
  it("removes color codes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
  });

  it("removes multi-parameter codes", () => {
    expect(stripAnsi("\u001b[1;32mbold green\u001b[0m")).toBe("bold green");
  });

  it("preserves plain text", () => {
    expect(stripAnsi("no escapes here")).toBe("no escapes here");
  });

  it("returns empty string unchanged", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("strips multiple interleaved codes", () => {
    const input = "\u001b[31mfoo\u001b[0m \u001b[32mbar\u001b[0m";
    expect(stripAnsi(input)).toBe("foo bar");
  });
});
