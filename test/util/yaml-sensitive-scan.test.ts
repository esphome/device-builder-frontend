import { describe, expect, it } from "vitest";
import { findSensitiveValueRanges } from "../../src/util/yaml-sensitive-scan.js";

// Helper: extract the substring of `yaml` that the range covers, so
// assertions read as "the value the editor would mask is X" rather
// than chasing column numbers.
function valuesAt(yaml: string, ranges: ReturnType<typeof findSensitiveValueRanges>) {
  const lines = yaml.split("\n");
  return ranges.map((r) => lines[r.line - 1].slice(r.valueFrom, r.valueTo));
}

describe("findSensitiveValueRanges", () => {
  it("returns empty for empty input", () => {
    expect(findSensitiveValueRanges("")).toEqual([]);
  });

  it("returns empty when no sensitive keys present", () => {
    const yaml = `esphome:
  name: living-room
wifi:
  ssid: my-network
`;
    expect(findSensitiveValueRanges(yaml)).toEqual([]);
  });

  it("masks plain `password:` values regardless of parent", () => {
    const yaml = `api:
  password: hunter2
ota:
  - platform: esphome
    password: "ota-secret"
mqtt:
  password: 'mq-secret'
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual([
      "hunter2",
      `"ota-secret"`,
      `'mq-secret'`,
    ]);
  });

  it("masks ap_password and ota_password", () => {
    const yaml = `wifi:
  ap_password: ap-secret
ota_password: top-level
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual(["ap-secret", "top-level"]);
  });

  it("masks psk values", () => {
    const yaml = `wifi:
  networks:
    - ssid: home
      psk: my-psk-value
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual(["my-psk-value"]);
  });

  it("masks api.encryption.key but not bare `key:` elsewhere", () => {
    const yaml = `api:
  encryption:
    key: "noise-key-value"
remote_receiver:
  - platform: rc_switch
    on_code:
      - then:
          - logger.log: "got"
        key: 1234
`;
    const ranges = findSensitiveValueRanges(yaml);
    // Only the api.encryption.key value is sensitive — the
    // remote_receiver `key:` is a button code, not a credential.
    expect(valuesAt(yaml, ranges)).toEqual([`"noise-key-value"`]);
  });

  it("does not mask !secret references", () => {
    const yaml = `api:
  password: !secret api_password
ota:
  password: !secret ota_password
`;
    expect(findSensitiveValueRanges(yaml)).toEqual([]);
  });

  it("strips trailing comments from the masked range", () => {
    const yaml = `api:
  password: hunter2  # set in deploy
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual(["hunter2"]);
  });

  it("ignores key-only lines with no inline value", () => {
    // `password:` with nothing after it (or just a comment) has no
    // value to mask on this line; mapping/block-scalar children would
    // be on subsequent lines.
    const yaml = `api:
  password:
  encryption:
    key:
`;
    expect(findSensitiveValueRanges(yaml)).toEqual([]);
  });

  it("correctly identifies parent across deeper nesting", () => {
    // `key:` at indent 6 has `encryption:` (indent 4) as its direct
    // parent — even though `api:` (indent 2) sits between them in
    // the indent stack we still want to mask the value.
    const yaml = `wifi:
  ssid: home
api:
  encryption:
    key: noise123
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual(["noise123"]);
  });

  it("returns 1-indexed line numbers matching CodeMirror convention", () => {
    const yaml = `# header line
api:
  password: hunter2
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].line).toBe(3);
  });

  it("masks block-scalar bodies (literal `|`)", () => {
    // The credential lives on the indented continuation lines, not
    // the `password: |` header. Without this, the body would render
    // as plain text right next to the masked-empty header glyph.
    const yaml = `api:
  password: |
    line-one-secret
    line-two-secret
mqtt:
  password: hunter2
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual([
      "line-one-secret",
      "line-two-secret",
      "hunter2",
    ]);
  });

  it("masks block-scalar bodies (folded `>`) with chomping indicator", () => {
    const yaml = `api:
  password: >-
    folded
    secret
ota:
  password: ok
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual(["folded", "secret", "ok"]);
  });

  it("does not misinterpret block-scalar contents as YAML keys", () => {
    // `secret: foo` inside a block scalar is part of the credential,
    // not a child key — masking it would mean the outer-loop key
    // tracker tried to interpret it. Verify only the body lines get
    // masked, and a sibling key after the block is still scanned.
    const yaml = `api:
  password: |
    secret: not-a-key
    other-line
  encryption:
    key: real-noise-key
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual([
      "secret: not-a-key",
      "other-line",
      "real-noise-key",
    ]);
  });

  it("preserves leading indentation on block-scalar lines (only value masked)", () => {
    const yaml = `api:
  password: |
    indented-secret
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(ranges).toHaveLength(1);
    // Range should start at the first non-whitespace character so the
    // editor's indentation guides remain visible.
    expect(ranges[0].valueFrom).toBe(4);
    expect(ranges[0].valueTo).toBe(4 + "indented-secret".length);
  });

  it("does not treat `#` inside a quoted value as a comment", () => {
    const yaml = `api:
  password: "abc # def"
ota:
  password: 'has # hash'
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual([`"abc # def"`, `'has # hash'`]);
  });

  it("strips a real trailing comment after a quoted value", () => {
    const yaml = `api:
  password: "abc # def" # the real comment
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual([`"abc # def"`]);
  });

  it("handles escaped quotes in double- and single-quoted values", () => {
    const yaml = `api:
  password: "with \\"escaped\\" inside"
ota:
  password: 'don''t # quote'
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual([
      `"with \\"escaped\\" inside"`,
      `'don''t # quote'`,
    ]);
  });

  it("does NOT mask `key:` under `api:` (only under `encryption:`)", () => {
    // Defensive test: if someone broadens PARENT_SCOPED_SENSITIVE_KEYS
    // accidentally, this catches it. `key:` is too generic to mask
    // by parent name alone.
    const yaml = `api:
  key: not-a-credential
`;
    expect(findSensitiveValueRanges(yaml)).toEqual([]);
  });

  it("does NOT mask a top-level bare `key:`", () => {
    const yaml = `key: not-a-credential
`;
    expect(findSensitiveValueRanges(yaml)).toEqual([]);
  });

  it("block-scalar in a list item terminates at sibling keys in the same item", () => {
    // Regression for a list-item header `- password: |`: the block must
    // end at the next sibling key (`other:`), not consume it. The
    // sibling lives at `leading + dash` columns, so the terminator
    // must use the effective indent — leading-only would let the
    // sibling slip through as block content.
    const yaml = `ota:
  - platform: esphome
    password: |
      line-one
      line-two
    other: visible-sibling
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual(["line-one", "line-two"]);
    // Explicitly assert `visible-sibling` was not masked.
    expect(ranges.every((r) => r.line !== 6)).toBe(true);
  });

  it("recognises closing `\"` after an even number of backslashes", () => {
    // `\\` is an escaped backslash; the `"` that follows is the real
    // close of the scalar. A naive "preceded by `\\`?" check would
    // run past it and lose the trailing comment-strip step.
    const line = `  password: "ends with \\\\" # real comment`;
    const yaml = `api:\n${line}\n`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual([`"ends with \\\\"`]);
  });

  it("treats `\"` after an odd number of backslashes as escaped", () => {
    // `\"` is an escaped quote inside the scalar; the next real `"`
    // closes it.
    const yaml = `api:
  password: "with \\"escaped\\" inside" # comment
`;
    const ranges = findSensitiveValueRanges(yaml);
    expect(valuesAt(yaml, ranges)).toEqual([
      `"with \\"escaped\\" inside"`,
    ]);
  });
});
