import { describe, expect, it } from "vitest";

import { formatAddress, formatUsbId, tenthLogger } from "../../src/util/flash-log.js";

describe("flash-log formatting", () => {
  it("prints addresses upper-case with a 0x prefix and USB ids as vvvv:pppp", () => {
    expect(formatAddress(0xc000)).toBe("0xC000");
    expect(formatUsbId(0x2e8a, 0x3)).toBe("2e8a:0003");
  });

  it("logs once per tenth reached, with the percent as reached", () => {
    const lines: string[] = [];
    const tenth = tenthLogger((l) => lines.push(l), "Writing");
    for (const p of [3, 9, 10, 12, 19, 20, 68, 70, 100]) tenth(p);
    expect(lines).toEqual([
      "Writing: 10%",
      "Writing: 20%",
      "Writing: 68%",
      "Writing: 70%",
      "Writing: 100%",
    ]);
  });
});
