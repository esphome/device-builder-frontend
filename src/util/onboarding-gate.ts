/**
 * Pure gating logic shared between the app shell and the kebab
 * header-actions, broken out so it can be unit-tested without
 * dragging in the WebSocket client + Lit lifecycle.
 */
import { type OnboardingState, OnboardingStepStatus } from "../api/types.js";

/** True when any onboarding step is data-derived ``pending``.
 *  Drives the ``Set up Wi-Fi…`` kebab entry's visibility. */
export function isOnboardingPending(state: OnboardingState): boolean {
  return state.steps.some((s) => s.status === OnboardingStepStatus.PENDING);
}

/**
 * True when the wizard should auto-pop on load.
 *
 * Three conditions must hold simultaneously:
 *
 * 1. The user is behind the current onboarding version (a future
 *    bump re-prompts users who completed an earlier flow).
 * 2. *Something is actually pending.* A version bump alone isn't
 *    a reason to interrupt a user whose secrets are already
 *    configured — most notably, installs that pre-date the
 *    wizard have ``completed_version = 0`` but already-valid
 *    Wi-Fi credentials, and asking them to re-enter values they
 *    already set is friction with no payoff. The kebab
 *    ``Set up Wi-Fi…`` entry uses the same pending gate, so the
 *    user never loses access — they just don't get an
 *    unsolicited prompt.
 * 3. The user hasn't already session-dismissed the dialog (the
 *    "Maybe later" / X / Escape paths set this so a refresh
 *    doesn't re-pop the dialog they just closed).
 */
export function shouldAutoShowOnboarding(
  state: OnboardingState,
  sessionDismissed: boolean
): boolean {
  return (
    state.completed_version < state.current_version &&
    isOnboardingPending(state) &&
    !sessionDismissed
  );
}
