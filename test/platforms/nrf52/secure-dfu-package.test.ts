import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ parseDfuPackage: vi.fn() }));
vi.mock("../../../src/platforms/nrf52/nrf-dfu.js", () => ({
  parseDfuPackage: mocks.parseDfuPackage,
}));

import { loadSecureDfuPackage } from "../../../src/platforms/nrf52/index.js";
import type { DfuFirmwarePart } from "../../../src/platforms/nrf52/nrf-dfu.js";
import { secureDfuRefusal } from "../../../src/platforms/nrf52/secure-dfu-package.js";

const part = (type: DfuFirmwarePart["type"]): DfuFirmwarePart => ({
  type,
  mode: 4,
  bin: new Uint8Array(1),
  dat: new Uint8Array(1),
});

describe("secureDfuRefusal", () => {
  it("takes one application image and nothing else", () => {
    expect(secureDfuRefusal({ parts: [part("application")] })).toBeUndefined();
    expect(secureDfuRefusal({ parts: [] })).toBe(
      "the package holds no image; Secure DFU over USB takes one application image"
    );
    expect(
      secureDfuRefusal({ parts: [part("softdevice+bootloader"), part("application")] })
    ).toBe(
      "the package holds softdevice+bootloader + application; Secure DFU over USB takes one application image"
    );
  });
});

describe("loadSecureDfuPackage", () => {
  it("parses the package and refuses one with more than the application", async () => {
    const pkg = { parts: [part("application")] };
    mocks.parseDfuPackage.mockReturnValueOnce(pkg);
    expect(await loadSecureDfuPackage(new Uint8Array())).toEqual({ pkg });

    mocks.parseDfuPackage.mockReturnValueOnce({ parts: [part("bootloader")] });
    expect(await loadSecureDfuPackage(new Uint8Array())).toEqual({
      key: "firmware.nrf_bad_package",
      detail:
        "the package holds bootloader; Secure DFU over USB takes one application image",
    });

    mocks.parseDfuPackage.mockImplementationOnce(() => {
      throw new Error("no manifest");
    });
    expect(await loadSecureDfuPackage(new Uint8Array())).toEqual({
      key: "firmware.nrf_bad_package",
      detail: "no manifest",
    });
  });
});
