/**
 * busConstraintPrefill turns a requester's bus_constraints dict into the
 * dep-added bus form's starting values and forced-required pin fields.
 */
import { describe, expect, test } from "vitest";

import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { busConstraintPrefill } from "../../src/util/bus-constraint-prefill.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const i2cEntries = [
  makeConfigEntry({
    key: "frequency",
    type: ConfigEntryType.FLOAT_WITH_UNIT,
    default_value: "50kHz",
    unit_options: ["Hz", "kHz", "MHz"],
  }),
];

const uartEntries = [
  makeConfigEntry({ key: "baud_rate", type: ConfigEntryType.INTEGER, required: true }),
  makeConfigEntry({ key: "parity", type: ConfigEntryType.STRING, default_value: "NONE" }),
  makeConfigEntry({ key: "stop_bits", type: ConfigEntryType.STRING, default_value: "1" }),
  makeConfigEntry({ key: "data_bits", type: ConfigEntryType.INTEGER, default_value: 8 }),
];

describe("busConstraintPrefill", () => {
  test("clamps the bus frequency down to a max constraint", () => {
    expect(busConstraintPrefill(i2cEntries, { max_frequency: 15000 })).toEqual({
      fields: { frequency: "15kHz" },
      required: [],
    });
  });

  test("leaves the frequency alone when the default is in range", () => {
    expect(busConstraintPrefill(i2cEntries, { min_frequency: 10000 })).toBeNull();
  });

  test("raises the frequency up to a min constraint", () => {
    expect(busConstraintPrefill(i2cEntries, { min_frequency: 100000 })).toEqual({
      fields: { frequency: "100kHz" },
      required: [],
    });
  });

  test("prefills exact-match uart values that differ from the defaults", () => {
    const result = busConstraintPrefill(uartEntries, {
      baud_rate: 9600,
      parity: "EVEN",
      stop_bits: 1,
      data_bits: 8,
    });
    // stop_bits / data_bits already match their defaults and stay out.
    expect(result).toEqual({
      fields: { baud_rate: 9600, parity: "EVEN" },
      required: [],
    });
  });

  test("maps require_* constraints to required pin fields", () => {
    expect(
      busConstraintPrefill(uartEntries, { require_tx: true, require_rx: true })
    ).toEqual({ fields: {}, required: ["tx_pin", "rx_pin"] });
  });

  test("returns null when nothing applies", () => {
    expect(busConstraintPrefill(uartEntries, { data_bits: 8 })).toBeNull();
  });

  test("formats the clamped frequency within the entry's unit options", () => {
    const hzOnly = [
      makeConfigEntry({
        key: "frequency",
        type: ConfigEntryType.FLOAT_WITH_UNIT,
        default_value: "50000Hz",
        unit_options: ["Hz"],
      }),
    ];
    expect(busConstraintPrefill(hzOnly, { max_frequency: 15000 })).toEqual({
      fields: { frequency: "15000Hz" },
      required: [],
    });
  });

  test("skips a constraint key with no matching bus field", () => {
    expect(busConstraintPrefill(uartEntries, { rx_buffer_size: 512 })).toBeNull();
  });

  // The catalog now gives baud_rate a 115200 default; a detour constraint
  // (e.g. an LD2410 needing 256000) must still win over that default.
  const baudDefaulted = [
    makeConfigEntry({
      key: "baud_rate",
      type: ConfigEntryType.INTEGER,
      required: true,
      default_value: 115200,
    }),
  ];

  test("prefills a baud constraint that differs from the new 115200 default", () => {
    expect(busConstraintPrefill(baudDefaulted, { baud_rate: 256000 })).toEqual({
      fields: { baud_rate: 256000 },
      required: [],
    });
  });

  test("drops a baud constraint equal to the default (seed already supplies it)", () => {
    expect(busConstraintPrefill(baudDefaulted, { baud_rate: 115200 })).toBeNull();
  });
});
