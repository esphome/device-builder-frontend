import { describe, expect, it } from "vitest";
import { parseYamlSectionValues } from "../../src/util/yaml-section-reader.js";
import {
  appendSectionToYaml,
  removeSectionFromYaml,
  updateSectionInYaml,
} from "../../src/util/yaml-section-values.js";
import { parseYamlTopLevelSections } from "../../src/util/yaml-sections-core.js";

const crlf = (...lines: string[]): string => lines.join("\r\n") + "\r\n";

describe("CRLF documents (#1601)", () => {
  it("parseYamlSectionValues reads every key from a CRLF document", () => {
    const yaml = crlf("wifi:", "  ssid: net", "  password: hunter2", "sensor:");
    expect(parseYamlSectionValues(yaml, "wifi")).toEqual({
      ssid: "net",
      password: "hunter2",
    });
  });

  it("updateSectionInYaml keeps untouched keys and emits CRLF throughout", () => {
    const out = updateSectionInYaml("wifi:\r\n  ssid: net\r\n", "wifi", {
      ssid: "net",
      use_address: "10.0.0.9",
    });
    expect(out).toBe(crlf("wifi:", "  ssid: net", "  use_address: 10.0.0.9"));
  });

  it("updateSectionInYaml round-trips unchanged values byte-identically", () => {
    const yaml = crlf(
      "wifi:",
      '  ssid: "quoted net"  # keep me',
      "  password: hunter2",
      "sensor:",
      "  - platform: dht"
    );
    const out = updateSectionInYaml(yaml, "wifi", parseYamlSectionValues(yaml, "wifi"));
    expect(out).toBe(yaml);
  });

  it("updateSectionInYaml preserves untouched-line byte layout on a real change", () => {
    const yaml = crlf(
      "wifi:",
      '  ssid: "quoted net"  # keep me',
      "  password: hunter2",
      "sensor:"
    );
    const out = updateSectionInYaml(yaml, "wifi", {
      ssid: "quoted net",
      password: "swordfish",
    });
    expect(out).toBe(
      crlf("wifi:", '  ssid: "quoted net"  # keep me', "  password: swordfish", "sensor:")
    );
  });

  it("removeSectionFromYaml drops the section and keeps CRLF elsewhere", () => {
    const yaml = crlf("wifi:", "  ssid: net", "sensor:", "  - platform: dht");
    expect(removeSectionFromYaml(yaml, "wifi")).toBe(
      crlf("sensor:", "  - platform: dht")
    );
  });

  it("appendSectionToYaml emits the new block with the document's ending", () => {
    const yaml = crlf("esphome:", "  name: x");
    expect(appendSectionToYaml(yaml, "wifi", { ssid: "net" })).toBe(
      crlf("esphome:", "  name: x", "", "wifi:", "  ssid: net")
    );
  });

  it("a mostly-LF document normalizes the stray CRLF line to LF", () => {
    const out = updateSectionInYaml("wifi:\n  ssid: net\r\nsensor:\n  id: s\n", "wifi", {
      ssid: "net",
      use_address: "10.0.0.9",
    });
    expect(out).toBe("wifi:\n  ssid: net\n  use_address: 10.0.0.9\nsensor:\n  id: s\n");
  });

  it("a mostly-CRLF document normalizes the stray LF line to CRLF", () => {
    const out = updateSectionInYaml(
      "wifi:\r\n  ssid: net\nsensor:\r\n  id: s\r\n",
      "wifi",
      { ssid: "net", use_address: "10.0.0.9" }
    );
    expect(out).toBe(
      crlf("wifi:", "  ssid: net", "  use_address: 10.0.0.9", "sensor:", "  id: s")
    );
  });

  it("updateSectionInYaml on a CRLF list item keeps the inline key single", () => {
    const yaml = crlf("sensor:", "  - platform: dht", "    pin: D1");
    const out = updateSectionInYaml(yaml, "sensor", { platform: "dht", pin: "D2" }, 2);
    expect(out).toBe(crlf("sensor:", "  - platform: dht", "    pin: D2"));
  });

  it("updateSectionInYaml on a CRLF globals block keeps every entry", () => {
    const yaml = crlf("globals:", "  - id: my_int", "    type: int");
    const items = parseYamlSectionValues(yaml, "globals").globals as Record<
      string,
      unknown
    >[];
    expect(items).toHaveLength(1);
    const out = updateSectionInYaml(yaml, "globals", { globals: items });
    expect(out).toBe(yaml);
  });

  it("updateSectionInYaml keeps a CRLF block-scalar body byte-for-byte", () => {
    const yaml = crlf(
      "wifi:",
      "  ssid: net",
      "  certificate: |-",
      "    AAA",
      "    BBB",
      "sensor:"
    );
    const out = updateSectionInYaml(yaml, "wifi", {
      ...parseYamlSectionValues(yaml, "wifi"),
      ssid: "other",
    });
    expect(out).toBe(
      crlf("wifi:", "  ssid: other", "  certificate: |-", "    AAA", "    BBB", "sensor:")
    );
  });

  it("an LF document stays LF", () => {
    const out = updateSectionInYaml("wifi:\n  ssid: net\n", "wifi", {
      ssid: "net",
      use_address: "10.0.0.9",
    });
    expect(out).toBe("wifi:\n  ssid: net\n  use_address: 10.0.0.9\n");
  });

  it("parseYamlTopLevelSections reads names from a CRLF document", () => {
    const yaml = crlf("sensor:", "  - platform: dht", '    name: "Kitchen Temp"');
    const sections = parseYamlTopLevelSections(yaml);
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("Kitchen Temp");
    expect(sections[0].platform).toBe("dht");
  });
});
