/**
 * @vitest-environment happy-dom
 *
 * Pins the save-time YAML validation prompt's behaviour after the migration
 * onto esphome-base-dialog: Enter takes the safe "Go to error" path (never
 * force-save), the goto latch fires once, and the reactive ?open /
 * request-close / after-hide -> cancel contract holds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeYamlValidationDialog } from "../../src/components/yaml-validation-dialog.js";
import { pressEnter } from "../_press-enter.js";

async function mount(): Promise<ESPHomeYamlValidationDialog> {
  const el = new ESPHomeYamlValidationDialog();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const baseDialog = (el: ESPHomeYamlValidationDialog): HTMLElement =>
  el.shadowRoot!.querySelector("esphome-base-dialog")!;

describe("yaml-validation-dialog ENTER", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("goes to the first error on Enter when a line is known", async () => {
    const el = await mount();
    el.firstErrorLine = 12;
    el.firstErrorCol = 4;
    await el.updateComplete;
    const onGoto = vi.fn();
    el.addEventListener("goto", onGoto as EventListener);
    el.open();
    pressEnter();
    expect(onGoto).toHaveBeenCalledTimes(1);
    expect(onGoto.mock.calls[0][0].detail).toEqual({ line: 12, col: 4 });
  });

  it("does nothing on Enter when no error line is known", async () => {
    const el = await mount();
    el.firstErrorLine = 0;
    await el.updateComplete;
    const onGoto = vi.fn();
    const onSaveAnyway = vi.fn();
    el.addEventListener("goto", onGoto);
    el.addEventListener("save-anyway", onSaveAnyway);
    el.open();
    pressEnter();
    expect(onGoto).not.toHaveBeenCalled();
    expect(onSaveAnyway).not.toHaveBeenCalled();
  });

  it("fires goto only once on a repeated Enter", async () => {
    const el = await mount();
    el.firstErrorLine = 3;
    await el.updateComplete;
    const onGoto = vi.fn();
    el.addEventListener("goto", onGoto);
    el.open();
    pressEnter();
    pressEnter();
    expect(onGoto).toHaveBeenCalledTimes(1);
  });

  it("does not go to the error before the dialog is opened", async () => {
    const el = await mount();
    el.firstErrorLine = 3;
    await el.updateComplete;
    const onGoto = vi.fn();
    el.addEventListener("goto", onGoto);
    pressEnter();
    expect(onGoto).not.toHaveBeenCalled();
  });
});

// The migration onto esphome-base-dialog introduced the reactive ?open binding,
// the request-close handler, and the after-hide -> cancel path. Pin them so the
// dismiss-cancels contract (the page-leave guard depends on it) can't regress.
describe("yaml-validation-dialog dismiss / request-close", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fires a single cancel when dismissed without a decision", async () => {
    const el = await mount();
    el.open();
    await el.updateComplete;
    const onCancel = vi.fn();
    el.addEventListener("cancel", onCancel);
    baseDialog(el).dispatchEvent(new CustomEvent("after-hide"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not fire cancel after Go to error was chosen", async () => {
    const el = await mount();
    el.firstErrorLine = 7;
    await el.updateComplete;
    const onGoto = vi.fn();
    const onCancel = vi.fn();
    el.addEventListener("goto", onGoto);
    el.addEventListener("cancel", onCancel);
    pressEnter(); // not open yet -> no-op
    el.open();
    pressEnter(); // resolves as "goto"
    baseDialog(el).dispatchEvent(new CustomEvent("after-hide"));
    expect(onGoto).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("flips the reactive open flag to false on request-close", async () => {
    const el = await mount();
    el.open();
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._open).toBe(true);
    baseDialog(el).dispatchEvent(new CustomEvent("request-close"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._open).toBe(false);
  });
});
