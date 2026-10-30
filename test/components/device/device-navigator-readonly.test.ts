/**
 * @vitest-environment happy-dom
 *
 * Pins the navigator's read-only mode (package file editor): no "+ Add"
 * actions, which open dialogs that write through device-only commands, and
 * file-level header copy.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";

async function mountNavigator(readonly: boolean): Promise<ESPHomeDeviceNavigator> {
  const nav = new ESPHomeDeviceNavigator();
  nav.yaml = "sensor:\n  - platform: uptime\n    name: Uptime\n";
  nav.readonly = readonly;
  nav.openSections = new Set([0, 1, 2]);
  document.body.appendChild(nav);
  await nav.updateComplete;
  return nav;
}

const root = (nav: ESPHomeDeviceNavigator) => nav.shadowRoot!;

describe("device-navigator readonly", () => {
  it("drops the add actions", async () => {
    const nav = await mountNavigator(true);
    expect(root(nav).querySelectorAll(".action-item")).toHaveLength(0);
    // Only the header blurb; no per-section "add things" copy.
    expect(root(nav).querySelectorAll("p.italic")).toHaveLength(1);
    expect(root(nav).querySelector(".card-title")?.textContent?.trim()).toBe(
      "device.navigator_title_file"
    );
  });

  it("keeps them on a device", async () => {
    const nav = await mountNavigator(false);
    expect(root(nav).querySelectorAll(".action-item").length).toBeGreaterThan(0);
    expect(root(nav).querySelector(".card-title")?.textContent?.trim()).toBe(
      "device.navigator_title"
    );
  });

  it("still lists the file's sections", async () => {
    const nav = await mountNavigator(true);
    expect(root(nav).querySelectorAll(".nav-item").length).toBeGreaterThan(0);
  });
});
