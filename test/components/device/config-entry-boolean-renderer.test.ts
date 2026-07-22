/**
 * Rendered-output pins for ``renderBooleanField``: the default-value
 * fallback that drives ``checked`` (an omitted
 * ``esp32_ble_tracker.software_coexistence`` with catalog
 * ``default_value: true`` must render ON), the lenient spelling
 * parse (#923), and the switch's accessible name.
 */
import { describe, expect, it } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { renderBooleanField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { findElementBindings, makeRenderCtx } from "./_renderer-fixtures.js";

function entry(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return makeConfigEntry({
    key: "enabled",
    type: ConfigEntryType.BOOLEAN,
    label: "Enabled",
    ...overrides,
  });
}

function switchBindings(
  values: Record<string, unknown>,
  overrides: Partial<ConfigEntry> = {}
): Record<string, unknown> {
  const ctx = makeRenderCtx(values, { board: null });
  const tpl = renderBooleanField(entry(overrides), ["enabled"], ctx);
  return findElementBindings(tpl, "wa-switch")[0];
}

describe("renderBooleanField — checked state", () => {
  it("falls back to entry.default_value when the YAML omits the field", () => {
    expect(switchBindings({}, { default_value: true })["?checked"]).toBe(true);
    expect(switchBindings({ enabled: null }, { default_value: true })["?checked"]).toBe(
      true
    );
    expect(switchBindings({}, { default_value: false })["?checked"]).toBe(false);
  });

  it("lets a present value win over the default", () => {
    expect(switchBindings({ enabled: false }, { default_value: true })["?checked"]).toBe(
      false
    );
  });

  it("collapses YAML truthy spellings through parseYamlBoolean", () => {
    expect(switchBindings({ enabled: "True" })["?checked"]).toBe(true);
    expect(switchBindings({ enabled: "off" })["?checked"]).toBe(false);
  });
});

describe("renderBooleanField — accessibility", () => {
  it("gives the wa-switch an accessible name from the field label", () => {
    // The visible label lives in a sibling ``.field-info`` div with no
    // ``for``/wrapping association, so without an explicit aria-label a
    // screen reader announces a bare "switch" with no context.
    expect(switchBindings({ enabled: true })["aria-label"]).toBe("Enabled");
  });
});
