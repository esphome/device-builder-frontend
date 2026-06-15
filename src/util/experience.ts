import { ExperienceLevel } from "../api/types/system.js";

/**
 * Experience levels in display order, each with its mdi icon name. Shared by
 * the onboarding wizard so the option list and icons can't drift (the consumer
 * still registers the icons it uses).
 */
export const EXPERIENCE_OPTIONS: ReadonlyArray<readonly [ExperienceLevel, string]> = [
  [ExperienceLevel.BEGINNER, "sprout"],
  [ExperienceLevel.EXPERT, "code-braces"],
];

/**
 * Whether an experience level unlocks the expert surfaces (editor diff,
 * navigator search, YAML search). ``EXPERT`` only; beginners and an unchosen
 * level are off. Single source of truth for the derived ``expertModeContext``.
 */
export function isExpert(level: ExperienceLevel | null): boolean {
  return level === ExperienceLevel.EXPERT;
}
