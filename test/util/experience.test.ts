import { describe, expect, it } from "vitest";
import { ExperienceLevel } from "../../src/api/types/system.js";
import {
  editorLayoutForExperience,
  EXPERIENCE_OPTIONS,
  yamlDiffForExperience,
} from "../../src/util/experience.js";

describe("yamlDiffForExperience", () => {
  it("is off for beginners and on for UI / YAML users", () => {
    expect(yamlDiffForExperience(ExperienceLevel.BEGINNER)).toBe(false);
    expect(yamlDiffForExperience(ExperienceLevel.UI)).toBe(true);
    expect(yamlDiffForExperience(ExperienceLevel.YAML)).toBe(true);
  });

  it("treats an unchosen level (null) as off", () => {
    expect(yamlDiffForExperience(null)).toBe(false);
  });
});

describe("editorLayoutForExperience", () => {
  it("opens the split view for YAML users and the navigator otherwise", () => {
    expect(editorLayoutForExperience(ExperienceLevel.YAML)).toBe("both");
    expect(editorLayoutForExperience(ExperienceLevel.UI)).toBe("left");
    expect(editorLayoutForExperience(ExperienceLevel.BEGINNER)).toBe("left");
    expect(editorLayoutForExperience(null)).toBe("left");
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
