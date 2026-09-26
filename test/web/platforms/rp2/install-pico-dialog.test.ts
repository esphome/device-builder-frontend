// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));
vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));

const fetchEsphomeWebManifest = vi.fn();
vi.mock("../../../../src/web/util/esphome-web-firmware.js", () => ({
  fetchEsphomeWebManifest: (...args: unknown[]) => fetchEsphomeWebManifest(...args),
}));

vi.mock("../../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../../src/components/install-details-log.js", () => ({}));
const mocks = vi.hoisted(() => ({
  loadPicoImage: vi.fn(),
  picoUf2Url: vi.fn(),
  flashPico: vi.fn(),
  touchIntoBootloader: vi.fn(),
  loadPicoboot: vi.fn(async () => ({})),
}));
vi.mock("../../../../src/web/platforms/rp2/pico-image.js", () => ({
  loadPicoImage: mocks.loadPicoImage,
  picoUf2Url: mocks.picoUf2Url,
}));
vi.mock("../../../../src/platforms/rp2/rp2-flash.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  flashPico: mocks.flashPico,
}));
vi.mock("../../../../src/util/serial-bootloader-touch.js", () => ({
  touchIntoBootloader: mocks.touchIntoBootloader,
}));
vi.mock("../../../../src/platforms/rp2/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadPicoboot: mocks.loadPicoboot,
}));

import toast from "sonner-js";

import { makeUsbPort } from "../../_make-web-serial-port.js";
import { PicoFlashError } from "../../../../src/platforms/rp2/rp2-flash.js";
import { ESPHomeWebInstallPicoDialog } from "../../../../src/web/platforms/rp2/esphome-web-install-pico-dialog.js";
import { PICO_PICK } from "../../../../src/web/platforms/rp2/pico-port-filter.js";

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
  delete (navigator as any).serial;
});

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
    mocks.picoUf2Url.mockReturnValue("https://firmware.esphome.io/pico.uf2");

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
    mocks.picoUf2Url.mockReturnValue("https://firmware.esphome.io/pico.uf2");
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

  beforeEach(() => {
    Object.defineProperty(navigator, "usb", { configurable: true, value: {} });
    mocks.loadPicoImage.mockResolvedValue(image);
    // Like the real helper, the write awaits the image it was handed and
    // reports a rejection as its own failure kind.
    mocks.flashPico.mockImplementation(async (uf2) => {
      await Promise.resolve(uf2).catch((err: unknown) => {
        throw new PicoFlashError("image", err);
      });
      return true;
    });
  });

  it("keeps the download steps where WebUSB is missing, without fetching the image", async () => {
    delete (navigator as any).usb;
    fetchEsphomeWebManifest.mockResolvedValue({ version: "1" });
    mocks.picoUf2Url.mockReturnValue("https://example/x.uf2");
    const el = await mount();
    expect(text(el)).toContain("web.pico.setup_step_4");
    expect(button(el, "dashboard.install")).toBeUndefined();
    expect(mocks.loadPicoImage).not.toHaveBeenCalled();
  });

  it("fetches the image and warms the engine on open, without the download manifest", async () => {
    const el = await mount();
    expect(mocks.loadPicoImage).toHaveBeenCalledOnce();
    expect(mocks.loadPicoboot).toHaveBeenCalledOnce();
    expect(fetchEsphomeWebManifest).not.toHaveBeenCalled();
    expect(text(el)).toContain("web.pico.install_step_bootsel");
  });

  it("installs over PICOBOOT with progress, then Continue hands over the port", async () => {
    let opened!: () => void;
    mocks.flashPico.mockImplementation(async (uf2, hooks) => {
      await uf2;
      await new Promise<void>((r) => (opened = r));
      hooks.onDeviceOpened?.();
      hooks.onProgress(50);
      return true;
    });
    const el = await mount();
    button(el, "dashboard.install").click();
    await settle(el);
    // Until the device is claimed the card connects; the bar comes with the write.
    expect(card(el).statusMessage).toBe("firmware.status_connecting");
    expect(card(el).progress).toBeNull();
    opened();
    await settle(el);
    expect(mocks.flashPico).toHaveBeenCalledWith(expect.any(Promise), expect.anything());
    // The status lives on the progress card's properties (the element is stubbed).
    expect(card(el).state).toBe("success");
    expect(card(el).statusMessage).toBe("web.pico.setup_step_5");
    const connected = vi.fn();
    el.addEventListener("pico-connected", connected);
    const port = makeUsbPort(0x2e8a, 0xf00a);
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: vi.fn(async () => port) },
    });
    button(el, "onboarding.wizard.continue").click();
    await settle(el);
    expect(connected).toHaveBeenCalledOnce();
    // The picker lists every Raspberry Pi device; a debug probe is turned away.
    connected.mockClear();
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: vi.fn(async () => makeUsbPort(0x2e8a, 0x000c)) },
    });
    button(el, "onboarding.wizard.continue").click();
    await settle(el);
    expect(connected).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("web.pico.probe_picked");
  });

  it("streams the engine's step lines into the card's details log", async () => {
    mocks.flashPico.mockImplementation(async (uf2, hooks) => {
      await uf2;
      hooks.onLog?.("Claimed the RP2 Boot device (2e8a:0003)");
      hooks.onDeviceOpened?.();
      return true;
    });
    const el = await mount();
    button(el, "dashboard.install").click();
    await settle(el);
    const log = el.shadowRoot!.querySelector("esphome-install-details-log") as any;
    expect(log.lines).toEqual(["Claimed the RP2 Boot device (2e8a:0003)"]);
  });

  it("keeps the reset step's lines when Install follows it, and drops them on a fresh run", async () => {
    mocks.touchIntoBootloader.mockImplementation(async ({ onLog }) => {
      onLog?.("Touching the port at 1200 baud");
      return true;
    });
    mocks.flashPico.mockImplementation(async (uf2, hooks) => {
      await uf2;
      hooks.onLog?.("Claimed the RP2 Boot device (2e8a:0003)");
      return true;
    });
    const el = await mount();
    button(el, "web.pico.install_reset_action").click();
    await settle(el);
    button(el, "dashboard.install").click();
    await settle(el);
    const log = () => el.shadowRoot!.querySelector("esphome-install-details-log") as any;
    expect(log().lines).toEqual([
      "Touching the port at 1200 baud",
      "Claimed the RP2 Boot device (2e8a:0003)",
    ]);
    // Retry from the start: a new run, a new log.
    (el as any)._state = "idle";
    await settle(el);
    button(el, "dashboard.install").click();
    await settle(el);
    expect(log().lines).toEqual(["Claimed the RP2 Boot device (2e8a:0003)"]);
  });

  it("goes back to the start when the chooser is dismissed", async () => {
    mocks.flashPico.mockResolvedValue(false);
    const el = await mount();
    button(el, "dashboard.install").click();
    await settle(el);
    expect(card(el)).toBeNull();
    expect(button(el, "dashboard.install")).toBeDefined();
  });

  it("shows the failure copy with Retry, and refetches an image that failed to load", async () => {
    // The prefetch on open fails, and so does the refetch behind Install.
    mocks.loadPicoImage
      .mockReset()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(image);
    const el = await mount();
    await settle(el);
    button(el, "dashboard.install").click();
    await settle(el);
    expect(card(el).state).toBe("error");
    expect(card(el).statusMessage).toBe("web.pico.install_image_failed");
    expect(mocks.loadPicoImage).toHaveBeenCalledTimes(2);
    button(el, "command.retry").click();
    await settle(el);
    mocks.flashPico.mockRejectedValue(new PicoFlashError("rp2350"));
    button(el, "dashboard.install").click();
    await settle(el);
    expect(card(el).statusMessage).toBe("firmware.rp2_rp2350_device");
  });

  it("names this page's own reset action for a device that is not in BOOTSEL", async () => {
    mocks.flashPico.mockRejectedValue(new PicoFlashError("not-bootsel"));
    const el = await mount();
    button(el, "dashboard.install").click();
    await settle(el);
    expect(card(el).statusMessage).toBe("web.pico.install_not_bootsel");
  });

  it("hands the image to the write as a promise, so the chooser is not held up by the download", async () => {
    let finish!: (image: unknown) => void;
    mocks.loadPicoImage.mockReset().mockReturnValue(new Promise((r) => (finish = r)));
    mocks.flashPico.mockResolvedValue(true);
    const el = await mount();
    button(el, "dashboard.install").click();
    await settle(el);
    expect(mocks.flashPico).toHaveBeenCalledWith(expect.any(Promise), expect.anything());
    finish(image);
  });

  it("resets a running Pico into BOOTSEL and waits for it, keeping Install at hand", async () => {
    mocks.touchIntoBootloader.mockResolvedValue(true);
    const el = await mount();
    button(el, "web.pico.install_reset_action").click();
    await settle(el);
    expect(mocks.touchIntoBootloader).toHaveBeenCalledWith(
      expect.objectContaining({ filters: PICO_PICK.filters })
    );
    expect(card(el).statusMessage).toBe("firmware.rp2_wait_title");
    expect(card(el).statusDetail).toBe("web.pico.install_waiting");
    // The setup steps give way to the card's own instruction.
    expect(text(el)).not.toContain("web.pico.install_step_bootsel");
    expect(button(el, "dashboard.install")).toBeDefined();
  });

  it("titles a failed reset as a connection failure, not a failed install", async () => {
    mocks.touchIntoBootloader.mockRejectedValue(new Error("no port"));
    const el = await mount();
    button(el, "web.pico.install_reset_action").click();
    await settle(el);
    expect(card(el).statusMessage).toBe("firmware.browser_flash_connect_failed");
    expect(card(el).statusDetail).toBe("no port");
  });
});
