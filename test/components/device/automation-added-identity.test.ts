/**
 * @vitest-environment happy-dom
 *
 * Pins the automation-added identity guards (#1479): a wizard round
 * trip that outlived a device switch names the previous device, and
 * neither relay may route the selection to its phantom key.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";
import { ESPHomeDeviceSectionConfig } from "../../../src/components/device/device-section-config.js";

const added = (configuration: string, sectionKey: string) =>
  new CustomEvent("automation-added", { detail: { configuration, sectionKey } });

describe("automation-added identity guards", () => {
  it("navigator relays a matching add and drops a mismatched one", () => {
    const nav = new ESPHomeDeviceNavigator();
    nav.configuration = "device.yaml";
    const selections: string[] = [];
    nav.addEventListener("section-select", (e) =>
      selections.push((e as CustomEvent<{ sectionKey: string }>).detail.sectionKey)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const relay = (nav as any)._onAutomationAdded as (e: CustomEvent) => void;
    relay.call(nav, added("device.yaml", "automation:script:s1"));
    relay.call(nav, added("other.yaml", "automation:script:phantom"));

    expect(selections).toEqual(["automation:script:s1"]);
  });

  it("section-config relays match and drop the same way", () => {
    const cfg = new ESPHomeDeviceSectionConfig();
    cfg.configuration = "device.yaml";
    const selections: string[] = [];
    cfg.addEventListener("section-select", (e) =>
      selections.push((e as CustomEvent<{ sectionKey: string }>).detail.sectionKey)
    );

    cfg._onAutomationAdded(added("device.yaml", "automation:script:s1"));
    cfg._onAutomationAdded(added("other.yaml", "automation:script:phantom"));
    cfg._onApiActionAdded(added("device.yaml", "automation:api_action:a1"));
    cfg._onApiActionAdded(added("other.yaml", "automation:api_action:phantom"));

    expect(selections).toEqual(["automation:script:s1", "automation:api_action:a1"]);
  });
});
