import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../../src/api/types.js";
import {
  ALWAYS_SHOWN_KEYS,
  collectRenderablePaths,
  filterRenderable,
} from "../../../src/components/device/config-entry-render-filter.js";
import { makeConfigEntry as makeEntry } from "../../util/_make-config-entry.js";

describe("ALWAYS_SHOWN_KEYS", () => {
  it("contains 'name' (the friendly-name leaf)", () => {
    expect(ALWAYS_SHOWN_KEYS.has("name")).toBe(true);
  });

  it("is read-only at the type level", () => {
    // Compile-time check — TypeScript rejects mutation. We can't
    // assert directly, but a runtime ``add()`` would still work
    // (Set's mutation methods are still on the prototype). The
    // ``ReadonlySet`` typing is the actual guard; this test is
    // a sanity check that the value itself is a Set.
    expect(ALWAYS_SHOWN_KEYS instanceof Set).toBe(true);
  });
});

describe("filterRenderable", () => {
  it("hides entries flagged hidden", () => {
    const entries = [
      makeEntry({ key: "a", hidden: true }),
      makeEntry({ key: "b", required: true }),
    ];
    const out = filterRenderable(entries, {}, {
      requiredOnly: true,
      showAdvanced: false,
    });
    expect(out.map((e) => e.key)).toEqual(["b"]);
  });

  it("hides advanced entries unless showAdvanced is true", () => {
    const entries = [
      makeEntry({ key: "a", advanced: true, required: true }),
      makeEntry({ key: "b", required: true }),
    ];
    const required = filterRenderable(entries, {}, {
      requiredOnly: true,
      showAdvanced: false,
    });
    expect(required.map((e) => e.key)).toEqual(["b"]);
    const withAdv = filterRenderable(entries, {}, {
      requiredOnly: true,
      showAdvanced: true,
    });
    expect(withAdv.map((e) => e.key)).toEqual(["a", "b"]);
  });

  it("keeps advanced leaves whose YAML value is set, even with showAdvanced off", () => {
    const entries = [
      makeEntry({ key: "tx_power", advanced: true }),
      makeEntry({ key: "fast_connect", advanced: true }),
      makeEntry({ key: "ssid", required: true }),
    ];
    const out = filterRenderable(entries, { tx_power: "20dB", ssid: "x" }, {
      requiredOnly: false,
      showAdvanced: false,
    });
    // `tx_power` survives because YAML supplied a value;
    // `fast_connect` stays hidden because it isn't filled.
    expect(out.map((e) => e.key)).toEqual(["tx_power", "ssid"]);
  });

  it("treats explicit falsy values (false, 0, '') as set on advanced leaves", () => {
    const entries = [
      makeEntry({ key: "use_address", advanced: true }),
      makeEntry({ key: "channel", advanced: true }),
      makeEntry({ key: "comment", advanced: true }),
    ];
    const out = filterRenderable(
      entries,
      { use_address: false, channel: 0, comment: "" },
      { requiredOnly: false, showAdvanced: false },
    );
    expect(out.map((e) => e.key)).toEqual([
      "use_address",
      "channel",
      "comment",
    ]);
  });

  it("keeps an advanced NESTED group when any descendant has a value", () => {
    const entries = [
      makeEntry({
        key: "manual_ip",
        type: ConfigEntryType.NESTED,
        advanced: true,
        config_entries: [
          makeEntry({ key: "static_ip" }),
          makeEntry({ key: "gateway" }),
        ],
      }),
    ];
    const filled = filterRenderable(
      entries,
      { manual_ip: { static_ip: "10.0.0.5" } },
      { requiredOnly: false, showAdvanced: false },
    );
    expect(filled.map((e) => e.key)).toEqual(["manual_ip"]);
    const empty = filterRenderable(entries, {}, {
      requiredOnly: false,
      showAdvanced: false,
    });
    expect(empty.map((e) => e.key)).toEqual([]);
  });

  it("surfaces an advanced leaf nested inside a non-advanced group when filled", () => {
    const entries = [
      makeEntry({
        key: "ota",
        type: ConfigEntryType.NESTED,
        config_entries: [
          makeEntry({ key: "platform", required: true }),
          makeEntry({ key: "password", advanced: true }),
        ],
      }),
    ];
    const filled = filterRenderable(
      entries,
      { ota: { platform: "esphome", password: "secret" } },
      { requiredOnly: false, showAdvanced: false },
    );
    expect(filled.map((e) => e.key)).toEqual(["ota"]);
    const filledChildren = filterRenderable(
      entries[0].config_entries!,
      { platform: "esphome", password: "secret" },
      { requiredOnly: false, showAdvanced: false },
    );
    expect(filledChildren.map((e) => e.key)).toEqual(["platform", "password"]);
    const emptyChildren = filterRenderable(
      entries[0].config_entries!,
      { platform: "esphome" },
      { requiredOnly: false, showAdvanced: false },
    );
    expect(emptyChildren.map((e) => e.key)).toEqual(["platform"]);
  });

  it("drops non-required leaves in required-only mode (except ALWAYS_SHOWN_KEYS)", () => {
    const entries = [
      makeEntry({ key: "freq" }), // optional, not allowlisted
      makeEntry({ key: "name" }), // optional but always shown
      makeEntry({ key: "scl", required: true }),
    ];
    const out = filterRenderable(entries, {}, {
      requiredOnly: true,
      showAdvanced: false,
    });
    expect(out.map((e) => e.key)).toEqual(["name", "scl"]);
  });

  it("keeps non-required leaves when requiredOnly is off", () => {
    const entries = [
      makeEntry({ key: "freq" }),
      makeEntry({ key: "scl", required: true }),
    ];
    const out = filterRenderable(entries, {}, {
      requiredOnly: false,
      showAdvanced: true,
    });
    expect(out.map((e) => e.key)).toEqual(["freq", "scl"]);
  });

  it("drops NESTED groups whose children are all filtered out", () => {
    const entries = [
      makeEntry({
        key: "auth",
        type: ConfigEntryType.NESTED,
        config_entries: [
          // Both children optional → filtered in required-only mode
          // → group survives only if any survive (none) → group drop.
          makeEntry({ key: "username" }),
          makeEntry({ key: "password" }),
        ],
      }),
    ];
    const out = filterRenderable(entries, {}, {
      requiredOnly: true,
      showAdvanced: false,
    });
    expect(out.map((e) => e.key)).toEqual([]);
  });

  it("keeps NESTED groups with at least one renderable child", () => {
    const entries = [
      makeEntry({
        key: "auth",
        type: ConfigEntryType.NESTED,
        config_entries: [
          makeEntry({ key: "username", required: true }),
          makeEntry({ key: "password" }),
        ],
      }),
    ];
    const out = filterRenderable(entries, {}, {
      requiredOnly: true,
      showAdvanced: false,
    });
    expect(out.map((e) => e.key)).toEqual(["auth"]);
  });

  it("respects depends_on visibility", () => {
    const entries = [
      makeEntry({ key: "mode", required: true }),
      makeEntry({
        key: "advanced_opt",
        required: true,
        depends_on: "mode",
        depends_on_value: "expert",
      }),
    ];
    // mode != "expert" → advanced_opt hidden.
    expect(
      filterRenderable(entries, { mode: "basic" }, {
        requiredOnly: true,
        showAdvanced: false,
      }).map((e) => e.key),
    ).toEqual(["mode"]);
    // mode == "expert" → both visible.
    expect(
      filterRenderable(entries, { mode: "expert" }, {
        requiredOnly: true,
        showAdvanced: false,
      }).map((e) => e.key),
    ).toEqual(["mode", "advanced_opt"]);
  });

  it("respects depends_on_component visibility", () => {
    const entries = [
      makeEntry({
        key: "mqtt_topic",
        required: true,
        depends_on_component: "mqtt",
      }),
      makeEntry({ key: "name", required: true }),
    ];
    expect(
      filterRenderable(entries, {}, {
        requiredOnly: true,
        showAdvanced: false,
        presentComponents: new Set(["esphome"]),
      }).map((e) => e.key),
    ).toEqual(["name"]);
    expect(
      filterRenderable(entries, {}, {
        requiredOnly: true,
        showAdvanced: false,
        presentComponents: new Set(["esphome", "mqtt"]),
      }).map((e) => e.key),
    ).toEqual(["mqtt_topic", "name"]);
  });
});

describe("collectRenderablePaths", () => {
  it("emits dotted paths for visible leaves", () => {
    const entries = [
      makeEntry({ key: "scl", required: true }),
      makeEntry({ key: "sda", required: true }),
      makeEntry({ key: "freq" }), // dropped in required-only
    ];
    const paths = collectRenderablePaths(entries, {}, {
      requiredOnly: true,
      showAdvanced: false,
    });
    expect([...paths].sort()).toEqual(["scl", "sda"]);
  });

  it("includes the NESTED group key alongside its renderable children", () => {
    const entries = [
      makeEntry({
        key: "auth",
        type: ConfigEntryType.NESTED,
        config_entries: [
          makeEntry({ key: "username", required: true }),
          makeEntry({ key: "password", required: true }),
        ],
      }),
    ];
    const paths = collectRenderablePaths(entries, {}, {
      requiredOnly: true,
      showAdvanced: false,
    });
    expect([...paths].sort()).toEqual([
      "auth",
      "auth.password",
      "auth.username",
    ]);
  });

  it("omits NESTED groups whose children are all filtered out", () => {
    const entries = [
      makeEntry({
        key: "auth",
        type: ConfigEntryType.NESTED,
        config_entries: [
          makeEntry({ key: "username" }), // optional, dropped in required-only
        ],
      }),
      makeEntry({ key: "name", required: true }),
    ];
    const paths = collectRenderablePaths(entries, {}, {
      requiredOnly: true,
      showAdvanced: false,
    });
    expect([...paths].sort()).toEqual(["name"]);
  });

  it("does not include hidden or advanced entries", () => {
    const entries = [
      makeEntry({ key: "hid", required: true, hidden: true }),
      makeEntry({ key: "adv", required: true, advanced: true }),
      makeEntry({ key: "vis", required: true }),
    ];
    const paths = collectRenderablePaths(entries, {}, {
      requiredOnly: true,
      showAdvanced: false,
    });
    expect([...paths]).toEqual(["vis"]);
  });
});
