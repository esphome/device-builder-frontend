/**
 * @vitest-environment happy-dom
 *
 * The single "Plug into this computer" USB row adapts to Web Serial
 * availability: an insecure origin (e.g. http://0.0.0.0:6052 or the HA add-on)
 * still flashes, by routing to the external secure-context flasher; only a
 * browser that lacks Web Serial entirely (secure origin, no API) is disabled.
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

async function mount(
  mode: "install" | "logs" = "install"
): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  (dialog as any)._localize = defaultLocalize;
  (dialog as any)._api = {}; // detectEnvironment only needs serverInfo?.ha_addon
  dialog.deviceState = DeviceState.ONLINE;
  dialog.mode = mode;
  // The USB row only applies to ESP (esptool) platforms.
  dialog.deviceTargetPlatform = "esp32";
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}

const serialRow = (d: ESPHomeInstallMethodDialog): Element | undefined =>
  Array.from(d.shadowRoot?.querySelectorAll(".option") ?? []).find((o) =>
    o.querySelector('wa-icon[name="serial-port"]')
  );

// Select by the usb icon, not the title or row order, so the selector isn't
// coupled to localized copy.
const usbRow = (d: ESPHomeInstallMethodDialog): Element | null =>
  Array.from(d.shadowRoot?.querySelectorAll(".option") ?? []).find((o) =>
    o.querySelector('wa-icon[name="usb"]')
  ) ?? null;

function methodOnClick(d: ESPHomeInstallMethodDialog, el: Element): string | null {
  let method: string | null = null;
  d.addEventListener(
    "select-method",
    (e) => {
      method = (e as CustomEvent).detail.method;
    },
    { once: true }
  );
  (el as HTMLElement).click();
  return method;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

afterEach(() => {
  if (origSerial) Object.defineProperty(navigator, "serial", origSerial);
  else if ("serial" in navigator) delete (navigator as any).serial;
  if (origSecure) Object.defineProperty(window, "isSecureContext", origSecure);
  if (origLocation) Object.defineProperty(window, "location", origLocation);
  vi.restoreAllMocks();
});

describe("install-method-dialog USB row availability", () => {
  it("on 0.0.0.0 routes to the external flasher but keeps the 127.0.0.1 jump", async () => {
    setEnv({ serial: false, secure: false, href: "http://0.0.0.0:6052/" });
    const dialog = await mount();
    const row = usbRow(dialog);
    expect(row).not.toBeNull();
    // Enabled (actionable), not the disabled hint state.
    expect(row!.classList.contains("option--disabled")).toBe(false);
    // Keep the local-flash escape hatch: a 127.0.0.1 link to switch origins.
    const link = row!.querySelector("a.inline-link") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("http://127.0.0.1:6052/");
    expect(link!.textContent).toContain("127.0.0.1:6052");
    // The row body still routes to the external flasher.
    expect(methodOnClick(dialog, row!)).toBe("web-flash");
    // Keep the server-serial row as a fallback: on an insecure origin we can't
    // tell a capable-but-blocked browser from one without Web Serial, so the
    // backend serial path must stay available.
    expect(serialRow(dialog)).not.toBeUndefined();
  });

  it("on an insecure origin with no loopback (HA-http) just uses the external flasher", async () => {
    setEnv({ serial: false, secure: false, href: "http://homeassistant.local:8123/" });
    const dialog = await mount();
    const row = usbRow(dialog);
    expect(row).not.toBeNull();
    expect(row!.classList.contains("option--disabled")).toBe(false);
    expect(row!.querySelector("a.inline-link")).toBeNull();
    expect(methodOnClick(dialog, row!)).toBe("web-flash");
  });

  it("in a secure context with Web Serial uses in-app flashing", async () => {
    setEnv({ serial: true, secure: true, href: "https://example.com/" });
    const dialog = await mount();
    const row = usbRow(dialog);
    expect(row).not.toBeNull();
    expect(row!.classList.contains("option--disabled")).toBe(false);
    expect(methodOnClick(dialog, row!)).toBe("web-serial");
  });

  it("disables the USB row when the browser lacks Web Serial entirely", async () => {
    setEnv({ serial: false, secure: true, href: "https://example.com/" });
    const dialog = await mount();
    const row = usbRow(dialog);
    expect(row).not.toBeNull();
    expect(row!.classList.contains("option--disabled")).toBe(true);
    // Disabled rows don't dispatch a method.
    expect(methodOnClick(dialog, row!)).toBeNull();
    expect(row!.textContent).toContain("Web Serial support");
  });

  it("in logs mode hides the USB row on an insecure origin (no web-flash logs)", async () => {
    // web-flash is install-only; logs over USB need in-app Web Serial, which an
    // insecure origin can't do. The row must not render a no-op web-flash here.
    setEnv({ serial: false, secure: false, href: "http://0.0.0.0:6052/" });
    const dialog = await mount("logs");
    expect(usbRow(dialog)).toBeNull();
    // Logs still have a serial path via server-serial.
    expect(serialRow(dialog)).not.toBeUndefined();
  });

  it("in logs mode with Web Serial shows the USB row routing to web-serial", async () => {
    setEnv({ serial: true, secure: true, href: "https://example.com/" });
    const dialog = await mount("logs");
    const row = usbRow(dialog);
    expect(row).not.toBeNull();
    expect(methodOnClick(dialog, row!)).toBe("web-serial");
  });

  it("drops the disabled USB row on localhost (server-serial covers it)", async () => {
    // 127.0.0.1 is a secure context; no navigator.serial => unsupported browser.
    setEnv({ serial: false, secure: true, href: "http://127.0.0.1:6052/" });
    const dialog = await mount();
    // No USB row: the server-serial row below carries the same actionable path.
    expect(usbRow(dialog)).toBeNull();
    expect(serialRow(dialog)).not.toBeUndefined();
  });
});
