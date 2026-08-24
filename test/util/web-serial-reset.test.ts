/**
 * @vitest-environment happy-dom
 *
 * The post-flash reset must boot the firmware, not re-enter the bootloader.
 * For a classic ESP32 / ESP8266 behind a UART bridge that means an EN (RTS)
 * pulse with GPIO0 (DTR) released — esptool-js's ClassicReset would instead
 * drive GPIO0 low and strand the chip in the serial bootloader (#1529).
 * A chip on its own USB-Serial/JTAG peripheral (ESP32-C6 and friends outside
 * the watchdog list) needs the same EN pulse with esptool's USB timings;
 * esptool-js's UsbJtagSerialReset is the *enter download mode* sequence and
 * left the XIAO ESP32-C6 in the ROM bootloader after flashing (#1678).
 */
import type { ESPLoader, Transport } from "esptool-js";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const jtagPort = {
  getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
} as unknown as SerialPort;
// ESP32-C6: no watchdog reset (its USB-Serial/JTAG controller can drop the
// port), so it takes the USB-JTAG branch.
const c6Loader = { chip: { CHIP_NAME: "ESP32-C6" } } as unknown as ESPLoader;

describe("resetAndDisconnect — chip's own USB-Serial/JTAG peripheral", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("boots the app on an ESP32-C6 with an EN pulse, boot strap released", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    const done = resetAndDisconnect(
      c6Loader,
      transport as unknown as Transport,
      jtagPort
    );
    await vi.runAllTimersAsync();
    await done;

    // EN pulse only: RTS true (reset) then false (boot). The download-mode
    // sequence would toggle RTS three times and drive DTR high.
    expect(transport.setRTS.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(transport.setDTR).toHaveBeenCalledWith(false);
    expect(transport.setDTR.mock.calls.every((c) => c[0] === false)).toBe(true);
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
  });

  it("holds EN low for esptool's 200 ms USB timing before releasing", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    const done = resetAndDisconnect(
      c6Loader,
      transport as unknown as Transport,
      jtagPort
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(transport.setRTS.mock.calls.map((c) => c[0])).toEqual([true]);
    await vi.advanceTimersByTimeAsync(60);
    expect(transport.setRTS.mock.calls.map((c) => c[0])).toEqual([true, false]);
    // Then waits out the USB re-enumeration window before closing the port.
    expect(transport.disconnect).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await done;
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
  });

  it("treats the ESP-USB-Bridge as a bridge despite the Espressif vendor id", async () => {
    vi.useFakeTimers();
    const transport = fakeTransport();
    const bridgePort = {
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1002 }),
    } as unknown as SerialPort;
    const done = resetAndDisconnect(
      esp8266Loader,
      transport as unknown as Transport,
      bridgePort
    );
    // Bridge timing: EN released after 100 ms, no post-release wait.
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(transport.setRTS.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
  });
});
