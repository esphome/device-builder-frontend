/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { LocalizeFunc } from "../../../src/common/localize.js";
import { ESPHomeOnboardingWizardDialog } from "../../../src/components/onboarding/onboarding-wizard-dialog.js";

interface WizardInternals {
  _index: number;
  _screen: string;
  _screens: string[];
  _isHaAddon: boolean;
  _discoveredHosts: Map<string, { friendly_name: string; name: string }> | null;
  _localize: LocalizeFunc;
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

afterEach(() => {
  document.body.replaceChildren();
});

describe("onboarding existing-server orientation", () => {
  it("inserts the orientation screen after welcome off the add-on", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._isHaAddon = false;
    state._discoveredHosts = hosts({ name: "living-room" });

    expect(state._screen).toBe("welcome");
    await state._onContinue();
    expect(state._screen).toBe("existing_server");
  });

  it("advances from the orientation screen to experience", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._isHaAddon = false;
    state._discoveredHosts = hosts({ name: "living-room" });

    await state._onContinue(); // welcome -> existing_server
    await state._onContinue(); // existing_server -> experience
    expect(state._screen).toBe("experience");
  });

  it("skips the orientation screen on the HA add-on", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._isHaAddon = true;
    state._discoveredHosts = hosts({ name: "living-room" });

    await state._onContinue();
    expect(state._screen).toBe("experience");
    expect(state._screens).not.toContain("existing_server");
  });

  it("skips the orientation screen when no server is on the network", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._isHaAddon = false;
    state._discoveredHosts = null;

    await state._onContinue();
    expect(state._screen).toBe("experience");
  });

  it("does not retro-insert the screen when a host arrives after welcome", async () => {
    const wizard = new ESPHomeOnboardingWizardDialog();
    wizard.open();
    const state = internals(wizard);
    state._isHaAddon = false;
    state._discoveredHosts = null;

    await state._onContinue(); // leaves welcome with nothing detected
    expect(state._screen).toBe("experience");

    state._discoveredHosts = hosts({ name: "late-arrival" }); // mDNS lands late
    expect(state._screen).toBe("experience");
    expect(state._screens).not.toContain("existing_server");
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

    await state._onContinue(); // welcome -> existing_server
    await wizard.updateComplete;

    expect(wizard.shadowRoot?.textContent).toContain("Living Room");
  });
});
