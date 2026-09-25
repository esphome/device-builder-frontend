/**
 * @vitest-environment happy-dom
 *
 * Browser Web Serial flashing (esptool-js) is ESP-only. Non-ESP targets — RP2040 /
 * RP2350, libretiny (bk72xx / rtl87xx / ln882x) — can't be flashed from
 * the browser, so the Web Serial install row is hidden for them; server-serial
 * (`esphome run`) stays available, even on localhost where it's normally
 * collapsed into Web Serial.
 *
 * nRF52 and RP2 are special cases: they don't get the esptool Web Serial row
 * but do get their own in-browser rows when Web Serial is available. In logs
 * mode the Web Serial row also covers RP2, whose native CDC console the
 * browser can read like any other port.
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
async function mount(
  platform: string,
  mode: "install" | "logs" = "install"
): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  (dialog as any)._localize = defaultLocalize;
  (dialog as any)._api = {};
  dialog.deviceState = DeviceState.ONLINE;
  dialog.deviceTargetPlatform = platform;
  dialog.mode = mode;
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
const hasRp2Row = (d: ESPHomeInstallMethodDialog): boolean =>
  [...d.shadowRoot!.querySelectorAll(".option .title")].some(
    (el) => el.textContent?.trim() === defaultLocalize("dashboard.install_method_rp2_uf2")
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
    expect(hasRp2Row(d)).toBe(false);
    expect(hasServerSerialRow(d)).toBe(true);
  });

  // The Pico row needs only Web Serial (for the 1200-baud reset); WebUSB
  // decides the write button inside the dialog, not the row.
  it.each(["rp2", "rp2040", "rp2350"])("shows the Pico row for %s", async (platform) => {
    const d = await mount(platform);
    expect(hasRp2Row(d)).toBe(true);
    expect(hasNrfDfuRow(d)).toBe(false);
  });

  it.each(["esp32", "bk72xx"])("hides the Pico row for %s", async (platform) => {
    const d = await mount(platform);
    expect(hasRp2Row(d)).toBe(false);
  });

  it("hides the Pico row in logs mode (flash-only)", async () => {
    const d = await mount("rp2", "logs");
    expect(hasRp2Row(d)).toBe(false);
  });
});

describe("install-method-dialog logs-mode platform gating", () => {
  // The Pico's CDC console reads like any other port, so logs get the Web
  // Serial row; on localhost that collapses the server-serial row, as for ESP.
  it.each(["rp2", "rp2040", "rp2350", "esp32"])(
    "shows Web Serial logs and drops server-serial for %s",
    async (platform) => {
      const d = await mount(platform, "logs");
      expect(hasWebSerialRow(d)).toBe(true);
      expect(hasServerSerialRow(d)).toBe(false);
    }
  );

  it.each(["bk72xx", "nrf52"])("keeps logs on server-serial for %s", async (platform) => {
    const d = await mount(platform, "logs");
    expect(hasWebSerialRow(d)).toBe(false);
    expect(hasServerSerialRow(d)).toBe(true);
  });

  it("keeps the install picker unchanged for rp2", async () => {
    const d = await mount("rp2");
    expect(hasWebSerialRow(d)).toBe(false);
    expect(hasServerSerialRow(d)).toBe(true);
  });
});
