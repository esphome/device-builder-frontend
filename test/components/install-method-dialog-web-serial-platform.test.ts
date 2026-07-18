/**
 * @vitest-environment happy-dom
 *
 * Browser Web Serial (esptool-js) is ESP-only. Non-ESP targets — RP2040 /
 * RP2350, nrf52, libretiny (bk72xx / rtl87xx / ln882x) — can't be flashed from
 * the browser, so the Web Serial install row is hidden for them; server-serial
 * (`esphome run`) stays available, even on localhost where it's normally
 * collapsed into Web Serial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/callout/callout.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

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
// server-serial uses "serial-port".
const hasWebSerialRow = (d: ESPHomeInstallMethodDialog): boolean =>
  !!d.shadowRoot!.querySelector('wa-icon[name="usb"]');
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
  // ESPHome's platform key for RP2350 is "rp2040"; "rp2350" included defensively.
  it.each(["rp2040", "rp2350", "nrf52", "bk72xx", "rtl87xx", "ln882x"])(
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
});
