/**
 * @vitest-environment happy-dom
 *
 * Unit tests for ``AutoApplyController`` — the shared auto-apply /
 * delete / dirty-tracking engine behind the automation, script and
 * api-action editors. The auto-apply + delete + revert pattern is the
 * security-sensitive surface: a failed write must reach the user via
 * toast instead of silently dropping, and a pending debounced upsert
 * must never fire for a section that's no longer on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import type { ReactiveController } from "lit";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  YamlDiff,
} from "../../../../src/api/types/automations.js";
import type { LocalizeFunc } from "../../../../src/common/localize.js";
import {
  AUTO_APPLY_DEBOUNCE_MS,
  AutoApplyController,
  type AutoApplyHost,
  type AutoApplyOptions,
} from "../../../../src/components/device/automation-editor/auto-apply-controller.js";
import type { YamlUpdatedDetail } from "../../../../src/components/device/section-editor.js";
import { flushTimers, identityLocalize } from "../../../_dom.js";

const SCRIPT: AutomationLocation = {
  kind: "script",
  id: "s1",
} as unknown as AutomationLocation;

const tree = (): AutomationTree =>
  ({ trigger_id: null, trigger_params: {}, actions: [] }) as unknown as AutomationTree;

/** Replaces line 1, so "line1\nline2" becomes "replaced\nline2". */
const DIFF: YamlDiff = { fromLine: 1, toLine: 1, replacement: "replaced\n" };

class Host extends EventTarget implements AutoApplyHost {
  configuration = "device.yaml";
  yaml = "line1\nline2";
  addMode = false;
  value: AutomationTree | null = tree();
  location: AutomationLocation | null = SCRIPT;
  parentNode: ParentNode | null = null;
  // SectionEditor surface the real hosts delegate to the engine.
  dirty = false;
  flushPending(): void {}
  reload(): void {}
  updates = 0;
  addController(_c: ReactiveController): void {}
  removeController(): void {}
  requestUpdate(): void {
    this.updates++;
  }
  updateComplete = Promise.resolve(true);
}

const localize: LocalizeFunc = identityLocalize as LocalizeFunc;

function setup(
  over: Partial<AutoApplyOptions> = {},
  parentNode: ParentNode | null = null
) {
  const host = new Host();
  host.parentNode = parentNode;
  const upsertAutomation = vi.fn().mockResolvedValue({ yaml_diff: DIFF });
  const deleteAutomation = vi.fn().mockResolvedValue({ yaml_diff: DIFF });
  const updateConfig = vi.fn().mockResolvedValue(undefined);
  const api = {
    upsertAutomation,
    deleteAutomation,
    updateConfig,
  } as unknown as ESPHomeAPI;
  const setError = vi.fn();
  const controller = new AutoApplyController(host, {
    getApi: () => api,
    getLocalize: () => localize,
    isReadOnly: () => false,
    setError,
    ...over,
  });
  // Mirror Lit's lifecycle: the host is on screen when tests drive it.
  controller.hostConnected();
  return { host, controller, upsertAutomation, deleteAutomation, updateConfig, setError };
}

function captureEvents(host: Host, ...types: string[]): CustomEvent[] {
  const seen: CustomEvent[] = [];
  for (const type of types) {
    host.addEventListener(type, (e) => seen.push(e as CustomEvent));
  }
  return seen;
}

describe("AutoApplyController auto-apply", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(toast.error).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces a burst of changes into one upsert and dispatches yaml-draft", async () => {
    const { host, controller, upsertAutomation } = setup();
    const drafts = captureEvents(host, "yaml-draft");

    controller.scheduleAutoApply();
    controller.scheduleAutoApply();
    controller.scheduleAutoApply();
    expect(upsertAutomation).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(upsertAutomation).toHaveBeenCalledTimes(1);
    expect(upsertAutomation).toHaveBeenCalledWith(
      "device.yaml",
      host.value,
      SCRIPT,
      "line1\nline2"
    );
    // The returned diff is applied locally and pushed up as a draft
    // carrying its snapshotted target and basis for the page guards.
    expect(drafts.map((e) => e.detail.yaml)).toEqual(["replaced\nline2"]);
    expect(drafts[0].detail.configuration).toBe("device.yaml");
    expect(drafts[0].detail.basedOn).toBe("line1\nline2");
    expect(drafts[0].detail.node).toBe(host);
  });

  it("withValue patches the host value, announces automation-change, and schedules", async () => {
    const { host, controller, upsertAutomation } = setup();
    const changes = captureEvents(host, "automation-change");

    controller.withValue({ trigger_id: "switch.on_turn_on" });
    expect(host.value?.trigger_id).toBe("switch.on_turn_on");
    expect(changes).toHaveLength(1);
    expect(changes[0].detail.value).toBe(host.value);
    expect(changes[0].detail.location).toBe(SCRIPT);

    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(upsertAutomation).toHaveBeenCalledTimes(1);
  });

  it("flips dirty on schedule and clears it once the upsert lands", async () => {
    const { host, controller } = setup();
    const dirtyEvents = captureEvents(host, "dirty-change");

    controller.scheduleAutoApply();
    expect(controller.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(controller.dirty).toBe(false);
    expect(dirtyEvents.map((e) => e.detail.dirty)).toEqual([true, false]);
    // Every flip names its emitter so the page can identity-guard.
    expect(dirtyEvents.every((e) => e.detail.node === host)).toBe(true);
  });

  it("never schedules in add-mode", async () => {
    const { host, controller, upsertAutomation } = setup();
    host.addMode = true;
    controller.scheduleAutoApply();
    expect(controller.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(upsertAutomation).not.toHaveBeenCalled();
  });

  it("never upserts while read-only, and drops a leftover dirty flag", async () => {
    let readOnly = false;
    const { controller, upsertAutomation } = setup({ isReadOnly: () => readOnly });
    // An edit lands while editable, then the section turns read-only
    // before the debounce fires (the #1050 shape).
    controller.scheduleAutoApply();
    readOnly = true;
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(upsertAutomation).not.toHaveBeenCalled();
    expect(controller.dirty).toBe(false);
  });

  it("blocks the upsert while canApply rejects the location", async () => {
    const { controller, upsertAutomation } = setup({ canApply: () => false });
    controller.scheduleAutoApply();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(upsertAutomation).not.toHaveBeenCalled();
  });

  it("an older apply's settle does not disarm edits still in the debounce window", async () => {
    const { controller, upsertAutomation } = setup();
    let resolveFirst!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r;
        })
    );
    controller.scheduleAutoApply();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    // A keystroke lands during the round trip — possibly for a
    // sibling the reused element was re-pointed at (#1486).
    controller.scheduleAutoApply();
    expect(controller.dirty).toBe(true);

    resolveFirst({ yaml_diff: DIFF });
    await flushTimers();
    // The stale settle must not disarm the newer edit's brief-window
    // flag; its own settle clears it.
    expect(controller.dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS + 20);
    expect(controller.dirty).toBe(false);
    expect(upsertAutomation).toHaveBeenCalledTimes(2);
  });

  it("coalesces a change landing mid-flight into one follow-up upsert", async () => {
    const { controller, upsertAutomation } = setup();
    let resolveFirst!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r;
        })
    );

    controller.scheduleAutoApply();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(upsertAutomation).toHaveBeenCalledTimes(1);
    expect(controller.inFlightWrite).toBe(true);

    // Two more changes land while the first upsert is in flight.
    await controller.autoApply();
    await controller.autoApply();
    expect(upsertAutomation).toHaveBeenCalledTimes(1);

    resolveFirst({ yaml_diff: DIFF });
    await flushTimers();
    // Exactly one re-run so the latest value wins.
    expect(upsertAutomation).toHaveBeenCalledTimes(2);
    expect(controller.inFlightWrite).toBe(false);
    expect(controller.dirty).toBe(false);
  });

  it("surfaces an upsert failure via toast.error and the inline error", async () => {
    const { controller, upsertAutomation, setError } = setup();
    upsertAutomation.mockRejectedValueOnce(new Error("boom"));

    controller.scheduleAutoApply();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);

    expect(setError).toHaveBeenCalledWith("boom");
    expect(toast.error).toHaveBeenCalledWith("device.automation_save_error", {
      description: "boom",
      richColors: true,
    });
  });

  it("flushPending flushes the pending debounce immediately and cancels the timer", async () => {
    const { controller, upsertAutomation } = setup();
    controller.scheduleAutoApply();
    await controller.flushPending();
    expect(upsertAutomation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(upsertAutomation).toHaveBeenCalledTimes(1);
  });

  it("flushPending waits out the re-run queued by a debounce cancelled into an in-flight apply", async () => {
    const { host, controller, upsertAutomation } = setup();
    let resolveFirst!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r;
        })
    );
    const order: string[] = [];
    host.addEventListener("yaml-draft", () => order.push("draft"));
    const applying = controller.autoApply();
    // A keystroke lands inside the debounce window while the round
    // trip is outstanding.
    controller.scheduleAutoApply();
    const flushing = controller.flushPending().then(() => order.push("flushed"));

    await vi.advanceTimersByTimeAsync(60);
    // Releasing here would let the global save commit the
    // pre-keystroke YAML while the queued re-run is still unwritten.
    expect(order).not.toContain("flushed");

    resolveFirst({ yaml_diff: DIFF });
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([applying, flushing]);
    // Both drafts reached the page buffer before the caller was
    // released, not merely before this assertion.
    expect(order).toEqual(["draft", "draft", "flushed"]);
  });

  it("flushPending waits out a debounce armed while it was already settle-waiting", async () => {
    const { host, controller, upsertAutomation } = setup();
    let resolveFirst!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r;
        })
    );
    const order: string[] = [];
    host.addEventListener("yaml-draft", () => order.push("draft"));
    const applying = controller.autoApply();
    // No debounce yet — the flush parks on the settled promise.
    const flushing = controller.flushPending().then(() => order.push("flushed"));
    await vi.advanceTimersByTimeAsync(30);
    // The keystroke lands mid-wait, after the debounce check.
    controller.scheduleAutoApply();

    resolveFirst({ yaml_diff: DIFF });
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS + 60);
    await Promise.all([applying, flushing]);
    // The late keystroke's upsert still lands before the release.
    expect(order).toEqual(["draft", "draft", "flushed"]);
  });

  it("a mid-flight unmount still delivers the draft through the anchor", async () => {
    const parent = document.createElement("div");
    const { controller, upsertAutomation } = setup({}, parent);
    let resolveFirst!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r;
        })
    );
    const seen: CustomEvent[] = [];
    parent.addEventListener("yaml-draft", (e) => seen.push(e as CustomEvent));

    const applying = controller.autoApply();
    // Back's composed switch unmounts the editor mid round trip.
    controller.hostDisconnected();
    resolveFirst({ yaml_diff: DIFF });
    await applying;

    // The draft rides the mount-time anchor instead of vanishing
    // with the detached element (#1479).
    expect(seen).toHaveLength(1);
    expect(seen[0].detail.yaml).toBe("replaced\nline2");
    expect(seen[0].detail.basedOn).toBe("line1\nline2");
  });

  it("a queued re-run chains its basis after the host unmounts", async () => {
    const parent = document.createElement("div");
    const { controller, upsertAutomation } = setup({}, parent);
    let resolveFirst!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r;
        })
    );
    const seen: CustomEvent[] = [];
    parent.addEventListener("yaml-draft", (e) => seen.push(e as CustomEvent));

    const applying = controller.autoApply();
    // A keystroke queues a re-run, then the section unmounts.
    void controller.autoApply();
    controller.hostDisconnected();
    resolveFirst({ yaml_diff: DIFF });
    await applying;
    await flushTimers();

    // Both rounds land through the anchor; the detached re-run's
    // basis chains onto the first round's result instead of the
    // frozen prop, so its draft applies rather than toasting.
    expect(upsertAutomation).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(2);
    expect(seen[0].detail.basedOn).toBe("line1\nline2");
    expect(seen[1].detail.basedOn).toBe("replaced\nline2");
    expect(upsertAutomation.mock.calls[1][3]).toBe("replaced\nline2");
  });

  it("flushPending wakes on the settle boundary, not a poll tick", async () => {
    const { controller, upsertAutomation } = setup();
    let resolveFirst!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r;
        })
    );
    const applying = controller.autoApply();
    let flushed = false;
    const flushing = controller.flushPending().then(() => (flushed = true));

    // Parked on the in-flight round trip: no amount of waiting
    // releases the caller while the upsert is outstanding.
    await vi.advanceTimersByTimeAsync(1000);
    expect(flushed).toBe(false);

    resolveFirst({ yaml_diff: DIFF });
    // One zero-delay macrotask hop after the settle releases the
    // caller — a poll would still be asleep in its interval here.
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(true);
    await Promise.all([applying, flushing]);
  });

  it("shouldSkipReload skips the echo of its own write, not a foreign edit", async () => {
    const { host, controller } = setup();
    expect(controller.shouldSkipReload()).toBe(false);
    controller.scheduleAutoApply();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    // The parent loops the drafted YAML back through the yaml prop.
    host.yaml = "replaced\nline2";
    expect(controller.shouldSkipReload()).toBe(true);
    // A YAML-pane edit differs from our last write — reload proceeds.
    host.yaml = "something: else";
    expect(controller.shouldSkipReload()).toBe(false);
  });
});

describe("AutoApplyController delete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(toast.error).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies the delete diff, writes through, and announces yaml-updated + section-select", async () => {
    const { host, controller, deleteAutomation, updateConfig } = setup();
    const updated = captureEvents(host, "yaml-updated");
    const selected = captureEvents(host, "section-select");

    await controller.delete();

    expect(deleteAutomation).toHaveBeenCalledWith("device.yaml", SCRIPT, "line1\nline2");
    expect(updateConfig).toHaveBeenCalledWith("device.yaml", "replaced\nline2");
    expect(updated.map((e) => e.detail.yaml)).toEqual(["replaced\nline2"]);
    expect(selected.map((e) => e.detail.sectionKey)).toEqual([null]);
    expect(controller.deleting).toBe(false);
  });

  it("cancels a pending auto-apply before deleting and clears its dirty flag", async () => {
    const { controller, upsertAutomation } = setup();
    controller.scheduleAutoApply();
    await controller.delete();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(upsertAutomation).not.toHaveBeenCalled();
    expect(controller.dirty).toBe(false);
  });

  it("a failed delete re-arms the cancelled pending auto-apply", async () => {
    const { controller, upsertAutomation, deleteAutomation } = setup();
    deleteAutomation.mockRejectedValueOnce(new Error("nope"));
    controller.scheduleAutoApply();
    await controller.delete();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS + 20);
    expect(upsertAutomation).toHaveBeenCalledTimes(1);
  });

  it("surfaces a delete failure via toast.error and clears the deleting flag", async () => {
    const { controller, deleteAutomation, updateConfig, setError } = setup();
    deleteAutomation.mockRejectedValueOnce(new Error("nope"));

    await controller.delete();

    expect(updateConfig).not.toHaveBeenCalled();
    // The inline error is cleared on entry, then set from the failure.
    expect(setError.mock.calls).toEqual([[""], ["nope"]]);
    expect(toast.error).toHaveBeenCalledWith("device.automation_save_error", {
      description: "nope",
      richColors: true,
    });
    expect(controller.deleting).toBe(false);
  });

  it("waits out an in-flight upsert so its draft lands before the delete", async () => {
    const { host, controller, upsertAutomation, deleteAutomation } = setup();
    let resolveUpsert!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveUpsert = r;
        })
    );
    const order: string[] = [];
    host.addEventListener("yaml-draft", (e) => {
      order.push("draft");
      // Mirror the page faithfully: three nested Lit update cycles
      // carry the draft back down, each on its own microtask — only
      // the flush's macrotask hop drains them all before the delete
      // reads the buffer.
      const yaml = (e as CustomEvent<{ yaml: string }>).detail.yaml;
      void Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => Promise.resolve())
        .then(() => {
          host.yaml = yaml;
        });
    });
    const updatedDetails: YamlUpdatedDetail[] = [];
    host.addEventListener("yaml-updated", (e) => {
      order.push("updated");
      updatedDetails.push((e as CustomEvent<YamlUpdatedDetail>).detail);
    });

    const applying = controller.autoApply();
    const deleting = controller.delete();
    await vi.advanceTimersByTimeAsync(60);
    expect(deleteAutomation).not.toHaveBeenCalled();

    resolveUpsert({ yaml_diff: DIFF });
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([applying, deleting]);

    expect(deleteAutomation).toHaveBeenCalledOnce();
    expect(deleteAutomation).toHaveBeenCalledWith(
      "device.yaml",
      SCRIPT,
      "replaced\nline2"
    );
    expect(order).toEqual(["draft", "updated"]);
    // The basis is the settled pre-delete buffer, not the write.
    expect(updatedDetails).toEqual([
      {
        configuration: "device.yaml",
        yaml: "replaced\nline2",
        basedOn: "replaced\nline2",
        removed: { kind: "automation", location: SCRIPT },
      },
    ]);
  });

  it("a mid-flush section switch cannot retarget the delete", async () => {
    const { host, controller, upsertAutomation, deleteAutomation } = setup();
    let resolveUpsert!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveUpsert = r;
        })
    );

    const applying = controller.autoApply();
    const deleting = controller.delete();
    await vi.advanceTimersByTimeAsync(60);
    // The user clicks a sibling automation while the delete is parked on
    // the in-flight upsert; the reused element gets a new location.
    host.location = { kind: "script", id: "s2" };

    resolveUpsert({ yaml_diff: DIFF });
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([applying, deleting]);

    expect(deleteAutomation).toHaveBeenCalledOnce();
    // The snapshot taken before the barrier wins, not the swapped prop.
    expect(deleteAutomation.mock.calls[0][1]).toBe(SCRIPT);
  });

  it("a failed delete re-arms an edit scheduled during the delete window", async () => {
    const { controller, upsertAutomation, deleteAutomation } = setup();
    let rejectDelete!: (e: Error) => void;
    deleteAutomation.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectDelete = reject;
        })
    );
    const deleting = controller.delete();
    await vi.advanceTimersByTimeAsync(1);
    controller.scheduleAutoApply();

    rejectDelete(new Error("nope"));
    await deleting;
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS + 20);

    expect(upsertAutomation).toHaveBeenCalledTimes(1);
  });

  it("a sibling's edit suppressed during the delete window survives the delete", async () => {
    const { host, controller, upsertAutomation, deleteAutomation } = setup();
    const selections = captureEvents(host, "section-select");
    let resolveDelete!: (v: { yaml_diff: YamlDiff }) => void;
    deleteAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveDelete = r;
        })
    );
    const deleting = controller.delete();
    await vi.advanceTimersByTimeAsync(1);
    // The navigator re-points the reused element at a sibling and
    // the user edits it while the delete is still in flight.
    host.location = { kind: "script", id: "sibling" } as unknown as AutomationLocation;
    controller.scheduleAutoApply();

    resolveDelete({ yaml_diff: DIFF });
    await deleting;
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS + 20);

    expect(upsertAutomation).toHaveBeenCalledTimes(1);
    expect(upsertAutomation).toHaveBeenCalledWith(
      "device.yaml",
      host.value,
      host.location,
      expect.any(String)
    );
    // The user is on the sibling; the delete must not navigate away
    // (that unmount would cancel the re-armed edit).
    expect(selections).toHaveLength(0);
  });

  it("a mid-delete unmount still lands yaml-updated through the mount-time parent", async () => {
    const { host, controller, deleteAutomation } = setup();
    // Production's anchor is board-info's ShadowRoot, so the listener
    // sits on the shadow host outside the boundary — the assertion
    // then pins the composed flag the whole fix rides on, not merely
    // that the dispatch target swapped.
    const outer = document.createElement("div");
    const shadow = outer.attachShadow({ mode: "open" });
    const updates: string[] = [];
    outer.addEventListener("yaml-updated", (e) =>
      updates.push((e as CustomEvent<{ yaml: string }>).detail.yaml)
    );
    host.parentNode = shadow;
    const selections = captureEvents(host, "section-select");
    let resolveDelete!: (v: { yaml_diff: YamlDiff }) => void;
    deleteAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveDelete = r;
        })
    );
    const deleting = controller.delete();
    await vi.advanceTimersByTimeAsync(1);
    // A different-kind section switch swaps the element out of the
    // tree while the delete round trip is outstanding — Lit tears it
    // down through disconnectedCallback. parentNode nulls too, so a
    // regression that snapshots the anchor after the awaits fails.
    controller.hostDisconnected();
    host.parentNode = null;

    resolveDelete({ yaml_diff: DIFF });
    await deleting;

    // The disk write still reaches the page's buffer via the parent…
    expect(updates).toEqual(["replaced\nline2"]);
    // …and no navigation fires at a user who already left.
    expect(selections).toHaveLength(0);
  });

  it("a mid-flush retarget without an edit stays on the sibling with nothing re-armed", async () => {
    const { host, controller, upsertAutomation, deleteAutomation } = setup();
    const selections = captureEvents(host, "section-select");
    let resolveDelete!: (v: { yaml_diff: YamlDiff }) => void;
    deleteAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveDelete = r;
        })
    );
    const deleting = controller.delete();
    await vi.advanceTimersByTimeAsync(1);
    // The navigator re-points the reused element at a sibling but the
    // user types nothing before the delete resolves.
    host.location = { kind: "script", id: "sibling" } as unknown as AutomationLocation;

    resolveDelete({ yaml_diff: DIFF });
    await deleting;
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS + 20);

    expect(selections).toHaveLength(0);
    expect(upsertAutomation).not.toHaveBeenCalled();
    expect(controller.dirty).toBe(false);
  });

  it("a suppressed sibling edit is not re-armed after navigating back to the deleted section", async () => {
    const { host, controller, upsertAutomation, deleteAutomation } = setup();
    let resolveDelete!: (v: { yaml_diff: YamlDiff }) => void;
    deleteAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveDelete = r;
        })
    );
    const deleting = controller.delete();
    await vi.advanceTimersByTimeAsync(1);
    // Retarget to a sibling, edit it, then navigate back to the
    // section being deleted before the round-trip finishes.
    host.location = { kind: "script", id: "sibling" } as unknown as AutomationLocation;
    controller.scheduleAutoApply();
    host.location = SCRIPT;

    resolveDelete({ yaml_diff: DIFF });
    await deleting;
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS + 20);

    // Re-arming here would upsert the deleted location and resurrect
    // it; the guard requires the host to still show the sibling.
    expect(upsertAutomation).not.toHaveBeenCalled();
    expect(controller.dirty).toBe(false);
  });

  it("a failed delete does not re-arm a torn-down section", async () => {
    const { controller, upsertAutomation, deleteAutomation } = setup();
    deleteAutomation.mockRejectedValueOnce(new Error("nope"));
    controller.scheduleAutoApply();
    const deleting = controller.delete();
    controller.hostDisconnected();
    await deleting;
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS + 20);
    expect(upsertAutomation).not.toHaveBeenCalled();
  });

  it("a failed delete re-arms the edit suppressed during the delete window", async () => {
    const { controller, upsertAutomation, deleteAutomation } = setup();
    let resolveUpsert!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveUpsert = r;
        })
    );
    deleteAutomation.mockRejectedValueOnce(new Error("nope"));
    const first = controller.autoApply();
    void controller.autoApply();
    const deleting = controller.delete();

    resolveUpsert({ yaml_diff: DIFF });
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([first, deleting]);
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS + 20);

    expect(upsertAutomation).toHaveBeenCalledTimes(2);
    expect(controller.dirty).toBe(false);
  });

  it("a queued re-apply is dropped once the delete owns the section", async () => {
    const { controller, upsertAutomation } = setup();
    let resolveUpsert!: (v: { yaml_diff: YamlDiff }) => void;
    upsertAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveUpsert = r;
        })
    );
    const first = controller.autoApply();
    void controller.autoApply();
    const deleting = controller.delete();

    resolveUpsert({ yaml_diff: DIFF });
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([first, deleting]);

    expect(upsertAutomation).toHaveBeenCalledTimes(1);
  });

  it("nothing schedules a new upsert while a delete is running", async () => {
    const { controller, upsertAutomation, deleteAutomation } = setup();
    let resolveDelete!: (v: { yaml_diff: YamlDiff }) => void;
    deleteAutomation.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveDelete = r;
        })
    );
    const deleting = controller.delete();
    await vi.advanceTimersByTimeAsync(1);
    controller.scheduleAutoApply();
    // The schedule guard refuses outright: no armed timer and no
    // spurious dirty flip while the delete owns the section.
    expect(controller.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS + 20);

    resolveDelete({ yaml_diff: DIFF });
    await vi.advanceTimersByTimeAsync(20);
    await deleting;

    expect(upsertAutomation).not.toHaveBeenCalled();
  });
});

describe("AutoApplyController host lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers itself on the host", () => {
    const host = new Host();
    const addController = vi.spyOn(host, "addController");
    const controller = new AutoApplyController(host, {
      getApi: () => undefined,
      getLocalize: () => localize,
      isReadOnly: () => false,
      setError: () => {},
    });
    expect(addController).toHaveBeenCalledWith(controller);
  });

  // No parent → exercises the ``anchor ?? host`` fallback dispatch;
  // the anchored path production uses is pinned by the test below.
  it("announces section-mount / section-unmount with the host node", () => {
    const { host, controller } = setup();
    const mounts = captureEvents(host, "section-mount");
    const unmounts = captureEvents(host, "section-unmount");
    controller.hostConnected();
    controller.hostDisconnected();
    expect(mounts.map((e) => e.detail.node)).toEqual([host]);
    expect(unmounts.map((e) => e.detail.node)).toEqual([host]);
  });

  it("the unmount announcement rides the mount-time parent past detachment", () => {
    const outer = document.createElement("div");
    const shadow = outer.attachShadow({ mode: "open" });
    const { host, controller } = setup({}, shadow);
    const unmounts: unknown[] = [];
    outer.addEventListener("section-unmount", (e) =>
      unmounts.push((e as CustomEvent<{ node: unknown }>).detail.node)
    );
    // Tear down like Lit does — after the host has left the tree.
    host.parentNode = null;
    controller.hostDisconnected();

    expect(unmounts).toEqual([host]);
  });

  it("drains the pending debounced upsert into a detached round on disconnect", async () => {
    const parent = document.createElement("div");
    const { controller, upsertAutomation } = setup({}, parent);
    const seen: CustomEvent[] = [];
    parent.addEventListener("yaml-draft", (e) => seen.push(e as CustomEvent));

    controller.scheduleAutoApply();
    controller.hostDisconnected();
    await flushTimers();

    // The keystrokes inside the debounce window are not dropped:
    // the round starts immediately (no timer left to fire) and its
    // draft rides the anchor with the frozen prop as its basis.
    expect(upsertAutomation).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].detail.basedOn).toBe("line1\nline2");
  });
});
