/**
 * @vitest-environment happy-dom
 *
 * The add dialog selects what it just added, so the navigator and the
 * section editor land on it instead of leaving the user wherever they
 * were. A board-curated entry's catalog id is the synthetic
 * `featured.<board>.<local>`, which matches no YAML section key, so it
 * has to be resolved to the component it actually adds first.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../_mock-webawesome.js";

vi.mock("../../../src/components/device/add-component-form.js", () => ({}));
vi.mock("../../../src/components/device/component-catalog.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import { ComponentCategory } from "../../../src/api/types/components.js";
import { _clearComponentCache } from "../../../src/util/component-name-cache.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeAddComponentDialogHost } from "./_add-component-dialog-host.js";

// A binary_sensor already in the device, so the added one has to be told
// apart from it by id rather than just "the only gpio block".
const YAML = [
  "esphome:",
  "  name: foo",
  "binary_sensor:",
  "  - platform: gpio",
  "    name: Motion Module",
  "    id: motion_module",
  "    pin: 3",
  "",
].join("\n");

const MERGED = `${YAML}  - platform: gpio\n    name: Boot Button\n    id: boot_button\n    pin: 9\n`;

/** A board whose `boot_button` preset materializes a `binary_sensor.gpio`. */
const BOARD = {
  id: "apollo-esk-1",
  featured_components: [
    { id: "boot_button", component_id: "binary_sensor.gpio", fields: {} },
    { id: "led", component_id: "light.binary", fields: {} },
  ],
} as unknown as BoardCatalogEntry;

interface Internals {
  _selected: unknown;
  _fastPathFields: (entry: unknown) => Record<string, unknown> | null;
  _submitComponent: (fields: Record<string, unknown>, notify?: boolean) => Promise<void>;
  _onBundleSelected: (e: CustomEvent) => Promise<void>;
}

const makeDialog = () =>
  makeAddComponentDialogHost<Internals>({ yaml: YAML, mergedYaml: MERGED, board: BOARD });

/** Every `section-select` the dialog dispatches. */
const capture = (el: EventTarget) => {
  const seen: { sectionKey: string; fromLine: number }[] = [];
  el.addEventListener("section-select", (e) =>
    seen.push((e as CustomEvent<{ sectionKey: string; fromLine: number }>).detail)
  );
  return seen;
};

afterEach(() => {
  _clearComponentCache();
  vi.clearAllMocks();
});

describe("add-component-dialog selects what it added", () => {
  it("resolves a board-curated id to the section it actually adds", async () => {
    // The reported bug: `featured.apollo-esk-1.boot_button` matched no
    // section, so nothing was selected and the editor stayed on whatever
    // was open — here, the other gpio binary_sensor.
    const { dialog, d } = makeDialog();
    d._selected = makeComponentEntry("featured.apollo-esk-1.boot_button", {
      name: "Boot Button",
      category: ComponentCategory.BINARY_SENSOR,
    });
    const seen = capture(dialog);

    await d._submitComponent({ id: "boot_button" }, true);

    expect(seen).toEqual([{ sectionKey: "binary_sensor.gpio", fromLine: 8 }]);
  });

  it("still selects a plain catalog component", async () => {
    // Non-featured ids pass through the resolver untouched.
    const { dialog, d } = makeDialog();
    d._selected = makeComponentEntry("binary_sensor.gpio", {
      name: "GPIO Binary Sensor",
      category: ComponentCategory.BINARY_SENSOR,
    });
    const seen = capture(dialog);

    await d._submitComponent({ id: "boot_button" }, true);

    expect(seen).toEqual([{ sectionKey: "binary_sensor.gpio", fromLine: 8 }]);
  });

  // Better to stay put than navigate somewhere wrong. Two distinct ways to
  // miss: the id never resolves, and it resolves to a section the merged
  // YAML doesn't hold — only the second reaches the resolver.
  it.each([
    ["an id the board doesn't carry", "featured.apollo-esk-1.unknown"],
    ["an id resolving to an absent section", "featured.apollo-esk-1.led"],
  ])("leaves the selection alone for %s", async (_label, id) => {
    const { dialog, d } = makeDialog();
    d._selected = makeComponentEntry(id, {
      name: "Mystery",
      category: ComponentCategory.BINARY_SENSOR,
    });
    const seen = capture(dialog);

    await d._submitComponent({ id: "boot_button" }, true);

    expect(seen).toEqual([]);
  });

  it("lands on the last member a bundle merged", async () => {
    const { dialog, d, addComponent, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({
      "featured.apollo-esk-1.led": makeComponentEntry("featured.apollo-esk-1.led", {
        category: ComponentCategory.LIGHT,
      }),
      "featured.apollo-esk-1.boot_button": makeComponentEntry(
        "featured.apollo-esk-1.boot_button",
        { category: ComponentCategory.BINARY_SENSOR }
      ),
    });
    addComponent
      .mockResolvedValueOnce({ yaml: YAML })
      .mockResolvedValueOnce({ yaml: MERGED });
    d._fastPathFields = vi.fn().mockImplementation((entry: { id: string }) => ({
      id: entry.id.endsWith("led") ? "led" : "boot_button",
    }));
    const seen = capture(dialog);

    await d._onBundleSelected(
      new CustomEvent("add-bundle", {
        detail: {
          bundle: { name: "Full setup", component_ids: ["led", "boot_button"] },
          boardId: "apollo-esk-1",
        },
      })
    );

    // The headline member is the one added last, not the first.
    expect(seen).toEqual([{ sectionKey: "binary_sensor.gpio", fromLine: 8 }]);
  });

  it("selects nothing when every bundle member was already present", async () => {
    // Nothing was added, so there is nothing to land on.
    const { dialog, d, getComponentBodies } = makeDialog();
    getComponentBodies.mockResolvedValue({
      "featured.apollo-esk-1.boot_button": makeComponentEntry(
        "featured.apollo-esk-1.boot_button",
        { category: ComponentCategory.BINARY_SENSOR }
      ),
    });
    // `motion_module` is already in YAML, so the member is skipped.
    d._fastPathFields = vi.fn().mockReturnValue({ id: "motion_module" });
    const seen = capture(dialog);

    await d._onBundleSelected(
      new CustomEvent("add-bundle", {
        detail: {
          bundle: { name: "Full setup", component_ids: ["boot_button"] },
          boardId: "apollo-esk-1",
        },
      })
    );

    expect(seen).toEqual([]);
  });
});
