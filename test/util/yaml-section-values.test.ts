import { describe, expect, it } from "vitest";
import {
  findSectionStart,
  LIST_ITEM_START_RE,
  parseYamlSectionValues,
  removeSectionFromYaml,
  updateSectionInYaml,
} from "../../src/util/yaml-section-values.js";

/** 1-indexed line of the *n*th (1-based) list-item dash following
 *  `parent:` in `yaml`. Section-editor callers pass that line as
 *  `fromLine`; resolving it here keeps tests robust to layout
 *  edits. Reuses the parser's `LIST_ITEM_START_RE` directly so
 *  a future tightening there can't silently let the test helper
 *  drift to a different definition of "list item". */
function nthListItemLine(
  yaml: string,
  parent: string,
  n: number,
): number {
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
    expect(() => nthListItemLine(yaml, "ota", 1)).toThrow(
      /section ota: not found/,
    );
  });

  it("throws when there are fewer dashes than requested", () => {
    const yaml = "ota:\n  - platform: esphome\n";
    expect(() => nthListItemLine(yaml, "ota", 2)).toThrow(
      /fewer than 2 list-item dashes/,
    );
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
    expect(
      (Object.prototype as { polluted?: unknown }).polluted,
    ).toBeUndefined();
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
      fromLine,
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
      fromLine,
    );
    expect(after).not.toContain("- platform: esphome");
    expect(after).toContain("password: secret");
    expect(after).toMatch(/^\s+-\s*$/m);

    // Round-trip: the bare-`-` shape parses back to the same
    // values the form holds (minus the null, which the
    // serializer drops).
    const afterFromLine = firstListItemLine(after, "ota");
    const reparsed = parseYamlSectionValues(
      after,
      "ota.esphome",
      afterFromLine,
    );
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
        2,
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
    const after = updateSectionInYaml(
      before,
      "wrap.constructor",
      formValues,
      fromLine,
    );
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
      nthListItemLine(multiItemOta, "ota", 2),
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
