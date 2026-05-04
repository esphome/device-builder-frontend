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

  it("rewrites the dash line when it has no inline value", () => {
    // `- platform:` (no value on dash) and form has `platform`:
    // the dash line is rewritten with the form's value so the
    // resulting YAML has `platform` exactly once on the dash,
    // not duplicated as an empty dash plus a body child.
    const before = "ota:\n  - platform:\n";
    const after = updateSectionInYaml(
      before,
      "ota.esphome",
      { platform: "esphome", password: "secret" },
      2,
    );
    expect(after.match(/platform:/g)).toHaveLength(1);
    expect(after).toContain("- platform: esphome");
    expect(after).toContain("password: secret");
  });

  it("rewrites the dash line when the form's value differs from inline", () => {
    // Stale-inline case: dash carries `- platform: esphome` but
    // the form's value is `http_request` (user picked a new
    // backend). The rewrite means the dash reflects the form's
    // current pick instead of the YAML's old value.
    const before = "ota:\n  - platform: esphome\n";
    const after = updateSectionInYaml(
      before,
      "ota.esphome",
      { platform: "http_request" },
      2,
    );
    expect(after.match(/platform:/g)).toHaveLength(1);
    expect(after).toContain("- platform: http_request");
    expect(after).not.toContain("esphome");
  });

  it("rewrites a dash line that carried a trailing comment", () => {
    // Edge case: the dash line carries a `#` comment after the
    // colon (`- platform: # set later`). The empty-value guard
    // can't tell that apart from a real value via plain
    // `inlineMatch[2].trim()`, but the rewrite path doesn't
    // need to: it builds the dash line from scratch, so the
    // comment is dropped along with the stale value and the
    // form's pick lands.
    const before = "ota:\n  - platform: # filled later\n";
    const after = updateSectionInYaml(
      before,
      "ota.esphome",
      { platform: "esphome" },
      2,
    );
    expect(after.match(/platform:/g)).toHaveLength(1);
    expect(after).toContain("- platform: esphome");
    expect(after).not.toContain("filled later");
  });

  it("leaves the dash alone when the form's value is non-scalar", () => {
    // A complex (object) inline value can't sit on the dash, so
    // the rewrite skips and the original behaviour stands —
    // dash kept, value emitted normally in the body. We don't
    // dedupe in that path because there's nothing useful to
    // collapse to.
    const before = "wrap:\n  - platform: x\n";
    const after = updateSectionInYaml(
      before,
      "wrap.x",
      { platform: { complex: "object" } },
      2,
    );
    expect(after).toContain("- platform: x");
    expect(after).toContain("complex: object");
  });

  it("handles inline keys with the full identifier alphabet", () => {
    // The shared `KEY_PATTERN` claims `[a-zA-Z_][a-zA-Z0-9_]*`
    // is the alphabet both parse and write recognise. Pin that
    // behaviorally with edge-case key shapes (leading
    // underscore, trailing digit, internal underscore) so a
    // future schema broadening that misses one site trips this.
    for (const key of ["_internal_id", "pin1", "is_active", "platform_v2"]) {
      const before = `wrap:\n  - ${key}: a\n`;
      const after = updateSectionInYaml(
        before,
        `wrap.${key}`,
        { [key]: "b", extra: "y" },
        2,
      );
      expect(after.match(new RegExp(`${key}:`, "g"))).toHaveLength(1);
      expect(after).toContain(`- ${key}: b`);
      expect(after).toContain("extra: y");
    }
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
