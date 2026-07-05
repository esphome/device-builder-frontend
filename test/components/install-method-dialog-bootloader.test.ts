/**
 * @vitest-environment happy-dom
 *
 * The "Update bootloader" advanced option renders only when the host says the
 * device can accept it (canFlashBootloader), only in install mode, and only
 * while the device is online.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { DeviceState } from "../../src/api/types/devices.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(
  props: Partial<ESPHomeInstallMethodDialog>
): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  (dialog as any)._localize = defaultLocalize;
  (dialog as any)._api = {};
  dialog.deviceState = DeviceState.ONLINE;
  dialog.deviceTargetPlatform = "esp32";
  Object.assign(dialog, props);
  (dialog as any)._advancedExpanded = true;
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const bootloaderRow = (d: ESPHomeInstallMethodDialog): HTMLElement | null =>
  d.shadowRoot!.querySelector('wa-icon[name="chip"]')?.closest(".option") ?? null;

describe("install-method dialog bootloader option", () => {
  it("renders in the advanced section and emits select-method bootloader", async () => {
    const dialog = await mount({ canFlashBootloader: true });
    const row = bootloaderRow(dialog);
    expect(row).not.toBeNull();

    const selected = vi.fn();
    dialog.addEventListener("select-method", selected);
    row!.click();
    expect(selected).toHaveBeenCalledTimes(1);
    expect((selected.mock.calls[0][0] as CustomEvent).detail).toEqual({
      method: "bootloader",
    });
  });

  it("is hidden when the device can't accept a bootloader flash", async () => {
    const dialog = await mount({ canFlashBootloader: false });
    expect(bootloaderRow(dialog)).toBeNull();
  });

  it("is hidden in logs mode", async () => {
    const dialog = await mount({ canFlashBootloader: true, mode: "logs" });
    expect(bootloaderRow(dialog)).toBeNull();
  });

  it("is hidden while the device is offline", async () => {
    const dialog = await mount({
      canFlashBootloader: true,
      deviceState: DeviceState.OFFLINE,
    });
    expect(bootloaderRow(dialog)).toBeNull();
  });
});
