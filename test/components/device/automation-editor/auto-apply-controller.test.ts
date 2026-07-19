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
  updates = 0;
  addController(_c: ReactiveController): void {}
  removeController(): void {}
  requestUpdate(): void {
    this.updates++;
  }
  updateComplete = Promise.resolve(true);
}

const localize: LocalizeFunc = identityLocalize as LocalizeFunc;

function setup(over: Partial<AutoApplyOptions> = {}) {
  const host = new Host();
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
    // The returned diff is applied locally and pushed up as a draft.
    expect(drafts.map((e) => e.detail.yaml)).toEqual(["replaced\nline2"]);
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

  it("cancels a pending auto-apply before deleting", async () => {
    const { controller, upsertAutomation } = setup();
    controller.scheduleAutoApply();
    await controller.delete();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(upsertAutomation).not.toHaveBeenCalled();
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

  it("announces section-mount / section-unmount with the host node", () => {
    const { host, controller } = setup();
    const mounts = captureEvents(host, "section-mount");
    const unmounts = captureEvents(host, "section-unmount");
    controller.hostConnected();
    controller.hostDisconnected();
    expect(mounts.map((e) => e.detail.node)).toEqual([host]);
    expect(unmounts.map((e) => e.detail.node)).toEqual([host]);
  });

  it("cancels the pending debounced upsert on host disconnect", async () => {
    const { controller, upsertAutomation } = setup();
    controller.scheduleAutoApply();
    controller.hostDisconnected();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_DEBOUNCE_MS);
    expect(upsertAutomation).not.toHaveBeenCalled();
  });
});
