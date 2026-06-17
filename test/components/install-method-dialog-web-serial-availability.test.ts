/**
 * @vitest-environment happy-dom
 *
 * On an insecure origin (e.g. http://0.0.0.0:6052) Chrome hides
 * navigator.serial, so the Web Serial row must explain the real blocker and
 * offer the 127.0.0.1 loopback (a secure context that hits the same backend)
 * rather than the misleading "needs Chrome" copy.
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

async function mount(): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  (dialog as any)._localize = defaultLocalize;
  (dialog as any)._api = {}; // detectEnvironment only needs serverInfo?.ha_addon
  dialog.deviceState = DeviceState.ONLINE;
  // Web Serial availability messaging only applies to ESP (esptool) platforms;
  // the row is hidden for non-ESP targets.
  dialog.deviceTargetPlatform = "esp32";
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}

const webSerialRow = (d: ESPHomeInstallMethodDialog): Element | null =>
  d.shadowRoot?.querySelector(".option--disabled") ?? null;
/* eslint-enable @typescript-eslint/no-explicit-any */

afterEach(() => {
  document.body.innerHTML = "";
  if (origSerial) Object.defineProperty(navigator, "serial", origSerial);
  else if ("serial" in navigator) delete (navigator as any).serial;
  if (origSecure) Object.defineProperty(window, "isSecureContext", origSecure);
  if (origLocation) Object.defineProperty(window, "location", origLocation);
  vi.restoreAllMocks();
});

describe("install-method-dialog Web Serial availability", () => {
  it("on 0.0.0.0 keeps the disabled row with a 127.0.0.1 loopback link", async () => {
    setEnv({ serial: false, secure: false, href: "http://0.0.0.0:6052/" });
    const dialog = await mount();
    const row = webSerialRow(dialog);
    expect(row).not.toBeNull();
    const link = row!.querySelector("a.inline-link") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("http://127.0.0.1:6052/");
    expect(link!.textContent).toContain("127.0.0.1:6052");
    // Framed as a requirement (secure origin), not a guaranteed fix.
    expect(row!.textContent).toContain("secure origin");
  });

  it("on a secure origin without the API shows the unsupported-browser copy", async () => {
    setEnv({ serial: false, secure: true, href: "https://example.com/" });
    const dialog = await mount();
    const row = webSerialRow(dialog);
    expect(row).not.toBeNull();
    expect(row!.querySelector("a.inline-link")).toBeNull();
    // Browser-agnostic wording (Chrome / Edge / Firefox 151+), no loopback link.
    expect(row!.textContent).toContain("Web Serial support");
  });
});
