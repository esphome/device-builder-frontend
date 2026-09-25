import { describe, expect, it } from "vitest";
import { argsLocalize } from "../_dom.js";
import { withManualBootloaderHint } from "../../src/util/manual-bootloader-hint.js";

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

  it("keeps a teardown abort bare", () => {
    expect(
      withManualBootloaderHint(new DOMException("aborted", "AbortError"), argsLocalize)
    ).toBe("aborted");
  });
});
