import { describe, expect, it } from "vitest";

import {
  hasSubstitutionReference,
  isSubstitutionString,
  looksLikeSubstitution,
  parseSubstitutions,
  resolveSubstitutions,
} from "../../src/util/substitutions.js";

describe("parseSubstitutions", () => {
  it("reads the top-level substitutions block into a map", () => {
    const yaml = [
      "substitutions:",
      "  upper_devicename: Driveway Gate",
      "  close_duration: 34.1sec",
      "esphome:",
      "  name: x",
    ].join("\n");
    const subs = parseSubstitutions(yaml);
    expect(subs.get("upper_devicename")).toBe("Driveway Gate");
    expect(subs.get("close_duration")).toBe("34.1sec");
  });

  it("returns an empty map when there is no block", () => {
    expect(parseSubstitutions("esphome:\n  name: x\n").size).toBe(0);
  });

  it("keeps scalars as their raw string, not YAML-coerced", () => {
    const subs = parseSubstitutions(
      "substitutions:\n  count: 5\n  enabled: yes\n  flag: false\n"
    );
    expect(subs.get("count")).toBe("5");
    // ESPHome treats these as raw strings, not booleans.
    expect(subs.get("enabled")).toBe("yes");
    expect(subs.get("flag")).toBe("false");
  });

  it("strips surrounding quotes and inline comments", () => {
    const subs = parseSubstitutions(
      'substitutions:\n  a: "Driveway Gate"  # the name\n  b: plain  # note\n'
    );
    expect(subs.get("a")).toBe("Driveway Gate");
    expect(subs.get("b")).toBe("plain");
  });

  it("ends the block at the next top-level key", () => {
    const subs = parseSubstitutions(
      "substitutions:\n  a: one\nesphome:\n  name: not_a_sub\n"
    );
    expect(subs.get("a")).toBe("one");
    expect(subs.has("name")).toBe(false);
  });
});

describe("resolveSubstitutions", () => {
  const subs = new Map([
    ["upper_devicename", "Driveway Gate"],
    ["id_prefix", "driveway_gate"],
  ]);

  it("expands ${var} references", () => {
    expect(resolveSubstitutions("${upper_devicename} Moving", subs)).toBe(
      "Driveway Gate Moving"
    );
  });

  it("expands a bare $var reference", () => {
    expect(resolveSubstitutions("$id_prefix", subs)).toBe("driveway_gate");
  });

  it("leaves an unknown reference literal", () => {
    expect(resolveSubstitutions("${nope} Moving", subs)).toBe("${nope} Moving");
  });

  it("resolves a substitution whose value references another", () => {
    const chain = new Map([
      ["a", "${b}"],
      ["b", "done"],
    ]);
    expect(resolveSubstitutions("${a}", chain)).toBe("done");
  });

  it("passes text with no references through unchanged", () => {
    expect(resolveSubstitutions("plain text", subs)).toBe("plain text");
  });

  it("passes through when the map is empty or undefined", () => {
    expect(resolveSubstitutions("${upper_devicename}", new Map())).toBe(
      "${upper_devicename}"
    );
    expect(resolveSubstitutions("${upper_devicename}", undefined)).toBe(
      "${upper_devicename}"
    );
  });

  it("does not treat a literal like $5.00 as a reference", () => {
    expect(resolveSubstitutions("costs $5.00", subs)).toBe("costs $5.00");
  });
});

describe("hasSubstitutionReference", () => {
  it("detects ${var} and bare $var references", () => {
    expect(hasSubstitutionReference("${upper_devicename} Moving")).toBe(true);
    expect(hasSubstitutionReference("$id_prefix")).toBe(true);
  });

  it("is false for plain text and dollar amounts", () => {
    expect(hasSubstitutionReference("Front Door")).toBe(false);
    expect(hasSubstitutionReference("costs $5.00")).toBe(false);
  });
});

describe("looksLikeSubstitution", () => {
  it("matches complete and mid-edit references", () => {
    expect(looksLikeSubstitution("${voltage_div}")).toBe(true);
    expect(looksLikeSubstitution("${voltage_div")).toBe(true); // brace deleted
    expect(looksLikeSubstitution("${")).toBe(true);
    expect(looksLikeSubstitution("$var")).toBe(true);
    expect(looksLikeSubstitution("a ${x} b")).toBe(true);
    // Agrees with hasSubstitutionReference: the inner ${x} still counts.
    expect(looksLikeSubstitution("$${x}")).toBe(true);
  });

  it("excludes a stray mid-string $ and $$ literals (#773 review)", () => {
    expect(looksLikeSubstitution("$$5")).toBe(false); // no { or letter after a $
    expect(looksLikeSubstitution("12$34")).toBe(false);
    expect(looksLikeSubstitution("5$")).toBe(false);
    expect(looksLikeSubstitution("$5.00")).toBe(false);
    expect(looksLikeSubstitution("0.05")).toBe(false);
  });
});

describe("isSubstitutionString", () => {
  it("narrows to substitution-looking strings only", () => {
    expect(isSubstitutionString("${var}")).toBe(true);
    expect(isSubstitutionString("${mid-edit")).toBe(true);
    expect(isSubstitutionString("GPIO5")).toBe(false);
    expect(isSubstitutionString(5)).toBe(false);
    expect(isSubstitutionString(undefined)).toBe(false);
    expect(isSubstitutionString({ number: "${var}" })).toBe(false);
  });
});
