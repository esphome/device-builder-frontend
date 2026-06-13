import { describe, expect, it } from "vitest";
import { ExperienceLevel } from "../../src/api/types/system.js";
import { EXPERIENCE_OPTIONS, yamlDiffForExperience } from "../../src/util/experience.js";

describe("yamlDiffForExperience", () => {
  it("is off for beginners and on for UI / YAML users", () => {
    expect(yamlDiffForExperience(ExperienceLevel.BEGINNER)).toBe(false);
    expect(yamlDiffForExperience(ExperienceLevel.UI)).toBe(true);
    expect(yamlDiffForExperience(ExperienceLevel.YAML)).toBe(true);
  });

  it("treats an unchosen level (null) as not-beginner", () => {
    // null seeds like UI/YAML (on); only an explicit BEGINNER turns it off.
    expect(yamlDiffForExperience(null)).toBe(true);
  });
});

describe("EXPERIENCE_OPTIONS", () => {
  it("lists the three levels in display order", () => {
    expect(EXPERIENCE_OPTIONS.map(([level]) => level)).toEqual([
      ExperienceLevel.BEGINNER,
      ExperienceLevel.UI,
      ExperienceLevel.YAML,
    ]);
  });
});
