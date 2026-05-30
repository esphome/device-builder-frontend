/**
 * @vitest-environment happy-dom
 *
 * Pins the OTA address-override submit button label per dialog mode.
 * The dialog is reused for ``install`` and ``logs``; the button used to
 * read "Install over network" in both, so the logs-method dialog showed
 * an install-labelled button that actually fetches logs (#1040).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

import { DeviceState } from "../../src/api/types/devices.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";

async function flushPending(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function mountWithOtaCardOpen(
  mode: "install" | "logs"
): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._localize = defaultLocalize;
  // _environment reads api.serverInfo; a bare object is enough to
  // resolve the deployment environment from window.location.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._api = {};
  dialog.mode = mode;
  dialog.deviceState = DeviceState.ONLINE;
  // Expand the Advanced disclosure and the OTA address card so the
  // submit button is in the rendered tree. Leave ``open`` unset — the
  // method list renders regardless, and flipping ``open`` true would
  // reset these flags in willUpdate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._advancedExpanded = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._otaAddressCardExpanded = true;
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  await flushPending();
  return dialog;
}

const submitLabel = (d: ESPHomeInstallMethodDialog): string =>
  d.shadowRoot?.querySelector("#ota-address-form .btn--primary")?.textContent?.trim() ??
  "";

describe("install-method-dialog OTA submit label", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("reads 'Install over network' in install mode", async () => {
    const dialog = await mountWithOtaCardOpen("install");
    expect(submitLabel(dialog)).toBe("Install over network");
  });

  it("reads 'View logs over network' in logs mode", async () => {
    const dialog = await mountWithOtaCardOpen("logs");
    expect(submitLabel(dialog)).toBe("View logs over network");
  });
});
