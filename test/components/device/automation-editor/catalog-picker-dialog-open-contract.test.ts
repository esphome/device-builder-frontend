/**
 * @vitest-environment happy-dom
 *
 * Open/close contract for the catalog-picker dialog after its
 * migration onto ``esphome-base-dialog``. The wrapper never mutates
 * its own ``open`` on a user-driven close, so the host owns the
 * reactive ``_open`` flag: ``open()`` sets it, ``@after-hide``
 * clears it once the hide animation ends, and picking an item requests
 * a close through the wrapper so the same after-hide clears it. The body
 * renders only while open. The sibling
 * ``catalog-picker-dialog.test.ts`` covers the filter / grouping
 * contract; this file owns the open/close lifecycle.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { identityLocalize } from "../../../_dom.js";
import { ESPHomeCatalogPickerDialog } from "../../../../src/components/device/automation-editor/catalog-picker-dialog.js";

async function mountDialog(
  kind: "action" | "condition" = "action"
): Promise<ESPHomeCatalogPickerDialog> {
  const dialog = new ESPHomeCatalogPickerDialog();
  dialog.kind = kind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dialog as any)._localize = identityLocalize; // no context provider in the test tree
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}

const isOpen = (d: ESPHomeCatalogPickerDialog): boolean =>
  (d as unknown as { _dialog: { open: boolean } })._dialog.open;
const activeTab = (d: ESPHomeCatalogPickerDialog): string =>
  (d as unknown as { _activeTab: string })._activeTab;
const afterHide = (d: ESPHomeCatalogPickerDialog): void => {
  d.shadowRoot!.querySelector("esphome-base-dialog")!.dispatchEvent(
    new CustomEvent("after-hide")
  );
};

describe("esphome-catalog-picker-dialog base-dialog open contract", () => {
  it("open() drives the reactive _open flag and resets the search", async () => {
    const dialog = await mountDialog("action");
    expect(isOpen(dialog)).toBe(false);
    (dialog as unknown as { _query: string })._query = "stale";
    dialog.open();
    expect(isOpen(dialog)).toBe(true);
    expect(activeTab(dialog)).toBe("by-target");
    expect((dialog as unknown as { _query: string })._query).toBe("");
  });

  it("open() defaults the condition picker to the by-type tab", async () => {
    const dialog = await mountDialog("condition");
    dialog.open();
    expect(activeTab(dialog)).toBe("by-type");
  });

  it("the controller's onAfterHide flips the open flag back to false", async () => {
    const dialog = await mountDialog();
    dialog.open();
    expect(isOpen(dialog)).toBe(true);
    afterHide(dialog);
    expect(isOpen(dialog)).toBe(false);
  });

  it("renders the body only while open", async () => {
    const dialog = await mountDialog();
    const body = () => dialog.shadowRoot!.querySelectorAll(".picker-body").length;
    expect(body()).toBe(0);

    dialog.open();
    await dialog.updateComplete;
    expect(body()).toBe(1);

    afterHide(dialog);
    await dialog.updateComplete;
    expect(body()).toBe(0);
  });

  it("picking an item hands the detail to the request's onPicked", async () => {
    const dialog = await mountDialog();
    const picked = vi.fn();
    dialog.open({ kind: "action", items: [], devices: [], onPicked: picked });
    (
      dialog as unknown as {
        _pick: (id: string, p?: Record<string, unknown>) => void;
      }
    )._pick("switch.toggle", { id: "relay" });
    expect(picked).toHaveBeenCalledTimes(1);
    expect(picked.mock.calls[0][0]).toEqual({
      id: "switch.toggle",
      preFilledParams: { id: "relay" },
    });
  });

  it("a pick closes through the wrapper so the body outlives the hide animation", async () => {
    const dialog = await mountDialog();
    dialog.open();
    await dialog.updateComplete;
    const wrapper = dialog.shadowRoot!.querySelector(
      "esphome-base-dialog"
    )! as HTMLElement & {
      requestClose?: () => void;
    };
    wrapper.requestClose = vi.fn();
    (dialog as unknown as { _pick: (id: string) => void })._pick("switch.toggle");
    await dialog.updateComplete;
    expect(wrapper.requestClose).toHaveBeenCalledTimes(1);
    expect(isOpen(dialog)).toBe(true);
    expect(dialog.shadowRoot!.querySelector(".picker-body")).not.toBeNull();

    afterHide(dialog);
    await dialog.updateComplete;
    expect(isOpen(dialog)).toBe(false);
    expect(dialog.shadowRoot!.querySelector(".picker-body")).toBeNull();
  });

  it("a request arriving mid-hide shows once that hide ends, with fresh state", async () => {
    const dialog = await mountDialog();
    const wrapper = dialog.shadowRoot!.querySelector("esphome-base-dialog")!;
    dialog.open();
    await dialog.updateComplete;
    (dialog as unknown as { _query: string })._query = "still visible";
    // The wrapper starts hiding (Escape, X, or a pick's requestClose).
    wrapper.dispatchEvent(new CustomEvent("request-close"));
    const onPicked = vi.fn();
    dialog.open({ kind: "condition", items: [], devices: [], onPicked });
    // Rows are still live: nothing changes until the hide ends.
    expect(isOpen(dialog)).toBe(true);
    expect(dialog.kind).toBe("action");
    expect((dialog as unknown as { _query: string })._query).toBe("still visible");

    afterHide(dialog);
    expect(isOpen(dialog)).toBe(false);
    await dialog.updateComplete;
    await dialog.updateComplete;
    expect(isOpen(dialog)).toBe(true);
    expect(dialog.kind).toBe("condition");
    expect((dialog as unknown as { _query: string })._query).toBe("");
    (dialog as unknown as { _pick: (id: string) => void })._pick("sensor.in_range");
    expect(onPicked).toHaveBeenCalledTimes(1);
  });

  it("a request landing between after-hide and the deferred re-show wins", async () => {
    const dialog = await mountDialog();
    const wrapper = dialog.shadowRoot!.querySelector("esphome-base-dialog")!;
    dialog.open();
    await dialog.updateComplete;
    wrapper.dispatchEvent(new CustomEvent("request-close"));
    const older = vi.fn();
    const newer = vi.fn();
    dialog.open({ kind: "action", items: [], devices: [], onPicked: older });
    afterHide(dialog);
    // Same tick as after-hide: the closed state has not committed yet.
    dialog.open({ kind: "condition", items: [], devices: [], onPicked: newer });
    expect(isOpen(dialog)).toBe(false);
    await dialog.updateComplete;
    await dialog.updateComplete;
    expect(isOpen(dialog)).toBe(true);
    expect(dialog.kind).toBe("condition");
    (dialog as unknown as { _pick: (id: string) => void })._pick("sensor.in_range");
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
  });

  it("drops the served request once the dialog has fully closed", async () => {
    const dialog = await mountDialog();
    const onPicked = vi.fn();
    dialog.open({ kind: "action", items: [], devices: [], onPicked });
    await dialog.updateComplete;
    afterHide(dialog);
    expect((dialog as unknown as { _request: unknown })._request).toBeNull();
  });

  it("a second pick during the hide is ignored until the picker reopens", async () => {
    const dialog = await mountDialog();
    dialog.open();
    await dialog.updateComplete;
    const wrapper = dialog.shadowRoot!.querySelector(
      "esphome-base-dialog"
    )! as HTMLElement & {
      requestClose?: () => void;
    };
    wrapper.requestClose = vi.fn();
    const picked = vi.fn();
    const request = { kind: "action" as const, items: [], devices: [], onPicked: picked };
    dialog.open(request);
    await dialog.updateComplete;
    const pick = (dialog as unknown as { _pick: (id: string) => void })._pick.bind(
      dialog
    );

    pick("switch.toggle");
    pick("switch.turn_on");
    expect(picked).toHaveBeenCalledTimes(1);

    afterHide(dialog);
    dialog.open(request);
    await dialog.updateComplete;
    pick("switch.turn_on");
    expect(picked).toHaveBeenCalledTimes(2);
  });
});
