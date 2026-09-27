import { afterEach, describe, expect, it, vi } from "vitest";

const rtl = vi.hoisted(() => ({ runAmbz2: vi.fn(), loadAmbz2Image: vi.fn() }));
vi.mock("../../../../src/platforms/rtl87xx/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAmbz2Engine: async () => ({}),
  runAmbz2: rtl.runAmbz2,
  loadAmbz2Image: rtl.loadAmbz2Image,
}));

import { RTL87XX_SERIAL_LOGS } from "../../../../src/platforms/rtl87xx/serial-logs.js";
import type {
  ReceiverNote,
  ReceiverRun,
  ReceiverRunHooks,
} from "../../../../src/web/flash-receiver/receiver-engine.js";
import { rtlAmbz2ReceiverEngine } from "../../../../src/web/platforms/rtl87xx/receiver-engine.js";

const localize = (k: string) => k;
const image = { familyId: 1, board: "bw15", runs: [], totalBytes: 0 };
const uf2 = [{ address: 0, data: new Uint8Array([1, 2, 3]) }];
const port = {} as SerialPort;

function hooks(): ReceiverRunHooks & { states: string[]; waits: string[] } {
  const rec = {
    states: [] as string[],
    waits: [] as string[],
    onState: (state: string, message: string) => rec.states.push(`${state}:${message}`),
    onProgress: vi.fn(),
    onLog: vi.fn(),
    onWaiting: (note: ReceiverNote) => rec.waits.push(note.message),
  };
  return rec;
}

async function prepared(): Promise<ReceiverRun> {
  rtl.loadAmbz2Image.mockResolvedValue({ image });
  const plan = await rtlAmbz2ReceiverEngine.prepare(uf2, false, localize);
  if ("error" in plan) throw new Error(plan.error);
  return plan.run;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("rtlAmbz2ReceiverEngine", () => {
  it("takes the UF2 as one part at address 0 and rejects anything else unparsed", async () => {
    expect(
      await rtlAmbz2ReceiverEngine.prepare(
        [{ address: 0x1000, data: new Uint8Array(1) }],
        false,
        localize
      )
    ).toEqual({ error: "firmware.rtl_bad_uf2 (not a single UF2 part)" });
    expect(rtl.loadAmbz2Image).not.toHaveBeenCalled();
  });

  it("names a parse failure the shared parser's way (an RTL8710B image is not this engine's)", async () => {
    rtl.loadAmbz2Image.mockResolvedValue({
      key: "firmware.rtl_wrong_family",
      detail: "family 0x22e0d6fc",
    });
    expect(await rtlAmbz2ReceiverEngine.prepare(uf2, false, localize)).toEqual({
      error: "firmware.rtl_wrong_family (family 0x22e0d6fc)",
    });
  });

  it("parses once and flashes that image, relaying the strap wait and the link", async () => {
    const run = await prepared();
    rtl.runAmbz2.mockImplementation(async (_port, _image, h) => {
      h.onWaitingForStrap();
      h.onLinked();
      h.onProgress(50);
      return { rebooted: true };
    });
    const h = hooks();
    expect(await run(port, h)).toEqual({ rebooted: true });
    expect(rtl.loadAmbz2Image).toHaveBeenCalledOnce();
    expect(rtl.runAmbz2).toHaveBeenCalledWith(port, image, expect.anything());
    expect(h.waits).toEqual(["firmware.rtl_wait_desc"]);
    expect(h.states).toEqual([
      "connecting:firmware.rtl_connecting",
      "installing:firmware.status_flashing",
    ]);
    expect(h.onProgress).toHaveBeenCalledWith(50);
  });

  it("asks for a manual reset when the adapter could not reboot the board", async () => {
    const run = await prepared();
    rtl.runAmbz2.mockResolvedValue({ rebooted: false });
    expect(await run(port, hooks())).toEqual({
      rebooted: false,
      note: { message: "firmware.rtl_done_manual_reset" },
    });
  });

  it("reports a failed flash and the logs policy that releases the lines", async () => {
    const run = await prepared();
    rtl.runAmbz2.mockResolvedValue({ detail: "no ROM" });
    const h = hooks();
    expect(await run(port, h)).toBeNull();
    expect(h.states[h.states.length - 1]).toBe("error:firmware.rtl_flash_failed: no ROM");
    expect(rtlAmbz2ReceiverEngine.logs).toBe(RTL87XX_SERIAL_LOGS);
  });
});
