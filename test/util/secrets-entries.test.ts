import { describe, expect, test } from "vitest";

import {
  addSecret,
  duplicateSecretKeys,
  groupSecretsByDevice,
  inlineSecretValue,
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

  test("a quote left open on the key's line is advanced even when the next line starts with #", () => {
    expect(parseSecretsEntries('wifi_ssid: "my\n  #network"\n')).toEqual([
      { key: "wifi_ssid", value: "", line: 0, editable: false },
    ]);
  });

  test("a scalar wrapped onto an indented continuation line is advanced", () => {
    expect(parseSecretsEntries('wifi_ssid: "my\n  network"\nother: x\n')).toEqual([
      { key: "wifi_ssid", value: "", line: 0, editable: false },
      { key: "other", value: "x", line: 2, editable: true },
    ]);
    expect(parseSecretsEntries("wifi_ssid: my\n  network\n")).toEqual([
      { key: "wifi_ssid", value: "", line: 0, editable: false },
    ]);
  });

  test("a double-quoted value is decoded and re-escaped once on write", () => {
    const yaml = 'wifi_password: "p\\"ss\\\\word"\n';
    const [entry] = parseSecretsEntries(yaml);
    expect(entry).toEqual({
      key: "wifi_password",
      value: 'p"ss\\word',
      line: 0,
      editable: true,
    });
    // The write side may spell it differently (a plain scalar is fine here), but it must parse back.
    expect(parseSecretsEntries(setSecretValue(yaml, 0, entry.value)!)[0].value).toBe(
      entry.value
    );
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
    expect(parseSecretsEntries("notakey :value\n")).toEqual([]);
  });

  test("whitespace before the colon is still a mapping", () => {
    const entries = parseSecretsEntries("wifi_ssid : home\nwifi_password\t: *pw\n");
    expect(entries).toEqual([
      { key: "wifi_ssid", value: "home", line: 0, editable: true },
      { key: "wifi_password", value: "", line: 1, editable: false },
    ]);
  });

  test("a top-level merge key surfaces as an advanced entry", () => {
    const entries = parseSecretsEntries("<<: *base\nwifi_ssid: home\n");
    expect(entries[0]).toMatchObject({ key: "<<", editable: false });
    expect(entries[1]).toMatchObject({ key: "wifi_ssid", editable: true });
  });
});

describe("inlineSecretValue", () => {
  test.each([
    ["absent key", "other: x\n", ""],
    ["bare key:", "wifi_ssid:\n", ""],
    ["comment-only value", "wifi_ssid: # set me\n", ""],
    ["plain scalar with trailing comment", "wifi_ssid: home # note\n", "home"],
    ["single-quoted", "wifi_ssid: 'it''s home'\n", "it's home"],
    ["single-quoted ending in an escaped quote", "wifi_ssid: 'abc'''\n", "abc'"],
    ["double-quoted ending in an escaped backslash", 'wifi_ssid: "abc\\\\"\n', "abc\\"],
    ["double-quoted numeric escape", 'wifi_ssid: "\\u0041b"\n', "Ab"],
    ["double-quoted with escapes", 'wifi_ssid: "p\\"ss word"\n', 'p"ss word'],
    ["hand-written boolean spelling stays text", "wifi_ssid: yes\n", "yes"],
    ["quoted key", '"wifi_ssid": home\n', "home"],
    ["whitespace before the colon", "wifi_ssid : home\n", "home"],
    ["value containing a colon", "wifi_ssid: http://host:8080\n", "http://host:8080"],
    ["key that is a colon-prefix of another line", "wifi_ssid:x: y\nwifi_ssid: z\n", "z"],
    ["double-quoted hash and backslash", 'wifi_ssid: "a # b\\\\c"\n', "a # b\\c"],
  ])("%s reads as an inline scalar", (_, yaml, expected) => {
    expect(inlineSecretValue(yaml, "wifi_ssid")).toBe(expected);
  });

  test.each([
    ["alias", "common: &pw x\nwifi_ssid: *pw\n"],
    ["anchor", "wifi_ssid: &home home\n"],
    ["tag", "wifi_ssid: !secret other\n"],
    ["block scalar", "wifi_ssid: |\n  home\n"],
    ["flow collection", "wifi_ssid: [a, b]\n"],
    ["indented block below", "wifi_ssid:\n  nested: 1\n"],
    ["merge key", "<<: *base\n"],
    ["alias behind whitespace before the colon", "wifi_ssid : *pw\n"],
    ["quoted scalar continued on the next line", 'wifi_ssid: "my\n  network"\n'],
    ["plain scalar continued on the next line", "wifi_ssid: my\n  network\n"],
    [
      "quoted scalar whose continuation looks like a comment",
      'wifi_ssid: "my\n  #network"\n',
    ],
    ["absent key beside a merge key that may supply it", "<<: *base\nother: x\n"],
    ["double-quoted with an escaped closing quote", 'wifi_ssid: "abc\\"\n'],
    ["single-quoted ending in a doubled-quote escape", "wifi_ssid: 'abc''\n"],
    ["double-quoted with an escape the decoder can't round-trip", 'wifi_ssid: "a\\ab"\n'],
    ["double-quoted with a stray inner quote", 'wifi_ssid: "a"b"\n'],
    ["double-quoted with a short numeric escape", 'wifi_ssid: "\\u12"\n'],
    ["double-quoted with an escaped line break", 'wifi_ssid: "a\\nb"\n'],
    ["double-quoted with an escaped tab", 'wifi_ssid: "a\\tb"\n'],
    ["double-quoted with a numeric control character", 'wifi_ssid: "a\\x07b"\n'],
    ["double-quoted private-use glyph", 'wifi_ssid: "a\\U000F058Fb"\n'],
    ["double-quoted lone surrogate", 'wifi_ssid: "\\uD800"\n'],
    ["double-quoted out-of-range code point", 'wifi_ssid: "\\U00110000"\n'],
  ])("%s is not inline-editable", (_, yaml) => {
    const key = yaml.startsWith("<<") ? "<<" : "wifi_ssid";
    expect(inlineSecretValue(yaml, key)).toBeNull();
  });

  test("a duplicate key is never inline-editable, whichever line is plain", () => {
    expect(
      inlineSecretValue("wifi_ssid: *pw\nwifi_ssid: plain\n", "wifi_ssid")
    ).toBeNull();
    expect(
      inlineSecretValue("wifi_ssid: first\nwifi_ssid: *pw\n", "wifi_ssid")
    ).toBeNull();
    expect(inlineSecretValue("wifi_ssid: a\nwifi_ssid: b\n", "wifi_ssid")).toBeNull();
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
    "!secret other",
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

  test("collapses hyphen and underscore spellings of the same device into one group", () => {
    const groups = groupSecretsByDevice(
      parseSecretsEntries("temp_sensor__api: a\ntemp-sensor__ota: b\n")
    );
    expect(groups.map((g) => g.device)).toEqual(["temp_sensor"]);
    expect(groups[0].entries.map((e) => e.key)).toEqual([
      "temp_sensor__api",
      "temp-sensor__ota",
    ]);
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

describe("duplicateSecretKeys", () => {
  test("reports keys defined on more than one line", () => {
    const entries = parseSecretsEntries("a: 1\nb: 2\na: 3\nc: 4\nb: 5\n");
    expect([...duplicateSecretKeys(entries)].sort()).toEqual(["a", "b"]);
  });

  test("is empty for unique keys", () => {
    expect(duplicateSecretKeys(parseSecretsEntries("a: 1\nb: 2\n")).size).toBe(0);
  });
});

describe("quoted top-level keys", () => {
  test("parse as rows keyed by the bare name, values unquoted", () => {
    const entries = parseSecretsEntries("\"wifi_password\": 'a b'\n'api_key': b\n");
    expect(entries.map((e) => [e.key, e.value, e.editable])).toEqual([
      ["wifi_password", "a b", true],
      ["api_key", "b", true],
    ]);
  });

  test("a key outside the identifier charset surfaces as a read-only row", () => {
    const [entry] = parseSecretsEntries('"wifi password": a\n');
    expect([entry.key, entry.editable]).toEqual(["wifi password", false]);
  });

  test("a quoted key duplicates its bare spelling", () => {
    const entries = parseSecretsEntries('wifi_password: a\n"wifi_password": b\n');
    expect([...duplicateSecretKeys(entries)]).toEqual(["wifi_password"]);
  });

  test("a bare merge key is read-only too", () => {
    expect(parseSecretsEntries("<<:\n")[0]).toMatchObject({ key: "<<", editable: false });
  });

  test("with an escaped quote surface read-only, name kept verbatim", () => {
    const entries = parseSecretsEntries("'wifi''s': a\n\"a\\\"b\": c\n");
    expect(entries.map((e) => [e.key, e.editable])).toEqual([
      ["wifi''s", false],
      ['a\\"b', false],
    ]);
  });

  test("single-quoted keys round-trip rewrites too", () => {
    expect(setSecretValue("'api_key': a\n", 0, "b")).toBe("'api_key': b\n");
    expect(renameSecretKey("'api_key': a\n", 0, "token")).toBe("'token': a\n");
  });

  test("may contain the other quote character", () => {
    const entries = parseSecretsEntries("\"don't\": 'a b'\n'say \"hi\"': x\n");
    // Read-only rows carry no value, per the SecretEntry contract.
    expect(entries.map((e) => [e.key, e.value, e.editable])).toEqual([
      ["don't", "", false],
      ['say "hi"', "", false],
    ]);
  });

  test("rewrites and removal target the quoted line and keep its quoting", () => {
    const yaml = '"wifi_password": a  # note\n';
    expect(setSecretValue(yaml, 0, "new")).toBe('"wifi_password": new  # note\n');
    expect(renameSecretKey(yaml, 0, "wifi_psk")).toBe('"wifi_psk": a  # note\n');
    expect(removeSecret(yaml, 0)).toBe("");
  });

  test("a comment-only value keeps its comment through a rewrite", () => {
    expect(setSecretValue("wifi_ssid: # note\n", 0, "home")).toBe(
      "wifi_ssid: home # note\n"
    );
    expect(renameSecretKey("wifi_ssid: # note\n", 0, "ssid")).toBe("ssid: # note\n");
  });

  test("mismatched quotes are not a key line", () => {
    expect(parseSecretsEntries('"wifi_password: a\n')).toEqual([]);
  });
});
