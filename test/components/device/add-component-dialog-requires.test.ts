/**
 * @vitest-environment happy-dom
 *
 * A featured component can declare `requires` (an i2c bus, then the pcf8574 hub
 * a gpio pin sits on). Selecting it must surface the prerequisites that aren't
 * already in the YAML — by their locked id — so the add flow can land them
 * first. Covers `_missingRequiredPrereqs`, the decision behind the auto-add.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  BoardCatalogEntry,
  FeaturedComponent,
} from "../../../src/api/types/boards.js";
import { ESPHomeAddComponentDialog } from "../../../src/components/device/add-component-dialog.js";
import { buildFeaturedId } from "../../../src/util/featured-id.js";

const BOARD_ID = "kincony_kc868_a16v3";

function fc(
  id: string,
  componentId: string,
  lockedId: string,
  requires?: string[]
): FeaturedComponent {
  return {
    id,
    component_id: componentId,
    name: id,
    description: null,
    fields: { id: { value: lockedId, locked: true, suggestions: null } },
    ...(requires ? { requires } : {}),
  };
}

function makeDialog(yaml: string) {
  const dialog = new ESPHomeAddComponentDialog();
  const board = {
    id: BOARD_ID,
    featured_components: [
      fc("bus_a", "i2c", "bus_a"),
      fc("pcf8574_hub_in_1", "pcf8574", "pcf8574_hub_in_1", ["bus_a"]),
      fc("input_1", "binary_sensor.gpio", "binary_sensor_gpio_1", [
        "bus_a",
        "pcf8574_hub_in_1",
      ]),
    ],
  } as unknown as BoardCatalogEntry;
  Object.assign(dialog as unknown as Record<string, unknown>, { board });
  dialog.yaml = yaml;
  return dialog as unknown as {
    _missingRequiredPrereqs: (entry: { id: string }) => {
      boardId: string;
      missing: string[];
      unresolved: string[];
    } | null;
  };
}

const ENTITY_ID = buildFeaturedId(BOARD_ID, "input_1");

describe("_missingRequiredPrereqs", () => {
  it("lists the bus then the hub, in order, when neither is present", () => {
    const dialog = makeDialog("esphome:\n  name: foo\n");
    expect(dialog._missingRequiredPrereqs({ id: ENTITY_ID })).toEqual({
      boardId: BOARD_ID,
      missing: [
        buildFeaturedId(BOARD_ID, "bus_a"),
        buildFeaturedId(BOARD_ID, "pcf8574_hub_in_1"),
      ],
      unresolved: [],
    });
  });

  it("skips a prerequisite whose locked id is already in the YAML", () => {
    const dialog = makeDialog("i2c:\n  - id: bus_a\n    sda: 9\n    scl: 10\n");
    expect(dialog._missingRequiredPrereqs({ id: ENTITY_ID })?.missing).toEqual([
      buildFeaturedId(BOARD_ID, "pcf8574_hub_in_1"),
    ]);
  });

  it("returns null for a non-featured catalog entry", () => {
    const dialog = makeDialog("esphome:\n  name: foo\n");
    expect(dialog._missingRequiredPrereqs({ id: "binary_sensor.gpio" })).toBeNull();
  });

  it("reports (and warns about) a requires id with no matching featured component", () => {
    const dialog = new ESPHomeAddComponentDialog();
    const board = {
      id: BOARD_ID,
      featured_components: [
        fc("input_1", "binary_sensor.gpio", "binary_sensor_gpio_1", ["ghost_hub"]),
      ],
    } as unknown as BoardCatalogEntry;
    Object.assign(dialog as unknown as Record<string, unknown>, { board });
    dialog.yaml = "esphome:\n  name: foo\n";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = (
      dialog as unknown as {
        _missingRequiredPrereqs: (e: {
          id: string;
        }) => { missing: string[]; unresolved: string[] } | null;
      }
    )._missingRequiredPrereqs({ id: ENTITY_ID });
    // Recorded as unresolved (so the caller refuses the add), not stamped as a
    // resolvable prerequisite to auto-add.
    expect(result?.missing).toEqual([]);
    expect(result?.unresolved).toEqual(["ghost_hub"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ghost_hub"));
    warn.mockRestore();
  });
});
