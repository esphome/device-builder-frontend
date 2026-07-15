/**
 * Tests for the onboarding-gate helpers.
 *
 * The helpers decide whether the first-run wizard auto-pops on load. The
 * subtle case is the existing-install upgrade path: a user with
 * ``completed_version = 0`` (never ran the wizard) but already done steps must
 * NOT be interrupted on next page load. A version bump alone shouldn't trigger
 * the wizard.
 */
import { describe, expect, it } from "vitest";
import {
  type OnboardingState,
  type OnboardingStep,
  OnboardingStepId,
  OnboardingStepStatus,
} from "../../src/api/types/system.js";
import {
  isExperienceChosen,
  isOnboardingPending,
  shouldAutoShowOnboarding,
} from "../../src/util/onboarding-gate.js";

const experience = (status: OnboardingStepStatus) => ({
  id: OnboardingStepId.EXPERIENCE_LEVEL,
  status,
});

const stateWith = (
  steps: OnboardingStep[],
  current_version = 1,
  completed_version = 0
): OnboardingState => ({
  current_version,
  completed_version,
  steps,
});

describe("isOnboardingPending", () => {
  it("returns true when any step is pending", () => {
    expect(
      isOnboardingPending(stateWith([experience(OnboardingStepStatus.PENDING)]))
    ).toBe(true);
  });

  it("returns false when every step is done", () => {
    expect(isOnboardingPending(stateWith([experience(OnboardingStepStatus.DONE)]))).toBe(
      false
    );
  });

  it("returns false on an empty step list", () => {
    expect(isOnboardingPending(stateWith([]))).toBe(false);
  });
});

describe("isExperienceChosen", () => {
  it("is true when the experience step is done", () => {
    expect(isExperienceChosen(stateWith([experience(OnboardingStepStatus.DONE)]))).toBe(
      true
    );
  });

  it("is false when the experience step is still pending (fresh install)", () => {
    expect(
      isExperienceChosen(stateWith([experience(OnboardingStepStatus.PENDING)]))
    ).toBe(false);
  });
});

describe("shouldAutoShowOnboarding", () => {
  it("pops for a fresh-install user behind current with pending step", () => {
    expect(
      shouldAutoShowOnboarding(stateWith([experience(OnboardingStepStatus.PENDING)]))
    ).toBe(true);
  });

  it(
    "does NOT pop for a pre-wizard install already done " +
      "(completed_version=0 + step DONE must not interrupt)",
    () => {
      expect(
        shouldAutoShowOnboarding(stateWith([experience(OnboardingStepStatus.DONE)]))
      ).toBe(false);
    }
  );

  it("does NOT pop when user is up to date even with pending step", () => {
    expect(
      shouldAutoShowOnboarding(
        stateWith([experience(OnboardingStepStatus.PENDING)], 1, 1)
      )
    ).toBe(false);
  });

  it("does NOT pop when user is ahead of current (rolled back from a future build)", () => {
    expect(
      shouldAutoShowOnboarding(
        stateWith([experience(OnboardingStepStatus.PENDING)], 1, 2)
      )
    ).toBe(false);
  });

  it("does NOT pop when behind current but step list is empty", () => {
    expect(shouldAutoShowOnboarding(stateWith([], 2, 0))).toBe(false);
  });
});
