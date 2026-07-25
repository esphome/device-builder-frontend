/**
 * @vitest-environment happy-dom
 *
 * Pins the label editor's reactive open/close contract after the migration
 * onto esphome-base-dialog (#549): the dialog tracks its open flag via ?open, and
 * request-close / after-hide both mirror it back to false so a user-driven
 * close (Escape / X / outside-click) actually dismisses. Saves fire on every
 * label toggle while the dialog stays open, so it deliberately does NOT bind
 * ?busy (that would dim/lock the dialog on each toggle).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
// Stub esphome-label-form with the one method the editor calls on its @query
// ref (_createForm?.collapse()); the real form pulls in heavy deps we don't need.
vi.mock("../../../src/components/labels/label-form.js", () => {
  class StubLabelForm extends HTMLElement {
    collapse(): void {}
  }
  if (!customElements.get("esphome-label-form")) {
    customElements.define("esphome-label-form", StubLabelForm);
  }
  return {};
});

import toast from "sonner-js";

import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { ESPHomeDeviceLabelsEditor } from "../../../src/components/labels/device-labels-editor.js";

async function mount(): Promise<ESPHomeDeviceLabelsEditor> {
  const el = new ESPHomeDeviceLabelsEditor();
  el.device = { configuration: "kitchen", labels: [] } as unknown as ConfiguredDevice;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** Effective label ids (optimistic override or prop). */
const chipIds = (el: ESPHomeDeviceLabelsEditor): string[] =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._currentLabelIds as string[];

const withApi = (
  el: ESPHomeDeviceLabelsEditor,
  setDeviceLabels: (config: string, ids: string[]) => Promise<void>
) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._api = { setDeviceLabels };
};

const dialog = (el: ESPHomeDeviceLabelsEditor): HTMLElement =>
  el.shadowRoot!.querySelector("esphome-base-dialog")!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isOpen = (el: ESPHomeDeviceLabelsEditor): boolean => (el as any)._dialog.open;

describe("device-labels-editor open/close contract", () => {
  it("opens via the Edit-labels trigger", async () => {
    const el = await mount();
    expect(isOpen(el)).toBe(false);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".edit-btn")!.click();
    await el.updateComplete;
    expect(isOpen(el)).toBe(true);
    expect(dialog(el).hasAttribute("open")).toBe(true);
  });

  it("flips the open flag to false on request-close", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._dialog.open = true;
    await el.updateComplete;
    dialog(el).dispatchEvent(new CustomEvent("request-close"));
    expect(isOpen(el)).toBe(false);
  });

  it("flips the open flag to false on after-hide", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._dialog.open = true;
    await el.updateComplete;
    dialog(el).dispatchEvent(new CustomEvent("after-hide"));
    expect(isOpen(el)).toBe(false);
  });

  it("closes when the device prop swaps to a different device", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._dialog.open = true;
    await el.updateComplete;
    el.device = { configuration: "bedroom", labels: [] } as unknown as ConfiguredDevice;
    await el.updateComplete;
    expect(isOpen(el)).toBe(false);
  });

  it("stays open on a same-device update (e.g. DEVICE_UPDATED after a toggle)", async () => {
    const el = await mount();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._dialog.open = true;
    await el.updateComplete;
    // Same configuration, new labels (and a new object ref, as the dashboard
    // hands down after set_labels) — the dialog must NOT close.
    el.device = {
      configuration: "kitchen",
      labels: ["a"],
    } as unknown as ConfiguredDevice;
    await el.updateComplete;
    expect(isOpen(el)).toBe(true);
  });
});

describe("device-labels-editor optimistic override lifecycle", () => {
  it("reverts the optimistic assignment when set_labels fails", async () => {
    const el = await mount();
    withApi(el, () => Promise.reject(new Error("nope")));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any)._toggleAssignment("a", true);

    expect(chipIds(el)).toEqual([]);
    expect(toast.error).toHaveBeenCalled();
  });

  it("keeps a newer click's optimistic state when an older save fails", async () => {
    const el = await mount();
    let rejectFirst!: (e: Error) => void;
    let resolveSecond!: () => void;
    let calls = 0;
    withApi(el, () =>
      ++calls === 1
        ? new Promise<void>((_, reject) => {
            rejectFirst = reject;
          })
        : new Promise<void>((resolve) => {
            resolveSecond = resolve;
          })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = (el as any)._toggleAssignment("a", true) as Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const second = (el as any)._toggleAssignment("b", true) as Promise<void>;
    // Let the chained task start so the first save is actually in flight.
    await new Promise((r) => setTimeout(r));

    rejectFirst(new Error("nope"));
    await first;
    // The failed save must not clobber the newer click's override.
    expect(chipIds(el)).toEqual(["a", "b"]);
    // Let the queued second save reach the API before releasing it.
    await new Promise((r) => setTimeout(r));
    resolveSecond();
    await second;
  });

  it("drops the override in the save's finally when the push landed first", async () => {
    const el = await mount();
    let resolveSave!: () => void;
    withApi(
      el,
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saving = (el as any)._toggleAssignment("a", true) as Promise<void>;
    // DEVICE_UPDATED for our own write, riding ahead of the command
    // reply; _pendingSaves > 0 blocks willUpdate from clearing here.
    el.device = {
      configuration: "kitchen",
      labels: ["a"],
    } as unknown as ConfiguredDevice;
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._optimisticLabels).not.toBeNull();

    resolveSave();
    await saving;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._optimisticLabels).toBeNull();
    expect(chipIds(el)).toEqual(["a"]);
  });

  it("a same-device push after the save settles drops the override", async () => {
    const el = await mount();
    withApi(el, () => Promise.resolve());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (el as any)._toggleAssignment("a", true);
    el.device = {
      configuration: "kitchen",
      labels: ["a"],
    } as unknown as ConfiguredDevice;
    await el.updateComplete;

    expect(chipIds(el)).toEqual(["a"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._optimisticLabels).toBeNull();
  });

  it("an unrelated same-device push mid-save does not revert the chips", async () => {
    const el = await mount();
    let resolveSave!: () => void;
    withApi(
      el,
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saving = (el as any)._toggleAssignment("a", true) as Promise<void>;
    // A DEVICE_UPDATED push for something else (state flip) lands while
    // the save is still in flight, carrying the pre-save labels.
    el.device = { configuration: "kitchen", labels: [] } as unknown as ConfiguredDevice;
    await el.updateComplete;
    expect(chipIds(el)).toEqual(["a"]);

    resolveSave();
    await saving;
  });
});
