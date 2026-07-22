import { describe, expect, test } from "vitest";

import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { coerceFields } from "../../../src/components/device/add-component-form-coerce.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const hexAddress = makeConfigEntry({
  key: "address",
  type: ConfigEntryType.INTEGER,
  display_format: "hex",
  range: [0, 255],
});

const plainInt = makeConfigEntry({
  key: "count",
  type: ConfigEntryType.INTEGER,
});

describe("coerceFields hex-display integers", () => {
  test("canonical 0x76 from the hex renderer passes through verbatim", () => {
    expect(coerceFields([hexAddress], { address: "0x76" })).toEqual({
      address: "0x76",
    });
  });

  test("0x0 survives without collapsing to numeric 0", () => {
    expect(coerceFields([hexAddress], { address: "0x0" })).toEqual({
      address: "0x0",
    });
  });

  test("a pre-existing JS number (catalog-default seed) is preserved", () => {
    expect(coerceFields([hexAddress], { address: 118 })).toEqual({
      address: 118,
    });
  });

  test("empty + required keeps the empty marker so submit blocks downstream", () => {
    const required = makeConfigEntry({
      ...hexAddress,
      required: true,
    });
    expect(coerceFields([required], { address: "" })).toEqual({ address: "" });
  });

  test("undefined drops out of the payload", () => {
    expect(coerceFields([hexAddress], {})).toEqual({});
  });
});

describe("coerceFields non-hex integers", () => {
  test('"5" still coerces to numeric 5', () => {
    expect(coerceFields([plainInt], { count: "5" })).toEqual({ count: 5 });
  });

  test("hex 0x1111 stays a verbatim string (parseInt base 10 would truncate it to 0)", () => {
    expect(coerceFields([plainInt], { count: "0x1111" })).toEqual({ count: "0x1111" });
  });

  test("a negative decimal coerces to a number", () => {
    expect(coerceFields([plainInt], { count: "-5" })).toEqual({ count: -5 });
  });
});

describe("coerceFields nested entity readings", () => {
  const tvoc = makeConfigEntry({
    key: "tvoc",
    type: ConfigEntryType.NESTED,
    required: true,
    platform_type: "sensor",
    config_entries: [makeConfigEntry({ key: "name", type: ConfigEntryType.STRING })],
  });

  test("a required nested entity with a seeded name survives", () => {
    expect(coerceFields([tvoc], { tvoc: { name: "TVOC" } })).toEqual({
      tvoc: { name: "TVOC" },
    });
  });

  test("an empty nested group is pruned from the payload", () => {
    expect(coerceFields([tvoc], { tvoc: {} })).toEqual({});
  });
});

describe("coerceFields multi_value nested list (usb_uart channels)", () => {
  const channels = makeConfigEntry({
    key: "channels",
    type: ConfigEntryType.NESTED,
    multi_value: true,
    required: true,
    config_entries: [
      makeConfigEntry({ key: "id", type: ConfigEntryType.ID, required: true }),
      makeConfigEntry({
        key: "baud_rate",
        type: ConfigEntryType.INTEGER,
        required: true,
      }),
    ],
  });

  test("a populated channels list survives with its baud_rate coerced to a number", () => {
    expect(
      coerceFields([channels], { channels: [{ id: "usb_cdc_0", baud_rate: "4800" }] })
    ).toEqual({ channels: [{ id: "usb_cdc_0", baud_rate: 4800 }] });
  });

  test("an empty list drops out of the payload", () => {
    expect(coerceFields([channels], { channels: [] })).toEqual({});
  });

  test("a list of only-empty items drops out of the payload", () => {
    expect(coerceFields([channels], { channels: [{}] })).toEqual({});
  });
});

describe("FLOAT coercion", () => {
  const gain = makeConfigEntry({ key: "gain", type: ConfigEntryType.FLOAT });

  test("coerces a finite string to a number and passes numbers through", () => {
    expect(coerceFields([gain], { gain: "1.5" })).toEqual({ gain: 1.5 });
    expect(coerceFields([gain], { gain: 2.5 })).toEqual({ gain: 2.5 });
  });

  test("ships a ${var} reference verbatim instead of dropping the field", () => {
    expect(coerceFields([gain], { gain: "${mic_gain}" })).toEqual({
      gain: "${mic_gain}",
    });
  });

  test("ships junk verbatim instead of prefix-parsing it", () => {
    // parseFloat("50Hz") is 50 — a silent rewrite; the backend should see
    // and flag the real value.
    expect(coerceFields([gain], { gain: "50Hz" })).toEqual({ gain: "50Hz" });
  });

  test("ships non-finite input verbatim instead of a JSON-null Infinity", () => {
    expect(coerceFields([gain], { gain: "Infinity" })).toEqual({ gain: "Infinity" });
    // A number input accepts 1e309, so the stored value can be a numeric
    // Infinity/NaN — those must stringify too, not JSON-serialize to null.
    expect(coerceFields([gain], { gain: Number.POSITIVE_INFINITY })).toEqual({
      gain: "Infinity",
    });
    expect(coerceFields([gain], { gain: Number.NaN })).toEqual({ gain: "NaN" });
  });

  test("coerces a 0x literal through strict Number, not parseFloat's 0", () => {
    expect(coerceFields([gain], { gain: "0x10" })).toEqual({ gain: 16 });
  });
});

describe("BOOLEAN coercion", () => {
  const enabled = makeConfigEntry({ key: "enabled", type: ConfigEntryType.BOOLEAN });

  test("passes booleans through and coerces YAML spellings", () => {
    expect(coerceFields([enabled], { enabled: true })).toEqual({ enabled: true });
    expect(coerceFields([enabled], { enabled: "yes" })).toEqual({ enabled: true });
    expect(coerceFields([enabled], { enabled: "off" })).toEqual({ enabled: false });
  });

  test("ships a ${var} reference verbatim instead of false", () => {
    expect(coerceFields([enabled], { enabled: "${enable_foo}" })).toEqual({
      enabled: "${enable_foo}",
    });
  });

  test("ships junk verbatim instead of false", () => {
    expect(coerceFields([enabled], { enabled: "maybe" })).toEqual({
      enabled: "maybe",
    });
  });
});
