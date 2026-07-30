/**
 * @vitest-environment happy-dom
 *
 * Pins that the dashboard re-binds the install/logs method picker's device
 * snapshot to the live object on every ``_devices`` change, so the picker's
 * online-gated OTA row tracks the device coming back after an OTA (#1431).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./_mock-dashboard-children.js";

import { flushMicrotasks } from "../_dom.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { DeviceState } from "../../src/api/types/devices.js";
import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";

const OFFLINE = makeConfiguredDevice({
  runtime_state: { state: DeviceState.OFFLINE },
});

async function mountWithPickerOpen(): Promise<ESPHomePageDashboard> {
  const page = new ESPHomePageDashboard();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._devices = [OFFLINE];
  // Loaded, so render() produces the real dialog tree (not the skeleton) and
  // the .deviceState binding under test actually evaluates.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._devicesLoaded = true;
  page._installMethodDevice = OFFLINE;
  page._installMethodMode = "logs";
  page._installMethodOpen = true;
  document.body.appendChild(page);
  await page.updateComplete;
  await flushMicrotasks(8);
  return page;
}

function pickerDeviceState(page: ESPHomePageDashboard): DeviceState | undefined {
  const dialog = page.shadowRoot!.querySelector("esphome-install-method-dialog");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (dialog as any)?.deviceState;
}

describe("dashboard install-method picker device re-bind", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = "";
  });

  it("swaps the snapshot for the live object when the device comes back online", async () => {
    const page = await mountWithPickerOpen();
    expect(pickerDeviceState(page)).toBe(DeviceState.OFFLINE);

    const online = makeConfiguredDevice({
      runtime_state: { state: DeviceState.ONLINE },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._devices = [online];
    await page.updateComplete;
    expect(page._installMethodDevice).toBe(online);
    expect(page._installMethodOpen).toBe(true);
    // The user-visible link: the dialog prop that gates the OTA row.
    expect(pickerDeviceState(page)).toBe(DeviceState.ONLINE);
  });

  it("closes the picker when the device leaves the list", async () => {
    const page = await mountWithPickerOpen();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (page as any)._devices = [];
    await page.updateComplete;
    expect(page._installMethodDevice).toBeNull();
    expect(page._installMethodOpen).toBe(false);
  });
});
