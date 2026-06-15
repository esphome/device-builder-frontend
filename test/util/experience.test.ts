import { describe, expect, it } from "vitest";
import { ExperienceLevel } from "../../src/api/types/system.js";
import { EXPERIENCE_OPTIONS, isExpert } from "../../src/util/experience.js";

describe("isExpert", () => {
  it("is true only for EXPERT", () => {
    expect(isExpert(ExperienceLevel.EXPERT)).toBe(true);
    expect(isExpert(ExperienceLevel.BEGINNER)).toBe(false);
  });

  it("treats an unchosen level (null) as not expert", () => {
    expect(isExpert(null)).toBe(false);
  });
});

describe("EXPERIENCE_OPTIONS", () => {
  it("lists the two levels in display order", () => {
    expect(EXPERIENCE_OPTIONS.map(([level]) => level)).toEqual([
      ExperienceLevel.BEGINNER,
      ExperienceLevel.EXPERT,
    ]);
  });
});
