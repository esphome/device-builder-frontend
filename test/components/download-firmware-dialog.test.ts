/**
 * @vitest-environment happy-dom
 *
 * Behavioral guard for the firmware-format picker (#1083). The dialog
 * lists the platform-supplied binaries (Factory / OTA on ESP32) and
 * bubbles the chosen one as ``download-binary`` so the dashboard can
 * perform the download. Pins that every binary renders a row, that a
 * click and a keyboard activation each dispatch the right binary, and
 * that the optional description only shows when supplied.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import type { FirmwareBinary } from "../../src/api/types/firmware-jobs.js";
import { ESPHomeDownloadFirmwareDialog } from "../../src/components/download-firmware-dialog.js";

const DEVICE = {
  configuration: "kitchen.yaml",
  name: "kitchen",
  friendly_name: "Kitchen",
} as unknown as ConfiguredDevice;

const FACTORY: FirmwareBinary = { title: "Factory format", file: "firmware.factory.bin" };
const OTA: FirmwareBinary = {
  title: "OTA format",
  file: "firmware.ota.bin",
  description: "For HTTP updates.",
};

async function mount(): Promise<ESPHomeDownloadFirmwareDialog> {
  const el = new ESPHomeDownloadFirmwareDialog();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const options = (el: ESPHomeDownloadFirmwareDialog): HTMLElement[] =>
  Array.from(el.shadowRoot?.querySelectorAll<HTMLElement>(".option") ?? []);

describe("download-firmware-dialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders one row per binary with title and optional description", async () => {
    const el = await mount();
    el.open(DEVICE, [FACTORY, OTA]);
    await el.updateComplete;

    const rows = options(el);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Factory format");
    expect(rows[1].textContent).toContain("OTA format");
    // Description only renders for the entry that supplies one.
    expect(rows[1].textContent).toContain("For HTTP updates.");
    expect(rows[0].querySelector(".desc")).toBeNull();
  });

  it("dispatches download-binary with the clicked binary and closes", async () => {
    const el = await mount();
    el.open(DEVICE, [FACTORY, OTA]);
    await el.updateComplete;

    const onPick = vi.fn();
    el.addEventListener("download-binary", onPick as EventListener);
    options(el)[1].click();

    expect(onPick).toHaveBeenCalledTimes(1);
    const detail = (onPick.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({ device: DEVICE, binary: OTA });
  });

  it("activates a row on Enter", async () => {
    const el = await mount();
    el.open(DEVICE, [FACTORY, OTA]);
    await el.updateComplete;

    const onPick = vi.fn();
    el.addEventListener("download-binary", onPick as EventListener);
    options(el)[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );

    expect(onPick).toHaveBeenCalledTimes(1);
    const detail = (onPick.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.binary).toEqual(FACTORY);
  });
});
