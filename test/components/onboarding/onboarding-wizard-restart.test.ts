/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ExperienceLevel } from "../../../src/api/types/system.js";
import {
  ESPHomeOnboardingWizardDialog,
  RESET_ONBOARDING_PARAM,
} from "../../../src/components/onboarding/onboarding-wizard-dialog.js";

interface WizardInternals {
  _api: {
    updatePreferences: ReturnType<typeof vi.fn>;
    markOnboardingAcknowledged: ReturnType<typeof vi.fn>;
  };
  _open: boolean;
  _index: number;
  _screen: string;
  _useCaseChosen: boolean;
  _remoteCompute: boolean;
  _experience: ExperienceLevel;
  _titleKey: string;
  _chooseExperience(level: ExperienceLevel): void;
  _onContinue(): Promise<void>;
  _onRequestClose(event: Event): void;
  _startTour(): void;
  _onAfterHide(): void;
}

const internals = (wizard: ESPHomeOnboardingWizardDialog) =>
  wizard as unknown as WizardInternals;

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

describe("onboarding wizard reset query", () => {
  it("opens a clean default run and consumes only its query parameter", async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    window.history.replaceState(
      null,
      "",
      `/?keep=yes&${RESET_ONBOARDING_PARAM}=1#section`
    );
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.hasUseCase = true;
    document.body.appendChild(wizard);
    await wizard.updateComplete;

    const state = internals(wizard);
    expect(state._open).toBe(true);
    expect(state._screen).toBe("welcome");
    expect(state._useCaseChosen).toBe(true);
    expect(state._remoteCompute).toBe(false);
    expect(state._experience).toBe(ExperienceLevel.BEGINNER);
    expect(window.location.search).toBe("?keep=yes");
    expect(window.location.hash).toBe("#section");
  });
});

describe("mandatory onboarding flow", () => {
  it("vetoes close requests until the final tour offer", () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.hasUseCase = true;
    wizard.open();
    const state = internals(wizard);

    const requiredClose = new Event("request-close", { cancelable: true });
    state._onRequestClose(requiredClose);
    expect(requiredClose.defaultPrevented).toBe(true);

    state._index = 2;
    const optionalClose = new Event("request-close", { cancelable: true });
    state._onRequestClose(optionalClose);
    expect(optionalClose.defaultPrevented).toBe(false);
    expect(state._open).toBe(false);
  });

  it("persists choices before presenting the tour offer", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.hasUseCase = true;
    wizard.open();
    const state = internals(wizard);
    state._index = 1;
    state._api = {
      updatePreferences: vi.fn().mockResolvedValue(undefined),
      markOnboardingAcknowledged: vi.fn().mockResolvedValue(undefined),
    };
    const acknowledged = vi.fn();
    wizard.addEventListener("onboarding-acknowledged", acknowledged);

    await state._onContinue();

    expect(state._api.updatePreferences).toHaveBeenCalledWith({
      experience_level: ExperienceLevel.BEGINNER,
      remote_compute_only: false,
    });
    expect(state._api.markOnboardingAcknowledged).toHaveBeenCalledOnce();
    expect(state._screen).toBe("tour");
    expect(acknowledged).toHaveBeenCalledOnce();
  });

  it("asks expert users for their use case before saving", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.hasUseCase = true;
    wizard.open();
    const state = internals(wizard);
    state._experience = ExperienceLevel.EXPERT;
    state._index = 1;
    state._api = {
      updatePreferences: vi.fn(),
      markOnboardingAcknowledged: vi.fn(),
    };

    await state._onContinue();

    expect(state._screen).toBe("use_case");
    expect(state._api.updatePreferences).not.toHaveBeenCalled();
  });

  it("restores local-device mode when switching back to beginner", () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.hasUseCase = true;
    wizard.open();
    const state = internals(wizard);
    state._experience = ExperienceLevel.EXPERT;
    state._remoteCompute = true;
    state._index = 1;

    state._chooseExperience(ExperienceLevel.BEGINNER);

    expect(state._remoteCompute).toBe(false);
    expect(state._screen).toBe("experience");
  });

  it("starts the guided tour only after the final dialog has closed", () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.hasUseCase = true;
    wizard.open();
    const state = internals(wizard);
    state._index = 2;
    const openTour = vi.fn();
    wizard.addEventListener("open-guided-tour", openTour);

    state._startTour();
    expect(openTour).not.toHaveBeenCalled();

    state._onAfterHide();
    expect(openTour).toHaveBeenCalledOnce();
  });

  it("ends remote-compute setup without offering an incompatible tour", () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.hasUseCase = true;
    wizard.open();
    const state = internals(wizard);
    state._experience = ExperienceLevel.EXPERT;
    state._remoteCompute = true;
    state._index = 3;

    expect(state._titleKey).toBe("onboarding.wizard.tour.remote_title");
  });
});
