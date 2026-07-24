/**
 * @vitest-environment happy-dom
 *
 * The add form threads the resolved section key into the shared form so
 * board featured-component pin designations guard there like the editor.
 */
import { describe, expect, it } from "vitest";

import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { buildFeaturedId } from "../../../src/util/featured-id.js";
import { identityLocalize } from "../../_dom.js";
import {
  extractAttributeBindings,
  findTemplatesByAnchor,
} from "../../_lit-template-walker.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";
import { makeTestBoard } from "./_renderer-fixtures.js";

const BOARD = makeTestBoard({
  overrides: {
    id: "apollo-esk-1",
    featured_components: [
      { id: "rgb_leds", component_id: "light.esp32_rmt_led_strip", fields: {} },
    ],
  } as never,
});

function renderedSectionKey(
  component: ComponentCatalogEntry,
  board: BoardCatalogEntry | null
): unknown {
  const form = new ESPHomeAddComponentForm();
  const internals = form as unknown as {
    component: ComponentCatalogEntry;
    board: BoardCatalogEntry | null;
    _localize: (key: string) => string;
    render: () => unknown;
  };
  internals.component = component;
  internals.board = board;
  internals._localize = identityLocalize;
  const inner = findTemplatesByAnchor(internals.render(), "<esphome-config-entry-form");
  return extractAttributeBindings(inner[0])[".sectionKey"];
}

describe("add-component-form section key", () => {
  it("resolves a featured id to the component it adds", () => {
    expect(
      renderedSectionKey(
        makeComponentEntry(buildFeaturedId("apollo-esk-1", "rgb_leds")),
        BOARD
      )
    ).toBe("light.esp32_rmt_led_strip");
  });

  it("passes a plain catalog id through", () => {
    expect(renderedSectionKey(makeComponentEntry("sensor.ags10"), BOARD)).toBe(
      "sensor.ags10"
    );
  });
});
