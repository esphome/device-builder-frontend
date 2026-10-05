import { afterEach, describe, expect, it, vi } from "vitest";

const rtl = vi.hoisted(() => ({ run: vi.fn(), load: vi.fn() }));
const ambz = vi.hoisted(() => ({ run: vi.fn(), load: vi.fn() }));
const bk = vi.hoisted(() => ({ run: vi.fn(), load: vi.fn() }));
const ln = vi.hoisted(() => ({ run: vi.fn(), load: vi.fn() }));
const port = vi.hoisted(() => ({}) as SerialPort);
// The picker is the helper's own; here the run gets a port as if picked.
vi.mock("../../../src/web/flash-receiver/serial-run.js", () => ({
  serialRun:
    (_localize: unknown, run: (port: SerialPort, hooks: unknown) => unknown) =>
    (hooks: unknown) =>
      run(port, hooks),
}));
vi.mock("../../../src/platforms/rtl87xx/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAmbz2Engine: async () => ({}),
  runAmbz2: rtl.run,
  loadAmbz2Image: rtl.load,
  loadAmbzEngine: async () => ({}),
  runAmbz: ambz.run,
  loadAmbzImage: ambz.load,
}));

vi.mock("../../../src/platforms/bk72xx/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBekenEngine: async () => ({}),
  runBeken: bk.run,
  loadBekenImage: bk.load,
}));

vi.mock("../../../src/platforms/ln882x/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadLn882xEngine: async () => ({}),
  warmLn882x: async () => ({}),
  runLn882x: ln.run,
  loadLn882xImage: ln.load,
}));

import { recordingHooks as hooks } from "../_receiver-hooks.js";
import { BK72XX_SERIAL_LOGS } from "../../../src/platforms/bk72xx/serial-logs.js";
import { LN882X_SERIAL_LOGS } from "../../../src/platforms/ln882x/serial-logs.js";
import { RTL87XX_SERIAL_LOGS } from "../../../src/platforms/rtl87xx/serial-logs.js";
import { libretinyReceiverEngine } from "../../../src/web/flash-receiver/libretiny-receiver-engine.js";
import type { ReceiverRun } from "../../../src/web/flash-receiver/receiver-engine.js";
import { BK_INSTALL } from "../../../src/web/platforms/bk72xx/install.js";
import { bkUartReceiverEngine } from "../../../src/web/platforms/bk72xx/receiver-engine.js";
import { LN_INSTALL } from "../../../src/web/platforms/ln882x/install.js";
import { lnUartReceiverEngine } from "../../../src/web/platforms/ln882x/receiver-engine.js";
import { RTL_AMBZ_INSTALL } from "../../../src/web/platforms/rtl87xx/ambz-install.js";
import { rtlAmbzReceiverEngine } from "../../../src/web/platforms/rtl87xx/ambz-receiver-engine.js";
import { RTL_AMBZ2_INSTALL } from "../../../src/web/platforms/rtl87xx/ambz2-install.js";
import { rtlAmbz2ReceiverEngine } from "../../../src/web/platforms/rtl87xx/receiver-engine.js";

const localize = (k: string) => k;
const image = { familyId: 1, board: "board", runs: [], totalBytes: 0 };
const uf2 = [{ address: 0, data: new Uint8Array([1, 2, 3]) }];

afterEach(() => {
  vi.clearAllMocks();
});

// What a family's engine is: its mocks, its copy, its logs, and what the
// receiver makes of a flash that went through.
describe.each([
  {
    name: "rtlAmbz2ReceiverEngine",
    engine: rtlAmbz2ReceiverEngine,
    install: RTL_AMBZ2_INSTALL,
    mocks: rtl,
    keys: "firmware.rtl_",
    logs: RTL87XX_SERIAL_LOGS,
    result: { rebooted: true },
  },
  {
    name: "bkUartReceiverEngine",
    engine: bkUartReceiverEngine,
    install: BK_INSTALL,
    mocks: bk,
    keys: "firmware.bk_",
    logs: BK72XX_SERIAL_LOGS,
    // The flash went over UART1; the logs are on another pad.
    result: { logsElsewhere: true, note: { message: "web.bk.logs_elsewhere" } },
  },
  {
    name: "lnUartReceiverEngine",
    engine: lnUartReceiverEngine,
    install: LN_INSTALL,
    mocks: ln,
    keys: "firmware.ln_",
    logs: LN882X_SERIAL_LOGS,
    // The flash went over UART0; the logs are on UART1.
    result: { logsElsewhere: true, note: { message: "web.ln.logs_elsewhere" } },
  },
  {
    name: "rtlAmbzReceiverEngine",
    engine: rtlAmbzReceiverEngine,
    install: RTL_AMBZ_INSTALL,
    mocks: ambz,
    keys: "firmware.rtl_",
    // UART2 is both the flash and the log port.
    logs: RTL87XX_SERIAL_LOGS,
    result: { rebooted: true },
  },
])("$name", ({ engine, install, mocks, keys, logs, result }) => {
  async function prepared(): Promise<ReceiverRun> {
    mocks.load.mockResolvedValue({ image });
    const plan = await engine.prepare(uf2, false, localize);
    if ("error" in plan) throw new Error(plan.error);
    return plan.run;
  }

  it("takes the UF2 as one part at address 0 and rejects anything else unparsed", async () => {
    expect(
      await engine.prepare(
        [{ address: 0x1000, data: new Uint8Array(1) }],
        false,
        localize
      )
    ).toEqual({ error: `${keys}bad_uf2 (not a single UF2 part)`, retryable: false });
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("names a parse failure the shared parser's way (an image of another family)", async () => {
    mocks.load.mockResolvedValue({ key: `${keys}wrong_family`, detail: "family 0x1" });
    expect(await engine.prepare(uf2, false, localize)).toEqual({
      error: `${keys}wrong_family (family 0x1)`,
      retryable: false,
    });
    // The parser chunk did not load: the same bytes can be checked again.
    mocks.load.mockResolvedValue({
      key: "firmware.engine_load_failed",
      detail: "Failed to fetch",
    });
    expect(await engine.prepare(uf2, false, localize)).toEqual({
      error: "web.install.tools_load_failed (Failed to fetch)",
      retryable: true,
    });
  });

  it("parses once and flashes that image, relaying the wait for the user and the link", async () => {
    const run = await prepared();
    mocks.run.mockImplementation(async (_port, _image, h) => {
      h.onWaiting();
      h.onLinked();
      h.onProgress(50);
      return { rebooted: true };
    });
    const h = hooks();

    expect(await run(h)).toEqual(result);

    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.run).toHaveBeenCalledWith(port, image, expect.anything());
    expect(h.waits).toEqual([install.copy.waitDetail]);
    expect(h.states).toEqual([
      `connecting:${keys}connecting`,
      "installing:firmware.status_flashing",
    ]);
    expect(h.onProgress).toHaveBeenCalledWith(50);
  });

  it("fetches the engine with the parse, and leaves a fetch that fails to the run", async () => {
    const loadEngine = vi.spyOn(install, "loadEngine");
    loadEngine.mockRejectedValue(new TypeError("Failed to fetch"));

    await prepared();

    expect(loadEngine).toHaveBeenCalledOnce();
    loadEngine.mockRestore();
  });

  it("reports a failed flash, and has the logs policy of its family", async () => {
    const run = await prepared();
    mocks.run.mockResolvedValue({ detail: "no answer" });
    const h = hooks();

    expect(await run(h)).toBeNull();

    expect(h.states[h.states.length - 1]).toBe(`error:${keys}flash_failed: no answer`);
    expect(engine.logs).toBe(logs);
  });
});

describe("rtlAmbz2ReceiverEngine", () => {
  it("names a failure by the copy of its own, as the dialog does", async () => {
    rtl.load.mockResolvedValue({ image });
    const plan = await rtlAmbz2ReceiverEngine.prepare(uf2, false, localize);
    rtl.run.mockResolvedValue({
      detail: "Failed to fetch",
      key: "firmware.engine_load_failed",
    });
    const h = hooks();

    expect("run" in plan && (await plan.run(h))).toBeNull();

    expect(h.states[h.states.length - 1]).toBe(
      "error:firmware.engine_load_failed: Failed to fetch"
    );
  });

  it("asks for a manual reset when the adapter could not reboot the board", async () => {
    rtl.load.mockResolvedValue({ image });
    const plan = await rtlAmbz2ReceiverEngine.prepare(uf2, false, localize);
    rtl.run.mockResolvedValue({ rebooted: false });

    expect("run" in plan && (await plan.run(hooks()))).toEqual({
      rebooted: false,
      note: { message: "firmware.rtl_done_manual_reset" },
    });
  });
});

describe("rtlAmbzReceiverEngine", () => {
  it("opens an RTL8710B's logs at once while it waits for its reset", async () => {
    ambz.load.mockResolvedValue({ image });
    const plan = await rtlAmbzReceiverEngine.prepare(uf2, false, localize);
    ambz.run.mockResolvedValue({ rebooted: false });

    expect("run" in plan && (await plan.run(hooks()))).toEqual({
      rebooted: false,
      notice: "firmware.rtl_ambz_done_reset",
      note: { message: "web.rtl.install_done_reset" },
    });
  });
});

describe("bkUartReceiverEngine", () => {
  it("names a failure by the copy of its own, as the dialog does", async () => {
    bk.load.mockResolvedValue({ image });
    const plan = await bkUartReceiverEngine.prepare(uf2, false, localize);
    bk.run.mockResolvedValue({
      detail: "built for a BK7238",
      key: "firmware.bk_wrong_chip",
    });
    const h = hooks();

    expect("run" in plan && (await plan.run(h))).toBeNull();

    expect(h.states[h.states.length - 1]).toBe(
      "error:firmware.bk_wrong_chip: built for a BK7238"
    );
  });
});

describe("libretinyReceiverEngine", () => {
  // A family whose board can be left in its downloader and has no line for it.
  const bare = libretinyReceiverEngine(
    {
      ...RTL_AMBZ2_INSTALL,
      copy: { ...RTL_AMBZ2_INSTALL.copy, doneByHand: undefined },
      load: async () => ({ image }),
      run: async () => ({ rebooted: false }),
    },
    RTL87XX_SERIAL_LOGS
  );

  it("says the board did not reboot, with or without a line for it", async () => {
    const plan = await bare.prepare(uf2, false, localize);

    expect("run" in plan && (await plan.run(hooks()))).toEqual({
      rebooted: false,
      note: { message: "web.install.done_reset_by_hand" },
    });
  });

  it("asks for the reset that is left before it says where the logs are", async () => {
    const elsewhere = libretinyReceiverEngine(
      {
        ...RTL_AMBZ2_INSTALL,
        copy: { ...RTL_AMBZ2_INSTALL.copy, logsElsewhere: "web.bk.logs_elsewhere" },
        load: async () => ({ image }),
        run: async () => ({ rebooted: false }),
      },
      RTL87XX_SERIAL_LOGS
    );
    const plan = await elsewhere.prepare(uf2, false, localize);

    expect("run" in plan && (await plan.run(hooks()))).toEqual({
      logsElsewhere: true,
      note: { message: "firmware.rtl_done_manual_reset web.bk.logs_elsewhere" },
    });
  });

  it("opens the logs on the flashed port when the opener says they are there", async () => {
    const onFlashPort = libretinyReceiverEngine(
      {
        ...RTL_AMBZ2_INSTALL,
        copy: { ...RTL_AMBZ2_INSTALL.copy, logsElsewhere: "web.bk.logs_elsewhere" },
        load: async () => ({ image }),
        run: async () => ({ rebooted: true }),
      },
      RTL87XX_SERIAL_LOGS
    );
    const plan = await onFlashPort.prepare(uf2, false, localize, "flash-port");

    expect("run" in plan && (await plan.run(hooks()))).toEqual({
      rebooted: true,
      note: undefined,
    });
  });

  it("opens no logs and points nowhere for a device without serial logs", async () => {
    const off = libretinyReceiverEngine(
      {
        ...RTL_AMBZ2_INSTALL,
        copy: { ...RTL_AMBZ2_INSTALL.copy, logsElsewhere: "web.bk.logs_elsewhere" },
        load: async () => ({ image }),
        run: async () => ({ rebooted: true }),
      },
      RTL87XX_SERIAL_LOGS
    );
    const plan = await off.prepare(uf2, false, localize, "off");

    expect("run" in plan && (await plan.run(hooks()))).toEqual({
      logsElsewhere: true,
      note: undefined,
    });
  });
});
