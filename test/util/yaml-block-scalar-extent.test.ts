/**
 * Block-scalar (`|-` / `!lambda |-`) body extent in the section reader.
 *
 * The expected values below were cross-checked against PyYAML 6.0.3
 * (`yaml.safe_load`, with `!lambda` mapped to its scalar): the frontend
 * must include exactly the lines PyYAML treats as the block body, so a
 * column-0 comment after the block is never swallowed into a lambda and
 * an indented `#` stays literal text. See device-builder issue: lambda
 * captured a trailing `# ...` comment.
 */
import { describe, expect, it } from "vitest";
import { parseYamlSectionValues } from "../../src/util/yaml-section-reader.js";
import { updateSectionInYaml } from "../../src/util/yaml-section-values.js";
import { YamlRawValue } from "../../src/util/yaml-serialize.js";

/** A block-scalar field value (LambdaValue or YamlRawValue) as the
 *  dedented, trailing-newline-stripped string PyYAML would produce. */
function blockText(v: unknown): string {
  if (v && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, "_lambda")) {
    return String((v as { _lambda: string })._lambda).replace(/\n+$/, "");
  }
  if (v instanceof YamlRawValue) return v.body.replace(/\n+$/, "");
  return String(v).replace(/\n+$/, "");
}

interface Case {
  name: string;
  yaml: string;
  key: string;
  from: number;
  field: string;
  /** PyYAML 6.0.3 scalar value for `field`. */
  pyyaml: string;
}

const CASES: Case[] = [
  {
    name: "trailing blanks then a column-0 comment (the bug)",
    yaml: `binary_sensor:
  - platform: template
    id: s
    lambda: |-
      return id(x) && id(y);


# Enable logging
logger:
  level: DEBUG
`,
    key: "binary_sensor.template",
    from: 2,
    field: "lambda",
    pyyaml: "return id(x) && id(y);",
  },
  {
    name: "block directly before the next top-level key",
    yaml: `sensor:
  - platform: template
    lambda: |-
      return 1;
logger:
  level: DEBUG
`,
    key: "sensor.template",
    from: 2,
    field: "lambda",
    pyyaml: "return 1;",
  },
  {
    name: "an indented # line is literal body, not a comment",
    yaml: `mqtt:
  log_format: |-
    line one
    # literal not a comment
    line two
sensor:
`,
    key: "mqtt",
    from: 1,
    field: "log_format",
    pyyaml: "line one\n# literal not a comment\nline two",
  },
  {
    name: "an interior blank line is kept",
    yaml: `sensor:
  - platform: template
    lambda: |-
      auto a = 1;

      return a;
# c
logger:
`,
    key: "sensor.template",
    from: 2,
    field: "lambda",
    pyyaml: "auto a = 1;\n\nreturn a;",
  },
  {
    name: "trailing blank at EOF",
    yaml: `binary_sensor:
  - platform: template
    lambda: |-
      return true;

`,
    key: "binary_sensor.template",
    from: 2,
    field: "lambda",
    pyyaml: "return true;",
  },
  {
    name: "deeper body lines then a less-indented sibling comment",
    yaml: `mqtt:
  log_format: |-
    a
      b
    c
  # sibling comment
  topic: t
`,
    key: "mqtt",
    from: 1,
    field: "log_format",
    pyyaml: "a\n  b\nc",
  },
  {
    name: "comment immediately after the block (no blank between)",
    yaml: `sensor:
  - platform: template
    lambda: |-
      return 1;
# c
logger:
`,
    key: "sensor.template",
    from: 2,
    field: "lambda",
    pyyaml: "return 1;",
  },
  {
    name: "4-space body indent",
    yaml: `sensor:
  - platform: template
    lambda: |-
        return 2;
# c
logger:
`,
    key: "sensor.template",
    from: 2,
    field: "lambda",
    pyyaml: "return 2;",
  },
  {
    name: "two stacked trailing comments",
    yaml: `mqtt:
  log_format: |-
    x
# one
# two
sensor:
`,
    key: "mqtt",
    from: 1,
    field: "log_format",
    pyyaml: "x",
  },
  {
    name: "trailing comment at the child indent (less than body indent)",
    yaml: `mqtt:
  log_format: |-
    x
  # one
sensor:
`,
    key: "mqtt",
    from: 1,
    field: "log_format",
    pyyaml: "x",
  },
  {
    name: "trailing comment indented between the child and body indents",
    yaml: `mqtt:
  log_format: |-
    x
   # one
sensor:
`,
    key: "mqtt",
    from: 1,
    field: "log_format",
    pyyaml: "x",
  },
  {
    name: "comment at the body indent is literal block text",
    yaml: `mqtt:
  log_format: |-
    x
    # one
sensor:
`,
    key: "mqtt",
    from: 1,
    field: "log_format",
    pyyaml: "x\n# one",
  },
];

describe("block-scalar body extent matches PyYAML 6.0.3", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const values = parseYamlSectionValues(c.yaml, c.key, c.from);
      expect(blockText(values[c.field])).toBe(c.pyyaml);
    });
  }

  it("round-trips every case byte-identically when nothing is edited", () => {
    for (const c of CASES) {
      const values = parseYamlSectionValues(c.yaml, c.key, c.from);
      expect(updateSectionInYaml(c.yaml, c.key, values, c.from)).toBe(c.yaml);
    }
  });

  it("keeps the trailing comment exactly once after editing a sibling field", () => {
    const c = CASES[0];
    const values = parseYamlSectionValues(c.yaml, c.key, c.from);
    (values as Record<string, unknown>).name = "Renamed";
    const after = updateSectionInYaml(c.yaml, c.key, values, c.from);
    expect(after.match(/# Enable logging/g)).toHaveLength(1);
    expect(after).toContain("logger:");
    // The comment did not leak into the lambda body.
    expect(blockText(parseYamlSectionValues(after, c.key, c.from).lambda)).toBe(c.pyyaml);
  });

  it("bounds a folded `>-` marker the same way (extent is marker-independent)", () => {
    // Folding is a value transform; the body extent rule is the same, so the
    // trailing comment is excluded and the block round-trips opaquely.
    const before = `mqtt:
  log_format: >-
    line one
    line two

# next
sensor:
`;
    const values = parseYamlSectionValues(before, "mqtt", 1);
    expect(blockText(values.log_format)).not.toContain("# next");
    expect(blockText(values.log_format)).toContain("line one");
    expect(updateSectionInYaml(before, "mqtt", values, 1)).toBe(before);
  });

  it("keeps both of two stacked trailing comments after an edit", () => {
    const before = `mqtt:
  log_format: |-
    x
# one
# two
sensor:
`;
    const values = parseYamlSectionValues(before, "mqtt", 1);
    (values as Record<string, unknown>).topic = "t";
    const after = updateSectionInYaml(before, "mqtt", values, 1);
    expect(after.match(/# one/g)).toHaveLength(1);
    expect(after.match(/# two/g)).toHaveLength(1);
    // Both stay after the section, before the next top-level key.
    expect(after.indexOf("# one")).toBeLessThan(after.indexOf("sensor:"));
  });
});
