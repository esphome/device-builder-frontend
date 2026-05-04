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
});
