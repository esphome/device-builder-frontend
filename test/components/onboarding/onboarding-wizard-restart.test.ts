/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));

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
  _remoteCompute: boolean;
  _experience: ExperienceLevel;
  _existingServerPinned: boolean;
  _showTour: boolean;
  _isHaAddon: boolean;
  _discoveredHosts: Map<string, { friendly_name: string; name: string }> | null;
  _titleKey: string;
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
    document.body.appendChild(wizard);
    await wizard.updateComplete;

    const state = internals(wizard);
    expect(state._open).toBe(true);
    expect(state._screen).toBe("welcome");
    expect(state._remoteCompute).toBe(false);
    expect(state._experience).toBe(ExperienceLevel.BEGINNER);
    expect(window.location.search).toBe("?keep=yes");
    expect(window.location.hash).toBe("#section");
  });
});

describe("mandatory onboarding flow", () => {
  it("vetoes close requests until the final tour offer", () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);

    const requiredClose = new Event("request-close", { cancelable: true });
    state._onRequestClose(requiredClose);
    expect(requiredClose.defaultPrevented).toBe(true);

    state._index = 2; // welcome, experience, tour
    const optionalClose = new Event("request-close", { cancelable: true });
    state._onRequestClose(optionalClose);
    expect(optionalClose.defaultPrevented).toBe(false);
    expect(state._open).toBe(false);
  });

  it("persists choices before presenting the tour offer", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._index = 1; // experience
    state._api = {
      updatePreferences: vi.fn().mockResolvedValue(undefined),
      markOnboardingAcknowledged: vi.fn().mockResolvedValue(undefined),
    };
    const acknowledged = vi.fn();
    wizard.addEventListener("onboarding-acknowledged", acknowledged);

    await state._onContinue(); // experience -> tour (nothing detected)

    expect(state._api.updatePreferences).toHaveBeenCalledWith({
      experience_level: ExperienceLevel.BEGINNER,
      remote_compute_only: false,
    });
    expect(state._api.markOnboardingAcknowledged).toHaveBeenCalledOnce();
    expect(state._screen).toBe("tour");
    expect(acknowledged).toHaveBeenCalledOnce();
  });

  it("closes straight onto the dashboard when the viewport can't run the tour", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._showTour = false;
    state._index = 1;
    state._api = {
      updatePreferences: vi.fn().mockResolvedValue(undefined),
      markOnboardingAcknowledged: vi.fn().mockResolvedValue(undefined),
    };

    await state._onContinue();

    expect(state._api.updatePreferences).toHaveBeenCalledOnce();
    expect(state._api.markOnboardingAcknowledged).toHaveBeenCalledOnce();
    expect(state._open).toBe(false);
  });

  it("still closes when a host arrives while choices are persisting", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._showTour = false; // phone-sized viewport
    state._isHaAddon = false;
    state._discoveredHosts = null;
    state._index = 1; // experience, nothing detected — pin lands false
    state._api = {
      // mDNS lands mid-save; the close decision must honor the pin, not
      // recompute the screen list from the freshly-arrived host.
      updatePreferences: vi.fn().mockImplementation(async () => {
        state._discoveredHosts = new Map([["h", { friendly_name: "", name: "late" }]]);
      }),
      markOnboardingAcknowledged: vi.fn().mockResolvedValue(undefined),
    };

    await state._onContinue();

    expect(state._open).toBe(false);
  });

  it("starts the guided tour only after the final dialog has closed", () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._index = 2; // tour
    const openTour = vi.fn();
    wizard.addEventListener("open-guided-tour", openTour);

    state._startTour();
    expect(openTour).not.toHaveBeenCalled();

    state._onAfterHide();
    expect(openTour).toHaveBeenCalledOnce();
  });

  it("ends remote-compute setup without offering an incompatible tour", () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    // A detected server with the remote-compute switch on lands on the remote
    // variant of the tour offer.
    state._isHaAddon = false;
    state._discoveredHosts = new Map([["h", { friendly_name: "", name: "hass" }]]);
    state._existingServerPinned = true;
    state._remoteCompute = true;
    state._index = 3; // welcome, experience, existing_server, tour

    expect(state._screen).toBe("tour");
    expect(state._titleKey).toBe("onboarding.wizard.tour.remote_title");
  });
});
