// @vitest-environment happy-dom
import toast from "sonner-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ConfiguredDevice, Label } from "../../../src/api/types/devices.js";
import type { BulkActionResult } from "../../../src/api/types/system.js";
import { ESPHomeBulkLabelsDialog } from "../../../src/components/labels/bulk-labels-dialog.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

/**
 * Pin the tri-state semantics of the multi-device labels picker:
 * derived state across the selection, click cycles, and the per-
 * device updates the Apply button would send.
 */

interface DialogView {
  _allDevices: ConfiguredDevice[];
  configurations: string[];
  devices: ESPHomeBulkLabelsDialog["devices"];
  _catalog: Label[];
  _pendingChanges: Map<string, "checked" | "unchecked">;
  _saving: boolean;
  _open: boolean;
  _failedConfigurations: Set<string> | null;
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

/** Seed a bare dialog with ``_allDevices`` (mirrors the
 *  ``devicesContext`` upstream) and ``configurations`` (what the
 *  dashboard would set on open). The dialog's ``devices`` getter
 *  resolves the filtered list from these inputs the same way it
 *  would in production. */
function seedDevices(dialog: DialogView, devices: ConfiguredDevice[]): void {
  dialog._allDevices = devices;
  dialog.configurations = devices.map((d) => d.configuration);
}

/** Build a dialog with a stubbed ``_api`` whose ``setDeviceLabelsBulk``
 *  returns whatever the test passes in (a result list or a thrown
 *  error). Centralises the boilerplate so the branch tests stay
 *  focused on their toast / state assertions. ``_open`` is seeded
 *  true so close-via-_open-flag assertions are observable. */
function makeMockedDialog(
  setDeviceLabelsBulkImpl: (
    updates: Array<{ configuration: string; labelIds: string[] }>
  ) => Promise<BulkActionResult[]>,
  devices: ConfiguredDevice[]
): DialogView {
  const dialog = makeDialog();
  seedDevices(dialog, devices);
  dialog._api = {
    setDeviceLabelsBulk: vi.fn(setDeviceLabelsBulkImpl),
  } as unknown as ESPHomeAPI;
  dialog._open = true;
  return dialog;
}

describe("esphome-bulk-labels-dialog tri-state derivation", () => {
  test("label on every selected device renders checked", () => {
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-a"] }),
    ]);
    expect(dialog.effectiveState("lbl-a")).toBe("checked");
  });

  test("label on no selected device renders unchecked", () => {
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-a"] }),
    ]);
    expect(dialog.effectiveState("lbl-b")).toBe("unchecked");
  });

  test("label on some-but-not-all selected devices renders indeterminate", () => {
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ]);
    expect(dialog.effectiveState("lbl-a")).toBe("indeterminate");
  });
});

describe("esphome-bulk-labels-dialog tri-state cycle", () => {
  test("checked -> click -> unchecked -> click -> checked", () => {
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
    ]);
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
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ]);
    expect(dialog.effectiveState("lbl-a")).toBe("indeterminate");
    // First click from indeterminate -> checked
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    expect(dialog.effectiveState("lbl-a")).toBe("checked");
  });
});

describe("esphome-bulk-labels-dialog computeUpdates", () => {
  test("no pending changes -> no payload (every device is a no-op)", () => {
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-b"] }),
    ]);
    // Diff filter: with no transitions, every device's after-set
    // equals its before-set, so the payload is empty. The Apply
    // button is disabled in this state anyway (``_hasPendingChanges``),
    // but pinning the payload shape so the success-toast count
    // reflects real changes only.
    expect(dialog.computeUpdates()).toEqual([]);
  });

  test("checked transition only emits entries for devices that actually change", () => {
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ]);
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    // a.yaml already has lbl-a → no diff → skipped.
    // b.yaml gains lbl-a → diff → included.
    expect(dialog.computeUpdates()).toEqual([
      { configuration: "b.yaml", labelIds: ["lbl-a"] },
    ]);
  });

  test("unchecked transition removes from every device that had it", () => {
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a", "lbl-b"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-a"] }),
    ]);
    dialog._pendingChanges = new Map([["lbl-a", "unchecked"]]);
    const updates = dialog.computeUpdates();
    const aLabels = updates.find((u) => u.configuration === "a.yaml")?.labelIds;
    const bLabels = updates.find((u) => u.configuration === "b.yaml")?.labelIds;
    expect(aLabels).toEqual(["lbl-b"]);
    expect(bLabels).toEqual([]);
  });

  test("untouched labels (indeterminate) preserve each device's existing assignment", () => {
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ]);
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
    seedDevices(dialog, [makeConfiguredDevice({ configuration: "a.yaml", labels: [] })]);
    expect(dialog._hasPendingChanges).toBe(false);
  });

  test("Apply enables once any label is touched", () => {
    const dialog = makeDialog();
    seedDevices(dialog, [makeConfiguredDevice({ configuration: "a.yaml", labels: [] })]);
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    expect(dialog._hasPendingChanges).toBe(true);
  });
});

describe("esphome-bulk-labels-dialog stays bound to live devices", () => {
  test("a DEVICE_UPDATED that replaces _allDevices refreshes derived state", () => {
    // Repro for the discussion thread: app-shell replaces device
    // objects on every DEVICE_UPDATED. The dialog must derive
    // tri-state from the LIVE list, not a snapshot taken at open
    // time. Otherwise a partial-failure retry (where succeeded
    // devices got new labels mid-dialog) would compute against
    // stale data.
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: [] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ]);
    expect(dialog.effectiveState("lbl-x")).toBe("unchecked");

    // Simulate the DEVICE_UPDATED event: app-shell replaces _allDevices
    // with a fresh array carrying new device objects (a.yaml now has
    // lbl-x; b.yaml still doesn't).
    dialog._allDevices = [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-x"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ];
    // configurations is unchanged but derived state now picks up
    // the fresh labels from _allDevices.
    expect(dialog.effectiveState("lbl-x")).toBe("indeterminate");
  });

  test("_onAfterHide flips _open false so the next render's ?open matches", () => {
    // The wrapper's wa-after-hide fires after every dismissal
    // (Esc / X / outside-click / reactive ?open flip). Without
    // this listener, our local _open would drift out of sync
    // with the wrapper's state and the next render would try to
    // re-open the just-closed dialog.
    const dialog = makeDialog();
    dialog._open = true;
    (dialog as unknown as { _onAfterHide: () => void })._onAfterHide();
    expect(dialog._open).toBe(false);
  });

  test("catalog deletion drops the corresponding pending entry", () => {
    // If another tab deletes a label while this dialog is open,
    // the catalog updates reactively. ``_pendingChanges`` would
    // otherwise hold a stale entry for the deleted id — Apply
    // stays enabled and the payload includes the dead id.
    const dialog = makeDialog();
    seedDevices(dialog, [makeConfiguredDevice({ configuration: "a.yaml", labels: [] })]);
    dialog._catalog = [{ id: "lbl-a", name: "Alpha", color: null }];
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    expect(dialog._hasPendingChanges).toBe(true);

    // Simulate the cross-tab delete: catalog now empty.
    dialog._catalog = [];
    // Drive the reactive cycle so updated() fires.
    (
      dialog as unknown as {
        updated: (m: Map<string, unknown>) => void;
      }
    ).updated(new Map([["_catalog", []]]));

    expect(dialog._pendingChanges.has("lbl-a")).toBe(false);
    expect(dialog._hasPendingChanges).toBe(false);
  });

  test("device shift that makes pending match derived drops the entry", () => {
    // Pending was load-bearing: derived was "indeterminate" (some
    // had it, some didn't), pending="checked" claimed the label
    // for the rest. If another tab now applies the same change so
    // every device has it, derived flips to "checked" and the
    // pending override becomes a no-op. Without a second pass in
    // updated(), Apply stays enabled and falls through to the
    // "no changes" branch on click.
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ]);
    dialog._catalog = [{ id: "lbl-a", name: "Alpha", color: null }];
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    expect(dialog._hasPendingChanges).toBe(true);

    // Cross-tab application: every device now has the label.
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-a"] }),
    ]);
    (
      dialog as unknown as {
        updated: (m: Map<string, unknown>) => void;
      }
    ).updated(new Map([["_allDevices", []]]));

    expect(dialog._pendingChanges.has("lbl-a")).toBe(false);
    expect(dialog._hasPendingChanges).toBe(false);
  });
});

describe("esphome-bulk-labels-dialog cycle-back drops stale pending changes", () => {
  test("checked -> unchecked -> checked returns to derived, drops override", () => {
    // Start: lbl-a checked on every selected device → derived is
    // "checked". A click cycles to unchecked; a second click
    // brings it back to the derived "checked" state, which must
    // drop the pending entry so Apply doesn't fire a no-op write.
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: ["lbl-a"] }),
    ]);
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

  test("indeterminate -> checked -> unchecked -> indeterminate (third click clears pending)", () => {
    // Indeterminate-derived rows can't fall out of the
    // ``next === derived`` shortcut (``next`` is binary), so the
    // third click on a mixed row gets a dedicated branch in
    // ``_onToggle`` that clears the pending entry and returns the
    // row to indeterminate. Without it the user has no in-dialog
    // path back to "leave each device alone" after a mistaken
    // click on a mixed row, short of Cancel-which-drops-all-edits.
    const dialog = makeDialog();
    seedDevices(dialog, [
      makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] }),
      makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
    ]);
    const toggle = (dialog as unknown as { _onToggle: (id: string) => void })._onToggle;
    const bound = toggle.bind(dialog);
    // Derived state is indeterminate (some devices have it, some don't).
    expect(dialog.effectiveState("lbl-a")).toBe("indeterminate");
    // Click 1: indeterminate -> checked.
    bound("lbl-a");
    expect(dialog._pendingChanges.get("lbl-a")).toBe("checked");
    expect(dialog.effectiveState("lbl-a")).toBe("checked");
    // Click 2: checked -> unchecked.
    bound("lbl-a");
    expect(dialog._pendingChanges.get("lbl-a")).toBe("unchecked");
    expect(dialog.effectiveState("lbl-a")).toBe("unchecked");
    // Click 3: unchecked + derived=indeterminate -> clear pending.
    bound("lbl-a");
    expect(dialog._pendingChanges.has("lbl-a")).toBe(false);
    expect(dialog.effectiveState("lbl-a")).toBe("indeterminate");
    expect(dialog._hasPendingChanges).toBe(false);
    // Click 4: same as click 1 (cycle restarts).
    bound("lbl-a");
    expect(dialog._pendingChanges.get("lbl-a")).toBe("checked");
    expect(dialog.effectiveState("lbl-a")).toBe("checked");
  });
});

describe("esphome-bulk-labels-dialog _apply branches", () => {
  let successSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    successSpy = vi.spyOn(toast, "success").mockImplementation(() => "");
    errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    infoSpy = vi.spyOn(toast, "info").mockImplementation(() => "");
  });

  afterEach(() => {
    successSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
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
    expect(dialog._open).toBe(false);
    expect(dialog._saving).toBe(false);
  });

  test("partial-failure: fires BOTH success and error toasts, dialog stays open", async () => {
    // 1 succeeded + 1 failed → both toasts. The dialog stays open
    // so the user can see their staged tri-state edits and re-Apply.
    // Acknowledging the successes avoids the "nothing worked" UX
    // when most of a bulk Apply lands correctly.
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

    expect(successSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(dialog._open).toBe(true);
    expect(dialog._saving).toBe(false);
  });

  test("partial-failure with no successes skips the success toast", async () => {
    // When zero devices succeeded (every entry failed), the
    // success toast is pointless and would say "0 devices updated".
    // Only the error toast fires.
    const dialog = makeMockedDialog(
      async (updates) =>
        updates.map((u) => ({
          configuration: u.configuration,
          success: false,
          error: "boom",
        })),
      [
        makeConfiguredDevice({ configuration: "a.yaml", labels: [] }),
        makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
      ]
    );
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);

    await dialog._apply();

    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("partial-failure records the failed configurations for retry-narrowing", async () => {
    // Apply with two devices; the first fails. _failedConfigurations
    // must capture the failed config so a retry computeUpdates() only
    // emits that one.
    const dialog = makeMockedDialog(
      async (updates) =>
        updates.map((u, i) =>
          i === 0
            ? { configuration: u.configuration, success: false, error: "boom" }
            : { configuration: u.configuration, success: true }
        ),
      [
        makeConfiguredDevice({ configuration: "a.yaml", labels: [] }),
        makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
      ]
    );
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);

    await dialog._apply();

    expect(dialog._failedConfigurations).not.toBeNull();
    expect([...dialog._failedConfigurations!]).toEqual(["a.yaml"]);

    // Retry computeUpdates: now emits only the failed config.
    expect(dialog.computeUpdates()).toEqual([
      { configuration: "a.yaml", labelIds: ["lbl-a"] },
    ]);
  });

  test("full success after partial-failure clears the retry-narrow filter", async () => {
    // Once a failure heals (or the user closes + re-opens), the
    // narrow shouldn't stick around to bite a future Apply that
    // expected to write all selected devices.
    let firstCall = true;
    const dialog = makeMockedDialog(
      async (updates) =>
        updates.map((u, i) =>
          firstCall && i === 0
            ? { configuration: u.configuration, success: false, error: "boom" }
            : { configuration: u.configuration, success: true }
        ),
      [
        makeConfiguredDevice({ configuration: "a.yaml", labels: [] }),
        makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
      ]
    );
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);

    await dialog._apply();
    expect(dialog._failedConfigurations).not.toBeNull();

    firstCall = false;
    await dialog._apply(); // retry — succeeds
    expect(dialog._failedConfigurations).toBeNull();
  });

  test("a new toggle after partial failure clears the retry-narrow filter", async () => {
    // The retry-narrow is for straight retries; a fresh edit
    // expresses new intent for the whole selection. Without the
    // clear, devices that succeeded last time would silently miss
    // the new transition.
    const dialog = makeMockedDialog(
      async (updates) =>
        updates.map((u, i) =>
          i === 0
            ? { configuration: u.configuration, success: false, error: "boom" }
            : { configuration: u.configuration, success: true }
        ),
      [
        makeConfiguredDevice({ configuration: "a.yaml", labels: [] }),
        makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
      ]
    );
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    await dialog._apply();
    expect(dialog._failedConfigurations).not.toBeNull();

    // A new toggle (a different label) clears the narrow so the
    // next Apply targets the whole selection again.
    (dialog as unknown as { _onToggle: (id: string) => void })._onToggle("lbl-b");
    expect(dialog._failedConfigurations).toBeNull();
  });

  test("open() resets the retry-narrow filter from a previous session", () => {
    const dialog = makeMockedDialog(
      async (updates) =>
        updates.map((u) => ({ configuration: u.configuration, success: true })),
      [makeConfiguredDevice({ configuration: "a.yaml", labels: [] })]
    );
    dialog._failedConfigurations = new Set(["stale.yaml"]);

    // open() lives on the production class; call it through the cast.
    (dialog as unknown as { open: () => void }).open();

    expect(dialog._failedConfigurations).toBeNull();
  });

  test("_apply on empty-payload no-op fires info toast then closes", async () => {
    // After a DEVICE_UPDATED in another tab makes the user's
    // staged transition a no-op for every selected device, the
    // diff filter returns [] even though _hasPendingChanges is
    // still true. Don't send an empty WS request, but DO fire an
    // info toast so the dialog vanishing doesn't read as a failed
    // click.
    const setDeviceLabelsBulk = vi.fn();
    const dialog = makeMockedDialog(
      async () => [], // shouldn't be called
      [makeConfiguredDevice({ configuration: "a.yaml", labels: ["lbl-a"] })]
    );
    dialog._api = { setDeviceLabelsBulk } as unknown as ESPHomeAPI;
    // User toggled lbl-a "checked" but the device already has it →
    // diff filter resolves to no-op.
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);
    expect(dialog.computeUpdates()).toEqual([]);

    await dialog._apply();

    expect(setDeviceLabelsBulk).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(dialog._open).toBe(false);
    expect(dialog._pendingChanges.size).toBe(0);
  });

  test("stale _apply response (open() before resolve) bails without mutating state", async () => {
    // Defense in depth against the busy-gate-bypass path: if some
    // imperative close + re-open lands during an in-flight WS
    // round-trip, the original promise must not fire toasts or
    // close() against the new session.
    let resolve!: (results: BulkActionResult[]) => void;
    const inFlight = new Promise<BulkActionResult[]>((r) => {
      resolve = r;
    });
    const dialog = makeMockedDialog(
      () => inFlight,
      [makeConfiguredDevice({ configuration: "a.yaml", labels: [] })]
    );
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);

    const apply = dialog._apply();
    // Simulate a re-open with a different selection mid-flight —
    // bumps the generation counter.
    (dialog as unknown as { open: () => void }).open();

    resolve([{ configuration: "a.yaml", success: true }]);
    await apply;

    // Stale response didn't fire toasts (those belong to the
    // previous selection, not the current one).
    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    // And didn't clobber the freshly-opened dialog's _saving state.
    expect(dialog._saving).toBe(false);
  });

  test("_apply re-entrancy guard drops a second concurrent call", async () => {
    // A quick double-click on Apply could fire two ``_apply`` calls
    // before Lit re-renders the disabled state. The second call
    // must early-return so only one ``set_labels_bulk`` request hits
    // the wire for the same payload.
    let resolve!: (results: BulkActionResult[]) => void;
    const inFlight = new Promise<BulkActionResult[]>((r) => {
      resolve = r;
    });
    const dialog = makeMockedDialog(
      () => inFlight,
      [makeConfiguredDevice({ configuration: "a.yaml", labels: [] })]
    );
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);

    const first = dialog._apply();
    const second = dialog._apply(); // should bail immediately

    resolve([{ configuration: "a.yaml", success: true }]);
    await Promise.all([first, second]);

    // setDeviceLabelsBulk was called exactly once despite two _apply invocations.
    expect(
      (dialog._api as unknown as { setDeviceLabelsBulk: ReturnType<typeof vi.fn> })
        .setDeviceLabelsBulk
    ).toHaveBeenCalledTimes(1);
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
    // Pin the exact key string the error toast received (the
    // dialog's default ``_localize`` returns the key unchanged
    // when no provider is attached). Asserts we don't regress
    // back to the single-device ``labels_save_failed`` key.
    expect(errorSpy.mock.calls[0]?.[0]).toBe("dashboard.labels_bulk_save_failed");
    // The dialog does NOT close on transport failure (so the user
    // can retry without losing their tri-state edits).
    expect(dialog._open).toBe(true);
    expect(dialog._saving).toBe(false);
  });

  test("missing _api routes through catch and surfaces bulk-failure toast", async () => {
    // The context provider is always wired in production. The
    // ``!this._api`` branch used to silently early-return,
    // producing a dead-click Apply button. The fix throws inside
    // the try block so the (edge-case) failure flows through the
    // same bulk-failure toast as a transport error.
    const dialog = makeMockedDialog(
      async () => [],
      [
        makeConfiguredDevice({ configuration: "a.yaml", labels: [] }),
        makeConfiguredDevice({ configuration: "b.yaml", labels: [] }),
      ]
    );
    dialog._api = undefined;
    dialog._pendingChanges = new Map([["lbl-a", "checked"]]);

    await dialog._apply();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toBe("dashboard.labels_bulk_save_failed");
    expect(dialog._open).toBe(true);
    expect(dialog._saving).toBe(false);
  });
});
