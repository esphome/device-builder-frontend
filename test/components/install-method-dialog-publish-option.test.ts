/**
 * @vitest-environment happy-dom
 *
 * Pins the Publish option visibility rules in the install-method dialog.
 * The option appears only when ``hasPublishCommand`` is true and the dialog
 * is in ``install`` mode; it stays hidden in ``logs`` mode even when the
 * command is configured, and clicking it fires ``select-method`` with
 * ``method: "publish"``.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { DeviceState } from "../../src/api/types/devices.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount(opts: {
  hasPublishCommand: boolean;
  mode?: "install" | "logs";
}): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  (dialog as any)._localize = defaultLocalize;
  (dialog as any)._api = {};
  dialog.deviceState = DeviceState.ONLINE;
  dialog.hasPublishCommand = opts.hasPublishCommand;
  dialog.mode = opts.mode ?? "install";
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const publishOption = (d: ESPHomeInstallMethodDialog): Element | null => {
  const titles = d.shadowRoot?.querySelectorAll(".option .title") ?? [];
  const titleEl = Array.from(titles).find((el) => el.textContent?.trim() === "Publish");
  return titleEl?.closest(".option") ?? null;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("install-method-dialog Publish option", () => {
  it("is shown in install mode when hasPublishCommand is true", async () => {
    const dialog = await mount({ hasPublishCommand: true });
    expect(publishOption(dialog)).not.toBeNull();
  });

  it("is hidden when hasPublishCommand is false", async () => {
    const dialog = await mount({ hasPublishCommand: false });
    expect(publishOption(dialog)).toBeNull();
  });

  it("is hidden in logs mode even when hasPublishCommand is true", async () => {
    const dialog = await mount({ hasPublishCommand: true, mode: "logs" });
    expect(publishOption(dialog)).toBeNull();
  });

  it("fires select-method with publish when clicked", async () => {
    const dialog = await mount({ hasPublishCommand: true });
    const events: CustomEvent[] = [];
    dialog.addEventListener("select-method", (e) => events.push(e as CustomEvent));
    (publishOption(dialog) as HTMLElement).click();
    expect(events).toHaveLength(1);
    expect(events[0].detail.method).toBe("publish");
  });
});
