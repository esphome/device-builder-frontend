import { describe, expect, it } from "vitest";
import {
  addFormHasUnsatisfiedConstraint,
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

  it("skips an exclusive group pinned by one locked member", () => {
    // The dropdown disables when any rendered option is locked (the board
    // made the choice), so the unlocked sibling is unreachable.
    const entries = [
      makeConfigEntry({ key: "i2c", exclusive_group: "bus", locked: true }),
      makeConfigEntry({ key: "spi", exclusive_group: "bus", locked: false }),
    ];
    expect(addFormNeedsUserInput(entries, {}, [], null, NONE)).toBe(false);
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
      [],
      null,
      NONE
    );
    expect(paths.has("advanced.sram1_as_iram")).toBe(true);
  });

  it("drops it when the root variant doesn't match", () => {
    const paths = addFormRenderablePaths(
      entries,
      { variant: "esp32c2", advanced: {} },
      [],
      null,
      NONE
    );
    expect(paths.has("advanced.sram1_as_iram")).toBe(false);
  });
});

describe("a required group whose members are all optional", () => {
  // spi: clk_pin is required, miso_pin / mosi_pin are optional but the schema
  // demands at least one of them; both are gated on the default `type`.
  const gated = { depends_on: "type", depends_on_value_any: ["single"] };
  const entries = [
    makeConfigEntry({ key: "type", default_value: "single" }),
    makeConfigEntry({ key: "clk_pin", required: true }),
    makeConfigEntry({ key: "miso_pin", ...gated }),
    makeConfigEntry({ key: "mosi_pin", ...gated }),
  ];
  const groups = [{ kind: "at_least_one" as const, keys: ["miso_pin", "mosi_pin"] }];

  it("paints the members so the group can be satisfied", () => {
    const paths = addFormRenderablePaths(entries, {}, groups, null, NONE);
    expect([...paths].sort()).toEqual(["clk_pin", "miso_pin", "mosi_pin"]);
  });

  it("keeps them painted once one is set", () => {
    const paths = addFormRenderablePaths(
      entries,
      { miso_pin: "GPIO7" },
      groups,
      null,
      NONE
    );
    expect(paths.has("miso_pin")).toBe(true);
    expect(paths.has("mosi_pin")).toBe(true);
  });

  it("drops them when their gate hides them", () => {
    const paths = addFormRenderablePaths(entries, { type: "quad" }, groups, null, NONE);
    expect([...paths]).toEqual(["clk_pin"]);
  });

  it("reports the group unsatisfied until a member is set", () => {
    const unmet = (values: Record<string, unknown>) =>
      addFormHasUnsatisfiedConstraint(entries, values, groups, null, NONE);
    expect(unmet({ clk_pin: "GPIO6" })).toBe(true);
    expect(unmet({ clk_pin: "GPIO6", mosi_pin: "GPIO7" })).toBe(false);
    expect(unmet({ clk_pin: "GPIO6", type: "quad" })).toBe(false);
  });

  it("leaves an at_most_one group's optional members hidden", () => {
    const atMost = [{ kind: "at_most_one" as const, keys: ["miso_pin", "mosi_pin"] }];
    const paths = addFormRenderablePaths(entries, {}, atMost, null, NONE);
    expect([...paths]).toEqual(["clk_pin"]);
  });
});

describe("a required group the add form cannot paint", () => {
  // emc2101: exactly one of two optional NESTED blocks whose children are all
  // optional, so required-only mode paints neither.
  const entries = [
    makeNestedEntry("pwm", [makeConfigEntry({ key: "resolution" })]),
    makeNestedEntry("dac", [makeConfigEntry({ key: "conversion_rate" })]),
  ];
  const groups = [{ kind: "exactly_one" as const, keys: ["pwm", "dac"] }];

  it("still opens the form so the banner is seen", () => {
    expect(addFormNeedsUserInput(entries, {}, groups, null, NONE)).toBe(true);
  });

  it("does not hold Add on a group with no painted member", () => {
    expect(addFormRenderablePaths(entries, {}, groups, null, NONE).size).toBe(0);
    expect(addFormHasUnsatisfiedConstraint(entries, {}, groups, null, NONE)).toBe(false);
  });

  it("does not hold Add on a group whose members are all advanced", () => {
    const advanced = [
      makeConfigEntry({ key: "a", advanced: true }),
      makeConfigEntry({ key: "b", advanced: true }),
    ];
    const atLeast = [{ kind: "at_least_one" as const, keys: ["a", "b"] }];
    expect(addFormHasUnsatisfiedConstraint(advanced, {}, atLeast, null, NONE)).toBe(
      false
    );
  });
});

describe("an unmet constraint cluster box", () => {
  // wifi eap: at least one of identity / certificate, where certificate and
  // key share an inclusive group, so the three render as one cluster box whose
  // header carries the warning instead of a banner.
  const members = (over: Record<string, unknown> = {}) => [
    makeConfigEntry({ key: "identity", ...over }),
    makeConfigEntry({ key: "certificate", group: "cert_and_key", ...over }),
    makeConfigEntry({ key: "key", group: "cert_and_key", ...over }),
  ];
  const groups = [{ kind: "at_least_one" as const, keys: ["identity", "certificate"] }];
  const unmet = (entries: ReturnType<typeof members>, values: Record<string, unknown>) =>
    addFormHasUnsatisfiedConstraint(entries, values, groups, null, NONE);

  it("holds Add until the cardinality rule is met", () => {
    expect(unmet(members(), {})).toBe(true);
    expect(unmet(members(), { identity: "me" })).toBe(false);
  });

  it("holds Add while the all-or-none pair is half set", () => {
    expect(unmet(members(), { certificate: "cert.pem" })).toBe(true);
    expect(unmet(members(), { certificate: "cert.pem", key: "key.pem" })).toBe(false);
  });

  it("does not hold Add when every member is board-locked", () => {
    expect(unmet(members({ locked: true }), {})).toBe(false);
  });

  it("holds Add on an all-advanced box, which the flat paint still draws", () => {
    expect(unmet(members({ advanced: true }), {})).toBe(true);
  });

  it("leaves an exactly_one radio cluster to its forced choice", () => {
    const radio = [{ kind: "exactly_one" as const, keys: ["identity", "certificate"] }];
    expect(addFormHasUnsatisfiedConstraint(members(), {}, radio, null, NONE)).toBe(false);
  });
});

describe("an unmet banner whose painted members are all board-locked", () => {
  it("does not hold Add, since nothing on screen can be changed", () => {
    const entries = [
      makeConfigEntry({ key: "a", locked: true }),
      makeConfigEntry({ key: "b", locked: true }),
    ];
    const groups = [{ kind: "exactly_one" as const, keys: ["a", "b"] }];
    const values = { a: "x", b: "y" };
    expect(addFormRenderablePaths(entries, values, groups, null, NONE).size).toBe(2);
    expect(addFormHasUnsatisfiedConstraint(entries, values, groups, null, NONE)).toBe(
      false
    );
  });
});
