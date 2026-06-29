/**
 * @vitest-environment happy-dom
 *
 * One-shot bundle add. Picking a bundle merges every member with its board
 * presets and no form, threading the editor draft; a member that needs input
 * the presets don't cover hands off to the interactive sequence from there so
 * the bundle still completes, keeping anything already added.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from "sonner-js";

import { ComponentCategory } from "../../../src/api/types/components.js";
import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";

interface Internals {
  _open: boolean;
  _prefillReference: { domain: string; id: string } | null;
  _bundleProgress: { current: number; total: number; bundleName: string } | null;
  _fastPathFields: (entry: unknown) => Record<string, unknown> | null;
  _startFeaturedSequence: (
    fullIds: string[],
    boardId: string,
    name: string
  ) => Promise<boolean>;
  _onBundleSelected: (e: CustomEvent) => Promise<void>;
}

function makeDialog() {
  const addComponent = vi.fn().mockResolvedValue({ yaml: "MERGED" });
  const getComponentBodies = vi.fn().mockResolvedValue({});
  const dialog = new ESPHomeAddComponentDialog();
  Object.assign(dialog as unknown as Record<string, unknown>, {
    _api: { addComponent, getComponentBodies },
  });
  dialog.configuration = "foo.yaml";
  dialog.yaml = "esphome:\n  name: foo\n";
  return { dialog, d: dialog as unknown as Internals, addComponent, getComponentBodies };
}

function bundleEvent(componentIds: string[], boardId = "bd") {
  return new CustomEvent("add-bundle", {
    detail: { bundle: { name: "Full setup", component_ids: componentIds }, boardId },
  });
}

afterEach(() => {
  _clearComponentCache();
  vi.clearAllMocks();
});

describe("add-component-dialog one-shot bundle", () => {
  it("adds every member with no form, threading the merged draft", async () => {
    const { d, addComponent, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({
      "featured.bd.a": makeComponentEntry("featured.bd.a", {
        category: ComponentCategory.SWITCH,
      }),
      "featured.bd.b": makeComponentEntry("featured.bd.b", {
        category: ComponentCategory.SWITCH,
      }),
    });
    addComponent
      .mockResolvedValueOnce({ yaml: "Y1" })
      .mockResolvedValueOnce({ yaml: "Y2" });
    // Distinct member ids — two bundle members never share one in practice.
    d._fastPathFields = vi.fn().mockImplementation((entry: { id: string }) => ({
      id: entry.id === "featured.bd.a" ? "xa" : "xb",
    }));

    await d._onBundleSelected(bundleEvent(["a", "b"]));

    expect(addComponent).toHaveBeenCalledTimes(2);
    // First member merges into the editor draft, the second into the result of
    // the first — one accumulating chain, not two independent merges.
    expect(addComponent.mock.calls[0]).toEqual([
      "foo.yaml",
      { component_id: "featured.bd.a", fields: { id: "xa" } },
      "esphome:\n  name: foo\n",
    ]);
    expect(addComponent.mock.calls[1]).toEqual([
      "foo.yaml",
      { component_id: "featured.bd.b", fields: { id: "xb" } },
      "Y1",
    ]);
    expect(d._open).toBe(false);
  });

  it("skips a member already present in the device instead of re-adding it", async () => {
    const { d, addComponent, getComponentBodies, dialog } = makeDialog();
    // The device already has member "a" (id `present_a`); re-applying the
    // bundle must not append it again.
    dialog.yaml = "switch:\n  - platform: gpio\n    id: present_a\n";
    getComponentBodies.mockResolvedValue({
      "featured.bd.a": makeComponentEntry("featured.bd.a", {
        category: ComponentCategory.SWITCH,
      }),
      "featured.bd.b": makeComponentEntry("featured.bd.b", {
        category: ComponentCategory.SWITCH,
      }),
    });
    addComponent.mockResolvedValue({ yaml: "Y_AFTER_B" });
    d._fastPathFields = vi.fn().mockImplementation((entry: { id: string }) => ({
      id: entry.id === "featured.bd.a" ? "present_a" : "new_b",
    }));

    await d._onBundleSelected(bundleEvent(["a", "b"]));

    // Only the absent member "b" is added; "a" is skipped, not duplicated.
    expect(addComponent).toHaveBeenCalledTimes(1);
    expect(addComponent.mock.calls[0][1]).toEqual({
      component_id: "featured.bd.b",
      fields: { id: "new_b" },
    });
    expect(d._open).toBe(false);
  });

  it("shows 'already set up' instead of 'Added' when every member is present", async () => {
    const { d, addComponent, getComponentBodies, dialog } = makeDialog();
    dialog.yaml = "switch:\n  - platform: gpio\n    id: present_a\n";
    getComponentBodies.mockResolvedValue({
      "featured.bd.a": makeComponentEntry("featured.bd.a", {
        category: ComponentCategory.SWITCH,
      }),
    });
    d._fastPathFields = vi.fn().mockReturnValue({ id: "present_a" });

    await d._onBundleSelected(bundleEvent(["a"]));

    // Nothing was added, so the toast must not claim "Added".
    expect(addComponent).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("device.bundle_already_present", {
      richColors: true,
    });
  });

  it("hands off to the interactive sequence when a member needs the form", async () => {
    const { d, addComponent, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({
      "featured.bd.a": makeComponentEntry("featured.bd.a", {
        category: ComponentCategory.OUTPUT,
      }),
      "featured.bd.b": makeComponentEntry("featured.bd.b", {
        category: ComponentCategory.LIGHT,
      }),
    });
    const startSequence = vi.fn().mockResolvedValue(true);
    d._startFeaturedSequence = startSequence;
    // First member fast-paths; the second needs the form.
    d._fastPathFields = vi
      .fn()
      .mockReturnValueOnce({ id: "dep" })
      .mockReturnValueOnce(null);

    await d._onBundleSelected(bundleEvent(["a", "b"]));

    // Only the silent first member was added; the rest is handed off.
    expect(addComponent).toHaveBeenCalledTimes(1);
    expect(addComponent.mock.calls[0][1]).toEqual({
      component_id: "featured.bd.a",
      fields: { id: "dep" },
    });
    expect(startSequence).toHaveBeenCalledWith(["featured.bd.b"], "bd", "Full setup");
    // The just-added dependency is carried into the opened form's reference.
    expect(d._prefillReference).toEqual({ domain: ComponentCategory.OUTPUT, id: "dep" });
  });

  it("does not clobber state when the hand-off sequence goes stale", async () => {
    const { d, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({
      "featured.bd.a": makeComponentEntry("featured.bd.a", {
        category: ComponentCategory.OUTPUT,
      }),
    });
    // The interactive sequence reports it didn't start (stale / errored hydrate).
    d._startFeaturedSequence = vi.fn().mockResolvedValue(false);
    d._fastPathFields = vi
      .fn()
      .mockReturnValueOnce({ id: "dep" })
      .mockReturnValueOnce(null);

    await d._onBundleSelected(bundleEvent(["a", "b"]));

    // A superseded sequence opened no form; the silent loop's prefill/progress
    // must not overwrite the newer selection's state.
    expect(d._prefillReference).toBeNull();
    expect(d._bundleProgress).toBeNull();
  });

  it("opens the form on the first member when nothing can be fast-pathed", async () => {
    const { d, addComponent, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({
      "featured.bd.a": makeComponentEntry("featured.bd.a"),
    });
    const startSequence = vi.fn();
    d._startFeaturedSequence = startSequence;
    d._fastPathFields = vi.fn().mockReturnValue(null);

    await d._onBundleSelected(bundleEvent(["a"]));

    expect(addComponent).not.toHaveBeenCalled();
    expect(startSequence).toHaveBeenCalledWith(["featured.bd.a"], "bd", "Full setup");
  });

  it("publishes the merged draft so far when a member fails mid-batch", async () => {
    const { dialog, d, addComponent, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({
      "featured.bd.a": makeComponentEntry("featured.bd.a", {
        category: ComponentCategory.SWITCH,
      }),
      "featured.bd.b": makeComponentEntry("featured.bd.b", {
        category: ComponentCategory.SWITCH,
      }),
    });
    addComponent
      .mockResolvedValueOnce({ yaml: "Y1" })
      .mockRejectedValueOnce(new Error("boom"));
    d._fastPathFields = vi.fn().mockReturnValue({ id: "x" });
    const drafts: string[] = [];
    dialog.addEventListener("yaml-draft", (e) => {
      drafts.push((e as CustomEvent).detail.yaml);
    });

    await d._onBundleSelected(bundleEvent(["a", "b"]));

    // The first member's merge is surfaced so the host keeps it; not lost to the
    // throw on the second.
    expect(drafts).toEqual(["Y1"]);
  });

  it("publishes the merged draft so far when a later selection makes the batch stale", async () => {
    const { dialog, d, addComponent, getComponentBodies } = makeDialog();
    const bodies: Record<string, unknown> = {
      "featured.bd.a": makeComponentEntry("featured.bd.a", {
        category: ComponentCategory.SWITCH,
      }),
      "featured.bd.b": makeComponentEntry("featured.bd.b", {
        category: ComponentCategory.SWITCH,
      }),
    };
    // Bump the selection token while member b is hydrating so its result is
    // stale (a newer catalog selection superseded the batch).
    getComponentBodies.mockImplementation(async (ids: string[]) => {
      if (ids.includes("featured.bd.b")) {
        (d as unknown as { _selectionSeq: number })._selectionSeq++;
      }
      return Object.fromEntries(
        ids.filter((id) => id in bodies).map((id) => [id, bodies[id]])
      );
    });
    addComponent.mockResolvedValueOnce({ yaml: "Y1" });
    d._fastPathFields = vi.fn().mockReturnValue({ id: "x" });
    const drafts: string[] = [];
    dialog.addEventListener("yaml-draft", (e) => {
      drafts.push((e as CustomEvent).detail.yaml);
    });

    await d._onBundleSelected(bundleEvent(["a", "b"]));

    // Member a merged to Y1; b went stale; the partial draft is still published.
    expect(addComponent).toHaveBeenCalledTimes(1);
    expect(drafts).toEqual(["Y1"]);
  });

  it("counts silently-added members in the hand-off progress banner", async () => {
    const { d, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({
      "featured.bd.a": makeComponentEntry("featured.bd.a", {
        category: ComponentCategory.OUTPUT,
      }),
      "featured.bd.b": makeComponentEntry("featured.bd.b", {
        category: ComponentCategory.LIGHT,
      }),
      "featured.bd.c": makeComponentEntry("featured.bd.c", {
        category: ComponentCategory.LIGHT,
      }),
    });
    // First member fast-paths silently; the second needs the form.
    d._fastPathFields = vi
      .fn()
      .mockReturnValueOnce({ id: "dep" })
      .mockReturnValueOnce(null);

    await d._onBundleSelected(bundleEvent(["a", "b", "c"]));

    // Member b opens at step 2 of 3, not step 1 of 2.
    expect(d._bundleProgress).toEqual({ current: 2, total: 3, bundleName: "Full setup" });
  });

  it("surfaces the message and keeps partial progress when a member fails to hydrate", async () => {
    const { dialog, d, addComponent, getComponentBodies } = makeDialog();
    // b is absent from the bodies, so its hydrate resolves to an error.
    getComponentBodies.mockResolvedValue({
      "featured.bd.a": makeComponentEntry("featured.bd.a", {
        category: ComponentCategory.SWITCH,
      }),
    });
    const startSequence = vi.fn();
    d._startFeaturedSequence = startSequence;
    addComponent.mockResolvedValueOnce({ yaml: "Y1" });
    d._fastPathFields = vi.fn().mockReturnValue({ id: "x" });
    const drafts: string[] = [];
    dialog.addEventListener("yaml-draft", (e) => {
      drafts.push((e as CustomEvent).detail.yaml);
    });

    await d._onBundleSelected(bundleEvent(["a", "b"]));

    // a merged to Y1 and is published; b's error is surfaced directly, with no
    // redundant re-fetch through the interactive hand-off.
    expect(addComponent).toHaveBeenCalledTimes(1);
    expect(drafts).toEqual(["Y1"]);
    expect(startSequence).not.toHaveBeenCalled();
    expect((d as unknown as { _submitError: string })._submitError).not.toBe("");
  });
});
