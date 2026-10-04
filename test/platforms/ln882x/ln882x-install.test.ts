// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  dispatchShowLogsAfterInstall: vi.fn(() => true),
  flashLn882x: vi.fn<(p: unknown, i: unknown, hooks: FlashHooks) => Promise<boolean>>(),
  loadRamcode: vi.fn(async () => new Uint8Array(0)),
}));
type FlashHooks = {
  onProgress: (p: number) => void;
  onLog?: (line: string) => void;
  onLinked?: () => void;
  onWaiting?: () => void;
  signal?: AbortSignal;
};
vi.mock("../../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/util/post-install-dispatch.js", () => ({
  dispatchShowLogsAfterInstall: mocks.dispatchShowLogsAfterInstall,
}));
vi.mock("../../../src/platforms/ln882x/ln882x-flasher.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/platforms/ln882x/ln882x-flasher.js")
  >()),
  flashLn882x: mocks.flashLn882x,
}));
vi.mock("../../../src/platforms/ln882x/ln882x-ramcode.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadRamcode: mocks.loadRamcode,
}));
const seams = vi.hoisted(() => ({ loadLn882xImage: vi.fn() }));
vi.mock("../../../src/platforms/ln882x/index.js", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../../src/platforms/ln882x/index.js")>();
  seams.loadLn882xImage.mockImplementation(real.loadLn882xImage);
  return { ...real, loadLn882xImage: seams.loadLn882xImage };
});

import { argsLocalize } from "../../_dom.js";
import {
  ltHeaderTags,
  ltPartInfoTags,
  ltPartitionTable,
  makeLibreTinyUf2,
} from "../../_make-libretiny-uf2.js";
import { lapsedPick } from "../../_web-serial.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { FirmwareBinary } from "../../../src/api/types/firmware-jobs.js";
import type { LibreTinyImage } from "../../../src/platforms/libretiny-uf2.js";
import { Ln882xStartAddrError } from "../../../src/platforms/ln882x/ln882x-flasher.js";
import {
  ln882xInstall,
  lnDoFlash,
  lnImage,
  startLn882xInstall,
} from "../../../src/platforms/ln882x/ln882x-install.js";
import { Ln882xRamcodeError } from "../../../src/platforms/ln882x/ln882x-ramcode.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import {
  asHost,
  bin,
  makeFlashHost,
} from "../../components/firmware-install-dialog/_flash-host.js";

const LN882H = 0xa38090a8;
const AMBZ2 = 0xe08f7564;

const uf2 = (family: number = LN882H): ArrayBuffer =>
  makeLibreTinyUf2({
    family,
    headerTags: ltHeaderTags({
      BOARD: "generic-ln882h",
      FAL_PTABLE: ltPartitionTable([{ name: "app", offset: 0x7000, length: 0x12c000 }]),
    }),
    blocks: [{ addr: 0, fill: 0x5a, tags: ltPartInfoTags([0, 0, 0, 1, 0, 0], ["app"]) }],
  }).buffer;

const device = {
  configuration: "plug.yaml",
  name: "plug",
  target_platform: "ln882x",
  mcu: "ln882h",
} as ConfiguredDevice;
const image: LibreTinyImage = {
  familyId: LN882H,
  board: "generic-ln882h",
  runs: [{ address: 0x7000, data: new Uint8Array(256) }],
  totalBytes: 256,
};

function makeHost(opts: { binaries?: FirmwareBinary[]; uf2?: ArrayBuffer } = {}) {
  return makeFlashHost(
    device,
    {
      binaries: opts.binaries ?? [bin("firmware.uf2", "uf2"), bin("firmware.bin", "bin")],
      downloadBytes: opts.uf2 ?? uf2(),
    },
    {
      _logsPort: null as SerialPort | null,
      _open: true,
      _showLogsAfterInstall: false,
    }
  );
}
type Host = ReturnType<typeof makeHost>;

/** The device, its logger moved by its config. */
const logging = (
  logger_interface: string | null,
  logger_baud_rate: number | null = null
): ConfiguredDevice => ({ ...device, logger_interface, logger_baud_rate });

function readyHost(): Host {
  const host = makeHost();
  lnImage.set(asHost(host), image);
  host._binaries = [bin("firmware.uf2", "uf2")];
  host._step = "ln-ready";
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startLn882xInstall", () => {
  it("compiles, picks the UF2 by type, parses it and lands on the ready step", async () => {
    const host = makeHost();

    await startLn882xInstall(asHost(host));

    expect(host._api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "plug.yaml",
      "firmware.uf2"
    );
    expect(lnImage.get(asHost(host))?.runs.map((r) => r.address)).toEqual([0x7000]);
    expect(host._binaries.map((b) => b.file)).toEqual(["firmware.uf2"]);
    expect(host._step).toBe("ln-ready");
    expect(host._statusMessage).toBe("firmware.ln_ready_title");
    // The engine and the RAM code start loading while the user reads on.
    await vi.waitFor(() => expect(mocks.loadRamcode).toHaveBeenCalledOnce());
  });

  it("does nothing without a device", async () => {
    const host = makeHost();
    host._device = null;

    await startLn882xInstall(asHost(host));

    expect(host._api.firmwareCompile).not.toHaveBeenCalled();
  });

  it("loads the parser after the download and names a failed chunk fetch", async () => {
    const host = makeHost();
    seams.loadLn882xImage.mockResolvedValueOnce({
      key: "firmware.engine_load_failed",
      detail: "Failed to fetch",
    });

    await startLn882xInstall(asHost(host));

    expect(host._statusMessage).toBe("firmware.engine_load_failed");
    expect(lnImage.get(asHost(host))).toBeNull();
    expect(
      vi.mocked(host._api.firmwareDownloadBytes).mock.invocationCallOrder[0]
    ).toBeLessThan(seams.loadLn882xImage.mock.invocationCallOrder[0]);
  });

  it("names an empty build by the flow that asked for it", async () => {
    const inApp = makeHost({ binaries: [] });
    await startLn882xInstall(asHost(inApp));
    expect(inApp._statusMessage).toBe("firmware.no_binaries");

    // The hand-off to web.esphome.io reads through the same download.
    const handoff = makeHost({ binaries: [] });
    Object.assign(handoff, { _installer: "web-flash" });
    await startLn882xInstall(asHost(handoff));
    expect(handoff._statusMessage).toBe("firmware.no_flashable_binary");
  });

  it("fails when the build produced no UF2", async () => {
    const host = makeHost({ binaries: [bin("firmware.bin", "bin")] });

    await startLn882xInstall(asHost(host));

    expect(host._statusMessage).toBe("firmware.no_uf2");
    expect(host._api.firmwareDownloadBytes).not.toHaveBeenCalled();
  });

  it("refuses an image of a family that is not the LN882H's", async () => {
    const host = makeHost({ uf2: uf2(AMBZ2) });

    await startLn882xInstall(asHost(host));

    expect(host._statusMessage).toBe("firmware.ln_wrong_family");
    expect(host._errorMessage).toContain("0xe08f7564");
    expect(lnImage.get(asHost(host))).toBeNull();
  });

  it("treats a malformed file as a bad UF2", async () => {
    const host = makeHost({ uf2: new Uint8Array(512).buffer });

    await startLn882xInstall(asHost(host));

    expect(host._statusMessage).toBe("firmware.ln_bad_uf2");
  });

  it("leaves a dialog that moved to another device untouched", async () => {
    const host = makeHost();
    vi.mocked(host._api.firmwareDownloadBytes).mockImplementation(async () => {
      host._device = { ...device, configuration: "other.yaml" } as ConfiguredDevice;
      return uf2();
    });

    await startLn882xInstall(asHost(host));

    expect(lnImage.get(asHost(host))).toBeNull();
    expect(host._step).not.toBe("ln-ready");
  });

  it("leaves a dialog that moved on while the image was parsed untouched", async () => {
    const host = makeHost();
    seams.loadLn882xImage.mockImplementationOnce(async () => {
      host._device = { ...device, configuration: "other.yaml" } as ConfiguredDevice;
      return { image };
    });

    await startLn882xInstall(asHost(host));

    expect(lnImage.get(asHost(host))).toBeNull();
    expect(host._step).not.toBe("ln-ready");
  });
});

describe("lnDoFlash", () => {
  it("does nothing without an image", async () => {
    const host = makeHost();

    await lnDoFlash(asHost(host));

    expect(mocks.requestSerialPort).not.toHaveBeenCalled();
  });

  it("does nothing when the port picker is dismissed", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue(null);

    await lnDoFlash(asHost(host));

    expect(host._step).toBe("ln-ready");
    expect(host._flashBusy).toBe(false);
    expect(mocks.flashLn882x).not.toHaveBeenCalled();
  });

  it("ignores a second click while the picker is open", async () => {
    const host = readyHost();
    host._flashBusy = true;

    await lnDoFlash(asHost(host));

    expect(mocks.requestSerialPort).not.toHaveBeenCalled();
  });

  it("reports a failed picker", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockRejectedValue(new Error("no serial"));
    await lnDoFlash(asHost(host));
    expect(host._statusMessage).toBe("firmware.browser_flash_connect_failed");
    expect(host._errorMessage).toBe("no serial");

    mocks.requestSerialPort.mockRejectedValue(lapsedPick());
    await lnDoFlash(asHost(host));
    expect(host._errorMessage).toBe("serial.picker_needs_click");
  });

  it("walks the connect, reset guide, flashing and done steps with the engine's hooks", async () => {
    const host = readyHost();
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    const seen: string[] = [];
    mocks.flashLn882x.mockImplementation(async (_p, _i, hooks) => {
      seen.push(`${host._step}:${host._statusMessage}`);
      expect(host._flashAbort?.signal).toBe(hooks.signal);
      hooks.onWaiting?.();
      seen.push(`${host._step}:${host._statusMessage}`);
      hooks.onLinked?.();
      seen.push(`${host._step}:${host._statusMessage}`);
      hooks.onProgress(42);
      expect(host._flashPercent).toBe(42);
      hooks.onLog?.("Writing 0x7000 (256 bytes)");
      return true;
    });

    await lnDoFlash(asHost(host));

    expect(mocks.flashLn882x).toHaveBeenCalledWith(port, image, expect.anything());
    expect(seen).toEqual([
      "ln-connect:firmware.ln_connecting",
      "ln-wait:firmware.ln_wait_title",
      "flashing:firmware.status_flashing",
    ]);
    expect(host._log.lines).toContain("Writing 0x7000 (256 bytes)");
    expect(host._step).toBe("done");
    expect(host._statusMessage).toBe("firmware.ln_done_logs_on_uart1");
    expect(host._flashAbort).toBeNull();
    // The flash went over UART0; the logs are on UART1 by default.
    expect(host._logsPort).toBeNull();
  });

  it("opens the logs on the flashed port when the config puts them on UART0", async () => {
    const host = readyHost();
    host._device = logging("UART0");
    host._showLogsAfterInstall = true;
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashLn882x.mockResolvedValue(true);

    await lnDoFlash(asHost(host));

    expect(host._statusMessage).toBe("firmware.status_done");
    expect(host._logsPort).toBe(port);
    expect(mocks.dispatchShowLogsAfterInstall).toHaveBeenCalledWith(
      host,
      expect.objectContaining({ webSerialPort: port, targetPlatform: "ln882x" })
    );
    expect(host._open).toBe(false);
  });

  it("keeps the UART0 port for Show logs without opening them unasked", async () => {
    const host = readyHost();
    host._device = logging("UART0");
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashLn882x.mockResolvedValue(true);

    await lnDoFlash(asHost(host));

    expect(host._step).toBe("done");
    expect(host._logsPort).toBe(port);
    expect(mocks.dispatchShowLogsAfterInstall).not.toHaveBeenCalled();
  });

  it.each([
    {
      why: "an explicit UART1",
      device: logging("UART1"),
      message: "firmware.ln_done_logs_on_uart1",
    },
    {
      why: "a disabled logger",
      device: logging("UART0", 0),
      message: "firmware.status_done",
    },
  ])("keeps no port for $why", async ({ device: config, message }) => {
    const host = readyHost();
    host._localize = argsLocalize;
    host._device = config;
    host._showLogsAfterInstall = true;
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashLn882x.mockResolvedValue(true);

    await lnDoFlash(asHost(host));

    expect(host._step).toBe("done");
    expect(host._statusMessage).toBe(message);
    expect(host._logsPort).toBeNull();
    expect(mocks.dispatchShowLogsAfterInstall).not.toHaveBeenCalled();
  });

  it("drops what the engine reports once the dialog moved on", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashLn882x.mockImplementation(async (_p, _i, hooks) => {
      host._flashImage = null;
      hooks.onWaiting?.();
      hooks.onLinked?.();
      hooks.onProgress(42);
      hooks.onLog?.("late");
      return true;
    });

    await lnDoFlash(asHost(host));

    expect(host._step).toBe("ln-connect");
    expect(host._flashPercent).toBe(0);
    expect(host._log.lines).not.toContain("late");
  });

  it("reports a failed flash with the engine's reason", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashLn882x.mockRejectedValue(new Error("The CRC of the flash at 0x11000"));

    await lnDoFlash(asHost(host));

    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.ln_flash_failed");
    expect(host._errorMessage).toContain("0x11000");
  });

  it("names a loader that could not be downloaded", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashLn882x.mockRejectedValue(
      new Ln882xRamcodeError("firmware.ln_ramcode_unavailable", "HTTP 503")
    );

    await lnDoFlash(asHost(host));

    expect(host._statusMessage).toBe("firmware.ln_ramcode_unavailable");
    expect(host._errorMessage).toBe("HTTP 503");
  });

  it("names a start address the chip refused under the flash failure", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashLn882x.mockRejectedValue(new Ln882xStartAddrError(0x7000));

    await lnDoFlash(asHost(host));

    expect(host._statusMessage).toBe("firmware.ln_flash_failed");
    expect(host._errorMessage).toBe("The chip refused the start address 0x7000");
  });

  it("asks for a reset by hand when the chip was not rebooted, keeping the UART0 port for Show logs", async () => {
    const host = readyHost();
    host._device = logging("UART0");
    host._showLogsAfterInstall = true;
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashLn882x.mockResolvedValue(false);

    await lnDoFlash(asHost(host));

    expect(host._step).toBe("done");
    expect(host._statusMessage).toBe("firmware.ln_done_manual_reset");
    // Not opened before the reset, but there for Show logs after it.
    expect(host._logsPort).toBe(port);
    expect(mocks.dispatchShowLogsAfterInstall).not.toHaveBeenCalled();
  });

  it("keeps no port after a manual reset when the logs are elsewhere", async () => {
    const host = readyHost();
    host._device = logging(null);
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashLn882x.mockResolvedValue(false);

    await lnDoFlash(asHost(host));

    expect(host._statusMessage).toBe("firmware.ln_done_manual_reset");
    expect(host._logsPort).toBeNull();
  });

  it("names a board that was unplugged during the flash", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashLn882x.mockRejectedValue(new SerialDeviceLostError());

    await lnDoFlash(asHost(host));

    expect(host._statusMessage).toBe("firmware.ln_flash_failed");
    expect(host._errorMessage).toBe("serial.device_lost");
  });

  it("stays silent when the dialog was torn down during the flash", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashLn882x.mockImplementation(async () => {
      host._device = null;
      host._flashAbort?.abort();
      throw new DOMException("aborted", "AbortError");
    });

    await lnDoFlash(asHost(host));

    expect(host._step).toBe("ln-connect");
    expect(host._errorMessage).toBe("");
  });

  it("leaves the abort of a newer flash in place", async () => {
    const host = readyHost();
    const newer = new AbortController();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashLn882x.mockImplementation(async () => {
      host._flashAbort = newer;
      return true;
    });

    await lnDoFlash(asHost(host));

    expect(host._flashAbort).toBe(newer);
  });
});

describe("ln882xInstall", () => {
  it("hands its UF2 to web.esphome.io's LN882H flasher, checked as the in-app flow checks it", async () => {
    const handoff = ln882xInstall.handoff!;

    expect(handoff).toMatchObject({
      flasher: "ln-uart",
      erase: false,
      noArtifactKey: "firmware.no_uf2",
    });
    expect(
      handoff.pick([bin("firmware.bin", "bin"), bin("firmware.uf2", "uf2")], "ln882x")
        ?.file
    ).toBe("firmware.uf2");
    expect(await handoff.check!(new Uint8Array(uf2()))).toBeNull();
    expect(await handoff.check!(new Uint8Array(uf2(AMBZ2)))).toMatchObject({
      key: "firmware.ln_wrong_family",
    });
  });

  it.each([
    { why: "logs on UART0", config: { logger_interface: "UART0" }, logs: "flash-port" },
    { why: "the default UART1", config: { logger_interface: null }, logs: undefined },
    { why: "a disabled logger", config: { logger_baud_rate: 0 }, logs: "off" },
  ])("tells the receiver where the logs are for $why", ({ config, logs }) => {
    expect(
      ln882xInstall.handoff!.logs!({ ...device, logger_baud_rate: null, ...config })
    ).toBe(logs);
  });

  it("goes back to the ready step as the Retry target", () => {
    const host = readyHost();
    host._step = "error";

    ln882xInstall.showFirstStep(asHost(host));

    expect(host._step).toBe("ln-ready");
    expect(host._statusMessage).toBe("firmware.ln_ready_title");
  });

  it("flashes from the ready step's button", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue(null);

    await ln882xInstall.steps["ln-ready"].footer!().primary!.run(asHost(host));

    expect(mocks.requestSerialPort).toHaveBeenCalledOnce();
  });

  it("links the LibreTiny guide from the BOOT step", async () => {
    const { render } = await import("lit");
    const into = document.createElement("div");

    render(ln882xInstall.steps["ln-wait"].extra!(asHost(readyHost())), into);

    const link = into.querySelector("a")!;
    expect(link.href).toBe("https://docs.libretiny.eu/link/flashing-ln882h");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.textContent).toBe("firmware.ln_guide_link");
  });
});

describe("ln882xInstall.holdsPort", () => {
  it.each([
    { why: "logs on UART0", config: logging("UART0"), holds: true },
    { why: "the default UART1", config: logging(null), holds: false },
    { why: "an explicit UART1", config: logging("UART1"), holds: false },
    { why: "a disabled logger", config: logging("UART0", 0), holds: false },
    { why: "no device", config: null, holds: false },
  ])("is $holds for $why", ({ config, holds }) => {
    expect(ln882xInstall.holdsPort(config)).toBe(holds);
  });
});
