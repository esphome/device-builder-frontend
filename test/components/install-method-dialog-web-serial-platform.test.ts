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

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { DeviceState } from "../../src/api/types/devices.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const origSerial = Object.getOwnPropertyDescriptor(navigator, "serial");
const origSecure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
const origLocation = Object.getOwnPropertyDescriptor(window, "location");

// Localhost, secure, Web Serial available — the case where server-serial is
// normally dropped in favour of Web Serial.
function setLocalhostWithWebSerial() {
  Object.defineProperty(navigator, "serial", { configurable: true, value: {} });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { hostname: "localhost", href: "http://localhost:6052/" },
  });
}

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
  document.body.innerHTML = "";
  if (origSerial) Object.defineProperty(navigator, "serial", origSerial);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  else if ("serial" in navigator) delete (navigator as any).serial;
  if (origSecure) Object.defineProperty(window, "isSecureContext", origSecure);
  if (origLocation) Object.defineProperty(window, "location", origLocation);
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
