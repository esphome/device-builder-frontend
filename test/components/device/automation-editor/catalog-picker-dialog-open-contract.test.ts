/**
 * @vitest-environment happy-dom
 *
 * Open/close contract for the catalog-picker dialog after its
 * migration onto ``esphome-base-dialog``. The wrapper never mutates
 * its own ``open`` on a user-driven close, so the host owns the
 * reactive ``_open`` flag: ``open()`` sets it, ``@after-hide``
 * clears it once the hide animation ends, and picking an item clears
 * it. The body renders only while open. The sibling
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
const afterHide = (d: ESPHomeCatalogPickerDialog): void =>
  d
    .shadowRoot!.querySelector("esphome-base-dialog")!
    .dispatchEvent(new CustomEvent("after-hide"));

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
    dialog.items = [
      {
        id: "switch.turn_on",
        name: "Turn On",
        domain: "switch",
        description: "",
        docs_url: "",
        config_entries: [],
        is_control_flow: false,
        has_else_branch: false,
        accepts_action_list: [],
      },
    ];
    dialog.devices = Array.from({ length: 20 }, (_, i) => ({
      component_id: "switch.gpio",
      id: `relay${i}`,
      name: `Relay ${i}`,
      has_explicit_id: true,
    }));
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelector(".picker-search")).toBeNull();
    expect(dialog.shadowRoot!.querySelectorAll(".picker-row")).toHaveLength(0);

    dialog.open();
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelectorAll(".picker-row")).toHaveLength(20);

    afterHide(dialog);
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.querySelectorAll(".picker-row")).toHaveLength(0);
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
