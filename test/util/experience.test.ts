import { describe, expect, it } from "vitest";
import { ExperienceLevel } from "../../src/api/types/system.js";
import {
  editorLayoutForExperience,
  EXPERIENCE_OPTIONS,
  isExpert,
} from "../../src/util/experience.js";

describe("isExpert", () => {
  it("is true only for EXPERT", () => {
    expect(isExpert(ExperienceLevel.EXPERT)).toBe(true);
    expect(isExpert(ExperienceLevel.BEGINNER)).toBe(false);
  });

  it("treats an unchosen level (null) as not expert", () => {
    expect(isExpert(null)).toBe(false);
  });
});

describe("editorLayoutForExperience", () => {
  it("opens the split view for experts and the navigator otherwise", () => {
    expect(editorLayoutForExperience(ExperienceLevel.EXPERT)).toBe("both");
    expect(editorLayoutForExperience(ExperienceLevel.BEGINNER)).toBe("left");
    expect(editorLayoutForExperience(null)).toBe("left");
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
