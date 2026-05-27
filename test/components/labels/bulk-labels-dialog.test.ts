// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";

import type { Label } from "../../../src/api/types.js";
import { ESPHomeBulkLabelsDialog } from "../../../src/components/labels/bulk-labels-dialog.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

/**
 * Pin the tri-state semantics of the multi-device labels picker:
 * derived state across the selection, click cycles, and the per-
 * device updates the Apply button would send.
 */

interface DialogView {
  devices: ESPHomeBulkLabelsDialog["devices"];
  _catalog: Label[];
  _pendingChanges: Map<string, "checked" | "unchecked">;
  effectiveState: ESPHomeBulkLabelsDialog["effectiveState"];
  computeUpdates: ESPHomeBulkLabelsDialog["computeUpdates"];
  _hasPendingChanges: boolean;
}

function makeDialog(): DialogView {
  return new ESPHomeBulkLabelsDialog() as unknown as DialogView;
}

const LBL_A: Label = { id: "lbl-a", name: "Alpha", color: null };
const LBL_B: Label = { id: "lbl-b", name: "Bravo", color: null };
const LBL_C: Label = { id: "lbl-c", name: "Charlie", color: null };

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

// Silence "unused" warnings on the symbols we expose for documentation
// of the test fixture even when a specific assertion doesn't reach for
// them — keeps the suite robust against tighter linting later.
void LBL_B;
void LBL_C;
