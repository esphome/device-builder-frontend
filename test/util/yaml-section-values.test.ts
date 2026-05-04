import { describe, expect, it } from "vitest";
import {
  parseYamlSectionValues,
  updateSectionInYaml,
} from "../../src/util/yaml-section-values.js";

describe("updateSectionInYaml — list item with inline key", () => {
  it("does not duplicate the inline key when adding a sibling field", () => {
    // The OTA section as the wizard emits it: a list with one
    // `- platform: esphome` item. The user opens the visual editor
    // for that item and adds a password.
    //
    // ``parseYamlSectionValues`` puts ``platform: "esphome"`` into
    // the form values (it reads the inline key on the dash line),
    // so ``values`` on save is ``{platform: "esphome", password:
    // "secret"}``. Without the dedupe the serializer rewrote
    // ``platform`` again as a regular child key, producing a
    // visibly duplicated setting — the symptom users reported as
    // "Save adds another esphome item".
    const before = "ota:\n  - platform: esphome\n";
    const after = updateSectionInYaml(
      before,
      "ota.esphome",
      { platform: "esphome", password: "secret" },
      2, // 1-indexed line of the `- platform: esphome` row
    );
    // The `platform` key must appear exactly once.
    expect(after.match(/platform:/g)).toHaveLength(1);
    expect(after).toContain("password: secret");
    expect(after).toContain("- platform: esphome");
  });

  it("round-trips through parseYamlSectionValues without duplication", () => {
    // End-to-end pin: parse → mutate → write must not introduce
    // ghost copies of inline keys, otherwise repeatedly re-saving
    // the same section snowballs the YAML.
    const start = "ota:\n  - platform: esphome\n    password: a\n";
    const values = parseYamlSectionValues(start, "ota.esphome", 2);
    expect(values).toEqual({ platform: "esphome", password: "a" });
    values.password = "b";
    const after = updateSectionInYaml(start, "ota.esphome", values, 2);
    expect(after.match(/platform:/g)).toHaveLength(1);
    expect(after).toContain("password: b");
    expect(after).not.toContain("password: a");
  });

  it("does not duplicate the inline key when only that key was changed", () => {
    // User changed `platform: esphome` to `platform: http_request`
    // (e.g. switched OTA backend). The inline-key dedupe must not
    // strip the *new* value — but the dash line itself still
    // carries the old one. The current implementation keeps the
    // dash line verbatim and drops the now-redundant `platform`
    // key from the body; net effect is the YAML stays at
    // `- platform: esphome` even though the user picked
    // `http_request`. Pin the current (limited) behavior so a
    // future fix can change it deliberately rather than by
    // accident.
    const before = ["ota:", "  - platform: esphome", ""].join("\n");
    const after = updateSectionInYaml(
      before,
      "ota.esphome",
      { platform: "http_request" },
      2,
    );
    // Today: the dash line is preserved verbatim — switching
    // platforms via this path is not yet supported, but the
    // result is at least syntactically valid (no duplicate).
    expect(after.match(/platform:/g)).toHaveLength(1);
  });

  it("does not strip the inline key when the dash line has no value", () => {
    // `- platform:` (no inline value) means the form value lives
    // only in `values` — `parseYamlSectionValues` skips empty
    // inline values (`raw !== ""`). If the dedupe fired
    // unconditionally we'd strip `platform` from the body too
    // and the user's pick would be lost on save.
    const before = "ota:\n  - platform:\n";
    const after = updateSectionInYaml(
      before,
      "ota.esphome",
      { platform: "esphome", password: "secret" },
      2,
    );
    expect(after).toContain("platform: esphome");
    expect(after).toContain("password: secret");
  });

  it("still serializes regular non-list-item sections normally", () => {
    // Defensive: the inline-dedupe only fires on the list-item
    // branch; a top-level dict section must still emit every
    // value the form holds.
    const before = "wifi:\n  ssid: x\n";
    const after = updateSectionInYaml(before, "wifi", {
      ssid: "x",
      password: "secret",
    });
    expect(after).toContain("ssid: x");
    expect(after).toContain("password: secret");
  });
});
