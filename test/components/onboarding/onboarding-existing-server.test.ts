/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));

import type { LocalizeFunc } from "../../../src/common/localize.js";
import { ESPHomeOnboardingWizardDialog } from "../../../src/components/onboarding/onboarding-wizard-dialog.js";

interface WizardInternals {
  _index: number;
  _screen: string;
  _screens: string[];
  _isHaAddon: boolean;
  _remoteCompute: boolean;
  _discoveredHosts: Map<string, { friendly_name: string; name: string }> | null;
  _localize: LocalizeFunc;
  _api: {
    updatePreferences: ReturnType<typeof vi.fn>;
    markOnboardingAcknowledged: ReturnType<typeof vi.fn>;
  };
  _onContinue(): Promise<void>;
}

const internals = (wizard: ESPHomeOnboardingWizardDialog) =>
  wizard as unknown as WizardInternals;

const hosts = (...entries: Array<{ friendly_name?: string; name: string }>) =>
  new Map(
    entries.map((e, i) => [
      `h${i}`,
      { friendly_name: e.friendly_name ?? "", name: e.name },
    ])
  );

const stubApi = (state: WizardInternals) => {
  state._api = {
    updatePreferences: vi.fn().mockResolvedValue(undefined),
    markOnboardingAcknowledged: vi.fn().mockResolvedValue(undefined),
  };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("onboarding existing-server orientation", () => {
  it("offers the orientation step after experience when a server is detected", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._isHaAddon = false;
    state._discoveredHosts = hosts({ name: "living-room" });

    expect(state._screen).toBe("welcome");
    await state._onContinue(); // welcome -> experience
    expect(state._screen).toBe("experience");
    await state._onContinue(); // experience -> existing_server
    expect(state._screen).toBe("existing_server");
  });

  it("skips the orientation step on the HA add-on", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._isHaAddon = true;
    state._discoveredHosts = hosts({ name: "living-room" });

    await state._onContinue(); // welcome -> experience
    expect(state._screen).toBe("experience");
    expect(state._screens).not.toContain("existing_server");
  });

  it("skips the orientation step when no server is on the network", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._isHaAddon = false;
    state._discoveredHosts = null;

    await state._onContinue(); // welcome -> experience
    expect(state._screen).toBe("experience");
    expect(state._screens).not.toContain("existing_server");
  });

  it("freezes the flow when a host arrives after leaving experience", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    stubApi(state);
    state._isHaAddon = false;
    state._discoveredHosts = null;

    await state._onContinue(); // welcome -> experience
    await state._onContinue(); // experience -> tour (nothing detected)
    expect(state._screen).toBe("tour");

    state._discoveredHosts = hosts({ name: "late-arrival" }); // mDNS lands late
    expect(state._screen).toBe("tour");
    expect(state._screens).not.toContain("existing_server");
  });

  it("persists remote_compute_only when the switch is on", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    stubApi(state);
    state._isHaAddon = false;
    state._discoveredHosts = hosts({ name: "living-room" });

    await state._onContinue(); // welcome -> experience
    await state._onContinue(); // experience -> existing_server
    state._remoteCompute = true; // user flips the switch
    await state._onContinue(); // existing_server -> tour (persists)

    expect(state._screen).toBe("tour");
    expect(state._api.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ remote_compute_only: true })
    );
  });

  it("names the discovered server, preferring its friendly name", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    document.body.appendChild(wizard);
    const state = internals(wizard);
    state._localize = ((key, values) =>
      values?.name !== undefined ? String(values.name) : key) as LocalizeFunc;
    wizard.open();
    state._isHaAddon = false;
    state._discoveredHosts = hosts({ friendly_name: "Living Room", name: "living-room" });

    await state._onContinue(); // welcome -> experience
    await state._onContinue(); // experience -> existing_server
    await wizard.updateComplete;

    expect(wizard.shadowRoot?.textContent).toContain("Living Room");
  });
});
