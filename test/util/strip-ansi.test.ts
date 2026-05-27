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

  it("strips the literal-text \\033 form some build pipelines emit", () => {
    /* PlatformIO's filter chain (and a few other tools) feed the
       firmware-job follow stream the literal six-character sequence
       ``\\033[32m`` instead of the real ESC byte. The saved download
       was keeping those visible until the regex grew this branch. */
    expect(stripAnsi("\\033[32mINFO\\033[0m hello")).toBe("INFO hello");
    expect(stripAnsi("\\033[0;35m[C][i2c.idf:092]: I2C\\033[0m")).toBe(
      "[C][i2c.idf:092]: I2C"
    );
  });
});
