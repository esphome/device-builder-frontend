import { describe, expect, it } from "vitest";
import { normalizeLogLine, parseLogLine, tagged } from "../../src/util/log-line.js";

const ESC = String.fromCharCode(27);

describe("parseLogLine", () => {
  it("parses a stamped record and strips the tag's :line suffix", () => {
    expect(parseLogLine("[12:34:56][W][wifi:123]: Disconnected")).toEqual({
      level: "W",
      tag: "wifi",
      tagStart: 14,
      tagEnd: 18,
    });
  });

  it("returns a tag range that indexes into the parsed line", () => {
    const line = "[11:21:19.093][E][esp32.crash:305]:   BT0: 0x4015482D";
    const parsed = parseLogLine(line)!;
    expect(line.slice(parsed.tagStart, parsed.tagEnd)).toBe("esp32.crash");
  });

  it("parses an unstamped (normalized) record", () => {
    expect(parseLogLine("[C][logger:224]: Logger:")?.level).toBe("C");
  });

  it.each(["E", "W", "I", "C", "D", "V", "VV"])("knows level %s", (level) => {
    expect(parseLogLine(`[12:00:00][${level}][app:029]: x`)?.level).toBe(level);
  });

  it("parses an S state line's bare entity-domain tag", () => {
    expect(parseLogLine("[12:00:00][S][sensor]: Temperature: 21.5")).toMatchObject({
      level: "S",
      tag: "sensor",
    });
  });

  it("rejects a pseudo-stamp that is not wall-clock shaped", () => {
    expect(parseLogLine("[123][W][wifi:123]: x")).toBeUndefined();
  });

  it("rejects a plain line", () => {
    expect(parseLogLine("Writing at 0x00010000... (5 %)")).toBeUndefined();
  });
});

describe("normalizeLogLine", () => {
  it("strips ANSI (both forms), the timestamp prefix, and trailing CRLF", () => {
    expect(normalizeLogLine(`[12:34:56]${ESC}[31mSoft WDT reset\r\n${ESC}[0m`)).toBe(
      "Soft WDT reset"
    );
    expect(normalizeLogLine("\\033[31m[12:34:56]Soft WDT reset\\033[0m")).toBe(
      "Soft WDT reset"
    );
  });

  it("strips a millisecond stamp", () => {
    expect(normalizeLogLine("[11:21:19.093][E][app:029]: boot")).toBe(
      "[E][app:029]: boot"
    );
  });

  it("keeps a line with no wrapping untouched", () => {
    expect(normalizeLogLine("Exception (28):")).toBe("Exception (28):");
  });
});

describe("tagged", () => {
  const re = tagged("BT\\d+:\\s*0x[0-9a-fA-F]{8}");

  it("matches both the raw and the logger-replayed form", () => {
    expect(re.test("BT0: 0x400d9150")).toBe(true);
    expect(re.test("[E][esp32.crash:305]: BT0: 0x4015482D")).toBe(true);
  });

  it("stays anchored past a non-record prefix", () => {
    expect(re.test("prose then BT0: 0x400d9150")).toBe(false);
  });
});
