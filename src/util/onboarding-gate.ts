/**
 * Pure gating logic shared between the app shell and the kebab
 * header-actions, broken out so it can be unit-tested without
 * dragging in the WebSocket client + Lit lifecycle.
 */
import {
  type OnboardingState,
  OnboardingStepId,
  OnboardingStepStatus,
} from "../api/types/system.js";

/** True when any onboarding step is data-derived ``pending``.
 *  Drives the auto-pop gate below. */
export function isOnboardingPending(state: OnboardingState): boolean {
  return state.steps.some((s) => s.status === OnboardingStepStatus.PENDING);
}

/** True when the experience step is already ``done`` (a stored experience
 *  level) — i.e. an existing / migrated install rather than a fresh one that
 *  still needs the first-run wizard. */
export function isExperienceChosen(state: OnboardingState): boolean {
  return state.steps.some(
    (s) =>
      s.id === OnboardingStepId.EXPERIENCE_LEVEL && s.status === OnboardingStepStatus.DONE
  );
}

/**
 * True when the first-run wizard should auto-pop on load.
 *
 * Two conditions must hold simultaneously:
 *
 * 1. The user is behind the current onboarding version (a future
 *    bump re-prompts users who completed an earlier flow).
 * 2. *Something is actually pending.* A version bump alone isn't a
 *    reason to interrupt a user who already finished onboarding.
 */
export function shouldAutoShowOnboarding(state: OnboardingState): boolean {
  return state.completed_version < state.current_version && isOnboardingPending(state);
}
