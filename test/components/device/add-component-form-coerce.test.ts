import { describe, expect, test } from "vitest";

import { coerceFields } from "../../../src/components/device/add-component-form-coerce.js";
import { ConfigEntryType } from "../../../src/api/types.js";
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
});
