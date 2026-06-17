/**
 * @vitest-environment happy-dom
 *
 * Web Serial flash-target selection. ESP8266's firmware.bin is a complete image
 * at 0x0; flashing it at the ESP32 app offset (0x10000) leaves the boot address
 * empty so the chip never boots (#1529).
 */
import { describe, expect, it } from "vitest";
import type { FirmwareBinary } from "../../src/api/types/firmware-jobs.js";
import { pickFlashTarget } from "../../src/components/firmware-install-dialog/install-flow.js";

const bin = (file: string): FirmwareBinary => ({ title: file, file });

describe("pickFlashTarget", () => {
  // esptool-js reports the chip *description*, not the bare family name.
  it("flashes an ESP8266EX firmware.bin at 0x0 (no factory variant exists)", () => {
    const target = pickFlashTarget("ESP8266EX", [
      bin("firmware.bin"),
      bin("firmware.elf"),
    ]);
    expect(target).toEqual({ binary: bin("firmware.bin"), address: 0x0 });
  });

  it("flashes an ESP8285 firmware.bin at 0x0", () => {
    const target = pickFlashTarget("ESP8285", [bin("firmware.bin")]);
    expect(target).toEqual({ binary: bin("firmware.bin"), address: 0x0 });
  });

  it("flashes an ESP32 merged factory image at 0x0", () => {
    const target = pickFlashTarget("ESP32-C3", [
      bin("firmware.bin"),
      bin("firmware.factory.bin"),
    ]);
    expect(target).toEqual({ binary: bin("firmware.factory.bin"), address: 0x0 });
  });

  it("flashes an ESP32 app image at 0x10000 when there's no factory image", () => {
    const target = pickFlashTarget("ESP32-C3", [bin("firmware.bin")]);
    expect(target).toEqual({ binary: bin("firmware.bin"), address: 0x10000 });
  });

  it("returns null when there are no binaries", () => {
    expect(pickFlashTarget("ESP8266", [])).toBeNull();
  });
});
