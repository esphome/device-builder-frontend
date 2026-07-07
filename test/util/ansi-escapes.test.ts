import { describe, expect, it } from "vitest";
import { stripAnsi, stripAnsiSgr } from "../../src/util/ansi-escapes.js";

describe("stripAnsiSgr", () => {
  it("removes color codes", () => {
    expect(stripAnsiSgr("\u001b[31mred\u001b[0m")).toBe("red");
  });

  it("removes multi-parameter codes", () => {
    expect(stripAnsiSgr("\u001b[1;32mbold green\u001b[0m")).toBe("bold green");
  });

  it("preserves plain text", () => {
    expect(stripAnsiSgr("no escapes here")).toBe("no escapes here");
  });

  it("returns empty string unchanged", () => {
    expect(stripAnsiSgr("")).toBe("");
  });

  it("strips multiple interleaved codes", () => {
    const input = "\u001b[31mfoo\u001b[0m \u001b[32mbar\u001b[0m";
    expect(stripAnsiSgr(input)).toBe("foo bar");
  });

  it("strips the literal-text \\033 form some build pipelines emit", () => {
    /* PlatformIO's filter chain (and a few other tools) feed the
       firmware-job follow stream the literal six-character sequence
       ``\\033[32m`` instead of the real ESC byte. The saved download
       was keeping those visible until the regex grew this branch. */
    expect(stripAnsiSgr("\\033[32mINFO\\033[0m hello")).toBe("INFO hello");
    expect(stripAnsiSgr("\\033[0;35m[C][i2c.idf:092]: I2C\\033[0m")).toBe(
      "[C][i2c.idf:092]: I2C"
    );
  });

  it("leaves non-SGR escapes untouched, unlike stripAnsi", () => {
    /* The contract split: stripAnsiSgr removes colours and nothing
       else, while stripAnsi discards every escape shape. An erase-line
       (CSI ``K``) sequence pins the difference. */
    const input = "\u001b[2K\u001b[31mflashing\u001b[0m";
    expect(stripAnsiSgr(input)).toBe("\u001b[2Kflashing");
    expect(stripAnsi(input)).toBe("flashing");
  });
});
