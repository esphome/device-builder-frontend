import { describe, expect, it } from "vitest";
import { parseYamlSectionValues } from "../../src/util/yaml-section-reader.js";
import { updateSectionInYaml } from "../../src/util/yaml-section-values.js";
import { YamlRawValue } from "../../src/util/yaml-serialize.js";

// A multi_conf list item whose FIRST field is a nested mapping (font.file's
// structured form). The child-indent detection used to read the item's child
// column from the nested grandchildren, mis-levelling everything: it captured
// the nested grandchildren as item-level keys and dropped the nested field
// plus every sibling (#1389 follow-up). Order-dependent, so the not-first and
// round-trip cases below guard against re-breaking either direction.

describe("parseYamlSectionValues — list item whose first field is a nested mapping", () => {
  it("captures the nested mapping plus its sibling keys (gfonts)", () => {
    const yaml = `font:
  - file:
      type: gfonts
      family: Roboto
      weight: 300
    id: my_font
    size: 20
`;
    const v = parseYamlSectionValues(yaml, "font", 2);
    expect(v.id).toBe("my_font");
    expect(v.size).toBe(20);
    expect(v.file).toEqual({ type: "gfonts", family: "Roboto", weight: 300 });
  });

  it("captures a local nested mapping (path)", () => {
    const yaml = `font:
  - file:
      type: local
      path: fonts/arial.ttf
    id: f
`;
    const v = parseYamlSectionValues(yaml, "font", 2);
    expect(v.file).toEqual({ type: "local", path: "fonts/arial.ttf" });
    expect(v.id).toBe("f");
  });

  it("captures a web nested mapping (url)", () => {
    const yaml = `font:
  - file:
      type: web
      url: https://example.com/x.ttf
    id: f
    size: 12
`;
    const v = parseYamlSectionValues(yaml, "font", 2);
    expect(v.file).toEqual({ type: "web", url: "https://example.com/x.ttf" });
    expect(v.id).toBe("f");
    expect(v.size).toBe(12);
  });

  it("handles 4-space user indentation", () => {
    const yaml = `font:
    -   file:
            type: gfonts
            family: Roboto
        id: my_font
`;
    const v = parseYamlSectionValues(yaml, "font", 2);
    expect(v.id).toBe("my_font");
    expect(v.file).toEqual({ type: "gfonts", family: "Roboto" });
  });

  it("still parses when the nested field is NOT first (regression guard)", () => {
    const yaml = `font:
  - id: my_font
    size: 20
    file:
      type: gfonts
      family: Roboto
`;
    const v = parseYamlSectionValues(yaml, "font", 2);
    expect(v.id).toBe("my_font");
    expect(v.size).toBe(20);
    expect(v.file).toEqual({ type: "gfonts", family: "Roboto" });
  });

  it("handles a sibling both before and after the nested field", () => {
    const yaml = `font:
  - id: f
    file:
      type: gfonts
      family: Roboto
    size: 18
`;
    const v = parseYamlSectionValues(yaml, "font", 2);
    expect(v).toEqual({
      id: "f",
      file: { type: "gfonts", family: "Roboto" },
      size: 18,
    });
  });
});

describe("updateSectionInYaml — list item whose first field is a nested mapping", () => {
  const START = `font:
  - file:
      type: gfonts
      family: Roboto
      weight: 300
    id: my_font
    size: 20
`;

  it("preserves the nested block when a sibling field is edited", () => {
    const values = parseYamlSectionValues(START, "font", 2);
    values.size = 24;
    const after = updateSectionInYaml(START, "font", values, 2);
    const v = parseYamlSectionValues(after, "font", 2);
    expect(v.size).toBe(24);
    expect(v.id).toBe("my_font");
    expect(v.file).toEqual({ type: "gfonts", family: "Roboto", weight: 300 });
  });

  it("round-trips an unchanged save without dropping or duplicating keys", () => {
    const values = parseYamlSectionValues(START, "font", 2);
    const after = updateSectionInYaml(START, "font", values, 2);
    const v = parseYamlSectionValues(after, "font", 2);
    expect(v).toEqual(values);
    expect(after.match(/type: gfonts/g)).toHaveLength(1);
    expect(after.match(/id: my_font/g)).toHaveLength(1);
  });

  it("writes an edited nested field back into the block", () => {
    const values = parseYamlSectionValues(START, "font", 2);
    (values.file as Record<string, unknown>).weight = 700;
    const after = updateSectionInYaml(START, "font", values, 2);
    const v = parseYamlSectionValues(after, "font", 2);
    expect((v.file as Record<string, unknown>).weight).toBe(700);
    expect((v.file as Record<string, unknown>).family).toBe("Roboto");
    expect(v.id).toBe("my_font");
  });
});

describe("parseYamlSectionValues — inline comment on the dash-line key", () => {
  it("captures the nested mapping when the dash key carries a comment", () => {
    const yaml = `font:
  - file:  # gfonts source
      type: gfonts
      family: Roboto
    id: f
`;
    const v = parseYamlSectionValues(yaml, "font", 2);
    expect(v.file).toEqual({ type: "gfonts", family: "Roboto" });
    expect(v.id).toBe("f");
  });

  it("keeps a scalar value that begins with # (no preceding space)", () => {
    // ``#`` is a comment only when preceded by whitespace, so an unspaced
    // ``#`` is part of the value, not a comment to drop.
    const yaml = `font:
  - file:#fragment
    id: f
`;
    const v = parseYamlSectionValues(yaml, "font", 2);
    expect(v.file).toBe("#fragment");
    expect(v.id).toBe("f");
  });

  it("strips a trailing comment from an inline scalar dash key", () => {
    const yaml = `font:
  - file: gfonts://Roboto  # cached locally
    id: f
`;
    const v = parseYamlSectionValues(yaml, "font", 2);
    expect(v.file).toBe("gfonts://Roboto");
    expect(v.id).toBe("f");
  });
});

// An mdns service item has scalar keys (service/protocol/port) alongside a
// nested ``txt:`` map. Under the nested-list-under-a-key path this used to
// drop the scalar siblings (nested map first) or fall back to YamlRawValue
// (nested map last/middle), and the under-covered span made the YAML grow a
// duplicate protocol/service pair on every keystroke.
describe("parseYamlSectionValues — nested-under-a-key list item with a txt map", () => {
  const expectFull = (yaml: string) => {
    const v = parseYamlSectionValues(yaml, "mdns", 1) as Record<string, unknown>;
    expect(v.services).toEqual([
      {
        service: "aioesphome._tcp.local.",
        protocol: "_tcp",
        port: 0,
        txt: { new_1: "fdfd" },
      },
    ]);
  };

  it("captures siblings when the txt map is FIRST", () => {
    expectFull(`mdns:
  services:
    - txt:
        new_1: fdfd
      service: aioesphome._tcp.local.
      protocol: _tcp
      port: 0
`);
  });

  it("captures the txt map when it is LAST", () => {
    expectFull(`mdns:
  services:
    - service: aioesphome._tcp.local.
      protocol: _tcp
      port: 0
      txt:
        new_1: fdfd
`);
  });

  it("captures the txt map when it is in the MIDDLE", () => {
    expectFull(`mdns:
  services:
    - service: aioesphome._tcp.local.
      txt:
        new_1: fdfd
      protocol: _tcp
      port: 0
`);
  });

  it("does not misread a flat sibling as nested when the dash has extra spaces", () => {
    // ``-   txt:`` (3 spaces after the dash) puts the key column past the
    // canonical ``dashIndent + 2``. With an empty ``txt:`` followed straight by
    // flat siblings, the nested-vs-sibling threshold must track the real key
    // column or ``protocol`` / ``service`` get swallowed as txt's nested map.
    const v = parseYamlSectionValues(
      `mdns:
  services:
    -   txt:
        protocol: _tcp
        service: aioesphome._tcp.local.
`,
      "mdns",
      1
    ) as Record<string, unknown>;
    expect(v.services).toEqual([
      { txt: null, protocol: "_tcp", service: "aioesphome._tcp.local." },
    ]);
  });

  it("round-trips and does not grow when one field is edited (regression)", () => {
    const yaml = `mdns:
  services:
    - service: aioesphome._tcp.local.
      protocol: _tcp
      txt:
        new_1: fdfd
`;
    const v = parseYamlSectionValues(yaml, "mdns", 1) as Record<string, unknown>;
    // Idempotent: re-emitting the parsed values reproduces the input.
    expect(updateSectionInYaml(yaml, "mdns", v, 1)).toBe(yaml);
    // Editing protocol yields exactly one protocol/service line, no growth.
    (v.services as Record<string, unknown>[])[0].protocol = "_tcpx";
    const out = updateSectionInYaml(yaml, "mdns", v, 1);
    expect((out.match(/protocol:/g) ?? []).length).toBe(1);
    expect((out.match(/service:/g) ?? []).length).toBe(1);
    expect(out).toContain("protocol: _tcpx");
  });

  it("heals an already-corrupted item once a field is edited", () => {
    const corrupt = `mdns:
  services:
    - txt:
        new_1: fdfd
      protocol: _tcpnewest
      service: aioesphome._tcp.local.
      protocol: _tcpolder
      service: aioesphome._tcp.local.
`;
    const v = parseYamlSectionValues(corrupt, "mdns", 1) as Record<string, unknown>;
    (v.services as Record<string, unknown>[])[0].protocol = "_tcp";
    const out = updateSectionInYaml(corrupt, "mdns", v, 1);
    expect(parseYamlSectionValues(out, "mdns", 1).services).toEqual([
      {
        txt: { new_1: "fdfd" },
        protocol: "_tcp",
        service: "aioesphome._tcp.local.",
      },
    ]);
  });

  it("captures every entry of a multi-key txt map", () => {
    const yaml = `mdns:
  services:
    - service: aioesphome._tcp.local.
      txt:
        new_1: fdfd
        version: "1.0"
      protocol: _tcp
`;
    expect(parseYamlSectionValues(yaml, "mdns", 1).services).toEqual([
      {
        service: "aioesphome._tcp.local.",
        txt: { new_1: "fdfd", version: "1.0" },
        protocol: "_tcp",
      },
    ]);
  });

  it("parses every item when the first leads with a txt map and a later one does not", () => {
    // childIndent is derived once from the first dash; a txt-first first item
    // must not mis-level the sibling columns of a service-first second item.
    const yaml = `mdns:
  services:
    - txt:
        new_1: fdfd
      service: a._tcp.local.
      protocol: _tcp
    - service: b._tcp.local.
      protocol: _udp
`;
    expect(parseYamlSectionValues(yaml, "mdns", 1).services).toEqual([
      { txt: { new_1: "fdfd" }, service: "a._tcp.local.", protocol: "_tcp" },
      { service: "b._tcp.local.", protocol: "_udp" },
    ]);
  });

  it("still falls back to YamlRawValue for a nested LIST (automation handler)", () => {
    const yaml = `mdns:
  services:
    - service: aioesphome._tcp.local.
      on_press:
        - logger.log: hi
`;
    const v = parseYamlSectionValues(yaml, "mdns", 1) as Record<string, unknown>;
    expect(v.services).toBeInstanceOf(YamlRawValue);
  });
});
