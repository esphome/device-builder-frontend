import { afterEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ flashAmbz2: vi.fn() }));
const parser = vi.hoisted(() => ({
  parseAmbz2Image: vi.fn(),
  Ambz2ImageError: class Ambz2ImageError extends Error {
    constructor(readonly key: string) {
      super(key);
    }
  },
}));
vi.mock("../../../../src/platforms/rtl87xx/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAmbz2Engine: async () => engine,
  loadLibreTinyParser: async () => parser,
}));

import { RTL87XX_SERIAL_LOGS } from "../../../../src/platforms/rtl87xx/serial-logs.js";
import type { ReceiverRunHooks } from "../../../../src/web/flash-receiver/receiver-engine.js";
import { rtlAmbz2ReceiverEngine } from "../../../../src/web/platforms/rtl87xx/receiver-engine.js";

const localize = (k: string) => k;
const image = { familyId: 1, board: "bw15", runs: [], totalBytes: 0 };
const uf2 = [{ address: 0, data: new Uint8Array([1, 2, 3]) }];

function hooks(): ReceiverRunHooks & { states: string[]; waits: string[] } {
  const rec = {
    states: [] as string[],
    waits: [] as string[],
    localize,
    onState: (state: string, message: string) => rec.states.push(`${state}:${message}`),
    onProgress: vi.fn(),
    onLog: vi.fn(),
    onWaiting: (message: string) => rec.waits.push(message),
  };
  return rec;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("rtlAmbz2ReceiverEngine", () => {
  it("takes the UF2 as one part at address 0 and rejects anything else", async () => {
    parser.parseAmbz2Image.mockReturnValue(image);
    expect(await rtlAmbz2ReceiverEngine.validate(uf2, localize)).toBeNull();
    expect(
      await rtlAmbz2ReceiverEngine.validate(
        [{ address: 0x1000, data: new Uint8Array(1) }],
        localize
      )
    ).toContain("firmware.rtl_bad_uf2");
  });

  it("names a wrong image family the parser's way (an RTL8710B image is not this engine's)", async () => {
    parser.parseAmbz2Image.mockImplementation(() => {
      throw new parser.Ambz2ImageError("firmware.rtl_wrong_family");
    });
    expect(await rtlAmbz2ReceiverEngine.validate(uf2, localize)).toContain(
      "firmware.rtl_wrong_family"
    );
  });

  it("flashes through the AmebaZ2 engine, relaying the strap wait and the link", async () => {
    parser.parseAmbz2Image.mockReturnValue(image);
    engine.flashAmbz2.mockImplementation(async (_port, _image, h) => {
      h.onWaitingForStrap();
      h.onLinked();
      h.onProgress(50);
      return true;
    });
    const h = hooks();
    const port = {} as SerialPort;
    expect(await rtlAmbz2ReceiverEngine.run(port, uf2, false, h)).toBe(true);
    expect(engine.flashAmbz2).toHaveBeenCalledWith(port, image, expect.anything());
    expect(h.waits).toEqual(["firmware.rtl_wait_desc"]);
    expect(h.states).toEqual([
      "connecting:firmware.rtl_connecting",
      "installing:dashboard.status_installing",
    ]);
    expect(h.onProgress).toHaveBeenCalledWith(50);
  });

  it("asks for a manual reset when the adapter could not reboot the board", async () => {
    parser.parseAmbz2Image.mockReturnValue(image);
    engine.flashAmbz2.mockResolvedValue(false);
    const h = hooks();
    expect(await rtlAmbz2ReceiverEngine.run({} as SerialPort, uf2, false, h)).toBe(true);
    expect(h.waits).toEqual(["firmware.rtl_done_manual_reset"]);
  });

  it("reports a failed flash and the logs policy that releases the lines", async () => {
    parser.parseAmbz2Image.mockReturnValue(image);
    engine.flashAmbz2.mockRejectedValue(new Error("no ROM"));
    const h = hooks();
    expect(await rtlAmbz2ReceiverEngine.run({} as SerialPort, uf2, false, h)).toBe(false);
    expect(h.states[h.states.length - 1]).toContain("firmware.rtl_flash_failed");
    expect(rtlAmbz2ReceiverEngine.logs).toBe(RTL87XX_SERIAL_LOGS);
  });
});
