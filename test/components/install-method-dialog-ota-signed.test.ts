/**
 * @vitest-environment happy-dom
 *
 * A device that rejects unsigned OTA images leads with USB, disables the
 * network row and hides the OTA address card; logs mode is unaffected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

vi.mock("@home-assistant/webawesome/dist/components/callout/callout.js", () => ({}));

import { makeConfiguredDevice } from "../_make-configured-device.js";
import { DeviceState } from "../../src/api/types/devices.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";
import { installsFor } from "../../src/platforms/registry.js";
import {
  restoreWebSerialEnv,
  setLocalhostWithWebSerial,
} from "./_install-method-dialog-env.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(
  mode: "install" | "logs" = "install"
): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  (dialog as any)._localize = (key: string) => key;
  (dialog as any)._api = {};
  dialog.otaNeedsUsb = true;
  dialog.deviceState = DeviceState.ONLINE;
  dialog.deviceTargetPlatform = "esp32";
  dialog.platformInstalls = installsFor(
    makeConfiguredDevice({ target_platform: "esp32" })
  );
  dialog.mode = mode;
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}

const rows = (d: ESPHomeInstallMethodDialog): Element[] => [
  ...d.shadowRoot!.querySelectorAll(".list .option"),
];
const iconOf = (row: Element): string =>
  row.querySelector("wa-icon")!.getAttribute("name")!;
const otaRow = (d: ESPHomeInstallMethodDialog): Element =>
  rows(d).find((r) => iconOf(r) === "wifi")!;
const callout = (d: ESPHomeInstallMethodDialog): Element | null =>
  d.shadowRoot!.querySelector(".method-notice");

async function openAdvanced(d: ESPHomeInstallMethodDialog): Promise<void> {
  (d as any)._advancedExpanded = true;
  await d.updateComplete;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  setLocalhostWithWebSerial();
});

afterEach(() => {
  restoreWebSerialEnv();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("install-method-dialog ota-signed", () => {
  it("leads with USB and shows the signed-firmware callout", async () => {
    const d = await mount();
    expect(iconOf(rows(d)[0])).toBe("usb");
    expect(callout(d)!.textContent).toContain(
      "dashboard.install_method_ota_signed_notice"
    );
  });

  it("disables the network row with an explanation", async () => {
    const d = await mount();
    const row = otaRow(d);
    expect(row.classList.contains("option--disabled")).toBe(true);
    expect(row.textContent).toContain("dashboard.install_method_network_desc_ota_signed");
  });

  it("hides the OTA address card", async () => {
    const d = await mount();
    await openAdvanced(d);
    expect(d.shadowRoot!.querySelector(".option-collapsible")).toBeNull();
  });

  it("leaves logs mode untouched", async () => {
    const d = await mount("logs");
    expect(iconOf(rows(d)[0])).toBe("wifi");
    expect(otaRow(d).classList.contains("option--disabled")).toBe(false);
    expect(callout(d)).toBeNull();
    await openAdvanced(d);
    expect(d.shadowRoot!.querySelector(".option-collapsible")).not.toBeNull();
  });
});
