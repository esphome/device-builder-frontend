/**
 * @vitest-environment happy-dom
 *
 * The Supports / Other / Reserved group labels and dividers inside the
 * pin ``<wa-select>`` are a sighted-only contrast cue (there's no
 * wa-optgroup to carry real grouping). They must be ``aria-hidden`` so a
 * screen reader doesn't announce them as stray, contextless text mid-list.
 */
import { render } from "lit";
import { describe, expect, it } from "vitest";

import { ConfigEntryType, PinFeature } from "../../../src/api/types/config-entries.js";
import { renderPinField } from "../../../src/components/device/config-entry-pin-renderer.js";
import {
  makeBoardPin,
  makeEntry,
  makeRenderCtx,
  makeTestBoard,
} from "./_renderer-fixtures.js";

// GPIO32 has ADC (Supports), GPIO25 doesn't (Other), GPIO6 is
// board-unavailable (Reserved) — forces all three groups + dividers.
const board = () =>
  makeTestBoard({
    pins: [
      makeBoardPin(32, { features: ["input", "output", "adc"] }),
      makeBoardPin(25, { features: ["input", "output"] }),
      makeBoardPin(6, { features: ["input", "output"], available: false }),
    ],
  });

describe("renderPinField — group header a11y", () => {
  it("marks the group labels and dividers aria-hidden", () => {
    const entry = makeEntry(ConfigEntryType.PIN, {
      key: "pin",
      required: true,
      pin_features: [PinFeature.ADC],
    });
    const container = document.createElement("div");
    render(
      renderPinField(entry, ["pin"], makeRenderCtx({}, { board: board() })),
      container
    );

    const labels = [...container.querySelectorAll(".pin-group-label")];
    const dividers = [...container.querySelectorAll(".pin-group-divider")];
    expect(labels.length).toBeGreaterThan(0);
    expect(dividers.length).toBeGreaterThan(0);
    for (const el of [...labels, ...dividers]) {
      expect(el.getAttribute("aria-hidden")).toBe("true");
    }
    // The options themselves stay in the a11y tree (not hidden).
    for (const opt of container.querySelectorAll("wa-option")) {
      expect(opt.getAttribute("aria-hidden")).toBeNull();
    }
  });
});
