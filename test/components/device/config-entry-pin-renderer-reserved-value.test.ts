/**
 * @vitest-environment happy-dom
 *
 * A reserved pin (``available: false``) that is the field's current value
 * must stay selectable even when the board doesn't lock it to the section
 * being edited — a disabled selected option blanks the ``wa-select`` head,
 * hiding the real config value.
 */
import { describe, expect, it } from "vitest";

import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderPinField } from "../../../src/components/device/config-entry-pin-renderer.js";
import { renderInto } from "../../_dom.js";
import {
  makeBoardPin,
  makeEntry,
  makeRenderCtx,
  makeTestBoard,
} from "./_renderer-fixtures.js";

const board = () =>
  makeTestBoard({
    pins: [
      makeBoardPin(2),
      makeBoardPin(4, { available: false, occupied_by: "Accessory power switch" }),
      makeBoardPin(6, { available: false, occupied_by: "SPI flash" }),
    ],
  });

function renderedOptions(value: unknown): Map<string, Element> {
  const entry = makeEntry(ConfigEntryType.PIN, { key: "pin", required: true });
  const container = renderInto(
    renderPinField(entry, ["pin"], makeRenderCtx({ pin: value }, { board: board() }))
  );
  return new Map(
    [...container.querySelectorAll("wa-option")].map((o) => [
      o.getAttribute("value") ?? "",
      o,
    ])
  );
}

describe("renderPinField — reserved pin holding the current value", () => {
  it("keeps the current value's option selectable, other reserved pins disabled", () => {
    const options = renderedOptions(4);
    const current = options.get("GPIO4")!;
    expect(current.hasAttribute("selected")).toBe(true);
    expect(current.hasAttribute("disabled")).toBe(false);
    expect(options.get("GPIO6")!.hasAttribute("disabled")).toBe(true);
  });

  it("leaves every reserved pin disabled when the value is elsewhere", () => {
    const options = renderedOptions(2);
    expect(options.get("GPIO4")!.hasAttribute("disabled")).toBe(true);
    expect(options.get("GPIO6")!.hasAttribute("disabled")).toBe(true);
  });
});
