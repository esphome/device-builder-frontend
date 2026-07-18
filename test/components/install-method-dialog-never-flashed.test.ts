/**
 * @vitest-environment happy-dom
 *
 * A never-flashed device leads with the USB rows (a queued OTA can never
 * reach it) and gets a first-install callout; a previously-flashed
 * offline device keeps OTA first with an offline callout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/callout/callout.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { DeviceState } from "../../src/api/types/devices.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";
import {
  restoreWebSerialEnv,
  setLocalhostWithWebSerial,
} from "./_install-method-dialog-env.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(opts: {
  neverFlashed?: boolean;
  state?: DeviceState;
  platform?: string;
  mode?: "install" | "logs";
}): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  (dialog as any)._localize = (key: string) => key;
  (dialog as any)._api = {};
  dialog.neverFlashed = opts.neverFlashed ?? false;
  dialog.deviceState = opts.state ?? DeviceState.UNKNOWN;
  dialog.deviceTargetPlatform = opts.platform ?? "esp32";
  dialog.mode = opts.mode ?? "install";
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}

// Rows are identified by their leading icon: OTA is "wifi", Web Serial
// "usb", server-serial "serial-port".
function rowIconOrder(d: ESPHomeInstallMethodDialog): string[] {
  return [...d.shadowRoot!.querySelectorAll(".list .option > wa-icon")].map((icon) =>
    icon.getAttribute("name")!
  );
}

const callout = (d: ESPHomeInstallMethodDialog): Element | null =>
  d.shadowRoot!.querySelector(".method-notice");
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  setLocalhostWithWebSerial();
});

afterEach(() => {
  restoreWebSerialEnv();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("install-method-dialog never-flashed ordering", () => {
  it("puts the USB row first with a first-install callout", async () => {
    const d = await mount({ neverFlashed: true });
    const order = rowIconOrder(d);
    expect(order[0]).toBe("usb");
    expect(order[order.length - 1]).toBe("wifi");
    expect(callout(d)!.getAttribute("variant")).toBe("brand");
    expect(callout(d)!.textContent).toContain(
      "dashboard.install_method_first_install_notice"
    );
  });

  it("promotes server-serial when the platform has no Web Serial row", async () => {
    const d = await mount({ neverFlashed: true, platform: "rp2040" });
    const order = rowIconOrder(d);
    expect(order[0]).toBe("serial-port");
    expect(order[order.length - 1]).toBe("wifi");
  });

  it("swaps the OTA description to the never-flashed copy", async () => {
    const d = await mount({ neverFlashed: true });
    expect(d.shadowRoot!.textContent).toContain(
      "dashboard.install_method_network_desc_never_flashed"
    );
  });

  it("keeps OTA first with a warning callout for a flashed offline device", async () => {
    const d = await mount({ state: DeviceState.OFFLINE });
    expect(rowIconOrder(d)[0]).toBe("wifi");
    expect(callout(d)!.getAttribute("variant")).toBe("warning");
    expect(callout(d)!.textContent).toContain("dashboard.install_method_offline_notice");
    expect(d.shadowRoot!.textContent).toContain(
      "dashboard.install_method_network_desc_offline"
    );
  });

  it("shows no callout and OTA first for an online device", async () => {
    const d = await mount({ state: DeviceState.ONLINE });
    expect(rowIconOrder(d)[0]).toBe("wifi");
    expect(callout(d)).toBeNull();
  });

  it("leaves logs mode untouched even for a never-flashed device", async () => {
    const d = await mount({
      neverFlashed: true,
      state: DeviceState.ONLINE,
      mode: "logs",
    });
    expect(rowIconOrder(d)[0]).toBe("wifi");
    expect(callout(d)).toBeNull();
  });
});
