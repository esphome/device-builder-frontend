/**
 * @vitest-environment happy-dom
 *
 * Open/close contract for the catalog-picker dialog after its
 * migration onto ``esphome-base-dialog``. The wrapper never mutates
 * its own ``open`` on a user-driven close, so the host owns the
 * reactive ``_open`` flag: ``open()`` sets it, ``@request-close``
 * clears it, and picking an item clears it. (The sibling source-scan
 * test in this folder stays node-env; this file opts into happy-dom
 * per-file so the element can mount.)
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeCatalogPickerDialog } from "../../../../src/components/device/automation-editor/catalog-picker-dialog.js";
import { identityLocalize } from "../../../_dom.js";

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

  it("the controller's onRequestClose flips the open flag back to false", async () => {
    const dialog = await mountDialog();
    dialog.open();
    expect(isOpen(dialog)).toBe(true);
    (
      dialog as unknown as { _dialog: { onRequestClose: () => void } }
    )._dialog.onRequestClose();
    expect(isOpen(dialog)).toBe(false);
  });

  it("picking an item emits catalog-picked and closes the dialog", async () => {
    const dialog = await mountDialog();
    dialog.open();
    const picked = vi.fn();
    dialog.addEventListener("catalog-picked", (e) => picked((e as CustomEvent).detail));
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
    expect(isOpen(dialog)).toBe(false);
  });
});
