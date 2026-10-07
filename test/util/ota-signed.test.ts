import { describe, expect, it } from "vitest";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { otaNeedsUsb } from "../../src/util/ota-signed.js";

describe("otaNeedsUsb", () => {
  it("is true when the firmware is signed and the config doesn't sign", () => {
    const device = makeConfiguredDevice({ runtime_state: { ota_signed: true } });
    expect(otaNeedsUsb(device)).toBe(true);
  });

  it("is false once the config signs with its own key", () => {
    const device = makeConfiguredDevice({
      runtime_state: { ota_signed: true },
      ota_signing_key: true,
    });
    expect(otaNeedsUsb(device)).toBe(false);
  });

  it("is false for unsigned running firmware", () => {
    expect(otaNeedsUsb(makeConfiguredDevice())).toBe(false);
  });

  it("is false with no device", () => {
    expect(otaNeedsUsb(null)).toBe(false);
  });
});
