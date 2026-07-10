import { describe, expect, it } from "vitest";
import {
  addFormNeedsUserInput,
  addFormRenderablePaths,
} from "../../../src/components/device/add-component-form-filter.js";
import { makeConfigEntry, makeNestedEntry } from "../../util/_make-config-entry.js";

const NONE = new Set<string>();

describe("addFormNeedsUserInput", () => {
  it("is false when every visible field is board-locked (a dead-end form)", () => {
    // A featured component whose every field is pinned by the board: the form
    // would render only read-only "Set by the board" rows, so it should be
    // skipped and the component added straight away.
    const entries = [
      makeConfigEntry({ key: "pin", required: true, locked: true }),
      makeConfigEntry({ key: "type", required: true, locked: true }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], null, NONE)).toBe(false);
  });

  it("is true when any visible field is unlocked", () => {
    const entries = [
      makeConfigEntry({ key: "pin", required: true, locked: true }),
      makeConfigEntry({ key: "name", required: true, locked: false }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], null, NONE)).toBe(true);
  });

  it("keeps the form open for an unlocked reference even when pre-seeded", () => {
    // A featured bundle member whose reference is pre-filled from its preset
    // still opens (the user reviews/confirms); the gate keys off unlocked +
    // visible, not whether a value is present.
    const entries = [
      makeConfigEntry({ key: "blue", required: true, references_component: "output" }),
    ];
    expect(addFormNeedsUserInput(entries, { blue: "output_blue" }, [], null, NONE)).toBe(
      true
    );
  });

  it("skips a fully board-locked exclusive group (every choice is read-only)", () => {
    const entries = [
      makeConfigEntry({ key: "i2c", exclusive_group: "bus", locked: true }),
      makeConfigEntry({ key: "spi", exclusive_group: "bus", locked: true }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], null, NONE)).toBe(false);
  });

  it("shows the form when an exclusive group still has an unlocked choice", () => {
    const entries = [
      makeConfigEntry({ key: "i2c", exclusive_group: "bus", locked: true }),
      makeConfigEntry({ key: "spi", exclusive_group: "bus", locked: false }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], null, NONE)).toBe(true);
  });

  it("skips a fully board-locked constraint cluster (every member read-only)", () => {
    const entries = [
      makeConfigEntry({ key: "a", group: "g", required: true, locked: true }),
      makeConfigEntry({ key: "b", group: "g", required: true, locked: true }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], null, NONE)).toBe(false);
  });

  it("shows the form when a constraint cluster has an unlocked member", () => {
    const entries = [
      makeConfigEntry({ key: "a", group: "g", required: true, locked: true }),
      makeConfigEntry({ key: "b", group: "g", required: true, locked: false }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], null, NONE)).toBe(true);
  });

  // A hidden unlocked member (here platform-incompatible) isn't rendered, so it
  // mustn't keep the form open when every visible field is locked.
  const ESP32 = { esphome: { platform: "esp32" } } as never;

  it("ignores a hidden unlocked exclusive-group member", () => {
    const entries = [
      makeConfigEntry({ key: "i2c", exclusive_group: "bus", locked: true }),
      makeConfigEntry({
        key: "spi",
        exclusive_group: "bus",
        locked: false,
        supported_platforms: ["esp8266"],
      }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], ESP32, NONE)).toBe(false);
  });

  it("ignores a hidden unlocked constraint-cluster member", () => {
    const entries = [
      makeConfigEntry({ key: "a", group: "g", required: true, locked: true }),
      makeConfigEntry({
        key: "b",
        group: "g",
        required: true,
        locked: false,
        supported_platforms: ["esp8266"],
      }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], ESP32, NONE)).toBe(false);
  });
});

describe("addFormRenderablePaths resolves a root-scoped depends_on", () => {
  // A nested field gated on a top-level sibling (the esp32 sram1_as_iram /
  // variant case): the add-form paint mirror must resolve `variant` against
  // the component root, not the empty nested scope, or it drifts from
  // validateEntries and bails the submit silently.
  const entries = [
    makeNestedEntry("advanced", [
      makeConfigEntry({
        key: "sram1_as_iram",
        required: true,
        depends_on: "variant",
        depends_on_value_any: ["esp32"],
      }),
    ]),
  ];

  it("paints the nested field when the root variant matches", () => {
    const paths = addFormRenderablePaths(
      entries,
      { variant: "esp32", advanced: {} },
      null,
      NONE
    );
    expect(paths.has("advanced.sram1_as_iram")).toBe(true);
  });

  it("drops it when the root variant doesn't match", () => {
    const paths = addFormRenderablePaths(
      entries,
      { variant: "esp32c2", advanced: {} },
      null,
      NONE
    );
    expect(paths.has("advanced.sram1_as_iram")).toBe(false);
  });
});
