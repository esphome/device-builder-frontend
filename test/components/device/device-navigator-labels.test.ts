/**
 * @vitest-environment happy-dom
 *
 * Behavioral tests for ``device-navigator``'s core-section subtitle.
 * The esphome row must show the backend-resolved node name (so a
 * ``name: $devicename`` substitution renders the expanded hostname),
 * falling back to the raw YAML scalar when no resolved name is known.
 * The dialog children are no-oped so the element constructs in
 * happy-dom; see ``device-navigator-coalesce.test.ts``.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/device/add-automation-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-component-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-config-dialog.js", () => ({}));
vi.mock("../../../src/components/device/add-script-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeDeviceNavigator } from "../../../src/components/device/device-navigator.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";

async function mountNavigator(
  props: Partial<{ yaml: string; deviceName: string }> = {}
): Promise<ESPHomeDeviceNavigator> {
  const nav = new ESPHomeDeviceNavigator();
  if (props.yaml !== undefined) nav.yaml = props.yaml;
  if (props.deviceName !== undefined) nav.deviceName = props.deviceName;
  // Core is the first section; open it so its items render.
  nav.openSections = new Set([0]);
  document.body.appendChild(nav);
  await nav.updateComplete;
  return nav;
}

/** Subtitle text of the (single) rendered core nav item. */
function coreSubtitle(nav: ESPHomeDeviceNavigator): string | undefined {
  return nav.shadowRoot
    ?.querySelector(".nav-item .nav-item-subtitle")
    ?.textContent?.trim();
}

describe("device-navigator core subtitle", () => {
  // Clear the shared component-name cache around each test so a
  // resolved ``esphome`` entry from another test can't shift the
  // primary label and make these assertions order-dependent.
  beforeEach(() => {
    _clearComponentCache();
  });

  afterEach(() => {
    _clearComponentCache();
  });

  it("shows the resolved node name for a $var substitution", async () => {
    const nav = await mountNavigator({
      yaml: "esphome:\n  name: $devicename\n",
      deviceName: "acfloatmonitor32",
    });
    expect(coreSubtitle(nav)).toBe("acfloatmonitor32");
  });

  it("falls back to the raw scalar when no resolved name is known", async () => {
    const nav = await mountNavigator({
      yaml: "esphome:\n  name: $devicename\n",
      deviceName: "",
    });
    expect(coreSubtitle(nav)).toBe("$devicename");
  });

  it("prefers the resolved name even over a plain literal name", async () => {
    // The backend-resolved name is canonical; with a device in the
    // list we always show it for the esphome row.
    const nav = await mountNavigator({
      yaml: "esphome:\n  name: my_device\n",
      deviceName: "my_device",
    });
    expect(coreSubtitle(nav)).toBe("my_device");
  });
});
