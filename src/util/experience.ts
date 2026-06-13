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
 * Whether the YAML diff button is on for an experience level: UI and YAML on,
 * beginners (and an unchosen level) off. Single source of truth for the
 * wizard's finish path and the Settings handler.
 */
export function yamlDiffForExperience(level: ExperienceLevel | null): boolean {
  return level === ExperienceLevel.UI || level === ExperienceLevel.YAML;
}

/**
 * Editor layout to seed on first open for an experience level: YAML users land
 * in the split view, everyone else (including an unchosen level) starts on the
 * navigator with the YAML pane hidden.
 */
export function editorLayoutForExperience(
  level: ExperienceLevel | null
): "both" | "left" {
  return level === ExperienceLevel.YAML ? "both" : "left";
}
