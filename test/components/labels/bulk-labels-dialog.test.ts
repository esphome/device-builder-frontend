// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import toast from "sonner-js";

import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { BulkActionResult, ConfiguredDevice } from "../../../src/api/types.js";
import { ESPHomeBulkLabelsDialog } from "../../../src/components/labels/bulk-labels-dialog.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

/**
 * Pin the tri-state semantics of the multi-device labels picker:
 * derived state across the selection, click cycles, and the per-
 * device updates the Apply button would send.
 */

interface DialogView {
  devices: ESPHomeBulkLabelsDialog["devices"];
  _pendingChanges: Map<string, "checked" | "unchecked">;
  _saving: boolean;
  _api: ESPHomeAPI | undefined;
  effectiveState: ESPHomeBulkLabelsDialog["effectiveState"];
  computeUpdates: ESPHomeBulkLabelsDialog["computeUpdates"];
  _hasPendingChanges: boolean;
  _apply: () => Promise<void>;
  close: () => void;
}

function makeDialog(): DialogView {
  return new ESPHomeBulkLabelsDialog() as unknown as DialogView;
}

/** Build a dialog with a stubbed ``_api`` whose ``setDeviceLabelsBulk``
 *  returns whatever the test passes in (a result list or a thrown
 *  error). Centralises the boilerplate so the three ``_apply`` branch
 *  tests below stay focused on their toast / state assertions. */
function makeMockedDialog(
  setDeviceLabelsBulkImpl: (
    updates: Array<{ configuration: string; labelIds: string[] }>
  ) => Promise<BulkActionResult[]>,
  devices: ConfiguredDevice[]
): DialogView {
  const dialog = makeDialog();
  dialog.devices = devices;
  dialog._api = {
    setDeviceLabelsBulk: vi.fn(setDeviceLabelsBulkImpl),
  } as unknown as ESPHomeAPI;
  // Stub close() so the @query("wa-dialog") miss doesn't crash on
  // the bare instance (we're not mounted).
  dialog.close = vi.fn();
  return dialog;
}

describe("esphome-bulk-labels-dialog tri-state derivation", () => {
  test("label on every selected device renders checked", () => {
    const dialog = makeDialog();
    dialog.devices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-a"] }),
    ];
    expect(dialog.effectiveState("lbl-a")).toBe("checked");
  });

  test("label on no selected device renders unchecked", () => {
    const dialog = makeDialog();
    dialog.devices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-a"] }),
    ];
    expect(dialog.effectiveState("lbl-b")).toBe("unchecked");
  });

  test("label on some-but-not-all selected devices renders indeterminate", () => {
    const dialog = makeDialog();
    dialog.devices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ];
    expect(dialog.effectiveState("lbl-a")).toBe("indeterminate");
  });
});

describe("esphome-bulk-labels-dialog tri-state cycle", () => {
  test("checked -> click -> unchecked -> click -> checked", () => {
    const dialog = makeDialog();
    dialog.devices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
    ];
    expect(dialog.effectiveState("lbl-a")).toBe("checked");
    dialog._pendingChanges = new Map([["lbl-a", "unchecked"]]);
    expect(dialog.effectiveState("lbl-a")).toBe("unchecked");
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    expect(dialog.effectiveState("lbl-a")).toBe("checked");
  });

  test("indeterminate -> click maps to checked (Gmail-style claim)", () => {
    // Cycle direction: the production renderer reads effectiveState
    // and sets the next value to "checked" unless the current is
    // already "checked" (in which case it goes to "unchecked").
    // Pinning the destination so the renderer can't drift.
    const dialog = makeDialog();
    dialog.devices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ];
    expect(dialog.effectiveState("lbl-a")).toBe("indeterminate");
    // First click from indeterminate -> checked
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    expect(dialog.effectiveState("lbl-a")).toBe("checked");
  });
});

describe("esphome-bulk-labels-dialog computeUpdates", () => {
  test("no pending changes -> per-device label sets are unchanged", () => {
    const dialog = makeDialog();
    dialog.devices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-b"] }),
    ];
    expect(dialog.computeUpdates()).toEqual([
      { configuration: "a.yaml", labelIds: ["lbl-a"] },
      { configuration: "b.yaml", labelIds: ["lbl-b"] },
    ]);
  });

  test("checked transition adds to every device that didn't already have it", () => {
    const dialog = makeDialog();
    dialog.devices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ];
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    const updates = dialog.computeUpdates();
    expect(updates).toEqual([
      { configuration: "a.yaml", labelIds: ["lbl-a"] },
      { configuration: "b.yaml", labelIds: ["lbl-a"] },
    ]);
  });

  test("unchecked transition removes from every device that had it", () => {
    const dialog = makeDialog();
    dialog.devices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a", "lbl-b"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-a"] }),
    ];
    dialog._pendingChanges = new Map([["lbl-a", "unchecked"]]);
    const updates = dialog.computeUpdates();
    const aLabels = updates.find((u) => u.configuration === "a.yaml")?.labelIds;
    const bLabels = updates.find((u) => u.configuration === "b.yaml")?.labelIds;
    expect(aLabels).toEqual(["lbl-b"]);
    expect(bLabels).toEqual([]);
  });

  test("untouched labels (indeterminate) preserve each device's existing assignment", () => {
    const dialog = makeDialog();
    dialog.devices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ];
    // User toggled lbl-c on for everyone but didn't touch lbl-a.
    dialog._pendingChanges = new Map([["lbl-c", "checked"]]);
    const updates = dialog.computeUpdates();
    const aLabels = updates.find((u) => u.configuration === "a.yaml")?.labelIds;
    const bLabels = updates.find((u) => u.configuration === "b.yaml")?.labelIds;
    expect(aLabels).toEqual(expect.arrayContaining(["lbl-a", "lbl-c"]));
    expect(aLabels).toHaveLength(2);
    expect(bLabels).toEqual(["lbl-c"]);
  });
});

describe("esphome-bulk-labels-dialog Apply gating", () => {
  test("Apply is disabled when there are no pending changes", () => {
    const dialog = makeDialog();
    dialog.devices = [makeConfiguredDevice({ configuration: "a.yaml", labels: [] })];
    expect(dialog._hasPendingChanges).toBe(false);
  });

  test("Apply enables once any label is touched", () => {
    const dialog = makeDialog();
    dialog.devices = [makeConfiguredDevice({ configuration: "a.yaml", labels: [] })];
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    expect(dialog._hasPendingChanges).toBe(true);
  });
});

describe("esphome-bulk-labels-dialog cycle-back drops stale pending changes", () => {
  test("checked -> unchecked -> checked returns to derived, drops override", () => {
    // Start: lbl-a checked on every selected device → derived is
    // "checked". A click cycles to unchecked; a second click
    // brings it back to the derived "checked" state, which must
    // drop the pending entry so Apply doesn't fire a no-op write.
    const dialog = makeDialog();
    dialog.devices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-a"] }),
    ];
    // First click: derived "checked" → next is "unchecked", store it.
    (dialog as unknown as { _onToggle: (id: string) => void })._onToggle("lbl-a");
    expect(dialog._pendingChanges.get("lbl-a")).toBe("unchecked");
    expect(dialog._hasPendingChanges).toBe(true);
    // Second click: effective is "unchecked", next is "checked",
    // which matches the derived state → entry dropped.
    (dialog as unknown as { _onToggle: (id: string) => void })._onToggle("lbl-a");
    expect(dialog._pendingChanges.has("lbl-a")).toBe(false);
    expect(dialog._hasPendingChanges).toBe(false);
  });
});

describe("esphome-bulk-labels-dialog _apply branches", () => {
  let successSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    successSpy = vi.spyOn(toast, "success").mockImplementation(() => "");
    errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
  });

  afterEach(() => {
    successSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("all-success: count-aware success toast, dialog closes, _saving resets", async () => {
    const dialog = makeMockedDialog(
      async (updates) =>
        updates.map((u) => ({ configuration: u.configuration, success: true })),
      [
        makeConfiguredDevice({ configuration: "a.yaml", labels: [] }),
        makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
      ]
    );
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);

    await dialog._apply();

    expect(successSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(dialog.close).toHaveBeenCalledTimes(1);
    expect(dialog._saving).toBe(false);
  });

  test("partial-failure: error toast carries the failure count, dialog stays open", async () => {
    // Partial-failure leaves the dialog open so the user can see
    // their staged tri-state edits and re-Apply without re-staging
    // every transition. Matches the transport-failure branch.
    const dialog = makeMockedDialog(
      async (updates) =>
        updates.map((u, i) =>
          i === 0
            ? {
                configuration: u.configuration,
                success: false,
                error: "unknown label id",
              }
            : { configuration: u.configuration, success: true }
        ),
      [
        makeConfiguredDevice({ configuration: "a.yaml", labels: [] }),
        makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
      ]
    );
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);

    await dialog._apply();

    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(dialog.close).not.toHaveBeenCalled();
    expect(dialog._saving).toBe(false);
  });

  test("_onRequestClose vetoes dismissal while _saving is true", () => {
    // Esc / X / backdrop-click all surface through ``wa-request-close``;
    // the handler must call preventDefault() to block them mid-save
    // so the in-flight set_labels_bulk write isn't orphaned.
    const dialog = makeMockedDialog(
      async (updates) =>
        updates.map((u) => ({ configuration: u.configuration, success: true })),
      [makeConfiguredDevice({ configuration: "a.yaml", labels: [] })]
    );

    const event = new Event("wa-request-close", { cancelable: true });
    dialog._saving = true;
    (dialog as unknown as { _onRequestClose: (e: Event) => void })._onRequestClose(event);
    expect(event.defaultPrevented).toBe(true);

    const idleEvent = new Event("wa-request-close", { cancelable: true });
    dialog._saving = false;
    (dialog as unknown as { _onRequestClose: (e: Event) => void })._onRequestClose(
      idleEvent
    );
    expect(idleEvent.defaultPrevented).toBe(false);
  });

  test("transport-failure: bulk-failure i18n key fires, dialog stays open", async () => {
    // Pin the fix that swapped ``labels_save_failed`` (single-
    // device wording) for the bulk-specific key on the catch path.
    // Asserting on the localize key name via the toast call is
    // load-bearing — the bug was that the wrong key surfaced
    // single-device copy on a multi-device failure.
    const dialog = makeMockedDialog(async () => {
      throw new Error("ws closed");
    }, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: [] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ]);
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);

    await dialog._apply();

    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // The dialog does NOT close on transport failure (so the user
    // can retry without losing their tri-state edits).
    expect(dialog.close).not.toHaveBeenCalled();
    expect(dialog._saving).toBe(false);
  });
});
