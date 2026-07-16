/**
 * @vitest-environment happy-dom
 *
 * Pins renderCardGrid's per-device bindings: runtime_state fields
 * (state, deployed_version, queued_update, api_encryption_active)
 * flow onto <esphome-device-card>, and the update indicator stays
 * gated on a live mDNS source.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { DeviceState } from "../../../src/api/types/devices.js";
import { renderCardGrid } from "../../../src/components/dashboard/render-content.js";
import {
  clearTourConfiguration,
  setTourActive,
  setTourConfiguration,
} from "../../../src/components/guided-tour/tour-session.js";
import { renderInto } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { makeDashboardHost } from "./_host.js";

afterEach(() => {
  setTourActive(false);
  clearTourConfiguration();
});

function makeHost(devices: ConfiguredDevice[]) {
  return makeDashboardHost({
    _devices: devices,
    _activeJobs: new Map(),
    _recentJobs: new Map(),
    _recentlyAdopted: null,
    _selectMode: false,
    _selectedDevices: new Set<string>(),
  });
}

function renderCard(device: ConfiguredDevice): HTMLElement {
  const container = renderInto(renderCardGrid(makeHost([device]), [device]));
  const card = container.querySelector("esphome-device-card");
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe("renderCardGrid", () => {
  it("binds the device's runtime_state onto the card", () => {
    const cipher = "Noise_NNpsk0_25519_ChaChaPoly_SHA256";
    const device = makeConfiguredDevice({
      update_available: true,
      runtime_state: {
        state: DeviceState.ONLINE,
        deployed_version: "2026.6.1",
        queued_update: true,
        api_encryption_active: cipher,
      },
    });
    const card = renderCard(device) as HTMLElement & {
      state: DeviceState;
      installedVersion: string;
      apiEncryptionActive: string | null;
    };
    expect(card.getAttribute("data-configuration")).toBe("kitchen.yaml");
    expect(card.state).toBe(DeviceState.ONLINE);
    expect(card.installedVersion).toBe("2026.6.1");
    expect(card.apiEncryptionActive).toBe(cipher);
    expect(card.hasAttribute("queued-update")).toBe(true);
    expect(card.hasAttribute("show-update")).toBe(true);
  });

  it("hides the update indicator when an api device's mDNS is dark", () => {
    const device = makeConfiguredDevice({
      update_available: true,
      api_enabled: true,
      runtime_state: { active_source: "ping" },
    });
    const card = renderCard(device);
    expect(card.hasAttribute("show-update")).toBe(false);
    expect(card.hasAttribute("queued-update")).toBe(false);
  });

  it("keeps the tour target in canonical device order", () => {
    const zulu = makeConfiguredDevice({
      name: "zulu",
      friendly_name: "Zulu",
      configuration: "zulu.yaml",
    });
    const alpha = makeConfiguredDevice({
      name: "alpha",
      friendly_name: "Alpha",
      configuration: "alpha.yaml",
    });
    setTourConfiguration(alpha.configuration);
    setTourActive(true);

    const container = renderInto(renderCardGrid(makeHost([zulu, alpha]), [zulu]));
    const configurations = [...container.querySelectorAll("esphome-device-card")].map(
      (card) => card.getAttribute("data-configuration")
    );

    expect(configurations).toEqual(["alpha.yaml", "zulu.yaml"]);
  });
});
