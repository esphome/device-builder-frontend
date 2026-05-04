import { describe, expect, it } from "vitest";
import { chipNameToVariant } from "../../src/util/chip-variant.js";

describe("chipNameToVariant", () => {
  it("maps plain ESP32 to esp32", () => {
    expect(chipNameToVariant("ESP32")).toBe("esp32");
  });

  it("maps ESP32-PICO-D4 to esp32 (the bug from #284)", () => {
    expect(chipNameToVariant("ESP32-PICO-D4")).toBe("esp32");
  });

  it("maps ESP32-D0WD variants to esp32", () => {
    expect(chipNameToVariant("ESP32-D0WD")).toBe("esp32");
    expect(chipNameToVariant("ESP32-D0WDQ6")).toBe("esp32");
    expect(chipNameToVariant("ESP32-U4WDH")).toBe("esp32");
  });

  it("maps PICO-V3 variants to esp32", () => {
    expect(chipNameToVariant("ESP32-PICO-V3")).toBe("esp32");
    expect(chipNameToVariant("ESP32-PICO-V3-02")).toBe("esp32");
  });

  it("maps each ESP32 sub-variant to its own variant", () => {
    expect(chipNameToVariant("ESP32-S2")).toBe("esp32s2");
    expect(chipNameToVariant("ESP32-S3")).toBe("esp32s3");
    expect(chipNameToVariant("ESP32-C2")).toBe("esp32c2");
    expect(chipNameToVariant("ESP32-C3")).toBe("esp32c3");
    expect(chipNameToVariant("ESP32-C5")).toBe("esp32c5");
    expect(chipNameToVariant("ESP32-C6")).toBe("esp32c6");
    expect(chipNameToVariant("ESP32-C61")).toBe("esp32c61");
    expect(chipNameToVariant("ESP32-H2")).toBe("esp32h2");
    expect(chipNameToVariant("ESP32-P4")).toBe("esp32p4");
  });

  it("does not let esp32c6 swallow esp32c61", () => {
    // Order in the prefix list matters: c61 must be checked before c6.
    expect(chipNameToVariant("ESP32-C61")).toBe("esp32c61");
    expect(chipNameToVariant("ESP32-C6")).toBe("esp32c6");
  });

  it("maps sub-variant packages to the sub-variant family", () => {
    expect(chipNameToVariant("ESP32-S3-PICO-1")).toBe("esp32s3");
    expect(chipNameToVariant("ESP32-S2FH4")).toBe("esp32s2");
    expect(chipNameToVariant("ESP32-S2FN4R2")).toBe("esp32s2");
  });

  it("maps ESP8266 chips to esp8266", () => {
    expect(chipNameToVariant("ESP8266")).toBe("esp8266");
    expect(chipNameToVariant("ESP8266EX")).toBe("esp8266");
  });

  it("strips parenthetical revision info", () => {
    expect(chipNameToVariant("ESP32-PICO-D4 (revision 1)")).toBe("esp32");
    expect(chipNameToVariant("ESP32 (revision 3)")).toBe("esp32");
  });

  it("returns the normalized input for unknown chips", () => {
    expect(chipNameToVariant("RP2040")).toBe("rp2040");
    expect(chipNameToVariant("Unknown-Chip")).toBe("unknownchip");
  });
});
