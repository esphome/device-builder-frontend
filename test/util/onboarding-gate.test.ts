/**
 * Tests for the onboarding-gate helpers.
 *
 * The two helpers decide whether the wizard auto-pops on load
 * and whether the ``Set up Wi-Fi…`` kebab entry is visible. The
 * subtle case is the existing-install upgrade path: a user with
 * ``completed_version = 0`` (never ran the wizard) but already
 * valid wifi credentials must NOT be interrupted on next page
 * load. A version bump alone shouldn't trigger the wizard.
 */
import { describe, expect, it } from "vitest";
import {
  type OnboardingState,
  OnboardingStepId,
  OnboardingStepStatus,
} from "../../src/api/types.js";
import {
  isOnboardingPending,
  shouldAutoShowOnboarding,
} from "../../src/util/onboarding-gate.js";

const wifi = (status: OnboardingStepStatus) => ({
  id: OnboardingStepId.WIFI_CREDENTIALS,
  status,
});

const stateWith = (
  steps: ReturnType<typeof wifi>[],
  current_version = 1,
  completed_version = 0
): OnboardingState => ({
  current_version,
  completed_version,
  steps,
});

describe("isOnboardingPending", () => {
  it("returns true when any step is pending", () => {
    expect(isOnboardingPending(stateWith([wifi(OnboardingStepStatus.PENDING)]))).toBe(
      true
    );
  });

  it("returns false when every step is done", () => {
    expect(isOnboardingPending(stateWith([wifi(OnboardingStepStatus.DONE)]))).toBe(false);
  });

  it("returns false on an empty step list", () => {
    expect(isOnboardingPending(stateWith([]))).toBe(false);
  });
});

describe("shouldAutoShowOnboarding", () => {
  it("pops for a fresh-install user behind current with pending step", () => {
    expect(
      shouldAutoShowOnboarding(stateWith([wifi(OnboardingStepStatus.PENDING)]), false)
    ).toBe(true);
  });

  it(
    "does NOT pop for a pre-wizard install with secrets already configured " +
      "(this is the bug fix — completed_version=0 + step DONE must not interrupt)",
    () => {
      expect(
        shouldAutoShowOnboarding(stateWith([wifi(OnboardingStepStatus.DONE)]), false)
      ).toBe(false);
    }
  );

  it("does NOT pop when user is up to date even with pending step", () => {
    expect(
      shouldAutoShowOnboarding(
        stateWith([wifi(OnboardingStepStatus.PENDING)], 1, 1),
        false
      )
    ).toBe(false);
  });

  it("does NOT pop when user is ahead of current (rolled back from a future build)", () => {
    expect(
      shouldAutoShowOnboarding(
        stateWith([wifi(OnboardingStepStatus.PENDING)], 1, 2),
        false
      )
    ).toBe(false);
  });

  it("respects session-dismissal even with pending work", () => {
    expect(
      shouldAutoShowOnboarding(stateWith([wifi(OnboardingStepStatus.PENDING)]), true)
    ).toBe(false);
  });

  it("does NOT pop when behind current but step list is empty", () => {
    expect(shouldAutoShowOnboarding(stateWith([], 2, 0), false)).toBe(false);
  });
});
