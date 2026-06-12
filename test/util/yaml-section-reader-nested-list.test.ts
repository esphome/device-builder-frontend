import { describe, expect, it } from "vitest";
import { parseYamlSectionValues } from "../../src/util/yaml-section-reader.js";
import { updateSectionInYaml } from "../../src/util/yaml-section-values.js";

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
    expect(v.size).toBe("20");
    expect(v.file).toEqual({ type: "gfonts", family: "Roboto", weight: "300" });
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
    expect(v.size).toBe("12");
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
    expect(v.size).toBe("20");
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
      size: "18",
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
    values.size = "24";
    const after = updateSectionInYaml(START, "font", values, 2);
    const v = parseYamlSectionValues(after, "font", 2);
    expect(v.size).toBe("24");
    expect(v.id).toBe("my_font");
    expect(v.file).toEqual({ type: "gfonts", family: "Roboto", weight: "300" });
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
    (values.file as Record<string, unknown>).weight = "700";
    const after = updateSectionInYaml(START, "font", values, 2);
    const v = parseYamlSectionValues(after, "font", 2);
    expect((v.file as Record<string, unknown>).weight).toBe("700");
    expect((v.file as Record<string, unknown>).family).toBe("Roboto");
    expect(v.id).toBe("my_font");
  });
});
