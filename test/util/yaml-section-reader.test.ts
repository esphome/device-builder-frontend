/**
 * Pins the shared direct-child line scan: last-key-wins among direct
 * children, deeper keys ignored, sibling list items stop the scan, and a
 * list item's inline dash key counting as a direct child when scanning
 * from that item.
 */
import { describe, expect, it } from "vitest";

import {
  findDirectChildLine,
  isSectionRemoved,
} from "../../src/util/yaml-section-reader.js";

const lines = (yaml: string) => yaml.split("\n");
const PASSWORD_RE = /^password\s*:/;

describe("findDirectChildLine", () => {
  it("returns the last direct child matching the key", () => {
    const doc = lines(
      "ota:\n  - platform: esphome\n    password: a\n    port: 1\n    password: b\n"
    );
    expect(findDirectChildLine(doc, "ota", PASSWORD_RE, 2)).toBe(4);
  });

  it("ignores deeper keys and stops at a sibling item", () => {
    const doc = lines(
      "ota:\n  - platform: esphome\n    encryption:\n      password: nested\n  - platform: web_server\n    password: sibling\n"
    );
    expect(findDirectChildLine(doc, "ota", PASSWORD_RE, 2)).toBe(-1);
  });

  it("counts an inline key on the item's own dash when scanning from that item", () => {
    const doc = lines("ota:\n  - password: x\n    platform: esphome\n");
    expect(findDirectChildLine(doc, "ota", PASSWORD_RE, 2)).toBe(1);
  });

  it("prefers a later child line over the dash key, per last-key-wins", () => {
    const doc = lines("ota:\n  - password: x\n    platform: esphome\n    password: y\n");
    expect(findDirectChildLine(doc, "ota", PASSWORD_RE, 2)).toBe(3);
  });

  // Documents the gate rather than guarding it: a column-0 scan starts on the
  // `ota:` header, so the dash branch is unreachable for this input.
  it("never reports a dash line for a column-0 section scan", () => {
    const doc = lines("- password: x\nota:\n  - platform: esphome\n");
    expect(findDirectChildLine(doc, "ota", PASSWORD_RE)).toBe(-1);
    expect(
      findDirectChildLine(lines("esphome:\n  name: kit\n"), "esphome", /^name\s*:/)
    ).toBe(1);
  });

  it("returns -1 when the section is absent", () => {
    expect(findDirectChildLine(lines("wifi:\n  ssid: x\n"), "ota", PASSWORD_RE)).toBe(-1);
  });
});

describe("isSectionRemoved", () => {
  it("detects a top-level `key: !remove`", () => {
    const doc = lines("wifi:\n  ssid: x\nweb_server: !remove\napi:\n");
    expect(isSectionRemoved(doc, "web_server")).toBe(true);
    expect(isSectionRemoved(doc, "web_server", 3)).toBe(true);
    expect(isSectionRemoved(doc, "wifi", 1)).toBe(false);
  });

  it("allows a trailing comment after the tag", () => {
    expect(isSectionRemoved(lines("api: !remove  # not needed\n"), "api", 1)).toBe(true);
  });

  it("ignores a nested `!remove` child", () => {
    const doc = lines("wifi:\n  ssid: x\n  ap: !remove\n");
    expect(isSectionRemoved(doc, "wifi", 1)).toBe(false);
  });

  it("detects a list item removed by `id: !remove`", () => {
    const doc = lines("ota:\n  - platform: esphome\n    id: !remove my_ota\n  - id: x\n");
    expect(isSectionRemoved(doc, "ota", 2)).toBe(true);
    expect(isSectionRemoved(doc, "ota", 4)).toBe(false);
    expect(isSectionRemoved(lines("ota:\n  - id: !remove my_ota\n"), "ota", 2)).toBe(
      true
    );
  });

  it("returns false for a missing section", () => {
    expect(isSectionRemoved(lines("api:\n"), "web_server")).toBe(false);
  });
});
