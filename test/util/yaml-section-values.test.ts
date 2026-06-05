import { describe, expect, it } from "vitest";
import { LIST_SECTIONS } from "../../src/util/section-entry-overrides.js";
import {
  findSectionStart,
  LIST_ITEM_START_RE,
  parseYamlSectionValues,
  removeSectionFromYaml,
  updateSectionInYaml,
} from "../../src/util/yaml-section-values.js";
import { serializeYamlValues, YamlRawValue } from "../../src/util/yaml-serialize.js";

/** 1-indexed line of the *n*th (1-based) list-item dash following
 *  `parent:` in `yaml`. Section-editor callers pass that line as
 *  `fromLine`; resolving it here keeps tests robust to layout
 *  edits. Reuses the parser's `LIST_ITEM_START_RE` directly so
 *  a future tightening there can't silently let the test helper
 *  drift to a different definition of "list item". */
function nthListItemLine(yaml: string, parent: string, n: number): number {
  const lines = yaml.split("\n");
  const start = findSectionStart(lines, parent);
  if (start === -1) {
    // Without this guard the loop would walk from index 0 and
    // could count list items belonging to a different section,
    // producing a misleading "found" line for a fixture that
    // doesn't actually contain `parent:`. Fail loud instead.
    throw new Error(`section ${parent}: not found in fixture`);
  }
  let count = 0;
  for (let i = start + 1; i < lines.length; i++) {
    if (LIST_ITEM_START_RE.test(lines[i])) {
      count++;
      if (count === n) return i + 1;
    }
  }
  throw new Error(`fewer than ${n} list-item dashes under ${parent}: in fixture`);
}

const firstListItemLine = (yaml: string, parent: string): number =>
  nthListItemLine(yaml, parent, 1);

describe("test helper: nthListItemLine", () => {
  it("throws when the parent section isn't in the fixture", () => {
    // Without an explicit guard, `findSectionStart` returning
    // -1 would let the loop walk from index 0 and count
    // list-item dashes belonging to a different section,
    // producing a misleading "found" line. Failing loud means
    // a typo in a test fixture surfaces immediately rather
    // than as a confusing wrong-line assertion downstream.
    const yaml = "esphome:\n  name: x\n";
    expect(() => nthListItemLine(yaml, "ota", 1)).toThrow(/section ota: not found/);
  });

  it("throws when there are fewer dashes than requested", () => {
    const yaml = "ota:\n  - platform: esphome\n";
    expect(() => nthListItemLine(yaml, "ota", 2)).toThrow(
      /fewer than 2 list-item dashes/
    );
  });
});

describe("parseYamlSectionValues — permissive key alphabet", () => {
  it("captures dotted / hyphenated keys (URL-style package names)", () => {
    // ``packages:`` accepts URL-derived names like
    // ``ApolloAutomation.R-PRO-1-ETH:`` (issue surfaced in the
    // form editor where the row vanished because the strict
    // ``[a-zA-Z_][a-zA-Z0-9_]*`` regex rejected the dot + hyphen
    // and the parser silently dropped the line). The MAP-fallback
    // editor uses ``parseYamlSectionValues`` to populate row
    // values; if the parser drops the line, the form shows
    // "No entries yet" while the YAML clearly has one.
    const yaml =
      "packages:\n" +
      "  ApolloAutomation.R-PRO-1-ETH: github://ApolloAutomation/R_PRO-1/Integrations/ESPHome/R_PRO-1_ETH.yaml\n";
    const values = parseYamlSectionValues(yaml, "packages");
    expect(values["ApolloAutomation.R-PRO-1-ETH"]).toBe(
      "github://ApolloAutomation/R_PRO-1/Integrations/ESPHome/R_PRO-1_ETH.yaml"
    );
  });

  it("captures path- and namespaced-style keys", () => {
    const yaml =
      "packages:\n" +
      "  vendor/lib@v1.2.3: ./local/path.yaml\n" +
      "  com.example.thing: github://example/thing\n";
    const values = parseYamlSectionValues(yaml, "packages");
    expect(values["vendor/lib@v1.2.3"]).toBe("./local/path.yaml");
    expect(values["com.example.thing"]).toBe("github://example/thing");
  });

  it("still rejects keys that start with a list-item dash or hash", () => {
    // The leading-character constraint stays strict so a stray
    // ``- `` (list item) or ``# `` (comment) at the section indent
    // doesn't masquerade as a key.
    const yaml = "packages:\n  - not_a_key: value\n  # commented: out\n";
    const values = parseYamlSectionValues(yaml, "packages");
    expect(values).toEqual({});
  });
});

describe("parseYamlSectionValues — prototype pollution defense", () => {
  // YAML keys like `__proto__` / `constructor` / `prototype`
  // would otherwise hit the corresponding setter on
  // `Object.prototype` and either mutate the prototype chain or
  // create a footgun for downstream property access. The values
  // map is built on a null-prototype object so these names land
  // as plain own properties without escalating.

  it("does not pollute Object.prototype via a __proto__ key", () => {
    // Use a NESTED mapping — that's the actual pollution vector.
    // A scalar `__proto__: hacked` is a no-op on a plain object
    // (the `__proto__` setter only mutates when assigned an
    // object), so a passing test there wouldn't actually exercise
    // the defense. With a nested mapping, the prototype-chain
    // setter would assign `{polluted: true}` as the prototype on
    // a regular object — the null-prototype root keeps it as a
    // plain own property instead.
    const yaml = "wrap:\n  __proto__:\n    polluted: true\n";
    const values = parseYamlSectionValues(yaml, "wrap");
    // Captured as data on the values map…
    expect(values.__proto__).toEqual({ polluted: true });
    // …without polluting bystanders or `Object.prototype`.
    const bystander: Record<string, unknown> = {};
    expect(bystander.polluted).toBeUndefined();
    expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("captures constructor / prototype keys as plain data", () => {
    const yaml = "wrap:\n  constructor: a\n  prototype: b\n";
    const values = parseYamlSectionValues(yaml, "wrap");
    expect(values.constructor).toBe("a");
    expect(values.prototype).toBe("b");
  });

  it("uses a null-prototype root so dunder access stays inert", () => {
    const yaml = "wrap:\n  ssid: x\n";
    const values = parseYamlSectionValues(yaml, "wrap");
    expect(Object.getPrototypeOf(values)).toBeNull();
  });

  it("propagates null-prototype to nested blocks and survives round-trip", () => {
    // `parseNestedBlock` (recursive) also uses
    // `Object.create(null)`. A deeply-nested config must round-trip
    // through downstream consumers (`Object.keys`, `for ... in`,
    // spread, JSON.stringify) without the missing prototype methods
    // causing surprises. Pin one config that exercises the full
    // chain.
    const yaml = [
      "outer:",
      "  level1:",
      "    level2:",
      "      key: value",
      "      arr:",
      "        - a",
      "        - b",
    ].join("\n");
    const values = parseYamlSectionValues(yaml, "outer");
    // Spread + JSON.stringify both rely on enumerable own properties
    // (not prototype methods), so they handle null-prototype maps
    // identically to plain objects.
    const nested = (values.level1 as Record<string, unknown>).level2 as Record<
      string,
      unknown
    >;
    expect(nested.key).toBe("value");
    expect(nested.arr).toEqual(["a", "b"]);
    // Every block in the chain is null-prototyped — pin both
    // levels so a future refactor that only null-prototypes the
    // leaves trips here.
    expect(Object.getPrototypeOf(values.level1)).toBeNull();
    expect(Object.getPrototypeOf(nested)).toBeNull();
    expect(JSON.stringify(values)).toContain('"key":"value"');
  });
});

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
      2 // 1-indexed line of the `- platform: esphome` row
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
      2
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
      2
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
    const after = updateSectionInYaml(before, "ota.esphome", { platform: "esphome" }, 2);
    expect(after.match(/platform:/g)).toHaveLength(1);
    expect(after).toContain("- platform: esphome");
    expect(after).not.toContain("filled later");
  });

  it("collapses dash to bare `-` when the form's value is non-scalar", () => {
    // A complex (object) inline value can't sit on the dash. The
    // dash is demoted to a bare `-` and the full body is emitted
    // at the child indent; the inline key still appears exactly
    // once (under its own line), preserving the no-duplicate
    // contract regardless of value type.
    const before = "wrap:\n  - platform: x\n";
    const fromLine = firstListItemLine(before, "wrap");
    const after = updateSectionInYaml(
      before,
      "wrap.x",
      { platform: { complex: "object" } },
      fromLine
    );
    expect(after.match(/platform:/g)).toHaveLength(1);
    expect(after).not.toContain("- platform: x");
    expect(after).toContain("complex: object");
    // Pin the dash actually stayed — a regression that turned
    // the list item into a plain dict (no leading `-`) would
    // otherwise pass the not-contains assertions silently.
    expect(after).toMatch(/^\s+-\s*$/m);

    // Round-trip closes the loop on whether the parser walks
    // children correctly under a bare-dash list-item head when
    // the body is a non-scalar nested mapping.
    const afterFromLine = firstListItemLine(after, "wrap");
    const reparsed = parseYamlSectionValues(after, "wrap.x", afterFromLine);
    expect(reparsed).toEqual({ platform: { complex: "object" } });
  });

  it("collapses dash to bare `-` when the form's value is null", () => {
    // Same shape as the non-scalar case — null isn't inlinable
    // (nothing useful to write after the colon), so we demote
    // the dash and let the body emit the (empty) entry. The
    // serializer skips null/empty values; net result is just
    // the bare `-` with whatever else the form holds.
    const before = "ota:\n  - platform: esphome\n";
    const fromLine = firstListItemLine(before, "ota");
    const after = updateSectionInYaml(
      before,
      "ota.esphome",
      { platform: null, password: "secret" },
      fromLine
    );
    expect(after).not.toContain("- platform: esphome");
    expect(after).toContain("password: secret");
    expect(after).toMatch(/^\s+-\s*$/m);

    // Round-trip: the bare-`-` shape parses back to the same
    // values the form holds (minus the null, which the
    // serializer drops).
    const afterFromLine = firstListItemLine(after, "ota");
    const reparsed = parseYamlSectionValues(after, "ota.esphome", afterFromLine);
    expect(reparsed).toEqual({ password: "secret" });
  });

  it("handles inline keys with the full identifier alphabet", () => {
    // The shared `KEY_PATTERN` claims `[a-zA-Z_][a-zA-Z0-9_]*`
    // is the alphabet both parse and write recognise. Pin that
    // behaviorally with edge-case key shapes (leading
    // underscore, trailing digit, internal underscore) so a
    // future schema broadening that misses one site trips this.
    //
    // Escape regex metacharacters in the key when constructing
    // the count assertion — today's alphabet has none, but if
    // it ever broadens to include `.` / `+` / `*` etc. the
    // assertion would silently over-match without this guard.
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const key of ["_internal_id", "pin1", "is_active", "platform_v2"]) {
      const before = `wrap:\n  - ${key}: a\n`;
      const after = updateSectionInYaml(
        before,
        `wrap.${key}`,
        { [key]: "b", extra: "y" },
        2
      );
      expect(after.match(new RegExp(`${escape(key)}:`, "g"))).toHaveLength(1);
      expect(after).toContain(`- ${key}: b`);
      expect(after).toContain("extra: y");
    }
  });

  it("does not rewrite the dash from inherited Object.prototype keys", () => {
    // Form values often arrive as regular `{}` objects from
    // spread / `setIn` paths, so `"constructor" in values` is
    // `true` because every plain object inherits it. The
    // dedupe must use an own-property check, not `in`, or the
    // dash line gets rewritten from an inherited value and the
    // YAML's actual inline content is lost.
    const before = "wrap:\n  - constructor: foo\n";
    const fromLine = firstListItemLine(before, "wrap");
    // Plain object with no own `constructor` property — but
    // `"constructor" in values` is still true via the prototype.
    const formValues: Record<string, unknown> = { extra: "y" };
    const after = updateSectionInYaml(before, "wrap.constructor", formValues, fromLine);
    expect(after).toContain("- constructor: foo");
    expect(after).toContain("extra: y");
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

describe("updateSectionInYaml — trailing comments / blank lines", () => {
  it("keeps a trailing comment block when toggling a nested value", () => {
    // Reported bug: flipping `active` wiped the commented-out block
    // between this section and the next.
    const before = [
      "esp32_ble_tracker:",
      "  scan_parameters:",
      "    active: false",
      "# Bluetooth LED blinks when receiving Bluetooth advertising",
      "#  on_ble_advertise:",
      "#    then:",
      "#      - output.turn_on: bluetooth_led",
      "",
      "",
      "bluetooth_proxy:",
      "",
    ].join("\n");
    const after = updateSectionInYaml(
      before,
      "esp32_ble_tracker",
      { scan_parameters: { active: true } },
      1
    );
    expect(after).toContain("active: true");
    expect(after).toContain(
      "# Bluetooth LED blinks when receiving Bluetooth advertising"
    );
    expect(after).toContain("#      - output.turn_on: bluetooth_led");
    expect(after).toContain("bluetooth_proxy:");
  });

  it("still saves a section followed immediately by the next key", () => {
    // No trailing run: the trim must not eat the section's last line.
    const before = "wifi:\n  ssid: x\nlogger:\n";
    const after = updateSectionInYaml(before, "wifi", { ssid: "y" }, 1);
    expect(after).toContain("ssid: y");
    expect(after).not.toContain("ssid: x");
    expect(after).toContain("logger:");
  });

  it("keeps comments when the section body is comment-only", () => {
    // Exercises the `> start + 1` guard: header replaced, comments kept.
    const before = "wifi:\n  # configure later\n  # see docs\nlogger:\n";
    const after = updateSectionInYaml(before, "wifi", { ssid: "y" }, 1);
    expect(after).toContain("ssid: y");
    expect(after).toContain("# configure later");
    expect(after).toContain("# see docs");
  });

  it("is stable across repeated saves", () => {
    // Same update twice yields an identical string, no drift.
    const before = "wifi:\n  ssid: x\n# note\n\nlogger:\n";
    const once = updateSectionInYaml(before, "wifi", { ssid: "y" }, 1);
    const twice = updateSectionInYaml(once, "wifi", { ssid: "y" }, 1);
    expect(twice).toBe(once);
    expect(once).toContain("# note");
  });

  it("does not treat a block-scalar `#` body line as a trailing comment", () => {
    // A `#`-prefixed line inside a `|` block scalar is literal text,
    // not a comment. It's indented deeper than the section's children,
    // so the trim must break there (not preserve it outside the
    // splice) — otherwise the serializer re-emits it AND the kept tail
    // retains it, duplicating the line.
    const before = [
      "mqtt:",
      "  topic: foo",
      "  log_format: |",
      "    # not a comment, literal text in the block",
      "sensor:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "mqtt", 1);
    const after = updateSectionInYaml(before, "mqtt", values, 1);
    expect(after).toBe(before);
    expect(after.match(/# not a comment/g)).toHaveLength(1);
  });
});

describe("removeSectionFromYaml — multi-item list", () => {
  // Pins the splice contract that surfaced the
  // wrong-section-deleted bug. The bug itself was at the
  // integration boundary (section editor was passing the
  // server's stale YAML instead of the live one), so the
  // splice was being asked to operate on a yaml the
  // navigator's `fromLine` didn't match.
  //
  // The unit-level guarantee these tests pin: given the live
  // YAML + a `fromLine` pointing at the right list item, the
  // splice removes that item and only that item.

  const multiItemOta = [
    "ota:",
    "  - platform: esphome",
    "    password: foo",
    "  - platform: web_server",
    "",
  ].join("\n");

  it("removes the FIRST OTA list item when fromLine points at it", () => {
    const fromLine = firstListItemLine(multiItemOta, "ota");
    const after = removeSectionFromYaml(multiItemOta, "ota.esphome", fromLine);
    expect(after).not.toContain("platform: esphome");
    expect(after).not.toContain("password: foo");
    // The other list item survives untouched.
    expect(after).toContain("- platform: web_server");
  });

  it("removes the SECOND OTA list item when fromLine points at it", () => {
    // Direct repro of the bug-report shape: deleting
    // `ota.web_server` (the second item) must hit it and
    // leave `ota.esphome` alone. The pre-fix code path
    // routed through a stale yaml fetch and clipped the
    // wrong item.
    const after = removeSectionFromYaml(
      multiItemOta,
      "ota.web_server",
      nthListItemLine(multiItemOta, "ota", 2)
    );
    expect(after).not.toContain("- platform: web_server");
    // The first item and its sibling field survive.
    expect(after).toContain("- platform: esphome");
    expect(after).toContain("password: foo");
  });

  it("drops the parent block when removing the only list item", () => {
    const before = "ota:\n  - platform: esphome\n";
    const fromLine = firstListItemLine(before, "ota");
    const after = removeSectionFromYaml(before, "ota.esphome", fromLine);
    // Empty-parent cleanup kicks in: the bare `ota:` left
    // behind would be invalid ESPHome, so the parent goes
    // too. Anchor `ota:` to the line start so a fixture that
    // happened to mention `ota` elsewhere (e.g. inside a
    // value or comment) wouldn't trip a false positive.
    expect(after).not.toMatch(/^ota:/m);
    expect(after).not.toContain("platform: esphome");
  });
});

describe("parseYamlSectionValues / updateSectionInYaml — block scalars and complex automations", () => {
  // Reduced repro of the user-reported bug: opening a template
  // button section in the visual editor and adding an icon mangled
  // the `on_press: - lambda: |-` block into `- "lambda: |-"` and
  // left the lambda body line stranded after the new icon row.
  // Two compounding causes:
  //   1. `findSectionRange` terminated the section at the indented
  //      `      - lambda: |-` thinking it was a sibling list item
  //      — it's actually nested inside the on_press value — so the
  //      splice didn't cover the lambda body line.
  //   2. The minimal parser/serializer can't represent block
  //      scalars; `on_press` came back as `["lambda: |-"]` and
  //      re-serialized as `- "lambda: |-"` (quoted because the
  //      string contains `:`).
  // Fix: track the section's leading-dash indent (only sibling
  // dashes at the same indent terminate); detect block-scalar /
  // sub-dict-list shapes and round-trip them via `YamlRawValue`.

  const TEMPLATE_BUTTON_YAML = `button:
  - platform: template
    name: My Button
    on_press:
      - lambda: |-
          some_code(1, 2);
`;

  it("preserves a list item's block-scalar lambda body across save", () => {
    // This is the exact user-reported flow: parse → form adds
    // `icon` → save. The lambda body must be intact and the
    // on_press list must NOT have been re-serialized as a
    // quoted string.
    const values = parseYamlSectionValues(TEMPLATE_BUTTON_YAML, "button.template", 2);
    expect(values.platform).toBe("template");
    expect(values.name).toBe("My Button");
    // Form-side: user adds an icon
    (values as Record<string, unknown>).icon = "mdi:account";
    const after = updateSectionInYaml(TEMPLATE_BUTTON_YAML, "button.template", values, 2);

    // Block scalar lambda is intact
    expect(after).toContain("- lambda: |-");
    expect(after).toContain("          some_code(1, 2);");
    // No mangled quoted-string version
    expect(after).not.toContain('- "lambda: |-"');
    // The new icon was added
    expect(after).toContain('icon: "mdi:account"');
    // Exactly one on_press: line — not duplicated by the splice
    expect(after.match(/on_press:/g)).toHaveLength(1);
    // Exactly one lambda: line (only the original block scalar
    // header), not the original-plus-mangled-copy
    expect(after.match(/lambda:/g)).toHaveLength(1);
  });

  it("preserves the on_press list when the form leaves it untouched", () => {
    // Sanity round-trip: parse + write WITHOUT the form changing
    // anything must produce a byte-equivalent (modulo trailing
    // newline handling) result for the section.
    const values = parseYamlSectionValues(TEMPLATE_BUTTON_YAML, "button.template", 2);
    const after = updateSectionInYaml(TEMPLATE_BUTTON_YAML, "button.template", values, 2);
    expect(after).toContain(
      "    on_press:\n      - lambda: |-\n          some_code(1, 2);"
    );
    // Tighten the byte-stable contract: no duplicated section
    // headers (regression check — early findSectionRange bug
    // had on_press: appearing twice in the output).
    expect(after.match(/on_press:/g)).toHaveLength(1);
    expect(after.match(/lambda:/g)).toHaveLength(1);
  });

  it("overrides raw preservation when the form writes a new value to that key", () => {
    // Contract pin: YamlRawValue is the parser's "I can't model
    // this, paste it back unchanged" sentinel. If the form does
    // get a real value into that key (a hypothetical edit field
    // on `on_press`, or the user clearing the field), the
    // form's value wins and serializer emits it normally —
    // raw-preservation is a parser-side default, not a sticky
    // protection.
    const yaml = `button:
  - platform: template
    name: My Button
    on_press:
      - lambda: |-
          some_code();
`;
    const values = parseYamlSectionValues(yaml, "button.template", 2);
    // Form replaces the on_press value with a plain string
    // (artificial — the real form doesn't expose on_press —
    // but documents the override semantics).
    (values as Record<string, unknown>).on_press = "new_value";
    const after = updateSectionInYaml(yaml, "button.template", values, 2);
    // Raw block is gone, replaced by the form's string.
    expect(after).toContain("on_press: new_value");
    expect(after).not.toContain("- lambda: |-");
    expect(after).not.toContain("some_code()");
  });

  it("findSectionRange does not stop at a nested list inside a value", () => {
    // Direct test for cause #1: parseYamlSectionValues exposes
    // the same section-range walk via its outer break loop. If
    // the loop bailed at `      - lambda: |-`, `name` would be
    // captured but `on_press` wouldn't — so the presence of
    // both keys in the parse output proves the walk crossed
    // the nested dash.
    const values = parseYamlSectionValues(TEMPLATE_BUTTON_YAML, "button.template", 2);
    expect(Object.keys(values).sort()).toEqual(["name", "on_press", "platform"].sort());
  });

  it("preserves sub-dict list items (`- then:` style automations)", () => {
    // Automations frequently use `- then:` headers with their
    // own indented body. The simple `string[]` parser would
    // capture only "then:" and drop the body — same class of
    // bug as the lambda block scalar.
    const yaml = `binary_sensor:
  - platform: gpio
    pin: D1
    on_press:
      - then:
          - logger.log: pressed
`;
    const values = parseYamlSectionValues(yaml, "binary_sensor.gpio", 2);
    (values as Record<string, unknown>).name = "Door";
    const after = updateSectionInYaml(yaml, "binary_sensor.gpio", values, 2);
    expect(after).toContain("- then:");
    expect(after).toContain("          - logger.log: pressed");
    expect(after).toContain("name: Door");
    expect(after).not.toContain('- "then:"');
  });

  it("preserves a direct block scalar (`lambda: |-`) on a top-level key", () => {
    // Direct block scalar — value sits on the SAME line as the
    // key, body underneath. Without raw-preservation the parser
    // captured `raw = "|-"` as a literal string and dropped the
    // body; the serializer then quoted `"|-"` (starts with `-`)
    // producing `lambda: "|-"` and corrupting the field.
    const yaml = `lambda:
  lambda: |-
    return some_value;
  other_field: hello
`;
    // The fixture's first line `lambda:` is a top-level key whose
    // value is a dict with a NESTED `lambda: |-` field.
    const values = parseYamlSectionValues(yaml, "lambda");
    // The nested block is preserved as YamlRawValue under the
    // outer dict's `lambda` key.
    expect(values.other_field).toBe("hello");
    // Now save the section unchanged and verify the block scalar
    // round-trips byte-for-byte.
    const after = updateSectionInYaml(yaml, "lambda", values);
    expect(after).toContain("lambda: |-");
    expect(after).toContain("    return some_value;");
    expect(after).not.toContain('lambda: "|-"');
  });

  it("preserves a direct block scalar at the top level of a list-item section", () => {
    // The repro Copilot flagged: a list-item section whose body
    // includes a direct block scalar field (not wrapped in a
    // list under a key). Editing a sibling field on save would
    // otherwise drop the block scalar's body.
    const yaml = `script:
  - id: my_script
    then:
      - logger.log: hello
    inline_code: |-
      some_function();
      another_line;
`;
    const values = parseYamlSectionValues(yaml, "script", 2);
    expect(values.id).toBe("my_script");
    // Form-side: rename the script
    (values as Record<string, unknown>).id = "renamed_script";
    const after = updateSectionInYaml(yaml, "script", values, 2);
    expect(after).toContain("inline_code: |-");
    expect(after).toContain("      some_function();");
    expect(after).toContain("      another_line;");
    expect(after).toContain("id: renamed_script");
    expect(after).not.toContain('inline_code: "|-"');
  });

  it("emits LambdaValue sentinel as `lambda: |-` block scalar (#940)", () => {
    // The renderer's @lambda-change handler writes the user's typed
    // body back into the values dict as a ``LambdaValue`` sentinel
    // (``{_lambda: "<body>"}``). Pre-#940 the serializer fell through
    // to the generic object-recursion branch and emitted
    // ``lambda:\n  _lambda: "raw\nbody"`` — invalid YAML that broke
    // findSectionRange on the next save, so each subsequent keystroke
    // APPENDED a fresh section instead of replacing.
    const yaml = `display:
  - platform: ssd1306_i2c
    address: 0x3c
    lambda: |-
      it.printf(0, 0, "hello");
`;
    const values = parseYamlSectionValues(yaml, "display.ssd1306_i2c", 2);
    // Form edit: user typed in the lambda editor, which wraps the
    // body in the sentinel.
    (values as Record<string, unknown>).lambda = {
      _lambda: 'it.printf(0, 0, "hello");\nit.printf(0, 8, "world");',
    };
    const after = updateSectionInYaml(yaml, "display.ssd1306_i2c", values, 2);
    expect(after).toContain("lambda: |-");
    expect(after).toContain('      it.printf(0, 0, "hello");');
    expect(after).toContain('      it.printf(0, 8, "world");');
    // No sentinel leak.
    expect(after).not.toContain("_lambda:");
    // No nested-mapping leak.
    expect(after).not.toMatch(/lambda:\s*\n\s+_lambda:/);
  });

  it("emits LambdaValue inside a list item as `- lambda: |-` (#940)", () => {
    // The automation editor produces list items like
    // ``- lambda: { _lambda: "..." }`` for inline lambda actions.
    // serializeListItem must dispatch on isLambdaValue before the
    // formatYamlScalar fallback (which would stringify the sentinel
    // object as ``[object Object]``).
    const yaml = `binary_sensor:
  - platform: gpio
    pin: D1
    on_press:
      - logger.log: pressed
`;
    const values = parseYamlSectionValues(yaml, "binary_sensor.gpio", 2);
    (values as Record<string, unknown>).on_press = [
      { lambda: { _lambda: "do_something();\nand_more();" } },
    ];
    const after = updateSectionInYaml(yaml, "binary_sensor.gpio", values, 2);
    expect(after).toContain("- lambda: |-");
    expect(after).toContain("      do_something();");
    expect(after).toContain("      and_more();");
    expect(after).not.toContain("_lambda:");
    expect(after).not.toContain("[object Object]");
  });

  it("LambdaValue round-trips through a re-save without appending (#940)", () => {
    // Bug #2 cascade check: the first save's malformed YAML broke the
    // next save's section-range detection, so each keystroke produced
    // ANOTHER copy of the lambda block appended below. With the fix
    // the YAML stays valid, parseYamlSectionValues finds the same
    // section on the second pass, and the save replaces in place.
    const yaml = `display:
  - platform: ssd1306_i2c
    address: 0x3c
    lambda: |-
      original();
`;
    const values1 = parseYamlSectionValues(yaml, "display.ssd1306_i2c", 2);
    (values1 as Record<string, unknown>).lambda = { _lambda: "edited_v1();" };
    const after1 = updateSectionInYaml(yaml, "display.ssd1306_i2c", values1, 2);
    const values2 = parseYamlSectionValues(after1, "display.ssd1306_i2c", 2);
    (values2 as Record<string, unknown>).lambda = { _lambda: "edited_v2();" };
    const after2 = updateSectionInYaml(after1, "display.ssd1306_i2c", values2, 2);
    // Exactly one platform / one lambda after each round.
    expect(after1.match(/- platform: ssd1306_i2c/g)?.length).toBe(1);
    expect(after2.match(/- platform: ssd1306_i2c/g)?.length).toBe(1);
    expect(after2.match(/lambda: \|-/g)?.length).toBe(1);
    expect(after2).toContain("      edited_v2();");
    expect(after2).not.toContain("edited_v1();");
    expect(after2).not.toContain("original();");
  });

  it("preserves dotted-key automation actions (`- logger.log:`, `- switch.turn_on:`)", () => {
    // Pre-fix `LIST_ITEM_DICT_KEY_RE` only matched bare
    // identifiers, so `- logger.log: pressed` was treated as a
    // plain string and re-emitted as `- "logger.log: pressed"`,
    // corrupting the automation.
    const yaml = `binary_sensor:
  - platform: gpio
    pin: D1
    on_press:
      - logger.log: pressed
      - switch.turn_on: relay_id
`;
    const values = parseYamlSectionValues(yaml, "binary_sensor.gpio", 2);
    (values as Record<string, unknown>).name = "Door";
    const after = updateSectionInYaml(yaml, "binary_sensor.gpio", values, 2);
    // Both dotted-key items survive without quoting
    expect(after).toContain("- logger.log: pressed");
    expect(after).toContain("- switch.turn_on: relay_id");
    expect(after).not.toContain('- "logger.log: pressed"');
    expect(after).not.toContain('- "switch.turn_on: relay_id"');
    expect(after).toContain("name: Door");
  });

  it("multi-button list: edits to one item don't disturb siblings", () => {
    // The PR description's full scenario — multiple template
    // buttons, only one is edited. Sibling buttons (above and
    // below) keep their lambda blocks intact.
    const yaml = `button:
  - platform: template
    name: Button A
    on_press:
      - lambda: |-
          do_a();
  - platform: template
    name: Button B
    on_press:
      - lambda: |-
          do_b();
  - platform: template
    name: Button C
    on_press:
      - lambda: |-
          do_c();
`;
    // Edit the middle button (line 7 = `  - platform: template`
    // for Button B).
    const values = parseYamlSectionValues(yaml, "button.template", 7);
    expect(values.name).toBe("Button B");
    (values as Record<string, unknown>).icon = "mdi:account";
    const after = updateSectionInYaml(yaml, "button.template", values, 7);
    // All three lambda bodies still present
    expect(after).toContain("do_a();");
    expect(after).toContain("do_b();");
    expect(after).toContain("do_c();");
    // Exactly three lambda headers — the splice didn't duplicate
    // or drop any
    expect(after.match(/- lambda: \|-/g)).toHaveLength(3);
    // Icon landed on the right button
    const lines = after.split("\n");
    const bIdx = lines.findIndex((l) => l.includes("name: Button B"));
    const buttonBSlice = lines.slice(bIdx, bIdx + 6).join("\n");
    expect(buttonBSlice).toContain('icon: "mdi:account"');
    // Sanity: only Button B got the icon (siblings stayed clean)
    expect(after.match(/icon:/g)).toHaveLength(1);
  });

  it("preserves a lambda block scalar verbatim when the user re-saves without editing", () => {
    // Issue #428 — opening the form for a binary_sensor with a
    // ``lambda: |-`` previously rendered ``[object Object]`` and
    // a save round-trip would have dropped the body entirely. Now
    // ``YamlRawValue.toString`` surfaces the dedented body for
    // display; the parser keeps the wrapper intact so the
    // serializer can paste the lines back unchanged.
    //
    // Byte-equality assertion (rather than substring presence) so
    // a future drift — extra whitespace, indent change, missing
    // ``|-`` marker — fails the test. The contract for "no edit"
    // on the lambda is "no diff," so we slice the exact lambda
    // block out of both the input and the output and compare them
    // line-for-line. (The test fixture's ``name: "..."`` quoting
    // gets stripped by the unrelated scalar serializer, so we
    // can't byte-compare the WHOLE document — that's a separate
    // pre-existing concern.)
    const lambdaBlock = `    lambda: |-
      return id(moving) && id(opening) && !id(opened).state ? true : false;`;
    const yaml = `binary_sensor:
  - platform: template
    name: Driveway Opening
    id: opening_sensor
${lambdaBlock}
`;
    const values = parseYamlSectionValues(yaml, "binary_sensor.template", 2);
    // Parser wraps the block scalar so the on-disk style round-trips.
    expect(values.lambda).toBeInstanceOf(YamlRawValue);
    // Re-save without editing → byte-identical YAML.
    const after = updateSectionInYaml(yaml, "binary_sensor.template", values, 2);
    expect(after).toBe(yaml);
    // Belt + suspenders: even if a future serializer change
    // reformats some surrounding key, the lambda block itself
    // must survive byte-identical.
    expect(after).toContain(lambdaBlock);
  });

  it("re-wraps an edited lambda body as a YamlRawValue with the same indent", () => {
    // Issue #428 — when the user edits a lambda body, the renderer
    // calls ``YamlRawValue.fromBodyText`` to wrap the textarea
    // content as a fresh ``YamlRawValue`` with the original indent
    // and ``|-`` header preserved. The serializer must paste it back
    // in the same shape so the YAML doesn't drift to inline-quoted
    // form on save.
    const yaml = `binary_sensor:
  - platform: template
    name: "Driveway Opening"
    lambda: |-
      return original_body;
`;
    const values = parseYamlSectionValues(yaml, "binary_sensor.template", 2);
    const original = values.lambda;
    expect(original).toBeInstanceOf(YamlRawValue);
    // Simulate the form editing the body:
    values.lambda = YamlRawValue.fromBodyText(
      "return id(moving) && id(opening);",
      original as YamlRawValue
    );
    const after = updateSectionInYaml(yaml, "binary_sensor.template", values, 2);
    // Block-scalar form is preserved.
    expect(after).toContain("lambda: |-");
    // Body has the new content at the original indent.
    expect(after).toContain("      return id(moving) && id(opening);");
    // Old body is gone.
    expect(after).not.toContain("return original_body");
  });
});

describe("updateSectionInYaml — preserves untouched field byte layout (#1227)", () => {
  // A single-field edit re-serialized the WHOLE section, so untouched
  // siblings lost their byte layout: inline-comment scalars got quoted,
  // standalone comments shifted, lambda bodies re-indented. The
  // diff-and-splice writer copies unchanged keys' lines verbatim and
  // only re-serializes the keys the form actually changed.

  it("keeps a sibling's inline-comment scalar byte-identical", () => {
    // Headline repro: `internal: true #hides from list` must NOT become
    // `internal: "true #hides from list"` when an unrelated field edits.
    const before = [
      "wifi:",
      "  ssid: home",
      "  internal: true #hides from list",
      "logger:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "wifi", 1);
    values.ssid = "office";
    const after = updateSectionInYaml(before, "wifi", values, 1);
    expect(after).toContain("\n  internal: true #hides from list\n");
    expect(after).not.toContain('internal: "true #hides from list"');
    expect(after).toContain("ssid: office");
  });

  it("keeps a sibling lambda block byte-identical and un-duplicated", () => {
    const before = [
      "display:",
      "  lambda: |-",
      '    it.printf(0, 0, "hello");',
      "  update_interval: 1s",
      "sensor:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "display", 1);
    values.update_interval = "5s";
    const after = updateSectionInYaml(before, "display", values, 1);
    expect(after).toContain('  lambda: |-\n    it.printf(0, 0, "hello");\n');
    expect(after.match(/lambda:/g)).toHaveLength(1);
    expect(after).toContain("update_interval: 5s");
  });

  it("keeps a standalone comment between siblings in place", () => {
    const before = [
      "wifi:",
      "  ssid: home",
      "  # keep me",
      "  password: secret",
      "logger:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "wifi", 1);
    values.ssid = "office";
    const after = updateSectionInYaml(before, "wifi", values, 1);
    expect(after).toContain("\n  # keep me\n  password: secret\n");
  });

  it("reformats only the edited field, keeping a standalone comment above it", () => {
    const before = [
      "wifi:",
      "  ssid: home",
      "  # toggles list visibility",
      "  internal: true #hides from list",
      "logger:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "wifi", 1);
    // Edit the commented field itself: the value line is allowed to
    // reformat (its trailing comment drops), but the standalone comment
    // above it and the untouched sibling survive.
    values.internal = false;
    const after = updateSectionInYaml(before, "wifi", values, 1);
    expect(after).toContain("  # toggles list visibility\n  internal: false");
    expect(after).toContain("\n  ssid: home\n");
  });

  it("interleaves a changed key between two unchanged keys correctly", () => {
    const before = [
      "wifi:",
      "  ssid: home #primary",
      "  power_save_mode: none",
      "  fast_connect: true #saves boot time",
      "logger:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "wifi", 1);
    values.power_save_mode = "light";
    const after = updateSectionInYaml(before, "wifi", values, 1);
    // Both commented siblings stay byte-identical; the middle key changed.
    expect(after).toContain("  ssid: home #primary\n");
    expect(after).toContain("  fast_connect: true #saves boot time\n");
    expect(after).toContain("power_save_mode: light");
    expect(after).not.toContain('"home #primary"');
    expect(after).not.toContain('"true #saves boot time"');
  });

  it("is stable across repeated saves on a commented section", () => {
    const before = [
      "wifi:",
      "  ssid: home",
      "  internal: true #hides from list",
      "logger:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "wifi", 1);
    values.ssid = "office";
    const once = updateSectionInYaml(before, "wifi", values, 1);
    const twiceValues = parseYamlSectionValues(once, "wifi", 1);
    const twice = updateSectionInYaml(once, "wifi", twiceValues, 1);
    expect(twice).toBe(once);
  });

  it("keeps a list item's commented inline dash key byte-identical", () => {
    const before = [
      "ota:",
      "  - platform: esphome #default backend",
      "    password: oldpass",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "ota.esphome", 2);
    values.password = "newpass";
    const after = updateSectionInYaml(before, "ota.esphome", values, 2);
    expect(after).toContain("  - platform: esphome #default backend\n");
    expect(after).not.toContain('"esphome #default backend"');
    expect(after).toContain("password: newpass");
    expect(after.match(/platform:/g)).toHaveLength(1);
  });

  it("keeps an unchanged nested-mapping sibling byte-identical", () => {
    // Exercises the deep-equal object branch on the verbatim path: an
    // untouched nested map (with its own deep inline comment) survives
    // a sibling scalar edit.
    const before = [
      "api:",
      "  reboot_timeout: 0s",
      "  encryption:",
      "    key: abc123 #shared with HA",
      "logger:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "api", 1);
    values.reboot_timeout = "30s";
    const after = updateSectionInYaml(before, "api", values, 1);
    expect(after).toContain("  encryption:\n    key: abc123 #shared with HA\n");
    expect(after).not.toContain('"abc123 #shared with HA"');
    expect(after).toContain("reboot_timeout: 30s");
  });

  it("keeps an unchanged list sibling with a commented item byte-identical", () => {
    // Exercises the array-equality branch on the verbatim path, and
    // guards a regression: re-serializing the list would quote the
    // commented item (`- homenet #primary` → `- "homenet #primary"`).
    const before = [
      "wifi:",
      "  ssid: home",
      "  networks:",
      "    - homenet #primary",
      "    - guestnet",
      "logger:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "wifi", 1);
    values.ssid = "office";
    const after = updateSectionInYaml(before, "wifi", values, 1);
    expect(after).toContain("  networks:\n    - homenet #primary\n    - guestnet\n");
    expect(after).not.toContain('"homenet #primary"');
    expect(after).toContain("ssid: office");
  });

  it("keeps an inter-key comment when editing the multi-line value above it", () => {
    // Copilot review: a block scalar's span absorbs the trailing
    // sibling-level comment the scanner skipped, so editing that key
    // used to drop the comment. The span-trim folds it into the next
    // key's leadStart instead.
    const before = [
      "display:",
      "  lambda: |-",
      "    old_code();",
      "  # between siblings",
      "  update_interval: 5s",
      "sensor:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "display", 1);
    values.lambda = { _lambda: "new_code();" };
    const after = updateSectionInYaml(before, "display", values, 1);
    expect(after).toContain("  # between siblings\n  update_interval: 5s\n");
    expect(after).toContain("new_code();");
    expect(after).not.toContain("old_code();");
  });

  it("appends a form-added key without disturbing commented siblings", () => {
    // Exercises the added-key arm of the splice loop (no source span →
    // serialize fresh): the new key appends while every existing
    // commented sibling stays byte-identical.
    const before = [
      "wifi:",
      "  ssid: home #primary",
      "  password: secret #wpa2",
      "logger:",
      "",
    ].join("\n");
    const values = parseYamlSectionValues(before, "wifi", 1);
    values.fast_connect = true;
    const after = updateSectionInYaml(before, "wifi", values, 1);
    expect(after).toContain("  ssid: home #primary\n");
    expect(after).toContain("  password: secret #wpa2\n");
    expect(after).not.toContain('"home #primary"');
    expect(after).not.toContain('"secret #wpa2"');
    expect(after).toContain("fast_connect: true");
  });
});

describe("serializeYamlValues — single-key null-value list items", () => {
  // The polymorphic carve-out in serializeListItem is in the
  // shared helper, so it affects every list-of-mapping consumer,
  // not just REGISTRY_LIST. Pin the contract here so a future
  // shape change doesn't quietly flip non-registry consumers
  // back to the pre-#941 bare-dash emit.

  it("emits `- key:` for a single-key null value (registry case)", () => {
    const lines = serializeYamlValues({ effects: [{ pulse: null }] }, "");
    expect(lines).toEqual(["effects:", "  - pulse:"]);
  });

  it("emits `- key:` for any single-key null value, not just registries", () => {
    // No code path produces this shape today on a non-registry
    // multi-value list, but the carve-out is structural: every
    // list-of-mapping consumer with a single null-keyed entry
    // gets the same output. Pin it so a future caller can rely.
    const lines = serializeYamlValues({ areas: [{ id: null }] }, "");
    expect(lines).toEqual(["areas:", "  - id:"]);
  });

  it("still drops a null field on a multi-key item (pre-#941 semantics)", () => {
    // The carve-out fires only when the WHOLE item collapses to one
    // null-valued key. Multi-key items keep the "drop null field"
    // semantic, mirroring how the form treats cleared scalar fields.
    const lines = serializeYamlValues({ areas: [{ id: "kitchen", name: null }] }, "");
    expect(lines).toEqual(["areas:", "  - id: kitchen"]);
  });

  it("emits bare `-` when every field is null (no carve-out match)", () => {
    // Two null-valued keys: not the single-key shape, so the
    // null-filter strips both and the placeholder dash remains.
    const lines = serializeYamlValues({ areas: [{ id: null, name: null }] }, "");
    expect(lines).toEqual(["areas:", "  -"]);
  });
});

describe("updateSectionInYaml — keepEmptyStrings option", () => {
  // Regression pin for Copilot's post-merge finding on #161:
  // ``serializeYamlValues`` drops ``""`` values by default
  // (form's "user cleared the field" semantics for ordinary
  // entries). For ``substitutions:`` and other top-level
  // user-keyed maps that's wrong — every key the user typed is
  // intentional data, ``foo: ""`` is a valid substitution that
  // must round-trip. Without ``keepEmptyStrings: true`` a save
  // in the substitutions section silently deletes any existing
  // empty-string substitution alongside the user's actual edit.

  it("drops empty-string values by default (ordinary section semantics)", () => {
    const yaml = "wifi:\n  ssid: home\n  password: secret\n";
    const values = { ssid: "home", password: "" };
    const after = updateSectionInYaml(yaml, "wifi", values);
    expect(after).toContain("ssid: home");
    // ``password`` got dropped (the form-cleared semantics).
    expect(after).not.toMatch(/password:/);
  });

  it("preserves empty-string values when keepEmptyStrings is true (substitutions semantics)", () => {
    // Two substitutions, one with an empty value. After loading
    // and saving with no further edits, both must persist.
    const yaml = 'substitutions:\n  id_prefix: kitchen\n  empty_var: ""\n';
    const values = parseYamlSectionValues(yaml, "substitutions");
    expect(values.empty_var).toBe("");
    const after = updateSectionInYaml(yaml, "substitutions", values, undefined, {
      keepEmptyStrings: true,
    });
    expect(after).toContain("id_prefix: kitchen");
    expect(after).toMatch(/empty_var:\s*""/);
  });

  it("preserves empty strings while saving an unrelated edit", () => {
    // The user edits ``id_prefix``; ``empty_var: ""`` must
    // survive the round-trip even though the user didn't touch
    // it.
    const yaml = 'substitutions:\n  id_prefix: kitchen\n  empty_var: ""\n';
    const values = parseYamlSectionValues(yaml, "substitutions");
    (values as Record<string, unknown>).id_prefix = "bedroom";
    const after = updateSectionInYaml(yaml, "substitutions", values, undefined, {
      keepEmptyStrings: true,
    });
    expect(after).toContain("id_prefix: bedroom");
    expect(after).toMatch(/empty_var:\s*""/);
  });

  it("threads keepEmptyStrings through nested objects (recursion preserves the option)", () => {
    // Copilot-flagged: ``serializeYamlValues`` recurses into
    // nested objects but didn't pass ``options`` through, so an
    // empty string inside a nested mapping was still dropped
    // even when ``keepEmptyStrings: true``. Pin the recursion.
    const yaml = 'esphome:\n  name: test\n  nested:\n    inner_empty: ""\n';
    const values = {
      name: "test",
      nested: { inner_empty: "" },
    };
    const after = updateSectionInYaml(yaml, "esphome", values, undefined, {
      keepEmptyStrings: true,
    });
    expect(after).toMatch(/inner_empty:\s*""/);
  });
});

describe("parseYamlSectionValues — list-of-mappings (multi_value=true)", () => {
  // Regression pin for issue #434: catalog entries marked
  // ``type=nested, multi_value=true`` (``esphome.devices`` /
  // ``esphome.areas``) must reach the renderer as structured
  // arrays of objects, not as ``YamlRawValue``. The parser used to
  // capture the whole block raw (because ``LIST_ITEM_DICT_KEY_RE``
  // flagged any ``- key:`` line as "complex"), and the editor's
  // nested-list renderer would then show "No items yet" even when
  // the YAML had items.

  it("parses a compact (same-indent) list under a nested key", () => {
    // YAML 1.2 compact block-sequence form: ``key:`` followed by
    // dash lines at the SAME indent as the key (not strictly
    // deeper). ESPHome examples produce this for short
    // ``calibration:`` / ``datapoints:`` lists. Pre-fix the parser
    // required strictly-deeper dashes and silently dropped the
    // list, so to_ntc_resistance loaded with an empty calibration
    // field even when the YAML had values.
    const yaml = `sensor:
  - platform: template
    name: Probe
    filters:
      - to_ntc_resistance:
          calibration:
          - 10.0kOhm -> 25°C
          - 27.219kOhm -> 0°C
          - 14.674kOhm -> 15°C
`;
    const values = parseYamlSectionValues(yaml, "sensor.template", 2);
    expect(values.filters).toEqual([
      {
        to_ntc_resistance: {
          calibration: ["10.0kOhm -> 25°C", "27.219kOhm -> 0°C", "14.674kOhm -> 15°C"],
        },
      },
    ]);
  });

  it("compact list followed by a sibling key at the same indent", () => {
    // Sibling key after the dashes; the sibling must NOT get
    // absorbed into the compact list. The terminator path in
    // ``_scanValueBlock`` distinguishes same-indent dashes (stay
    // in the block) from same-indent non-dash (end the block).
    const yaml = `sensor:
  - platform: template
    filters:
      - to_ntc_resistance:
          calibration:
          - "10.0kOhm -> 25°C"
          - "27.219kOhm -> 0°C"
          b_constant: 3950
`;
    const values = parseYamlSectionValues(yaml, "sensor.template", 2);
    expect(values.filters).toEqual([
      {
        to_ntc_resistance: {
          calibration: ["10.0kOhm -> 25°C", "27.219kOhm -> 0°C"],
          b_constant: "3950",
        },
      },
    ]);
  });

  it("two sibling compact lists under the same parent", () => {
    const yaml = `sensor:
  - platform: template
    filters:
      - to_ntc_resistance:
          calibration:
          - a
          - b
          other:
          - c
          - d
`;
    const values = parseYamlSectionValues(yaml, "sensor.template", 2);
    expect(values.filters).toEqual([
      {
        to_ntc_resistance: {
          calibration: ["a", "b"],
          other: ["c", "d"],
        },
      },
    ]);
  });

  it("compact list at the very end of input (no trailing newline)", () => {
    // EOF terminates the list cleanly — no trailing key, no blank
    // line. Pins that the dash-walk doesn't depend on a terminator.
    const yaml = `sensor:
  - platform: template
    filters:
      - to_ntc_resistance:
          calibration:
          - x
          - y`;
    const values = parseYamlSectionValues(yaml, "sensor.template", 2);
    expect(values.filters).toEqual([
      {
        to_ntc_resistance: {
          calibration: ["x", "y"],
        },
      },
    ]);
  });

  it("parses esphome.devices into an array of plain objects", () => {
    const yaml = `esphome:
  name: test
  devices:
    - id: front_door_device
      name: "Front Door Sensor"
      area_id: entrance_area
    - id: kitchen_motion_device
      name: "Kitchen Motion"
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    expect(values.name).toBe("test");
    expect(values.devices).toEqual([
      {
        id: "front_door_device",
        name: "Front Door Sensor",
        area_id: "entrance_area",
      },
      { id: "kitchen_motion_device", name: "Kitchen Motion" },
    ]);
    // Not a YamlRawValue — the editor must be able to recurse
    // into per-item children, which it can't with raw text.
    expect(values.devices).not.toBeInstanceOf(YamlRawValue);
  });

  it("parses esphome.areas alongside esphome.devices in the same section", () => {
    const yaml = `esphome:
  devices:
    - id: front_door
      name: "Front Door"
  areas:
    - id: entrance
      name: "Entrance"
    - id: kitchen
      name: "Kitchen"
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    expect(values.devices).toEqual([{ id: "front_door", name: "Front Door" }]);
    expect(values.areas).toEqual([
      { id: "entrance", name: "Entrance" },
      { id: "kitchen", name: "Kitchen" },
    ]);
  });

  it("falls back to YamlRawValue when items contain dotted-key automation actions", () => {
    // ``- logger.log: pressed`` is automation-action shorthand,
    // not a flat-mapping field. Capturing it as a structured
    // ``{ "logger.log": "pressed" }`` would round-trip on save as
    // ``- "logger.log": pressed``, corrupting the trigger.
    const yaml = `binary_sensor:
  - platform: gpio
    pin: D1
    on_press:
      - logger.log: pressed
      - switch.turn_on: relay_id
`;
    const values = parseYamlSectionValues(yaml, "binary_sensor.gpio", 2);
    expect(values.on_press).toBeInstanceOf(YamlRawValue);
  });

  it("falls back to YamlRawValue when items contain block scalars", () => {
    const yaml = `script:
  - id: my_script
    actions:
      - lambda: |-
          some_function();
          another_line;
`;
    const values = parseYamlSectionValues(yaml, "script", 2);
    expect(values.actions).toBeInstanceOf(YamlRawValue);
  });

  it("falls back to YamlRawValue when items have nested mappings under a sub-key", () => {
    // ``- key:\n      sub_key:`` (sub_key with empty raw, opening
    // a deeper mapping) carries shape the flat-mapping helper
    // can't model. The conservative bail-out keeps the block raw
    // so the deeper content survives a round-trip.
    const yaml = `sensor:
  - platform: template
    name: outside_temp
    triggers:
      - id: my_trigger
        filters:
          delta: 0.5
`;
    const values = parseYamlSectionValues(yaml, "sensor.template", 2);
    expect(values.triggers).toBeInstanceOf(YamlRawValue);
  });

  it("parses effects from the #941 reporter's exact YAML shape", () => {
    // The reporter's fixture: real config preamble (esphome / esp32 /
    // logger / sensor) sits ahead of the light section. The parser
    // has to resolve the dash line by name + 1-indexed line number,
    // not by counting from zero. Without this regression test, a
    // future shift in the fromLine semantics could land effects in
    // an empty array again and the rendered list would show "No
    // items yet" — the visible bug the user screenshot caught.
    const yaml = `esphome:
  name: test-light

esp32:
  board: esp32dev

logger:

light:
  - platform: esp32_rmt_led_strip
    name: RGB LEDs
    id: rgb_leds
    pin: GPIO14
    num_leds: 10
    rgb_order: GRB
    chipset: WS2812
    rmt_symbols: 48
    effects:
      - addressable_rainbow:
      - addressable_color_wipe:

sensor:
  - platform: template
    name: Probe
    id: probe_sensor
    filters:
      - delta: 0.1
      - multiply: 2.0
`;
    const lightLine =
      yaml
        .split("\n")
        .findIndex((l) => l.startsWith("  - platform: esp32_rmt_led_strip")) + 1;
    const lightValues = parseYamlSectionValues(
      yaml,
      "light.esp32_rmt_led_strip",
      lightLine
    );
    expect(lightValues.effects).toEqual([
      { addressable_rainbow: null },
      { addressable_color_wipe: null },
    ]);
    // Filters with simple scalar args also round-trip as an array
    // of single-key mappings. A lambda filter would force a
    // YamlRawValue fallback because the parser can't model block
    // scalars inside list items; that's a pre-existing path,
    // covered by the existing "falls back to YamlRawValue when
    // items contain block scalars" test.
    const sensorLine =
      yaml.split("\n").findIndex((l) => l.startsWith("  - platform: template")) + 1;
    const sensorValues = parseYamlSectionValues(yaml, "sensor.template", sensorLine);
    expect(sensorValues.filters).toEqual([{ delta: "0.1" }, { multiply: "2.0" }]);
  });

  it("parses light effects (single-key empty mappings) as an array (#941)", () => {
    // Each ``- effect_id:`` is a polymorphic registry-list item: a
    // single-key mapping whose value is either null (default params)
    // or a nested mapping (per-effect overrides). Pre-fix the parser
    // bailed on the empty value at ``parseFlatMappingField`` and the
    // whole block fell back to YamlRawValue; the section editor
    // then collapsed the body into a single text input.
    const yaml = `light:
  - platform: esp32_rmt_led_strip
    name: RGB LEDs
    effects:
      - addressable_rainbow:
      - addressable_color_wipe:
`;
    const values = parseYamlSectionValues(yaml, "light.esp32_rmt_led_strip", 2);
    expect(values.effects).toEqual([
      { addressable_rainbow: null },
      { addressable_color_wipe: null },
    ]);
    expect(values.effects).not.toBeInstanceOf(YamlRawValue);
  });

  it("parses light effects with per-effect params (#941)", () => {
    // ``- pulse:\n      transition_length: 1s`` — the dash header has
    // empty value, the next line is strictly deeper than the
    // flat-sub-key childIndent, and recursively forms the params
    // mapping for the empty-keyed field.
    const yaml = `light:
  - platform: monochromatic
    name: Lamp
    effects:
      - pulse:
          transition_length: 1s
          update_interval: 2s
      - random:
`;
    const values = parseYamlSectionValues(yaml, "light.monochromatic", 2);
    expect(values.effects).toEqual([
      { pulse: { transition_length: "1s", update_interval: "2s" } },
      { random: null },
    ]);
  });

  it("falls back to YamlRawValue when a single-key item nests a list (#941)", () => {
    // ``- then:\n  - logger.log: pressed`` is an automation handler
    // (list under a single key), not a polymorphic params mapping.
    // The polymorphic branch must bail so the inner list rounds-trips
    // through YamlRawValue — same shape as the pre-fix behaviour for
    // ``on_press:`` blocks.
    const yaml = `binary_sensor:
  - platform: gpio
    pin: D1
    on_press:
      - then:
          - logger.log: pressed
`;
    const values = parseYamlSectionValues(yaml, "binary_sensor.gpio", 2);
    expect(values.on_press).toBeInstanceOf(YamlRawValue);
  });

  it("round-trips light effects through update with edits (#941)", () => {
    const yaml = `light:
  - platform: esp32_rmt_led_strip
    name: RGB LEDs
    effects:
      - addressable_rainbow:
      - addressable_color_wipe:
`;
    const values = parseYamlSectionValues(yaml, "light.esp32_rmt_led_strip", 2);
    const effects = values.effects as Record<string, unknown>[];
    effects.push({ pulse: { transition_length: "1s" } });
    const after = updateSectionInYaml(yaml, "light.esp32_rmt_led_strip", values, 2);
    expect(after).toContain("- addressable_rainbow:");
    expect(after).toContain("- addressable_color_wipe:");
    expect(after).toContain("- pulse:");
    expect(after).toContain("transition_length: 1s");
    expect(after).not.toContain("YamlRawValue");
  });

  it("round-trips esphome.devices through update with edits to one item", () => {
    const yaml = `esphome:
  devices:
    - id: front_door
      name: "Front Door"
    - id: kitchen
      name: "Kitchen"
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    const devices = values.devices as Record<string, unknown>[];
    devices[0].name = "Front Entry";
    const after = updateSectionInYaml(yaml, "esphome", values);
    // Both items survive; only the first item's name changed.
    expect(after).toContain("- id: front_door");
    expect(after).toContain("name: Front Entry");
    expect(after).toContain("- id: kitchen");
    expect(after).toContain("name: Kitchen");
    // No double-quoted dotted-key corruption.
    expect(after).not.toMatch(/"id":/);
  });

  it("round-trips a freshly-added empty item via the renderer's Add button", () => {
    // ``renderNestedListField`` emits ``[..., {}]`` when the user
    // clicks Add. The serializer should emit a bare dash
    // placeholder so the YAML stays valid even before the user
    // fills in a key.
    const yaml = `esphome:
  devices:
    - id: existing
      name: Existing
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    const devices = values.devices as Record<string, unknown>[];
    devices.push({});
    const after = updateSectionInYaml(yaml, "esphome", values);
    // The existing item still emits with its keys.
    expect(after).toContain("- id: existing");
    // The new empty item emits as a bare dash; the next compile
    // will surface a real schema error if any required field is
    // missing.
    const lines = after.split("\n");
    const dashLines = lines.filter((l) => /^\s+-/.test(l));
    expect(dashLines).toHaveLength(2);
    expect(dashLines[1].trim()).toBe("-");
  });

  it("emits new mapping items with the dash on the first key only", () => {
    // The serializer's contract for list-of-mappings: the dash
    // sits on the first sub-key's line; remaining keys live one
    // indent step deeper, no leading dash. Matches what
    // ``parseYamlSectionValues`` reads back so the round-trip is
    // stable.
    const yaml = `esphome:
  name: test
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    (values as Record<string, unknown>).devices = [
      { id: "front", name: "Front Door", area_id: "entrance" },
    ];
    const after = updateSectionInYaml(yaml, "esphome", values);
    expect(after).toContain("    - id: front");
    expect(after).toContain("      name: Front Door");
    expect(after).toContain("      area_id: entrance");
    // The dash must NOT appear on the second / third sub-key's
    // line — the parser would re-read those as new list items.
    expect(after).not.toContain("    - name:");
    expect(after).not.toContain("    - area_id:");
  });

  it("treats a bare dash with trailing whitespace as an empty placeholder", () => {
    // Some editors emit ``    -  `` (dash + trailing spaces)
    // when the user lands on a fresh dash line and pauses. The
    // exact-match check (``lines[at] === bareDash``) used to
    // miss this and bail to YamlRawValue, breaking the visual
    // editor. ``LIST_ITEM_BARE_DASH_RE`` already accepts any
    // trailing whitespace as a complexity signal — the parser
    // now uses the same predicate inside ``parseItem`` so the
    // two stay in lockstep.
    const yaml = `esphome:
  devices:
    -
    - id: kitchen
      name: Kitchen
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    expect(values.devices).toEqual([{}, { id: "kitchen", name: "Kitchen" }]);
  });

  it("parses a list-of-mappings with a comment line between key and items", () => {
    // Regression for Copilot's catch: a comment between
    // ``devices:`` and the first ``- id:`` line used to make
    // ``peekLine`` land on the comment, fail
    // ``isDeeperListItemLine``, and route through
    // ``parseNestedBlock`` — which then skipped the list items
    // entirely, returning an empty mapping. The field got
    // dropped from values and deleted on save.
    const yaml = `esphome:
  devices:
    # the kitchen sensor and the front door
    - id: kitchen
      name: Kitchen
    - id: front_door
      name: "Front Door"
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    expect(values.devices).toEqual([
      { id: "kitchen", name: "Kitchen" },
      { id: "front_door", name: "Front Door" },
    ]);
  });

  it("parses a nested mapping with a comment line between key and content", () => {
    // Same comment-skip semantic in ``parseNestedBlock`` — the
    // recursion path that handles deeper map blocks. A comment
    // between ``manual_ip:`` and ``static_ip:`` would silently
    // drop the manual_ip field from values.
    const yaml = `wifi:
  manual_ip:
    # static IP for the office sensor
    static_ip: 10.0.0.5
    gateway: 10.0.0.1
`;
    const values = parseYamlSectionValues(yaml, "wifi");
    expect(values.manual_ip).toEqual({
      static_ip: "10.0.0.5",
      gateway: "10.0.0.1",
    });
  });

  it("preserves a list of only bare-dash placeholder items", () => {
    // Regression for the bug Copilot caught: a list whose only
    // items are bare-dash placeholders (the user clicked Add but
    // hadn't filled any fields yet, then saved) used to drop the
    // whole field. ``_scanValueBlock`` saw no ``- key:`` lines and
    // returned ``isComplex=false``, so the scalar-list branch
    // ran, the ``- `` regex missed the bare dash, items=0, and
    // the key got omitted from the values dict — which then
    // *deleted* the user's in-progress rows on the next save.
    // The bare-dash regex is now part of the complexity signal,
    // so the block routes through ``collectBlockListMappings``
    // and rebuilds each placeholder as ``{}``.
    const yaml = `esphome:
  devices:
    -
    -
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    expect(values.devices).toEqual([{}, {}]);
  });

  it("re-parses a bare-dash list item as an empty mapping (round-trip stable)", () => {
    // The serializer emits ``    -`` (no trailing key) for an
    // empty mapping item — the placeholder shape for a
    // freshly-added Add row the user saved before filling in any
    // fields. The parser must accept the bare dash and rebuild
    // ``{}`` so the row survives the round-trip; otherwise the
    // user's in-progress item vanishes on reload.
    const yaml = `esphome:
  devices:
    - id: kitchen
      name: Kitchen
    -
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    expect(values.devices).toEqual([{ id: "kitchen", name: "Kitchen" }, {}]);
  });

  it("re-parses a bare-dash item inside a parseNestedBlock recursion", () => {
    // Same bare-dash handling at deeper indents — exercises the
    // ``parseNestedBlock`` branch that ``parseYamlSectionValues``
    // delegates to for nested mappings.
    const yaml = `outer:
  meta:
    rows:
      - id: first
      -
`;
    const values = parseYamlSectionValues(yaml, "outer");
    expect(values.meta).toEqual({ rows: [{ id: "first" }, {}] });
  });

  it("survives a full Add → save → reload cycle", () => {
    // Drives the exact flow the user hits in the visual editor:
    // start with one item, click Add, save (serializer emits
    // bare dash for the new empty row), reload (parser rebuilds
    // the array). Without the round-trip fix the second item
    // disappears on reload.
    const yaml = `esphome:
  devices:
    - id: kitchen
      name: Kitchen
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    (values.devices as Record<string, unknown>[]).push({});
    const after = updateSectionInYaml(yaml, "esphome", values);
    const reloaded = parseYamlSectionValues(after, "esphome");
    expect(reloaded.devices).toEqual([{ id: "kitchen", name: "Kitchen" }, {}]);
  });

  it("reads a flat section with 4-space user indent", () => {
    // The non-list path through ``parseYamlSectionValues`` —
    // every leaf is a bare ``key: value`` and the section has
    // no list-of-mappings child — must also detect indent.
    const yaml = `wifi:
    ssid: home
    password: secret
`;
    const values = parseYamlSectionValues(yaml, "wifi");
    expect(values.ssid).toBe("home");
    expect(values.password).toBe("secret");
  });

  it("reads nested mappings with 4-space user indent", () => {
    // ``parseNestedBlock`` recursion must propagate the
    // detected indent so a ``manual_ip:`` block with
    // ``static_ip:`` underneath comes back as a structured
    // sub-object, not undefined.
    const yaml = `wifi:
    ssid: home
    manual_ip:
        static_ip: 10.0.0.5
        gateway: 10.0.0.1
`;
    const values = parseYamlSectionValues(yaml, "wifi");
    expect(values.manual_ip).toEqual({
      static_ip: "10.0.0.5",
      gateway: "10.0.0.1",
    });
  });

  it("round-trips 4-space user YAML through update without mixing indents", () => {
    // The save path detects the user's indent step and threads it
    // through the serializer so the rewritten section keeps the
    // user's 4-space style instead of splicing canonical 2-space
    // content into a 4-space file (mixed indent inside one
    // mapping is valid YAML but visually inconsistent).
    const yaml = `esphome:
    name: test
    devices:
        - id: kitchen
          name: Kitchen
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    (values.devices as Record<string, unknown>[])[0].name = "Renamed";
    const after = updateSectionInYaml(yaml, "esphome", values);
    // Top-level fields stay at 4-space — column 4, exactly.
    expect(after).toMatch(/^ {4}name: test/m);
    // Devices list keeps its 8-space dash indent (4 + 4 step) and
    // sub-keys align with the inline first key — column 10
    // (= dash col 8 + the literal 2-char ``- `` gap), NOT
    // dash + step (which would be 12 on a 4-space file). Pin the
    // exact column so a regression to ``${dashIndent}${step}``
    // surfaces in CI instead of hiding behind a substring match.
    expect(after).toMatch(/^ {8}- id: kitchen/m);
    expect(after).toMatch(/^ {10}name: Renamed/m);
    // No 2-space children sneaking in mid-section.
    expect(after).not.toMatch(/^ {2}[a-zA-Z]/m);
  });

  it("reads a flat scalar list with 4-space user indent", () => {
    // Regression pin for the bug Copilot caught:
    // ``listItemRegexFor`` was building its regex from
    // ``parentIndent + ESPHOME_YAML_INDENT``, hardcoding the dash
    // at ``parent + 2`` even when the actual dash sat at
    // ``parent + 4`` for a 4-space user file. The startsWith
    // prefix check passed (it was already detected from the
    // content) but the regex match failed, so
    // ``collectBlockListItems`` returned ``[]`` and the list was
    // silently dropped — and would have been deleted on save.
    const yaml = `wifi:
    networks:
        - one
        - two
        - three
`;
    const values = parseYamlSectionValues(yaml, "wifi");
    expect(values.networks).toEqual(["one", "two", "three"]);
  });

  it("round-trips a 4-space scalar list through update without dropping items", () => {
    // The save path would have spliced the empty parsed list back
    // into the YAML, deleting the user's networks. Pin both the
    // parse and the round-trip so a regression is caught at CI.
    const yaml = `wifi:
    networks:
        - one
        - two
`;
    const values = parseYamlSectionValues(yaml, "wifi");
    (values.networks as string[]).push("three");
    const after = updateSectionInYaml(yaml, "wifi", values);
    expect(after).toContain("- one");
    expect(after).toContain("- two");
    expect(after).toContain("- three");
  });

  it("treats an underscore-leading sibling section as a section terminator", () => {
    // The terminator predicate has to mirror ``KEY_PATTERN``'s
    // leading-character set (``[a-zA-Z_]``). A section header
    // like ``_internal:`` wasn't matched by the older
    // ``/^[a-zA-Z]/`` shape and could leak into the parent
    // section's child walk, picking up its keys as siblings of
    // the parent.
    const yaml = `esphome:
  name: test
_internal:
  hidden: true
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    expect(values.name).toBe("test");
    // The ``_internal`` section's children must not bleed into
    // ``esphome``'s.
    expect(values.hidden).toBeUndefined();
  });

  it("reads list-of-mappings with non-default user indent (4-space YAML)", () => {
    // YAML allows any consistent indent step — a user-typed
    // 4-space file is just as valid as ESPHome's canonical
    // 2-space emit. The parser detects the actual indent from
    // the first child line and propagates it down so the same
    // ``esphome.devices`` list works regardless of the step
    // the user chose.
    const yaml = `esphome:
    name: test
    devices:
        - id: kitchen
          name: Kitchen
        - id: front_door
          name: "Front Door"
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    expect(values.name).toBe("test");
    expect(values.devices).toEqual([
      { id: "kitchen", name: "Kitchen" },
      { id: "front_door", name: "Front Door" },
    ]);
  });

  it("skips null / undefined / empty-string fields inside a mapping item — round-trip", () => {
    // Same skip semantics the top-level serializer applies, so a
    // partially-filled item written by ``renderNestedListField``
    // doesn't emit half-blank rows that re-parse as different
    // values on the next round-trip.
    const yaml = `esphome:
  name: test
`;
    const values = parseYamlSectionValues(yaml, "esphome");
    (values as Record<string, unknown>).devices = [
      {
        id: "front",
        name: "Front Door",
        area_id: null,
        comment: undefined,
        empty_field: "",
      },
    ];
    const after = updateSectionInYaml(yaml, "esphome", values);
    expect(after).toContain("- id: front");
    expect(after).toContain("name: Front Door");
    expect(after).not.toContain("area_id:");
    expect(after).not.toContain("comment:");
    expect(after).not.toContain("empty_field:");
  });
});

describe("parseYamlSectionValues — ESPHome YAML boolean spellings", () => {
  // ESPHome's YAML accepts ``true|yes|on|enable`` / ``false|no|off|disable``
  // case-insensitively (https://esphome.io/guides/yaml#scalars). The
  // section parser feeds the form view, so every accepted spelling has
  // to surface as the boolean primitive — otherwise the form's
  // boolean toggle stays OFF on a user-typed ``True`` (issue
  // device-builder#923).
  const TRUTHY = [
    "true",
    "True",
    "TRUE",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "enable",
    "Enable",
    "ENABLE",
  ];
  const FALSY = [
    "false",
    "False",
    "FALSE",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF",
    "disable",
    "Disable",
    "DISABLE",
  ];

  for (const spelling of TRUTHY) {
    it(`parses ${spelling} as boolean true`, () => {
      const values = parseYamlSectionValues(
        `wifi:\n  fast_connect: ${spelling}\n`,
        "wifi"
      );
      expect(values.fast_connect).toBe(true);
    });
  }

  for (const spelling of FALSY) {
    it(`parses ${spelling} as boolean false`, () => {
      const values = parseYamlSectionValues(
        `wifi:\n  fast_connect: ${spelling}\n`,
        "wifi"
      );
      expect(values.fast_connect).toBe(false);
    });
  }

  it("leaves non-boolean strings that resemble words alone", () => {
    const values = parseYamlSectionValues(
      "esphome:\n  name: enabled-device\n  comment: yesterday\n",
      "esphome"
    );
    expect(values.name).toBe("enabled-device");
    expect(values.comment).toBe("yesterday");
  });

  it("leaves quoted boolean-looking words as strings", () => {
    // YAML quoting is the explicit "force string" signal — a user
    // who wrote ``mode: "on"`` or ``state: 'yes'`` wants the literal
    // string. Without the quoted-scalar guard, the truthy-spelling
    // table would corrupt those fields into boolean ``true`` and
    // the round-trip would emit ``true:`` instead.
    const values = parseYamlSectionValues(
      `mqtt:\n  mode: "on"\n  state: 'yes'\n  fallback: "True"\n  hint: 'enable'\n`,
      "mqtt"
    );
    expect(values.mode).toBe("on");
    expect(values.state).toBe("yes");
    expect(values.fallback).toBe("True");
    expect(values.hint).toBe("enable");
  });
});

describe("globals list section (LIST_SECTIONS)", () => {
  const TWO_ENTRY =
    "globals:\n" +
    "  - id: my_int\n" +
    "    type: int\n" +
    "    initial_value: '0'\n" +
    "  - id: my_bool\n" +
    "    type: bool\n" +
    "    restore_value: true\n";

  it("parses a 2-entry globals block into an item array at [sectionKey]", () => {
    const parsed = parseYamlSectionValues(TWO_ENTRY, "globals");
    const items = parsed.globals as Record<string, unknown>[];
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("my_int");
    expect(items[0].type).toBe("int");
    expect(items[0].initial_value).toBe("0");
    expect(items[1].id).toBe("my_bool");
    expect(items[1].type).toBe("bool");
    expect(items[1].restore_value).toBe(true);
  });

  it("round-trips editing one item's initial_value, keeping every entry", () => {
    const parsed = parseYamlSectionValues(TWO_ENTRY, "globals");
    const items = parsed.globals as Record<string, unknown>[];
    items[0].initial_value = "42";
    const out = updateSectionInYaml(TWO_ENTRY, "globals", { globals: items });
    expect(out.startsWith("globals:")).toBe(true);
    const reparsed = parseYamlSectionValues(out + "\n", "globals");
    const ritems = reparsed.globals as Record<string, unknown>[];
    expect(ritems).toHaveLength(2);
    expect(ritems[0].id).toBe("my_int");
    expect(ritems[0].initial_value).toBe("42");
    expect(ritems[1].id).toBe("my_bool");
  });

  it("round-trips adding a third item", () => {
    const parsed = parseYamlSectionValues(TWO_ENTRY, "globals");
    const items = parsed.globals as Record<string, unknown>[];
    items.push({ id: "my_str", type: "std::string" });
    const out = updateSectionInYaml(TWO_ENTRY, "globals", { globals: items });
    const ritems = parseYamlSectionValues(out + "\n", "globals").globals as Record<
      string,
      unknown
    >[];
    expect(ritems.map((i) => i.id)).toEqual(["my_int", "my_bool", "my_str"]);
  });

  it("round-trips removing the first item", () => {
    const parsed = parseYamlSectionValues(TWO_ENTRY, "globals");
    const items = parsed.globals as Record<string, unknown>[];
    items.splice(0, 1);
    const out = updateSectionInYaml(TWO_ENTRY, "globals", { globals: items });
    const ritems = parseYamlSectionValues(out + "\n", "globals").globals as Record<
      string,
      unknown
    >[];
    expect(ritems).toHaveLength(1);
    expect(ritems[0].id).toBe("my_bool");
  });

  it("round-trips a 4-space-indented globals fixture", () => {
    const FOUR_SPACE =
      "globals:\n" +
      "    - id: my_int\n" +
      "      type: int\n" +
      "    - id: my_bool\n" +
      "      type: bool\n";
    const parsed = parseYamlSectionValues(FOUR_SPACE, "globals");
    const items = parsed.globals as Record<string, unknown>[];
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("my_int");
    items[0].type = "int64_t";
    const out = updateSectionInYaml(FOUR_SPACE, "globals", { globals: items });
    const ritems = parseYamlSectionValues(out + "\n", "globals").globals as Record<
      string,
      unknown
    >[];
    expect(ritems).toHaveLength(2);
    expect(ritems[0].type).toBe("int64_t");
    expect(ritems[1].id).toBe("my_bool");
  });

  it("preserves sibling sections after globals on round-trip", () => {
    const WITH_SIBLING = TWO_ENTRY + "wifi:\n  ssid: home\n";
    const items = parseYamlSectionValues(WITH_SIBLING, "globals").globals as Record<
      string,
      unknown
    >[];
    items[0].initial_value = "7";
    const out = updateSectionInYaml(WITH_SIBLING, "globals", { globals: items });
    expect(out).toContain("wifi:");
    expect(out).toContain("ssid: home");
  });

  it("leaves the YAML untouched when the list value is not an array (no wipe)", () => {
    // A missing/garbled value must not collapse the block to an empty
    // mapping.
    const out = updateSectionInYaml(TWO_ENTRY, "globals", { globals: undefined });
    expect(out).toBe(TWO_ENTRY);
  });

  it("falls through to mapping parse when the body is not a dash-list", () => {
    // Guard branch: a member whose body isn't `- ` items must not
    // stash an array — it degrades to the empty-list editor, not a wipe.
    const parsed = parseYamlSectionValues("globals:\n  foo: bar\n", "globals");
    expect(Array.isArray(parsed.globals)).toBe(false);
    expect(parsed.foo).toBe("bar");
  });

  it("removes the whole block when every item is deleted, keeping siblings", () => {
    const out = updateSectionInYaml(TWO_ENTRY + "wifi:\n  ssid: home\n", "globals", {
      globals: [],
    });
    expect(out).not.toContain("globals:");
    expect(out).toContain("wifi:");
    expect(out).toContain("ssid: home");
  });

  it("emptying the only section yields an empty document", () => {
    expect(updateSectionInYaml(TWO_ENTRY, "globals", { globals: [] })).toBe("");
  });
});

describe("LIST_SECTIONS is membership-driven, not hardcoded to globals", () => {
  // Pins genericity: parse/serialize key off membership, so a future
  // top-level list section is one allowlist edit.
  const KEY = "future_list_section";
  const FIXTURE = `${KEY}:\n  - id: a\n    type: int\n  - id: b\n    type: bool\n`;

  it("parses and round-trips an arbitrary LIST_SECTIONS member", () => {
    const mutable = LIST_SECTIONS as Set<string>;
    mutable.add(KEY);
    try {
      const items = parseYamlSectionValues(FIXTURE, KEY)[KEY] as Record<
        string,
        unknown
      >[];
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe("a");

      items.push({ id: "c", type: "float" });
      const out = updateSectionInYaml(FIXTURE, KEY, { [KEY]: items });
      expect(out.startsWith(`${KEY}:`)).toBe(true);
      const ritems = parseYamlSectionValues(out + "\n", KEY)[KEY] as Record<
        string,
        unknown
      >[];
      expect(ritems.map((i) => i.id)).toEqual(["a", "b", "c"]);
    } finally {
      mutable.delete(KEY);
    }
  });

  it("parses as a flat mapping (no item array) when NOT a member", () => {
    const parsed = parseYamlSectionValues(FIXTURE, KEY);
    expect(parsed[KEY]).toBeUndefined();
  });
});
