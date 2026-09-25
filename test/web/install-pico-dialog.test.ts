// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));

const fetchEsphomeWebManifest = vi.fn();
const picoUf2Url = vi.fn();
vi.mock("../../src/web/util/esphome-web-firmware.js", () => ({
  fetchEsphomeWebManifest: (...args: unknown[]) => fetchEsphomeWebManifest(...args),
  picoUf2Url: (...args: unknown[]) => picoUf2Url(...args),
}));

vi.mock("../../src/components/process-terminal/process-terminal.js", () => ({}));
const picoFlash = vi.hoisted(() => ({
  loadPicoImage: vi.fn(),
  flashPico: vi.fn(),
  resetToBootloader: vi.fn(),
  requestSerialPort: vi.fn(),
}));
vi.mock("../../src/web/install/pico-flash.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadPicoImage: picoFlash.loadPicoImage,
  flashPico: picoFlash.flashPico,
}));
vi.mock("../../src/util/serial-bootloader-touch.js", () => ({
  resetToBootloader: picoFlash.resetToBootloader,
}));
vi.mock("../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: picoFlash.requestSerialPort,
}));

import toast from "sonner-js";
import { ESPHomeWebInstallPicoDialog } from "../../src/web/install/esphome-web-install-pico-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Flush the microtask queue and Lit's render loop enough times for the async
// _loadManifest() to settle and re-render.
async function settle(el: ESPHomeWebInstallPicoDialog): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await el.updateComplete;
  }
}

async function mount(): Promise<ESPHomeWebInstallPicoDialog> {
  const el = new ESPHomeWebInstallPicoDialog();
  (el as any)._localize = (k: string) => k;
  el.open = true;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  delete (navigator as any).usb;
});

const withWebUsb = () =>
  Object.defineProperty(navigator, "usb", { configurable: true, value: {} });
const text = (el: ESPHomeWebInstallPicoDialog) => el.shadowRoot!.textContent ?? "";
const card = (el: ESPHomeWebInstallPicoDialog) =>
  el.shadowRoot!.querySelector("esphome-process-terminal") as any;
const button = (el: ESPHomeWebInstallPicoDialog, label: string): HTMLElement =>
  [...el.shadowRoot!.querySelectorAll("wa-button")].find(
    (b) => b.textContent?.trim() === label
  ) as HTMLElement;

describe("esphome-web-install-pico-dialog", () => {
  it("renders the download link once the manifest loads", async () => {
    fetchEsphomeWebManifest.mockResolvedValue({});
    picoUf2Url.mockReturnValue("https://firmware.esphome.io/pico.uf2");

    const el = await mount();

    const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("a[download]");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://firmware.esphome.io/pico.uf2");
    expect(el.shadowRoot!.querySelector(".download-error")).toBeNull();
  });

  it("shows the loading placeholder while the manifest is in flight", async () => {
    // A fetch that never settles keeps the step in its loading state.
    fetchEsphomeWebManifest.mockReturnValue(new Promise(() => {}));

    const el = await mount();

    expect((el as any)._downloadFailed).toBe(false);
    expect(el.shadowRoot!.querySelector("a[download]")).toBeNull();
    expect(el.shadowRoot!.querySelector(".download-error")).toBeNull();
  });

  it("shows an inline error (and toasts) when the manifest fetch fails", async () => {
    fetchEsphomeWebManifest.mockRejectedValue(new Error("offline"));

    const el = await mount();

    expect((el as any)._downloadFailed).toBe(true);
    expect(el.shadowRoot!.querySelector(".download-error")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("a[download]")).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("retries and clears the error when reopened after a failure", async () => {
    fetchEsphomeWebManifest.mockRejectedValueOnce(new Error("offline"));

    const el = await mount();
    expect((el as any)._downloadFailed).toBe(true);

    // Reopen with a now-working fetch: the prior failure clears and the link renders.
    fetchEsphomeWebManifest.mockResolvedValue({});
    picoUf2Url.mockReturnValue("https://firmware.esphome.io/pico.uf2");
    el.open = false;
    await settle(el);
    el.open = true;
    await settle(el);

    expect((el as any)._downloadFailed).toBe(false);
    expect(el.shadowRoot!.querySelector("a[download]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".download-error")).toBeNull();
  });
});

describe("esphome-web-install-pico-dialog over WebUSB", () => {
  const image = { familyId: 0xe48bff56, ranges: [], totalBytes: 0 };

  it("keeps the download steps where WebUSB is missing", async () => {
    fetchEsphomeWebManifest.mockResolvedValue({ version: "1" });
    picoUf2Url.mockReturnValue("https://example/x.uf2");
    const el = await mount();
    expect(text(el)).toContain("web.pico.setup_step_4");
    expect(button(el, "dashboard.install")).toBeUndefined();
    expect(picoFlash.loadPicoImage).not.toHaveBeenCalled();
  });

  it("fetches the image on open and installs over PICOBOOT, then Continue hands over the port", async () => {
    withWebUsb();
    fetchEsphomeWebManifest.mockResolvedValue({ version: "1" });
    picoFlash.loadPicoImage.mockResolvedValue(image);
    picoFlash.flashPico.mockImplementation(async (_image, hooks) => {
      hooks.onProgress(50);
      return true;
    });
    const el = await mount();
    expect(picoFlash.loadPicoImage).toHaveBeenCalledOnce();
    expect(text(el)).toContain("web.pico.install_step_bootsel");
    button(el, "dashboard.install").click();
    await settle(el);
    expect(picoFlash.flashPico).toHaveBeenCalledWith(image, expect.anything());
    // The status lives on the progress card's properties (the element is stubbed).
    expect(card(el).statusMessage).toBe("web.pico.setup_step_5");
    const connected = vi.fn();
    el.addEventListener("pico-connected", connected);
    const port = {};
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: vi.fn(async () => port) },
    });
    button(el, "onboarding.wizard.continue").click();
    await settle(el);
    expect(connected).toHaveBeenCalledOnce();
    delete (navigator as any).serial;
  });

  it("goes back to the start when the chooser is dismissed", async () => {
    withWebUsb();
    picoFlash.loadPicoImage.mockResolvedValue(image);
    picoFlash.flashPico.mockResolvedValue(false);
    const el = await mount();
    button(el, "dashboard.install").click();
    await settle(el);
    expect((el as any)._state).toBe("idle");
    expect(button(el, "dashboard.install")).toBeDefined();
  });

  it("names the failure and offers Retry, refetching an image that failed to load", async () => {
    withWebUsb();
    picoFlash.loadPicoImage
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(image);
    const el = await mount();
    button(el, "dashboard.install").click();
    await settle(el);
    expect(card(el).statusDetail).toBe("web.pico.install_image_failed");
    button(el, "command.retry").click();
    await settle(el);
    picoFlash.flashPico.mockRejectedValue(
      new (await import("../../src/web/install/pico-flash.js")).PicoFlashError("rp2350")
    );
    button(el, "dashboard.install").click();
    await settle(el);
    expect(picoFlash.loadPicoImage).toHaveBeenCalledTimes(2);
    expect(card(el).statusDetail).toBe("firmware.rp2_rp2350_device");
  });

  it("resets a running Pico into BOOTSEL from its serial port", async () => {
    withWebUsb();
    picoFlash.loadPicoImage.mockResolvedValue(image);
    const port = {};
    picoFlash.requestSerialPort.mockResolvedValue(port);
    const el = await mount();
    button(el, "web.pico.install_reset_action").click();
    await settle(el);
    expect(picoFlash.resetToBootloader).toHaveBeenCalledWith(port);
    expect((el as any)._state).toBe("reset");
    expect(button(el, "dashboard.install")).toBeDefined();
  });
});
