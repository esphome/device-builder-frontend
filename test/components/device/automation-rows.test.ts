/**
 * Unit-pins the pure ``automation-rows`` module lifted out of
 * ``device-section-config``'s ``renderTriggersTable`` /
 * ``renderActionFieldsTable`` (render-tables.ts): filter + label of inline
 * trigger and action-field rows. The catalog/i18n labels are injected so
 * these run with no DOM, controller, or live API — the table renderers are
 * thin wrappers that feed in ``parseYamlAutomations(yaml)`` and the label
 * callback.
 */
import { describe, expect, it } from "vitest";

import {
  selectActionFieldRows,
  selectApiActionRows,
  selectTriggerRows,
} from "../../../src/components/device/device-section-config/automation-rows.js";
import type { YamlSection } from "../../../src/util/yaml-sections.js";

/** Minimal YamlSection factory — only the fields the selectors read. */
function section(overrides: Partial<YamlSection>): YamlSection {
  return { key: "k", fromLine: 1, toLine: 1, ...overrides };
}

/** Label callback that echoes a field so assertions stay legible. */
const labelEvent = (s: YamlSection) => `<${s.eventKey ?? "?"}>`;
const labelField = (field: string) => `<${field}>`;

describe("selectTriggerRows", () => {
  it("drops sections without an eventKey", () => {
    const sections = [
      section({ key: "a", eventKey: "on_press", id: "c1" }),
      section({ key: "b", id: "c1" }), // no eventKey → not a trigger
    ];
    const rows = selectTriggerRows(
      sections,
      { kind: "component_on", componentId: "c1" },
      labelEvent
    );
    expect(rows.map((r) => r.key)).toEqual(["a"]);
  });

  it("device_on lists only esphome-parented triggers", () => {
    const sections = [
      section({ key: "a", eventKey: "on_boot", parentKey: "esphome" }),
      section({ key: "b", eventKey: "on_press", parentKey: "binary_sensor", id: "c1" }),
    ];
    const rows = selectTriggerRows(sections, { kind: "device_on" }, labelEvent);
    expect(rows.map((r) => r.key)).toEqual(["a"]);
    expect(rows[0].label).toBe("<on_boot>");
  });

  it("component_on includes the instance's own and its sub-entities' triggers", () => {
    const sections = [
      section({ key: "own", eventKey: "on_turn_on", id: "c1" }),
      section({
        key: "sub",
        eventKey: "on_value",
        parentComponentId: "c1",
        name: "Temperature",
      }),
      section({ key: "other", eventKey: "on_press", id: "c2" }),
    ];
    const rows = selectTriggerRows(
      sections,
      { kind: "component_on", componentId: "c1" },
      labelEvent
    );
    expect(rows.map((r) => r.key)).toEqual(["own", "sub"]);
  });

  it("prefixes a sub-entity row with its name, falling back to id", () => {
    const sections = [
      section({
        key: "named",
        eventKey: "on_value",
        parentComponentId: "c1",
        name: "Temperature",
      }),
      section({
        key: "unnamed",
        eventKey: "on_value",
        parentComponentId: "c1",
        id: "hum_1",
      }),
    ];
    const rows = selectTriggerRows(
      sections,
      { kind: "component_on", componentId: "c1" },
      labelEvent
    );
    expect(rows[0].label).toBe("Temperature → <on_value>");
    expect(rows[1].label).toBe("hum_1 → <on_value>");
  });

  it("does not prefix the component's own (non-sub-entity) triggers", () => {
    const sections = [section({ key: "own", eventKey: "on_turn_on", id: "c1" })];
    const rows = selectTriggerRows(
      sections,
      { kind: "component_on", componentId: "c1" },
      labelEvent
    );
    expect(rows[0].label).toBe("<on_turn_on>");
  });
});

describe("selectActionFieldRows", () => {
  it("keeps only action-field rows for the matching instance", () => {
    const sections = [
      section({ key: "open", actionField: "open_action", id: "c1" }),
      section({ key: "trigger", eventKey: "on_press", id: "c1" }), // no actionField
      section({ key: "other", actionField: "close_action", id: "c2" }), // wrong instance
    ];
    const rows = selectActionFieldRows(sections, "c1", labelField);
    expect(rows).toEqual([{ key: "open", label: "<open_action>" }]);
  });

  it("returns an empty list when the instance declares no action fields", () => {
    const sections = [section({ key: "trigger", eventKey: "on_press", id: "c1" })];
    expect(selectActionFieldRows(sections, "c1", labelField)).toEqual([]);
  });
});

describe("selectApiActionRows", () => {
  it("keeps only api_action rows, labelled by id", () => {
    const sections = [
      section({ key: "automation:api_action:greet", id: "greet" }),
      section({ key: "automation:trigger:esphome:on_boot", eventKey: "on_boot" }),
      section({ key: "automation:api_action:anon" }), // no id -> empty label
    ];
    expect(selectApiActionRows(sections)).toEqual([
      { key: "automation:api_action:greet", label: "greet" },
      { key: "automation:api_action:anon", label: "" },
    ]);
  });
});
