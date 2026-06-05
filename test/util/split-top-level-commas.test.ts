import { describe, expect, it } from "vitest";
import { splitTopLevelCommas } from "../../src/util/split-top-level-commas.js";

describe("splitTopLevelCommas", () => {
  it("splits plain comma-separated values", () => {
    expect(splitTopLevelCommas("a, b, c")).toEqual(["a", " b", " c"]);
  });

  it("keeps commas inside double-quoted spans", () => {
    expect(splitTopLevelCommas('"a,b", c')).toEqual(['"a,b"', " c"]);
  });

  it("keeps commas inside single-quoted spans", () => {
    expect(splitTopLevelCommas("'x,y', z")).toEqual(["'x,y'", " z"]);
  });

  it("honors an escaped quote inside a double-quoted span", () => {
    expect(splitTopLevelCommas('"a\\",b", c')).toEqual(['"a\\",b"', " c"]);
  });

  it("returns a single segment when there are no top-level commas", () => {
    expect(splitTopLevelCommas('"a,b,c"')).toEqual(['"a,b,c"']);
  });
});
