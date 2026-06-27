/**
 * Tests for the pin string <-> GPIO primitives in
 * ``src/util/pin-gpio.ts`` — the single source of truth shared by the
 * pin-selector renderer (current value + suggestions) and the YAML
 * used-pin scanner (cross-section conflict detection).
 *
 * Four exported functions, each with a load-bearing contract:
 *
 *  - ``parsePinGpio`` — strict, anchored parse of a *single* pin value
 *    (a field value or one suggestion entry). Returns ``null`` for
 *    anything unparseable so the caller drops the entry rather than
 *    blanking the dropdown.
 *  - ``formatPinValue`` — render a GPIO number in the form the target
 *    platform's validator accepts.
 *  - ``scanPinGpios`` — loose, unanchored scan of a whole YAML *line*
 *    for every pin form. Deliberately value-context-agnostic (it sees
 *    raw lines from the used-pin scan), so the tests pin its known
 *    over-match behaviour on free-text P-tokens too — that's the
 *    contract its caller (``findUsedPins``) is written against.
 *  - ``isPinFieldKey`` — whether a mapping key names a pin field, so the
 *    used-pin scan can accept a bare-integer value the token scan misses.
 *
 * Platform pin forms covered (see the module header for the full
 * derivation):
 *   - esp / esp8266 / rp2040 / libretiny : bare int or ``GPIOn``
 *   - bk72xx                             : bare ``P{n}``
 *   - rtl87xx / ln882x port A            : ``PA{n}`` (n is the GPIO)
 *   - ln882x port B                      : ``PB{n}`` (16 + n)
 *   - nRF52                              : ``P{port}.{pin}`` (port*32 + pin)
 */

import { describe, expect, it } from "vitest";
import {
  formatPinValue,
  isPinFieldKey,
  LONG_FORM_PIN_KEYS,
  parseBoardGpio,
  parsePinGpio,
  scanPinGpios,
} from "../../src/util/pin-gpio.js";

describe("parsePinGpio", () => {
  it("returns finite numbers verbatim", () => {
    expect(parsePinGpio(0)).toBe(0);
    expect(parsePinGpio(12)).toBe(12);
    expect(parsePinGpio(33)).toBe(33);
  });

  it("rejects non-finite numbers", () => {
    expect(parsePinGpio(NaN)).toBeNull();
    expect(parsePinGpio(Infinity)).toBeNull();
    expect(parsePinGpio(-Infinity)).toBeNull();
  });

  it("parses bare-int and GPIOn string forms, case- and space-insensitive", () => {
    expect(parsePinGpio("12")).toBe(12);
    expect(parsePinGpio(" 12 ")).toBe(12);
    expect(parsePinGpio("GPIO12")).toBe(12);
    expect(parsePinGpio("gpio12")).toBe(12);
    expect(parsePinGpio("  GPIO0  ")).toBe(0);
  });

  it("parses nRF52 port.pin notation as port*32 + pin", () => {
    expect(parsePinGpio("P0.27")).toBe(27);
    expect(parsePinGpio("P1.1")).toBe(33);
    expect(parsePinGpio("P0.0")).toBe(0);
  });

  it("rejects an nRF52 pin >= 32 rather than normalizing it", () => {
    // "P0.33" must not silently become some other valid-looking pin —
    // that would rewrite the YAML. Each port has exactly 32 pins.
    expect(parsePinGpio("P0.33")).toBeNull();
    expect(parsePinGpio("P1.32")).toBeNull();
  });

  it("parses LibreTiny port-A 'PA{n}' as the trailing number (padding cosmetic)", () => {
    expect(parsePinGpio("PA02")).toBe(2);
    expect(parsePinGpio("PA15")).toBe(15);
    expect(parsePinGpio("PA0")).toBe(0);
  });

  it("parses LibreTiny port-B 'PB{n}' as 16 + n (ln882x)", () => {
    expect(parsePinGpio("PB0")).toBe(16);
    expect(parsePinGpio("PB03")).toBe(19);
  });

  it("parses bk72xx bare 'P{n}' form", () => {
    expect(parsePinGpio("P5")).toBe(5);
    expect(parsePinGpio("P23")).toBe(23);
  });

  it("orders the forms so dotted and letter-port variants win over bare-P", () => {
    // "P0.27" must read as 27 (nRF52), not 0 (bk72xx swallowing "P0").
    expect(parsePinGpio("P0.27")).toBe(27);
    // "PA02"/"PB03" must not be swallowed by the no-letter bare-P pattern.
    expect(parsePinGpio("PA02")).toBe(2);
    expect(parsePinGpio("PB03")).toBe(19);
  });

  it("unwraps the long-form pin block object via its `number` field", () => {
    expect(parsePinGpio({ number: 0, mode: { input: true } })).toBe(0);
    expect(parsePinGpio({ number: "GPIO7" })).toBe(7);
    expect(parsePinGpio({ number: "P0.27" })).toBe(27);
  });

  it("returns null for an object whose `number` is unparseable", () => {
    expect(parsePinGpio({ number: null })).toBeNull();
    expect(parsePinGpio({ mode: { input: true } })).toBeNull();
  });

  it("namespaces an I/O-expander pin so its channel never aliases a board GPIO", () => {
    // The pcf8574 hub channel 0 must not collide with board GPIO 0.
    expect(parsePinGpio({ pcf8574: "pcf8574_hub_in_1", number: 0, mode: "INPUT" })).toBe(
      "pcf8574:pcf8574_hub_in_1:0"
    );
    expect(parsePinGpio({ mcp23017: "hub", number: 7 })).toBe("mcp23017:hub:7");
    // The channel is parsed like any pin value, so a string `number` works.
    expect(parsePinGpio({ pcf8574: "hub", number: "0" })).toBe("pcf8574:hub:0");
    // Expander key present but no resolvable channel -> null, not a board pin.
    expect(parsePinGpio({ pcf8574: "hub" })).toBeNull();
    // Provider present but hub id empty (mid-edit) -> null, NOT board GPIO 0.
    expect(parsePinGpio({ pcf8574: "", number: 0 })).toBeNull();
  });

  it("treats every long-form board-GPIO key as a board pin, never an expander provider", () => {
    // Characterizes the provider-detection contract: any key NOT in
    // LONG_FORM_PIN_KEYS is read as an I/O-expander provider, so each member
    // must round-trip a plain board GPIO (here 7) to a number, not a token.
    // This set mirrors the backend BOARD_PIN_KEYS in lockstep; dropping a key
    // (or letting it drift) would misclassify a board pin as an expander
    // channel, and this trips a red test instead of shipping silently.
    for (const key of LONG_FORM_PIN_KEYS) {
      if (key === "number") continue;
      expect(parsePinGpio({ number: 7, [key]: "x" }), key).toBe(7);
    }
  });

  it("returns null for unparseable or non-pin inputs", () => {
    expect(parsePinGpio("abc")).toBeNull();
    expect(parsePinGpio("")).toBeNull();
    expect(parsePinGpio(null)).toBeNull();
    expect(parsePinGpio(undefined)).toBeNull();
    expect(parsePinGpio([1])).toBeNull(); // arrays are not pin-block objects
    expect(parsePinGpio(true)).toBeNull();
  });
});

describe("parseBoardGpio", () => {
  it("returns the board GPIO and drops expander tokens", () => {
    expect(parseBoardGpio(12)).toBe(12);
    expect(parseBoardGpio({ number: 5, mode: { input: true } })).toBe(5);
    // An expander channel is not a board pin.
    expect(parseBoardGpio({ pcf8574: "hub", number: 0 })).toBeNull();
  });
});

describe("formatPinValue", () => {
  it("defaults to the GPIOn form (esp / esp8266 / rp2040 / rtl87xx / ln882x)", () => {
    expect(formatPinValue(4, undefined)).toBe("GPIO4");
    expect(formatPinValue(4, "esp32")).toBe("GPIO4");
    expect(formatPinValue(2, "rtl87xx")).toBe("GPIO2");
    expect(formatPinValue(19, "ln882x")).toBe("GPIO19");
  });

  it("writes bk72xx as the bare 'P{n}' form", () => {
    expect(formatPinValue(23, "bk72xx")).toBe("P23");
    expect(formatPinValue(0, "bk72xx")).toBe("P0");
  });

  it("writes nRF52 as port.pin notation (port*32 + pin)", () => {
    expect(formatPinValue(27, "nrf52")).toBe("P0.27");
    expect(formatPinValue(33, "nrf52")).toBe("P1.1");
    expect(formatPinValue(0, "nrf52")).toBe("P0.0");
  });

  it("round-trips GPIOn / bk72xx / nRF52 through parsePinGpio", () => {
    for (const gpio of [0, 2, 16, 23, 27, 33]) {
      expect(parsePinGpio(formatPinValue(gpio, undefined))).toBe(gpio);
      expect(parsePinGpio(formatPinValue(gpio, "bk72xx"))).toBe(gpio);
      expect(parsePinGpio(formatPinValue(gpio, "nrf52"))).toBe(gpio);
    }
  });
});

describe("scanPinGpios", () => {
  it("collects every GPIOn token on a line, case-insensitive", () => {
    expect(scanPinGpios("pin: GPIO4")).toEqual([4]);
    expect(scanPinGpios("GPIO5 and gpio6")).toEqual([5, 6]);
  });

  it("collects the LibreTiny / nRF52 P-forms", () => {
    expect(scanPinGpios("pin: PA02")).toEqual([2]); // port A
    expect(scanPinGpios("pin: PB03")).toEqual([19]); // port B = 16 + 3
    expect(scanPinGpios("pin: P0.27")).toEqual([27]); // nRF52
    expect(scanPinGpios("pin: P23")).toEqual([23]); // bk72xx
  });

  it("scans mixed forms across a single line", () => {
    expect(scanPinGpios("GPIO5 and PA02")).toEqual([5, 2]);
  });

  it("skips an nRF52 pin >= 32, mirroring parsePinGpio", () => {
    expect(scanPinGpios("pin: P0.33")).toEqual([]);
  });

  it("respects word boundaries so pins inside identifiers don't match", () => {
    // The \b in the P-token regex keeps a bare "P5" from firing inside
    // words like STEP5 / relay_p7, and the "P" inside RP2040 / esp32.
    expect(scanPinGpios("STEP5")).toEqual([]);
    expect(scanPinGpios("relay_p7")).toEqual([]);
    expect(scanPinGpios("RP2040")).toEqual([]);
    expect(scanPinGpios("esp32")).toEqual([]);
  });

  it("does not double-count the P inside a GPIOn token", () => {
    // "GPIO5" matches the GPIO scan once; the P-form scan must not also
    // fire on the "P" buried in "GPIO" (no word boundary precedes it).
    expect(scanPinGpios("GPIO5")).toEqual([5]);
  });

  it("returns an empty array for a line with no pin tokens", () => {
    expect(scanPinGpios("")).toEqual([]);
    expect(scanPinGpios("name: living room light")).toEqual([]);
  });

  // Documented over-match: scanPinGpios is value-context-agnostic — it
  // scans raw lines including names and comments, so a punctuation-
  // bounded P-token in free text reads as a used pin. The caller
  // (findUsedPins) is responsible for stripping comments and skipping
  // free-text keys; the scanner itself stays loose by design. These
  // cases lock that behaviour so a future "fix" here surfaces the
  // shared-source-of-truth tradeoff instead of silently changing it.
  it("over-matches free-text P-tokens (caller filters context)", () => {
    expect(scanPinGpios("Pump P0.5 valve")).toEqual([5]); // P0.5 -> port0 pin5
    expect(scanPinGpios("P3.invalid")).toEqual([3]); // dotted alt fails, bare P3 wins
    expect(scanPinGpios("P0.5V")).toEqual([0]); // dotted \b fails on V, bare P0 wins
  });
});

describe("isPinFieldKey", () => {
  it("matches the _pin / _gpio suffix and the long-form pin / number keys", () => {
    for (const key of ["pin", "tx_pin", "dir_pin", "led_gpio", "gpio", "number"]) {
      expect(isPinFieldKey(key)).toBe(true);
    }
  });

  it("rejects numeric config keys that aren't pins", () => {
    for (const key of [
      "baud_rate",
      "phy_addr",
      "data_bits",
      "max_speed",
      "id",
      "pin_x",
    ]) {
      expect(isPinFieldKey(key)).toBe(false);
    }
  });
});
