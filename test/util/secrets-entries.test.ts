import { describe, expect, test } from "vitest";

import {
  addSecret,
  groupSecretsByDevice,
  isValidSecretKey,
  parseSecretsEntries,
  removeSecret,
  renameSecretKey,
  setSecretValue,
} from "../../src/util/secrets-entries.js";

describe("parseSecretsEntries", () => {
  test("parses simple name: value scalars as editable", () => {
    const entries = parseSecretsEntries("wifi_ssid: home\nwifi_password: hunter2\n");
    expect(entries).toEqual([
      { key: "wifi_ssid", value: "home", line: 0, editable: true },
      { key: "wifi_password", value: "hunter2", line: 1, editable: true },
    ]);
  });

  test("strips quotes from the display value", () => {
    const entries = parseSecretsEntries("api_key: \"a b c\"\nother: 'x'\n");
    expect(entries[0].value).toBe("a b c");
    expect(entries[1].value).toBe("x");
    expect(entries.every((e) => e.editable)).toBe(true);
  });

  test("ignores a trailing inline comment in the value", () => {
    const [entry] = parseSecretsEntries("wifi_ssid: home # primary AP\n");
    expect(entry.value).toBe("home");
    expect(entry.editable).toBe(true);
  });

  test("a bare key with no value is an editable empty scalar", () => {
    const [entry] = parseSecretsEntries("wifi_password:\n");
    expect(entry).toMatchObject({ key: "wifi_password", value: "", editable: true });
  });

  test("tagged values are advanced (read-only)", () => {
    const entries = parseSecretsEntries(
      "ssid: !secret real_ssid\nca: !include ca.yaml\n"
    );
    expect(entries.map((e) => e.editable)).toEqual([false, false]);
  });

  test("anchors, block scalars and flow collections are advanced", () => {
    const entries = parseSecretsEntries(
      "anchor: &a value\nblock: |\n  multi\n  line\nflow: [a, b]\n"
    );
    expect(entries.map((e) => [e.key, e.editable])).toEqual([
      ["anchor", false],
      ["block", false],
      ["flow", false],
    ]);
  });

  test("a key with a nested mapping is advanced", () => {
    const entries = parseSecretsEntries("group:\n  inner: 1\nflat: 2\n");
    expect(entries).toEqual([
      { key: "group", value: "", line: 0, editable: false },
      { key: "flat", value: "2", line: 2, editable: true },
    ]);
  });

  test("a comment-only value above an indented block is advanced", () => {
    const entries = parseSecretsEntries("group: # a note\n  inner: 1\n");
    expect(entries).toEqual([{ key: "group", value: "", line: 0, editable: false }]);
  });

  test("a comment-only value with no block is an editable empty scalar", () => {
    const entries = parseSecretsEntries("wifi_ssid: # set me\n");
    expect(entries).toEqual([{ key: "wifi_ssid", value: "", line: 0, editable: true }]);
  });

  test("comments and blank lines are skipped, not parsed as entries", () => {
    const entries = parseSecretsEntries("# header\n\nwifi_ssid: home\n");
    expect(entries).toEqual([
      { key: "wifi_ssid", value: "home", line: 2, editable: true },
    ]);
  });

  test("key:value with no space after the colon is not an entry", () => {
    expect(parseSecretsEntries("notakey:value\n")).toEqual([]);
  });

  test("a top-level merge key surfaces as an advanced entry", () => {
    const entries = parseSecretsEntries("<<: *base\nwifi_ssid: home\n");
    expect(entries[0]).toMatchObject({ key: "<<", editable: false });
    expect(entries[1]).toMatchObject({ key: "wifi_ssid", editable: true });
  });
});

describe("splice operations preserve the rest of the document", () => {
  test("setSecretValue rewrites only the value, keeping the trailing comment", () => {
    const yaml = "# header\nwifi_ssid: home # AP\nca: !include ca.yaml\n";
    const out = setSecretValue(yaml, 1, "office");
    expect(out).toBe("# header\nwifi_ssid: office # AP\nca: !include ca.yaml\n");
  });

  test("setSecretValue quotes a value that needs quoting", () => {
    const out = setSecretValue("k: v\n", 0, "a: b");
    expect(out).toBe('k: "a: b"\n');
  });

  test("renameSecretKey keeps the value and comment byte-for-byte", () => {
    const out = renameSecretKey("wifi_ssid: home # AP\n", 0, "ap_ssid");
    expect(out).toBe("ap_ssid: home # AP\n");
  });

  test("renameSecretKey leaves a bare key bare (no trailing space)", () => {
    expect(renameSecretKey("wifi_password:\n", 0, "ap_pw")).toBe("ap_pw:\n");
  });

  test("addSecret appends a new line", () => {
    expect(addSecret("wifi_ssid: home\n", "api_key", "abc")).toBe(
      "wifi_ssid: home\napi_key: abc\n"
    );
  });

  test("addSecret inserts a separator when the buffer lacks a trailing newline", () => {
    expect(addSecret("wifi_ssid: home", "api_key", "abc")).toBe(
      "wifi_ssid: home\napi_key: abc\n"
    );
  });

  test("addSecret on an empty buffer just writes the entry", () => {
    expect(addSecret("", "api_key", "abc")).toBe("api_key: abc\n");
  });

  test("removeSecret drops the line and leaves the rest intact", () => {
    const yaml = "# header\nwifi_ssid: home\nca: !include ca.yaml\n";
    expect(removeSecret(yaml, 1)).toBe("# header\nca: !include ca.yaml\n");
  });

  test("a tagged value survives an edit to a sibling row", () => {
    const yaml = "ssid: !secret real\nwifi_password: old\n";
    expect(setSecretValue(yaml, 1, "new")).toBe(
      "ssid: !secret real\nwifi_password: new\n"
    );
  });

  test("setSecretValue returns null when the line no longer holds a key", () => {
    expect(setSecretValue("# just a comment\n", 0, "x")).toBeNull();
  });

  test("renameSecretKey returns null when the line no longer holds a key", () => {
    expect(renameSecretKey("# just a comment\n", 0, "x")).toBeNull();
  });

  test("removeSecret returns null for an out-of-range index", () => {
    expect(removeSecret("wifi_ssid: home\n", 9)).toBeNull();
  });

  test("removeSecret returns null when the line isn't a top-level key", () => {
    // A stale index landing on a comment must not delete an unrelated line.
    expect(removeSecret("# header\nwifi_ssid: home\n", 0)).toBeNull();
  });

  test.each([
    "!tag",
    "&anchor",
    "*alias",
    "|block",
    ">fold",
    "[flow",
    "{flow",
    "@home",
    "%pct",
  ])(
    "a value starting with the YAML indicator %s is quoted and round-trips editable",
    (value) => {
      const out = setSecretValue("pw: x\n", 0, value)!;
      const [entry] = parseSecretsEntries(out);
      expect(entry.editable).toBe(true);
      expect(entry.value).toBe(value);
    }
  );
});

describe("groupSecretsByDevice", () => {
  test("splits shared and per-device runs by the __ prefix", () => {
    const entries = parseSecretsEntries(
      "wifi_ssid: home\nbw15__api: a\nbw15__ota: b\nfan__key: c\n"
    );
    const groups = groupSecretsByDevice(entries);
    expect(groups.map((g) => g.device)).toEqual([null, "bw15", "fan"]);
    expect(groups[1].entries.map((e) => e.key)).toEqual(["bw15__api", "bw15__ota"]);
  });

  test("a leading __ has no device prefix and stays shared", () => {
    const groups = groupSecretsByDevice(parseSecretsEntries("__weird: 1\n"));
    expect(groups).toHaveLength(1);
    expect(groups[0].device).toBeNull();
  });

  test("the shared run sorts ahead of device runs even when it appears later", () => {
    const groups = groupSecretsByDevice(
      parseSecretsEntries("bw15__api: a\nwifi_ssid: home\n")
    );
    expect(groups.map((g) => g.device)).toEqual([null, "bw15"]);
  });
});

describe("isValidSecretKey", () => {
  test("accepts identifier-like keys", () => {
    expect(isValidSecretKey("wifi_ssid")).toBe(true);
    expect(isValidSecretKey("api.key-1")).toBe(true);
  });

  test("rejects empty, spaced, or symbol-led keys", () => {
    expect(isValidSecretKey("")).toBe(false);
    expect(isValidSecretKey("has space")).toBe(false);
    expect(isValidSecretKey("1leading")).toBe(false);
    expect(isValidSecretKey("<<")).toBe(false);
  });
});
