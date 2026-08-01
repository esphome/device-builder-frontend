/**
 * @vitest-environment happy-dom
 *
 * A dependency can itself be missing a dependency (climate.anova needs
 * ble_client, which needs esp32_ble_tracker). Each level suspends onto the
 * detour stack and is restored in turn, with its own in-progress values.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { identityLocalize, mount } from "../../_dom.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import type { DetourFrame } from "../../../src/components/device/add-component-dialog-dep-nav.js";
import type { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import {
  makeAddComponentDialogHost,
  navigateToDepEvent,
  setForm,
} from "./_add-component-dialog-host.js";

interface Internals {
  _detourStack: DetourFrame[];
  _returnValues: Record<string, unknown> | null;
  _selected: unknown;
  _prefillReference: { domain: string; id: string } | null;
  _onBack: () => void;
  _onNavigateToDep: (e: CustomEvent) => Promise<void>;
  _submitComponent: (fields: Record<string, unknown>, notify?: boolean) => Promise<void>;
}

const anova = makeComponentEntry("climate.anova", { name: "Anova Cooker" });
const bleClient = makeComponentEntry("ble_client", { name: "BLE Client" });
const tracker = makeComponentEntry("esp32_ble_tracker", { name: "BLE Tracker Hub" });

const bodies: Record<string, ComponentCatalogEntry> = {
  ble_client: bleClient,
  esp32_ble_tracker: tracker,
};

async function makeDialog() {
  const host = makeAddComponentDialogHost<Internals>();
  host.getComponentBodies.mockImplementation((ids: string[]) =>
    Promise.resolve(bodies[ids[0]] ? { [ids[0]]: bodies[ids[0]] } : {})
  );
  await mount(host.dialog, { _localize: identityLocalize } as never);
  return host;
}

const addDep = (d: Internals, domain: string) =>
  d._onNavigateToDep(navigateToDepEvent(domain));

/** Name in the "we'll bring you back to X" banner, or null when it's absent. */
async function bannerName(dialog: ESPHomeAddComponentDialog): Promise<string | null> {
  await dialog.updateComplete;
  return dialog.shadowRoot?.querySelector(".return-banner strong")?.textContent ?? null;
}

afterEach(() => {
  _clearComponentCache();
  vi.clearAllMocks();
});

describe("nested dependency detours", () => {
  it("suspends each level and returns through them in order", async () => {
    const { dialog, d } = await makeDialog();
    d._selected = anova;
    setForm(d, { currentValues: { name: "Anova Cooker" } });

    await addDep(d, "ble_client");
    expect(d._selected).toBe(bleClient);
    expect(await bannerName(dialog)).toBe("Anova Cooker");

    setForm(d, { currentValues: { mac_address: "AA:BB:CC:DD:EE:FF" } });
    await addDep(d, "esp32_ble_tracker");
    expect(d._selected).toBe(tracker);
    expect(d._detourStack.map((f) => f.component)).toEqual([anova, bleClient]);
    expect(await bannerName(dialog)).toBe("BLE Client");

    // Adding the hub returns to the ble_client form, with its own values and
    // the hub's id ready for the reference field.
    await d._submitComponent({ id: "tracker_1" });
    expect(d._selected).toBe(bleClient);
    expect(d._returnValues).toEqual({ mac_address: "AA:BB:CC:DD:EE:FF" });
    expect(d._prefillReference).toEqual({ domain: "esp32_ble_tracker", id: "tracker_1" });
    expect(await bannerName(dialog)).toBe("Anova Cooker");

    // Adding the client returns to the cooker instead of closing the dialog.
    await d._submitComponent({ id: "ble_client_1" });
    expect(d._selected).toBe(anova);
    expect(d._returnValues).toEqual({ name: "Anova Cooker" });
    expect(d._prefillReference).toEqual({ domain: "ble_client", id: "ble_client_1" });
    expect(d._detourStack).toHaveLength(0);
    expect(await bannerName(dialog)).toBeNull();
  });

  it("backs out one level per click", async () => {
    const { dialog, d } = await makeDialog();
    d._selected = anova;
    setForm(d, { currentValues: { name: "Anova Cooker" } });
    await addDep(d, "ble_client");
    setForm(d, { currentValues: { mac_address: "AA:BB:CC:DD:EE:FF" } });
    await addDep(d, "esp32_ble_tracker");

    d._onBack();
    expect(d._selected).toBe(bleClient);
    expect(await bannerName(dialog)).toBe("Anova Cooker");

    d._onBack();
    expect(d._selected).toBe(anova);
    expect(d._returnValues).toEqual({ name: "Anova Cooker" });
    expect(await bannerName(dialog)).toBeNull();

    d._onBack();
    expect(d._selected).toBeNull();
  });
});
