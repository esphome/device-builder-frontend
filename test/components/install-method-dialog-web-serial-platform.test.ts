/**
 * @vitest-environment happy-dom
 *
 * Browser Web Serial (esptool-js) is ESP-only. Non-ESP targets — RP2040 /
 * RP2350, libretiny (bk72xx / rtl87xx / ln882x) — can't be flashed from
 * the browser, so the Web Serial install row is hidden for them; server-serial
 * (`esphome run`) stays available, even on localhost where it's normally
 * collapsed into Web Serial.
 *
 * nRF52 is a special case: it doesn't get the esptool Web Serial row but
 * does get its own nRF DFU row when Web Serial is available.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

vi.mock("@home-assistant/webawesome/dist/components/callout/callout.js", () => ({}));

import { DeviceState } from "../../src/api/types/devices.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";
import {
  restoreWebSerialEnv,
  setLocalhostWithWebSerial,
} from "./_install-method-dialog-env.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(platform: string): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  (dialog as any)._localize = defaultLocalize;
  (dialog as any)._api = {};
  dialog.deviceState = DeviceState.ONLINE;
  dialog.deviceTargetPlatform = platform;
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}

// Rows are identified by their leading icon: Web Serial uses "usb",
// server-serial uses "serial-port". The nRF DFU row shares the "chip" icon
// with the bootloader row, so it's matched by title instead.
const hasWebSerialRow = (d: ESPHomeInstallMethodDialog): boolean =>
  !!d.shadowRoot!.querySelector('wa-icon[name="usb"]');
const hasNrfDfuRow = (d: ESPHomeInstallMethodDialog): boolean =>
  [...d.shadowRoot!.querySelectorAll(".option .title")].some(
    (el) => el.textContent?.trim() === defaultLocalize("dashboard.install_method_nrf_dfu")
  );
const hasServerSerialRow = (d: ESPHomeInstallMethodDialog): boolean =>
  !!d.shadowRoot!.querySelector('wa-icon[name="serial-port"]');
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  setLocalhostWithWebSerial();
});

afterEach(() => {
  restoreWebSerialEnv();
  vi.restoreAllMocks();
});

describe("install-method-dialog platform gating", () => {
  // ESPHome's platform key for both RP2 chips is "rp2"; the legacy
  // "rp2040" spelling and "rp2350" are included defensively.
  it.each(["rp2", "rp2040", "rp2350", "bk72xx", "rtl87xx", "ln882x"])(
    "hides Web Serial and keeps server-serial for non-ESP platform %s",
    async (platform) => {
      const d = await mount(platform);
      expect(hasWebSerialRow(d)).toBe(false);
      expect(hasServerSerialRow(d)).toBe(true);
    }
  );

  it.each(["esp32", "esp32c3", "esp32s3", "esp8266", "esp8285"])(
    "shows Web Serial for ESP platform %s",
    async (platform) => {
      const d = await mount(platform);
      expect(hasWebSerialRow(d)).toBe(true);
    }
  );

  it("shows nRF DFU row and hides Web Serial for nrf52", async () => {
    const d = await mount("nrf52");
    expect(hasWebSerialRow(d)).toBe(false);
    expect(hasNrfDfuRow(d)).toBe(true);
    expect(hasServerSerialRow(d)).toBe(true);
  });
});
