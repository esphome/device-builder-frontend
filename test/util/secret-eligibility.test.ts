import { describe, expect, it } from "vitest";
import {
  isSecretEligible,
  recommendedSecretKeys,
  secretValueFromYaml,
  withoutForeignDeviceSecrets,
} from "../../src/util/secret-eligibility.js";
import { formatYamlScalar } from "../../src/util/yaml-serialize.js";

describe("secret-eligibility", () => {
  it("flags the two WiFi credential fields", () => {
    expect(isSecretEligible("wifi", "ssid")).toBe(true);
    expect(isSecretEligible("wifi", "password")).toBe(true);
  });

  it("rejects fields outside the allowlist", () => {
    expect(isSecretEligible("wifi", "output_power")).toBe(false);
    expect(isSecretEligible("sensor", "ssid")).toBe(false);
    expect(isSecretEligible("", "")).toBe(false);
  });
});

describe("recommendedSecretKeys", () => {
  it("recommends the shared keys for WiFi regardless of hostname", () => {
    expect(recommendedSecretKeys("wifi", "ssid", "kitchen", false)).toEqual([
      "wifi_ssid",
    ]);
    expect(recommendedSecretKeys("wifi", "password", "", true)).toEqual([
      "wifi_password",
    ]);
  });

  it("scopes per-device credentials to the hostname, double-underscore first", () => {
    // `__` separator preferred; single-`_` kept for back-compat.
    expect(recommendedSecretKeys("ota", "password", "kitchen", true)).toEqual([
      "kitchen__ota_password",
      "kitchen_ota_password",
    ]);
    expect(recommendedSecretKeys("api", "key", "kitchen", true)).toEqual([
      "kitchen__encryption_key",
      "kitchen_encryption_key",
    ]);
  });

  it("keeps a real underscore in the hostname unambiguous via the __ join", () => {
    expect(recommendedSecretKeys("ota", "password", "my_device", true)).toEqual([
      "my_device__ota_password",
      "my_device_ota_password",
    ]);
  });

  it("falls back to <hostname>__<section>_<key> for other concealed fields", () => {
    expect(recommendedSecretKeys("mqtt", "password", "Living Room", true)).toEqual([
      "living_room__mqtt_password",
      "living_room_mqtt_password",
    ]);
  });

  it("recommends nothing for a per-device field without a hostname", () => {
    expect(recommendedSecretKeys("ota", "password", "", true)).toEqual([]);
  });

  it("recommends nothing for a non-concealed unknown field", () => {
    expect(recommendedSecretKeys("sensor", "name", "kitchen", false)).toEqual([]);
  });
});

describe("withoutForeignDeviceSecrets", () => {
  const keys = [
    "kitchen__encryption_key",
    "porch__encryption_key",
    "bw15__ota_password",
    "wifi_ssid",
    "wifi_password",
    "j",
  ];
  const devices = ["kitchen", "porch", "bw15"];

  it("hides other devices' per-device secrets, keeps this device's + shared", () => {
    expect(withoutForeignDeviceSecrets(keys, "kitchen", devices)).toEqual([
      "kitchen__encryption_key",
      "wifi_ssid",
      "wifi_password",
      "j",
    ]);
  });

  it("slugs the hostname so a hyphenated name matches its secret prefix", () => {
    expect(
      withoutForeignDeviceSecrets(
        ["apollo_r_pro_1_eth_5938e0__encryption_key", "kitchen__encryption_key"],
        "apollo-r-pro-1-eth-5938e0",
        ["apollo-r-pro-1-eth-5938e0", "kitchen"]
      )
    ).toEqual(["apollo_r_pro_1_eth_5938e0__encryption_key"]);
  });

  it("keeps everything when there are no other devices", () => {
    expect(withoutForeignDeviceSecrets(keys, "kitchen", ["kitchen"])).toEqual(keys);
  });

  it("does not filter when the current hostname is unresolved (empty)", () => {
    // Before the device name resolves, hiding all <host>__ keys would blank out
    // the current device's own secrets — so return everything unfiltered.
    expect(withoutForeignDeviceSecrets(keys, "", devices)).toEqual(keys);
  });

  it("keeps a __ secret whose prefix isn't a known device", () => {
    expect(withoutForeignDeviceSecrets(["myapp__token"], "kitchen", devices)).toEqual([
      "myapp__token",
    ]);
  });
});

describe("secretValueFromYaml", () => {
  const secrets = [
    "# secrets",
    'wifi_ssid: "my ssid"',
    "ota_password: plainpw",
    "kitchen__encryption_key: abc123==",
  ].join("\n");

  it("reads a quoted value", () => {
    expect(secretValueFromYaml(secrets, "wifi_ssid")).toBe("my ssid");
  });

  it("reads an unquoted value", () => {
    expect(secretValueFromYaml(secrets, "ota_password")).toBe("plainpw");
    expect(secretValueFromYaml(secrets, "kitchen__encryption_key")).toBe("abc123==");
  });

  it("returns null when the key is absent", () => {
    expect(secretValueFromYaml(secrets, "nope")).toBeNull();
  });

  it("reads a value that itself contains a colon", () => {
    expect(secretValueFromYaml("endpoint: http://host:8080", "endpoint")).toBe(
      "http://host:8080"
    );
  });

  it("doesn't mis-match a key whose first colon isn't the separator", () => {
    // `wifi:ssid:` is a single key; searching `wifi` must find the real
    // top-level `wifi:` entry, not the colon-prefix of the other line.
    expect(secretValueFromYaml("wifi:ssid: x\nwifi: y", "wifi")).toBe("y");
  });

  it("keeps a hand-written boolean spelling as an opaque string", () => {
    // A secret is an opaque string — `ota_pw: yes` must not coerce to "true".
    expect(secretValueFromYaml("ota_pw: yes", "ota_pw")).toBe("yes");
    expect(secretValueFromYaml("ota_pw: off", "ota_pw")).toBe("off");
  });

  it("strips single quotes and the '' escape without type coercion", () => {
    expect(secretValueFromYaml("k: 'it''s a secret'", "k")).toBe("it's a secret");
    expect(secretValueFromYaml("k: 'no'", "k")).toBe("no");
  });

  it("unescapes a double-quoted value (inverts formatYamlScalar)", () => {
    expect(secretValueFromYaml('k: "pa\\"ss "', "k")).toBe('pa"ss ');
    expect(secretValueFromYaml('k: "a:b\\\\c"', "k")).toBe("a:b\\c");
    expect(secretValueFromYaml('k: "a # b"', "k")).toBe("a # b");
  });

  it("round-trips values that need quoting and contain quotes/backslashes", () => {
    // The migrate write (formatYamlScalar) and the manual-revert read
    // (secretValueFromYaml) must be inverses, or a credential corrupts silently.
    for (const value of ['pa"ss ', "a:b\\c", 'a:"b', "  spaced  ", "a # b", "x:y"]) {
      const line = `k: ${formatYamlScalar(value)}`;
      expect(secretValueFromYaml(line, "k")).toBe(value);
    }
  });
});
