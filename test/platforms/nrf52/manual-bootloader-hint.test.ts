import { describe, expect, it } from "vitest";
import { argsLocalize } from "../../_dom.js";
import { withManualBootloaderHint } from "../../../src/platforms/nrf52/manual-bootloader-hint.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";

describe("withManualBootloaderHint", () => {
  it("joins the error with the hint", () => {
    expect(
      withManualBootloaderHint(
        new Error("Failed to receive ACK after 3 attempts"),
        argsLocalize
      )
    ).toBe(
      "firmware.nrf_manual_bootloader_hint | Failed to receive ACK after 3 attempts"
    );
  });

  it("drops a trailing period from the browser's message before joining", () => {
    expect(
      withManualBootloaderHint(new Error("Failed to open serial port."), argsLocalize)
    ).toBe("firmware.nrf_manual_bootloader_hint | Failed to open serial port");
  });

  it("names a board that went away: the bootloader is not the way out of that", () => {
    expect(withManualBootloaderHint(new SerialDeviceLostError(), argsLocalize)).toBe(
      "serial.device_lost"
    );
  });

  it("keeps a teardown abort bare", () => {
    expect(
      withManualBootloaderHint(new DOMException("aborted", "AbortError"), argsLocalize)
    ).toBe("aborted");
  });
});
