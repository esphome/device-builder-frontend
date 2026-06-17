/**
 * @vitest-environment happy-dom
 *
 * The post-flash reset must boot the firmware, not re-enter the bootloader.
 * For a classic ESP32 / ESP8266 behind a UART bridge that means an EN (RTS)
 * pulse with GPIO0 (DTR) released — esptool-js's ClassicReset would instead
 * drive GPIO0 low and strand the chip in the serial bootloader (#1529).
 */
import type { ESPLoader, Transport } from "esptool-js";
import { describe, expect, it, vi } from "vitest";
import { resetAndDisconnect } from "../../src/util/web-serial.js";

function fakeTransport() {
  return {
    setDTR: vi.fn().mockResolvedValue(undefined),
    setRTS: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

// An ESP8266 (no RTC watchdog) behind a CP210x bridge — the classic path.
const esp8266Loader = { chip: { CHIP_NAME: "ESP8266" } } as unknown as ESPLoader;
const cp210xPort = { getInfo: () => ({ usbVendorId: 0x10c4 }) } as unknown as SerialPort;

describe("resetAndDisconnect — classic ESP32 / ESP8266 over a UART bridge", () => {
  it("pulses EN and leaves GPIO0 released, then disconnects", async () => {
    const transport = fakeTransport();
    await resetAndDisconnect(
      esp8266Loader,
      transport as unknown as Transport,
      cp210xPort
    );

    // EN pulse: RTS true (reset) then false (boot).
    expect(transport.setRTS.mock.calls.map((c) => c[0])).toEqual([true, false]);
    // GPIO0/DTR is actively released and never driven low (which would re-enter
    // the download bootloader, the #1529 regression).
    expect(transport.setDTR).toHaveBeenCalledWith(false);
    expect(transport.setDTR.mock.calls.every((c) => c[0] === false)).toBe(true);
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
  });
});
