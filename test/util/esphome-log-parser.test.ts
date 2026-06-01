import { describe, expect, it } from "vitest";
import { ESPHomeLogParser } from "../../src/util/esphome-log-parser.js";

// Build the ESC byte at runtime so the test source stays free of raw
// control characters (the device sends real ESC; the renderer accepts it).
const ESC = String.fromCharCode(0x1b);
const RESET = `${ESC}[0m`;
const MAGENTA = `${ESC}[0;35m`; // [C] config color

describe("ESPHomeLogParser", () => {
  it("appends a reset to an entry line that opened color but never closed it", () => {
    const p = new ESPHomeLogParser();
    // First line of a multi-line dump_config block: color opens, no reset.
    expect(p.parseLine(`${MAGENTA}[C][wifi:1248]: WiFi:`)).toBe(
      `${MAGENTA}[C][wifi:1248]: WiFi:${RESET}`
    );
  });

  it("re-applies the entry color + prefix to an indented continuation line", () => {
    const p = new ESPHomeLogParser();
    p.parseLine(`${MAGENTA}[C][wifi:1248]: WiFi:`);
    // The device sends continuation lines indented, with no color/header.
    // The parser rebuilds them to match the backend's per-line output:
    // <color>[prefix]: <content><reset>.
    expect(p.parseLine("  Local MAC: 24:4C:AB:03:E6:B8")).toBe(
      `${MAGENTA}[C][wifi:1248]:   Local MAC: 24:4C:AB:03:E6:B8${RESET}`
    );
    expect(p.parseLine("  Hostname: 'ol'")).toBe(
      `${MAGENTA}[C][wifi:1248]:   Hostname: 'ol'${RESET}`
    );
  });

  it("matches the backend esphome-logs per-line shape once timestamped", () => {
    // What devices/logs (backend) emits vs what WebSerial + this parser
    // produce must be identical after the caller prepends the timestamp.
    const ts = "[12:09:30.050]";
    const p = new ESPHomeLogParser();
    p.parseLine(`${MAGENTA}[C][wifi:1526]: WiFi:`);
    const got = ts + p.parseLine("  Local MAC: 24:4C:AB:03:E6:B8");
    expect(got).toBe(
      `${ts}${MAGENTA}[C][wifi:1526]:   Local MAC: 24:4C:AB:03:E6:B8${RESET}`
    );
  });

  it("leaves a self-contained entry line (already reset) untouched", () => {
    const p = new ESPHomeLogParser();
    const line = `${MAGENTA}[C][wifi:1248]:   Hostname: 'ol'${RESET}`;
    expect(p.parseLine(line)).toBe(line);
  });

  it("passes plain non-ESPHome lines through unchanged (esptool / pio output)", () => {
    const p = new ESPHomeLogParser();
    expect(p.parseLine("Writing at 0x0... (2%)")).toBe("Writing at 0x0... (2%)");
    expect(p.parseLine("Compiling .pioenvs/ol/src/main.cpp.o")).toBe(
      "Compiling .pioenvs/ol/src/main.cpp.o"
    );
  });

  it("does not invent a prefix for a continuation before any entry is seen", () => {
    const p = new ESPHomeLogParser();
    // Joined mid-record: indented, no entry context yet → pass through.
    expect(p.parseLine("  orphan continuation")).toBe("  orphan continuation");
  });

  it("switches prefix/color when a new entry interrupts a block", () => {
    const p = new ESPHomeLogParser();
    p.parseLine(`${MAGENTA}[C][wifi:1248]: WiFi:`);
    const green = `${ESC}[0;32m`;
    // A new [I] entry resets the carried prefix/color...
    p.parseLine(`${green}[I][app:151]: ESPHome version`);
    // ...so the next continuation inherits the new entry, not the old one.
    expect(p.parseLine("  detail line")).toBe(
      `${green}[I][app:151]:   detail line${RESET}`
    );
  });

  it("leaves blank continuation lines as-is", () => {
    const p = new ESPHomeLogParser();
    p.parseLine(`${MAGENTA}[C][wifi:1248]: WiFi:`);
    expect(p.parseLine("   ")).toBe("   ");
  });

  it("preserves carried color across an empty line within a block", () => {
    const p = new ESPHomeLogParser();
    p.parseLine(`${MAGENTA}[C][wifi:1248]: WiFi:`);
    // A fully empty line must pass through without clearing state, so the
    // continuation after it still inherits the entry's color/prefix.
    expect(p.parseLine("")).toBe("");
    expect(p.parseLine("  Hostname: 'ol'")).toBe(
      `${MAGENTA}[C][wifi:1248]:   Hostname: 'ol'${RESET}`
    );
  });
});
