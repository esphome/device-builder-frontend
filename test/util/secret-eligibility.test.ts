import { describe, expect, it } from "vitest";
import {
  isSecretEligible,
  isSharedSecret,
  recommendedSecretKeys,
  secretValueFromYaml,
  visibleSecretKeys,
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
    // `__` separator preferred; single-`_` kept for back-compat. The OTA key is
    // keyed by the `ota.esphome` sectionKey the picker passes (matching the
    // security notice's generated `<host>__ota_password`).
    expect(recommendedSecretKeys("ota.esphome", "password", "kitchen", true)).toEqual([
      "kitchen__ota_password",
      "kitchen_ota_password",
    ]);
    expect(recommendedSecretKeys("api", "key", "kitchen", true)).toEqual([
      "kitchen__encryption_key",
      "kitchen_encryption_key",
    ]);
    expect(recommendedSecretKeys("web_server", "password", "kitchen", true)).toEqual([
      "kitchen__web_password",
      "kitchen_web_password",
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

  it("scopes the nested AP credentials by path, not the shared wifi_* keys", () => {
    // `wifi.ap.{ssid,password}` share their leaf with the STA `wifi.{ssid,password}`;
    // the dotted path disambiguates so each AP field gets its own scoped key
    // instead of pointing at the home-network secret.
    expect(
      recommendedSecretKeys("wifi", "password", "kitchen", true, ["ap", "password"])
    ).toEqual(["kitchen__ap_password", "kitchen_ap_password"]);
    expect(
      recommendedSecretKeys("wifi", "ssid", "kitchen", false, ["ap", "ssid"])
    ).toEqual(["kitchen__ap_ssid", "kitchen_ap_ssid"]);
  });

  it("still resolves the STA wifi ssid/password to the shared keys when path is passed", () => {
    expect(
      recommendedSecretKeys("wifi", "password", "kitchen", true, ["password"])
    ).toEqual(["wifi_password"]);
    expect(recommendedSecretKeys("wifi", "ssid", "kitchen", false, ["ssid"])).toEqual([
      "wifi_ssid",
    ]);
  });

  it("leaves api / web_server keys unchanged when their nested paths are passed", () => {
    expect(
      recommendedSecretKeys("api", "key", "kitchen", true, ["encryption", "key"])
    ).toEqual(["kitchen__encryption_key", "kitchen_encryption_key"]);
    expect(
      recommendedSecretKeys("web_server", "password", "kitchen", true, [
        "auth",
        "password",
      ])
    ).toEqual(["kitchen__web_password", "kitchen_web_password"]);
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

  it("filters a legacy hyphenated foreign key by slugging the stored prefix", () => {
    // The key was stored before names converged (`porch-light__…`); it must
    // still be recognized as another device's and dropped.
    expect(
      withoutForeignDeviceSecrets(
        ["porch-light__encryption_key", "kitchen__ota_password"],
        "kitchen",
        ["kitchen", "porch-light"]
      )
    ).toEqual(["kitchen__ota_password"]);
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

describe("isSharedSecret", () => {
  it("treats wifi_* and unscoped names as shared", () => {
    expect(isSharedSecret("wifi_password", "kitchen")).toBe(true);
    expect(isSharedSecret("some_token", "kitchen")).toBe(true);
  });

  it("treats this device's own scoped key as not shared", () => {
    expect(isSharedSecret("kitchen__ota_password", "kitchen")).toBe(false);
  });

  it("recognizes a legacy hyphenated own-device key as not shared", () => {
    expect(isSharedSecret("temp-sensor__ota_password", "temp-sensor")).toBe(false);
  });

  it("treats another device's scoped key as shared", () => {
    expect(isSharedSecret("porch__encryption_key", "kitchen")).toBe(true);
  });

  it("is shared when the hostname is unresolved", () => {
    expect(isSharedSecret("kitchen__ota_password", "")).toBe(true);
  });
});

describe("visibleSecretKeys", () => {
  const keys = [
    "wifi_ssid",
    "wifi_password",
    "kitchen__encryption_key",
    "kitchen__ota_password",
    "porch__encryption_key",
    "x_secret",
  ];

  it("drops wifi_* on a non-WiFi field, keeps the device's own + unscoped", () => {
    expect(
      visibleSecretKeys(keys, ["kitchen__encryption_key"], "kitchen", [
        "kitchen",
        "porch",
      ])
    ).toEqual(["kitchen__encryption_key", "kitchen__ota_password", "x_secret"]);
  });

  it("keeps wifi_ssid on the WiFi SSID field but not wifi_password", () => {
    expect(
      visibleSecretKeys(keys, ["wifi_ssid"], "kitchen", ["kitchen", "porch"])
    ).toEqual([
      "wifi_ssid",
      "kitchen__encryption_key",
      "kitchen__ota_password",
      "x_secret",
    ]);
  });

  it("still hides other devices' per-device secrets", () => {
    expect(
      visibleSecretKeys(keys, ["wifi_ssid"], "kitchen", ["kitchen", "porch"])
    ).not.toContain("porch__encryption_key");
  });

  it("keeps a kept key (e.g. the selected value) even if field-bound", () => {
    // The picker passes recommended + selectedKey as `keep`, so the currently
    // referenced secret stays listed even on a field it's not recommended for.
    expect(
      visibleSecretKeys(["wifi_password", "x"], ["wifi_password"], "kitchen", ["kitchen"])
    ).toContain("wifi_password");
  });

  it("keeps a kept key even if it's another device's per-device secret", () => {
    // The selected value is always listed, even past the foreign-device filter.
    expect(
      visibleSecretKeys(
        ["porch__encryption_key", "x"],
        ["porch__encryption_key"],
        "kitchen",
        ["kitchen", "porch"]
      )
    ).toContain("porch__encryption_key");
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
