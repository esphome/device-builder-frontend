/**
 * @vitest-environment happy-dom
 *
 * Pins that Enter in the OTA address field submits the method and
 * claims the keydown, so the progress dialog it opens doesn't receive
 * the same keystroke on its freshly focused close button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

vi.mock("@home-assistant/webawesome/dist/components/callout/callout.js", () => ({}));

import { flushMicrotasks } from "../_dom.js";
import { DeviceState } from "../../src/api/types/devices.js";
import { defaultLocalize } from "../../src/common/localize.js";
import { ESPHomeInstallMethodDialog } from "../../src/components/install-method-dialog.js";

async function mountWithOtaCardOpen(
  address: string
): Promise<ESPHomeInstallMethodDialog> {
  const dialog = new ESPHomeInstallMethodDialog();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._localize = defaultLocalize;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._api = {};
  dialog.mode = "install";
  dialog.deviceState = DeviceState.ONLINE;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._advancedExpanded = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._otaAddressCardExpanded = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._otaAddressValue = address;
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  await flushMicrotasks(5);
  return dialog;
}

function pressEnterIn(input: HTMLInputElement): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  input.dispatchEvent(event);
  return event;
}

const addressInput = (d: ESPHomeInstallMethodDialog): HTMLInputElement =>
  d.shadowRoot!.querySelector<HTMLInputElement>("#ota-address-form input")!;

describe("install-method-dialog OTA address Enter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("submits the ota method with the address and claims the keydown", async () => {
    const dialog = await mountWithOtaCardOpen("192.168.1.42");
    const selected: Array<{ method: string; port?: string }> = [];
    dialog.addEventListener("select-method", (e) => {
      selected.push((e as CustomEvent<{ method: string; port?: string }>).detail);
    });

    const event = pressEnterIn(addressInput(dialog));

    expect(selected).toEqual([{ method: "ota", port: "192.168.1.42" }]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Enter alone when the address is empty", async () => {
    const dialog = await mountWithOtaCardOpen("");
    const selected: unknown[] = [];
    dialog.addEventListener("select-method", (e) => selected.push(e));

    const event = pressEnterIn(addressInput(dialog));

    expect(selected).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });
});
