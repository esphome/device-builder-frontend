/**
 * @vitest-environment happy-dom
 *
 * The "+ Add" wizard dialogs (api-action / script / automation) submit on a
 * plain Enter via the shared base-dialog's confirmOnEnter (issue #1269). These
 * use the REAL esphome-base-dialog (only the wa primitives are stubbed) so the
 * wrapper's EnterController actually runs: Enter while open invokes _onContinue,
 * Enter while closed does not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import { LitElement } from "lit";
import { ESPHomeAddApiActionDialog } from "../../../src/components/device/add-api-action-dialog.js";
import { ESPHomeAddAutomationDialog } from "../../../src/components/device/add-automation-dialog.js";
import { ESPHomeAddScriptDialog } from "../../../src/components/device/add-script-dialog.js";
import { identityLocalize } from "../../_dom.js";

afterEach(() => {
  vi.clearAllMocks();
});

function pressEnter(): void {
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );
}

// Each dialog binds .confirmOnEnter=${this._onContinue}; swap _onContinue for a
// spy before the first render so the wrapper picks up the spy.
async function mount<T extends LitElement>(
  ctor: new () => T
): Promise<{ dialog: T; onContinue: ReturnType<typeof vi.fn> }> {
  const dialog = new ctor();
  const onContinue = vi.fn();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (dialog as any)._localize = identityLocalize; // no context provider here
  (dialog as any)._onContinue = onContinue;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return { dialog, onContinue };
}

describe.each([
  ["add-api-action", ESPHomeAddApiActionDialog],
  ["add-script", ESPHomeAddScriptDialog],
  ["add-automation", ESPHomeAddAutomationDialog],
])("%s dialog Enter-to-confirm (issue #1269)", (_name, ctor) => {
  it("Enter while open invokes _onContinue", async () => {
    const { dialog, onContinue } = await mount(ctor as new () => LitElement);
    (dialog as unknown as { open: () => void }).open();
    await dialog.updateComplete;
    pressEnter();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("Enter while closed does nothing", async () => {
    const { onContinue } = await mount(ctor as new () => LitElement);
    pressEnter();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("stops firing once the dialog closes", async () => {
    const { dialog, onContinue } = await mount(ctor as new () => LitElement);
    const view = dialog as unknown as {
      open: () => void;
      _dialog: { onRequestClose: () => void };
    };
    view.open();
    await dialog.updateComplete;
    view._dialog.onRequestClose(); // flips the open flag false (Escape / X / backdrop path)
    await dialog.updateComplete;
    pressEnter();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
