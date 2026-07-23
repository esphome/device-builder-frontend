/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));

import { ExperienceLevel } from "../../../src/api/types/system.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import {
  DESKTOP_ONBOARDING_PARAM,
  ESPHomeOnboardingWizardDialog,
  RESET_ONBOARDING_PARAM,
} from "../../../src/components/onboarding/onboarding-wizard-dialog.js";
import type { UsageChoice } from "../../../src/components/onboarding/wizard-screens.js";

interface WizardInternals {
  _api: {
    updatePreferences: ReturnType<typeof vi.fn>;
    markOnboardingAcknowledged: ReturnType<typeof vi.fn>;
  };
  _open: boolean;
  _index: number;
  _screen: string;
  _screens: string[];
  _desktopVersion: string;
  _showUsage: boolean;
  _usage: UsageChoice | null;
  _usageRecommended: UsageChoice | null;
  _discoveredHosts: Map<string, { friendly_name: string; name: string }> | null;
  _isHaAddon: boolean;
  _localize: LocalizeFunc;
  _onContinue(): Promise<void>;
}

const internals = (wizard: ESPHomeOnboardingWizardDialog) =>
  wizard as unknown as WizardInternals;

const hosts = (...names: string[]) =>
  new Map(names.map((name, i) => [`h${i}`, { friendly_name: "", name }]));

const stubApi = (state: WizardInternals) => {
  state._api = {
    updatePreferences: vi.fn().mockResolvedValue(undefined),
    markOnboardingAcknowledged: vi.fn().mockResolvedValue(undefined),
  };
};

/** A wizard opened under the desktop app (handshake reported a version). */
const openDesktopWizard = () => {
  const wizard = new ESPHomeOnboardingWizardDialog();
  const state = internals(wizard);
  state._desktopVersion = "1.4.0";
  wizard.open();
  stubApi(state);
  return { wizard, state };
};

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

describe("desktop usage question", () => {
  it("is asked right after welcome only under the desktop app", () => {
    const { state } = openDesktopWizard();
    expect(state._screens).toEqual(["welcome", "usage", "experience", "tour"]);

    const web = new ESPHomeOnboardingWizardDialog();
    web.open();
    expect(internals(web)._screens).not.toContain("usage");
  });

  it("defaults to standalone with the badge when nothing is detected", async () => {
    const { state } = openDesktopWizard();
    state._discoveredHosts = null;

    await state._onContinue(); // welcome -> usage

    expect(state._screen).toBe("usage");
    expect(state._usage).toBe("standalone");
    expect(state._usageRecommended).toBe("standalone");
  });

  it("defaults to remote builder with the badge when an install is detected", async () => {
    const { state } = openDesktopWizard();
    state._discoveredHosts = hosts("living-room");

    await state._onContinue(); // welcome -> usage

    expect(state._usage).toBe("remote_builder");
    expect(state._usageRecommended).toBe("remote_builder");
  });

  it("keeps the pinned default when a host arrives mid-screen", async () => {
    const { state } = openDesktopWizard();
    state._discoveredHosts = null;
    await state._onContinue(); // welcome -> usage

    state._discoveredHosts = hosts("late-arrival"); // mDNS lands late

    expect(state._usage).toBe("standalone");
    expect(state._usageRecommended).toBe("standalone");
  });

  it("continues the standalone flow without the orientation step", async () => {
    const { state } = openDesktopWizard();
    // A detected host must not re-insert existing_server on desktop: the
    // usage question already asked it.
    state._discoveredHosts = hosts("living-room");
    await state._onContinue(); // welcome -> usage
    state._usage = "standalone";

    await state._onContinue(); // usage -> experience
    expect(state._screen).toBe("experience");

    await state._onContinue(); // experience -> tour (persists)
    expect(state._screen).toBe("tour");
    expect(state._screens).not.toContain("existing_server");
    expect(state._api.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        experience_level: ExperienceLevel.BEGINNER,
        remote_compute_only: false,
        hide_device_builder: false,
      })
    );
  });

  it("ends onboarding at the usage screen for a remote builder", async () => {
    const { state } = openDesktopWizard();
    state._discoveredHosts = hosts("living-room");
    await state._onContinue(); // welcome -> usage (remote preselected)

    await state._onContinue(); // completes setup, no tour offer

    expect(state._api.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        remote_compute_only: true,
        hide_device_builder: true,
      })
    );
    // The experience screen was never shown, so the default must not
    // overwrite a returning user's stored level.
    const prefs = state._api.updatePreferences.mock.calls[0][0];
    expect("experience_level" in prefs).toBe(false);
    expect(state._api.markOnboardingAcknowledged).toHaveBeenCalledOnce();
    expect(state._open).toBe(false);
  });

  it("never writes hide_device_builder off the desktop app", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    stubApi(state);
    state._index = 1; // experience, nothing detected

    await state._onContinue();

    const prefs = state._api.updatePreferences.mock.calls[0][0];
    expect("hide_device_builder" in prefs).toBe(false);
  });

  it("banners the experience screen when standalone won over a detected install", async () => {
    const { wizard, state } = openDesktopWizard();
    document.body.appendChild(wizard);
    state._discoveredHosts = hosts("living-room");
    await state._onContinue(); // welcome -> usage, remote preselected
    await wizard.updateComplete;
    expect(wizard.shadowRoot?.querySelector(".existing-notice")).toBeNull();

    state._usage = "standalone";
    await state._onContinue(); // usage -> experience
    await wizard.updateComplete;

    expect(state._screen).toBe("experience");
    expect(wizard.shadowRoot?.querySelector(".existing-notice")).not.toBeNull();
  });

  it("names the detected install in the banner", async () => {
    const { wizard, state } = openDesktopWizard();
    document.body.appendChild(wizard);
    state._localize = ((key, params) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key) as LocalizeFunc;
    state._discoveredHosts = hosts("living-room");
    await state._onContinue(); // welcome -> usage
    state._usage = "standalone";
    await state._onContinue(); // usage -> experience
    await wizard.updateComplete;

    const notice = wizard.shadowRoot?.querySelector(".existing-notice");
    expect(notice?.textContent).toContain("living-room");
  });

  it("returns to the usage screen with remote preselected via the banner link", async () => {
    const { wizard, state } = openDesktopWizard();
    document.body.appendChild(wizard);
    state._discoveredHosts = hosts("living-room");
    await state._onContinue(); // welcome -> usage
    state._usage = "standalone";
    await state._onContinue(); // usage -> experience
    await wizard.updateComplete;

    wizard.shadowRoot
      ?.querySelector<HTMLButtonElement>(".existing-notice .notice-link")
      ?.click();
    await wizard.updateComplete;

    expect(state._screen).toBe("usage");
    expect(state._usage).toBe("remote_builder");
  });

  it("previews the usage screen via the dev reset query on a non-desktop backend", async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    window.history.replaceState(
      null,
      "",
      `/?${RESET_ONBOARDING_PARAM}=1&${DESKTOP_ONBOARDING_PARAM}=1`
    );
    const wizard = new ESPHomeOnboardingWizardDialog();
    document.body.appendChild(wizard);
    await wizard.updateComplete;

    const state = internals(wizard);
    expect(state._open).toBe(true);
    expect(state._showUsage).toBe(true);
    expect(state._screens).toContain("usage");
    expect(window.location.search).toBe("");
  });

  it("shows no banner when nothing was detected or off the desktop app", async () => {
    const { wizard, state } = openDesktopWizard();
    document.body.appendChild(wizard);
    state._discoveredHosts = null;
    await state._onContinue(); // welcome -> usage, standalone preselected
    await state._onContinue(); // usage -> experience
    await wizard.updateComplete;
    expect(wizard.shadowRoot?.querySelector(".existing-notice")).toBeNull();

    // Non-desktop installs keep the orientation-step flow instead.
    const web = new ESPHomeOnboardingWizardDialog();
    document.body.appendChild(web);
    web.open();
    const webState = internals(web);
    webState._discoveredHosts = hosts("living-room");
    await webState._onContinue(); // welcome -> experience
    await web.updateComplete;
    expect(webState._screen).toBe("experience");
    expect(web.shadowRoot?.querySelector(".existing-notice")).toBeNull();
  });
});
