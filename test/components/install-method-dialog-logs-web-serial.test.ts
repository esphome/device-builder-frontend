/**
 * @vitest-environment happy-dom
 *
 * Logs mode on an insecure origin: in-app Web Serial is blocked and the
 * external flasher only flashes, so the dialog offers a "Plug into this
 * computer" row that opens ESPHome Web (a secure-context origin) with the
 * ``?dashboard_logs`` hint. Clicking it opens a new tab rather than selecting
 * an in-app method.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

function setEnv(opts: { serial: boolean; secure: boolean; href: string }) {
  if (opts.serial) {
    Object.defineProperty(navigator, "serial", { configurable: true, value: {} });
  } else if ("serial" in navigator) {
    delete (navigator as any).serial;
  }
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: opts.secure,
  });
  const u = new URL(opts.href);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { hostname: u.hostname, href: u.href },
  });
}

async function mount(mode: "install" | "logs"): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  (dialog as any)._localize = defaultLocalize;
  (dialog as any)._api = {};
  dialog.deviceState = DeviceState.ONLINE;
  dialog.mode = mode;
  dialog.deviceTargetPlatform = "esp32";
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}

// The USB-icon row (either the in-app row or the web-logs link, depending on
// mode/availability).
const usbRow = (d: ESPHomeInstallMethodDialog): HTMLElement | null =>
  (Array.from(d.shadowRoot?.querySelectorAll(".option") ?? []).find((o) =>
    o.querySelector('wa-icon[name="usb"]')
  ) as HTMLElement | undefined) ?? null;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  if (origSerial) Object.defineProperty(navigator, "serial", origSerial);
  else if ("serial" in navigator) delete (navigator as any).serial;
  if (origSecure) Object.defineProperty(window, "isSecureContext", origSecure);
  if (origLocation) Object.defineProperty(window, "location", origLocation);
});

describe("install-method-dialog logs → ESPHome Web (insecure origin)", () => {
  it("opens web.esphome.io/?dashboard_logs from the USB row", async () => {
    setEnv({ serial: false, secure: false, href: "http://homeassistant.local:8123/" });
    const dialog = await mount("logs");
    const row = usbRow(dialog);
    expect(row).toBeTruthy();

    const open = vi.spyOn(window, "open").mockReturnValue(null);
    row!.click();
    expect(open).toHaveBeenCalledWith(
      "https://web.esphome.io/?dashboard_logs",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("does not open a tab in logs mode when Web Serial is available (secure)", async () => {
    setEnv({ serial: true, secure: true, href: "https://localhost:6052/" });
    const dialog = await mount("logs");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    // The in-app USB row is present here; clicking it selects a method, not a link.
    usbRow(dialog)?.click();
    expect(open).not.toHaveBeenCalled();
  });

  it("does not open a tab in install mode on an insecure origin", async () => {
    setEnv({ serial: false, secure: false, href: "http://homeassistant.local:8123/" });
    const dialog = await mount("install");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    // Install mode shows the external-flasher USB row, which selects web-flash.
    usbRow(dialog)?.click();
    expect(open).not.toHaveBeenCalled();
  });
});
