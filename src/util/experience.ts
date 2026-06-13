import { ExperienceLevel } from "../api/types/system.js";

/**
 * Experience levels in display order, each with its mdi icon name. Shared by
 * the onboarding wizard and the Settings experience section so the option list
 * and icons can't drift (the consumer still registers the icons it uses).
 */
export const EXPERIENCE_OPTIONS: ReadonlyArray<readonly [ExperienceLevel, string]> = [
  [ExperienceLevel.BEGINNER, "sprout"],
  [ExperienceLevel.UI, "cursor-default-click-outline"],
  [ExperienceLevel.YAML, "code-braces"],
];

/**
 * Whether the YAML diff button is on for an experience level: beginners off,
 * UI and YAML on. Single source of truth for the wizard's finish path and the
 * Settings handler.
 */
export function yamlDiffForExperience(level: ExperienceLevel | null): boolean {
  return level !== ExperienceLevel.BEGINNER;
}
