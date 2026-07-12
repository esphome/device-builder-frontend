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
});

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
