/**
 * @vitest-environment happy-dom
 *
 * A featured component can declare `requires` (an i2c bus, then the pcf8574 hub
 * a gpio pin sits on). Selecting it must surface the prerequisites that aren't
 * already in the YAML — by their locked id — so the add flow can land them
 * first. Covers `missingRequiredPrereqs`, the decision behind the auto-add.
 */
import { describe, expect, it, vi } from "vitest";

import type { FeaturedComponent } from "../../../src/api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import {
  missingRequiredPrereqs,
  type OpenComponentHost,
} from "../../../src/components/device/add-component-dialog-open.js";
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

function makeHost(
  yaml: string,
  featured: FeaturedComponent[] = [
    fc("bus_a", "i2c", "bus_a"),
    fc("pcf8574_hub_in_1", "pcf8574", "pcf8574_hub_in_1", ["bus_a"]),
    fc("input_1", "binary_sensor.gpio", "binary_sensor_gpio_1", [
      "bus_a",
      "pcf8574_hub_in_1",
    ]),
  ]
): OpenComponentHost {
  return {
    board: { id: BOARD_ID, featured_components: featured },
    yaml,
  } as unknown as OpenComponentHost;
}

const entry = (id: string) => ({ id }) as ComponentCatalogEntry;

const ENTITY_ID = buildFeaturedId(BOARD_ID, "input_1");

describe("missingRequiredPrereqs", () => {
  it("lists the bus then the hub, in order, when neither is present", () => {
    const host = makeHost("esphome:\n  name: foo\n");
    expect(missingRequiredPrereqs(host, entry(ENTITY_ID))).toEqual({
      boardId: BOARD_ID,
      missing: [
        buildFeaturedId(BOARD_ID, "bus_a"),
        buildFeaturedId(BOARD_ID, "pcf8574_hub_in_1"),
      ],
      unresolved: [],
    });
  });

  it("skips a prerequisite whose locked id is already in the YAML", () => {
    const host = makeHost("i2c:\n  - id: bus_a\n    sda: 9\n    scl: 10\n");
    expect(missingRequiredPrereqs(host, entry(ENTITY_ID))?.missing).toEqual([
      buildFeaturedId(BOARD_ID, "pcf8574_hub_in_1"),
    ]);
  });

  it("returns null for a non-featured catalog entry", () => {
    const host = makeHost("esphome:\n  name: foo\n");
    expect(missingRequiredPrereqs(host, entry("binary_sensor.gpio"))).toBeNull();
  });

  it("reports (and warns about) a requires id with no matching featured component", () => {
    const host = makeHost("esphome:\n  name: foo\n", [
      fc("input_1", "binary_sensor.gpio", "binary_sensor_gpio_1", ["ghost_hub"]),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = missingRequiredPrereqs(host, entry(ENTITY_ID));
    // Recorded as unresolved (so the caller refuses the add), not stamped as a
    // resolvable prerequisite to auto-add.
    expect(result?.missing).toEqual([]);
    expect(result?.unresolved).toEqual(["ghost_hub"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ghost_hub"));
    warn.mockRestore();
  });
});
