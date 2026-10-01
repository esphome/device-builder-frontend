// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  dispatchShowLogsAfterInstall: vi.fn(() => true),
  flashBeken: vi.fn<(p: unknown, i: unknown, hooks: FlashHooks) => Promise<void>>(),
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
vi.mock("../../../src/platforms/bk72xx/beken-flasher.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/platforms/bk72xx/beken-flasher.js")
  >()),
  flashBeken: mocks.flashBeken,
}));
const seams = vi.hoisted(() => ({ loadBekenImage: vi.fn() }));
vi.mock("../../../src/platforms/bk72xx/index.js", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../../src/platforms/bk72xx/index.js")>();
  seams.loadBekenImage.mockImplementation(real.loadBekenImage);
  return { ...real, loadBekenImage: seams.loadBekenImage };
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
import {
  BekenChipMismatchError,
  BekenUnknownFlashError,
} from "../../../src/platforms/bk72xx/beken-flasher.js";
import {
  bekenDoFlash,
  bekenImage,
  bekenInstall,
  startBekenInstall,
} from "../../../src/platforms/bk72xx/beken-install.js";
import type { LibreTinyImage } from "../../../src/platforms/libretiny-uf2.js";
import { SerialDeviceLostError } from "../../../src/util/serial-open-error.js";
import {
  asHost,
  bin,
  makeFlashHost,
} from "../../components/firmware-install-dialog/_flash-host.js";

const BK7238 = 0x159ac324;
const AMBZ2 = 0xe08f7564;

const uf2 = (family: number = BK7238): ArrayBuffer =>
  makeLibreTinyUf2({
    family,
    headerTags: ltHeaderTags({
      BOARD: "generic-bk7238",
      FAL_PTABLE: ltPartitionTable([{ name: "app", offset: 0x11000, length: 0x119000 }]),
    }),
    blocks: [{ addr: 0, fill: 0x5a, tags: ltPartInfoTags([0, 0, 0, 1, 0, 0], ["app"]) }],
  }).buffer;

const device = {
  configuration: "plug.yaml",
  name: "plug",
  target_platform: "bk72xx",
  mcu: "bk7238",
} as ConfiguredDevice;
const image: LibreTinyImage = {
  familyId: BK7238,
  board: "generic-bk7238",
  runs: [{ address: 0x11000, data: new Uint8Array(256) }],
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
  bekenImage.set(asHost(host), image);
  host._binaries = [bin("firmware.uf2", "uf2")];
  host._step = "bk-ready";
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startBekenInstall", () => {
  it("compiles, picks the UF2 by type, parses it and lands on the ready step", async () => {
    const host = makeHost();

    await startBekenInstall(asHost(host));

    expect(host._api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "plug.yaml",
      "firmware.uf2"
    );
    expect(bekenImage.get(asHost(host))?.runs.map((r) => r.address)).toEqual([0x11000]);
    expect(host._binaries.map((b) => b.file)).toEqual(["firmware.uf2"]);
    expect(host._step).toBe("bk-ready");
    expect(host._statusMessage).toBe("firmware.bk_ready_title");
  });

  it("does nothing without a device", async () => {
    const host = makeHost();
    host._device = null;

    await startBekenInstall(asHost(host));

    expect(host._api.firmwareCompile).not.toHaveBeenCalled();
  });

  it("loads the parser after the download and names a failed chunk fetch", async () => {
    const host = makeHost();
    seams.loadBekenImage.mockResolvedValueOnce({
      key: "firmware.engine_load_failed",
      detail: "Failed to fetch",
    });

    await startBekenInstall(asHost(host));

    expect(host._statusMessage).toBe("firmware.engine_load_failed");
    expect(bekenImage.get(asHost(host))).toBeNull();
    expect(
      vi.mocked(host._api.firmwareDownloadBytes).mock.invocationCallOrder[0]
    ).toBeLessThan(seams.loadBekenImage.mock.invocationCallOrder[0]);
  });

  it("names an empty build by the flow that asked for it", async () => {
    const inApp = makeHost({ binaries: [] });
    await startBekenInstall(asHost(inApp));
    expect(inApp._statusMessage).toBe("firmware.no_binaries");

    // The hand-off to web.esphome.io reads through the same download.
    const handoff = makeHost({ binaries: [] });
    Object.assign(handoff, { _installer: "web-flash" });
    await startBekenInstall(asHost(handoff));
    expect(handoff._statusMessage).toBe("firmware.no_flashable_binary");
  });

  it("fails when the build produced no UF2", async () => {
    const host = makeHost({ binaries: [bin("firmware.bin", "bin")] });

    await startBekenInstall(asHost(host));

    expect(host._statusMessage).toBe("firmware.no_uf2");
    expect(host._api.firmwareDownloadBytes).not.toHaveBeenCalled();
  });

  it("refuses an image of a family that is not Beken's", async () => {
    const host = makeHost({ uf2: uf2(AMBZ2) });

    await startBekenInstall(asHost(host));

    expect(host._statusMessage).toBe("firmware.bk_wrong_family");
    expect(host._errorMessage).toContain("0xe08f7564");
    expect(bekenImage.get(asHost(host))).toBeNull();
  });

  it("treats a malformed file as a bad UF2", async () => {
    const host = makeHost({ uf2: new Uint8Array(512).buffer });

    await startBekenInstall(asHost(host));

    expect(host._statusMessage).toBe("firmware.bk_bad_uf2");
  });

  it("leaves a dialog that moved to another device untouched", async () => {
    const host = makeHost();
    vi.mocked(host._api.firmwareDownloadBytes).mockImplementation(async () => {
      host._device = { ...device, configuration: "other.yaml" } as ConfiguredDevice;
      return uf2();
    });

    await startBekenInstall(asHost(host));

    expect(bekenImage.get(asHost(host))).toBeNull();
    expect(host._step).not.toBe("bk-ready");
  });

  it("leaves a dialog that moved on while the image was parsed untouched", async () => {
    const host = makeHost();
    seams.loadBekenImage.mockImplementationOnce(async () => {
      host._device = { ...device, configuration: "other.yaml" } as ConfiguredDevice;
      return { image };
    });

    await startBekenInstall(asHost(host));

    expect(bekenImage.get(asHost(host))).toBeNull();
    expect(host._step).not.toBe("bk-ready");
  });
});

describe("bekenDoFlash", () => {
  it("does nothing without an image", async () => {
    const host = makeHost();

    await bekenDoFlash(asHost(host));

    expect(mocks.requestSerialPort).not.toHaveBeenCalled();
  });

  it("does nothing when the port picker is dismissed", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue(null);

    await bekenDoFlash(asHost(host));

    expect(host._step).toBe("bk-ready");
    expect(host._flashBusy).toBe(false);
    expect(mocks.flashBeken).not.toHaveBeenCalled();
  });

  it("ignores a second click while the picker is open", async () => {
    const host = readyHost();
    host._flashBusy = true;

    await bekenDoFlash(asHost(host));

    expect(mocks.requestSerialPort).not.toHaveBeenCalled();
  });

  it("reports a failed picker", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockRejectedValue(new Error("no serial"));
    await bekenDoFlash(asHost(host));
    expect(host._statusMessage).toBe("firmware.browser_flash_connect_failed");
    expect(host._errorMessage).toBe("no serial");

    mocks.requestSerialPort.mockRejectedValue(lapsedPick());
    await bekenDoFlash(asHost(host));
    expect(host._errorMessage).toBe("serial.picker_needs_click");
  });

  it("walks the connect, reset guide, flashing and done steps with the engine's hooks", async () => {
    const host = readyHost();
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    const seen: string[] = [];
    mocks.flashBeken.mockImplementation(async (_p, _i, hooks) => {
      seen.push(`${host._step}:${host._statusMessage}`);
      expect(host._flashAbort?.signal).toBe(hooks.signal);
      hooks.onWaiting?.();
      seen.push(`${host._step}:${host._statusMessage}`);
      hooks.onLinked?.();
      seen.push(`${host._step}:${host._statusMessage}`);
      hooks.onProgress(42);
      expect(host._flashPercent).toBe(42);
      hooks.onLog?.("Writing 0x11000 (256 bytes)");
    });

    await bekenDoFlash(asHost(host));

    expect(mocks.flashBeken).toHaveBeenCalledWith(port, image, expect.anything());
    expect(seen).toEqual([
      "bk-connect:firmware.bk_connecting",
      "bk-wait:firmware.bk_wait_title",
      "flashing:firmware.status_flashing",
    ]);
    expect(host._log.lines).toContain("Writing 0x11000 (256 bytes)");
    expect(host._step).toBe("done");
    expect(host._statusMessage).toBe("firmware.bk_done_logs_on_uart2");
    expect(host._flashAbort).toBeNull();
    // The flash went over UART1; the logs are on another port by default.
    expect(host._logsPort).toBeNull();
  });

  it("opens the logs on the flashed port when the config puts them on UART1", async () => {
    const host = readyHost();
    host._device = logging("UART1");
    host._showLogsAfterInstall = true;
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashBeken.mockResolvedValue(undefined);

    await bekenDoFlash(asHost(host));

    expect(host._statusMessage).toBe("firmware.status_done");
    expect(host._logsPort).toBe(port);
    expect(mocks.dispatchShowLogsAfterInstall).toHaveBeenCalledWith(
      host,
      expect.objectContaining({ webSerialPort: port, targetPlatform: "bk72xx" })
    );
    expect(host._open).toBe(false);
  });

  it("keeps the UART1 port for Show logs without opening them unasked", async () => {
    const host = readyHost();
    host._device = logging("UART1");
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.flashBeken.mockResolvedValue(undefined);

    await bekenDoFlash(asHost(host));

    expect(host._step).toBe("done");
    expect(host._logsPort).toBe(port);
    expect(mocks.dispatchShowLogsAfterInstall).not.toHaveBeenCalled();
  });

  it.each([
    {
      why: "an explicit UART2",
      device: logging("UART2"),
      message: "firmware.bk_done_logs_on_uart2 | logger: hardware_uart: UART1",
    },
    {
      why: "a disabled logger",
      device: logging("UART1", 0),
      message: "firmware.status_done",
    },
  ])("keeps no port for $why", async ({ device: config, message }) => {
    const host = readyHost();
    host._localize = argsLocalize;
    host._device = config;
    host._showLogsAfterInstall = true;
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashBeken.mockResolvedValue(undefined);

    await bekenDoFlash(asHost(host));

    expect(host._step).toBe("done");
    expect(host._statusMessage).toBe(message);
    expect(host._logsPort).toBeNull();
    expect(mocks.dispatchShowLogsAfterInstall).not.toHaveBeenCalled();
  });

  it("drops what the engine reports once the dialog moved on", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashBeken.mockImplementation(async (_p, _i, hooks) => {
      host._flashImage = null;
      hooks.onWaiting?.();
      hooks.onLinked?.();
      hooks.onProgress(42);
      hooks.onLog?.("late");
    });

    await bekenDoFlash(asHost(host));

    expect(host._step).toBe("bk-connect");
    expect(host._flashPercent).toBe(0);
    expect(host._log.lines).not.toContain("late");
  });

  it("reports a failed flash with the engine's reason", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashBeken.mockRejectedValue(new Error("The CRC of the flash at 0x11000"));

    await bekenDoFlash(asHost(host));

    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.bk_flash_failed");
    expect(host._errorMessage).toContain("0x11000");
  });

  it("names an image built for another chip than the one connected", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashBeken.mockRejectedValue(new BekenChipMismatchError("BK7238", "BK7231N"));

    await bekenDoFlash(asHost(host));

    expect(host._statusMessage).toBe("firmware.bk_wrong_chip");
    expect(host._errorMessage).toBe(
      "The firmware was built for a BK7238, the chip is a BK7231N"
    );
  });

  it("names a flash that is not known", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashBeken.mockRejectedValue(new BekenUnknownFlashError("123415"));

    await bekenDoFlash(asHost(host));

    expect(host._statusMessage).toBe("firmware.bk_unknown_flash");
    expect(host._errorMessage).toBe("Flash ID not known: 123415");
  });

  it("names a board that was unplugged during the flash", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashBeken.mockRejectedValue(new SerialDeviceLostError());

    await bekenDoFlash(asHost(host));

    expect(host._statusMessage).toBe("firmware.bk_flash_failed");
    expect(host._errorMessage).toBe("serial.device_lost");
  });

  it("stays silent when the dialog was torn down during the flash", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashBeken.mockImplementation(async () => {
      host._device = null;
      host._flashAbort?.abort();
      throw new DOMException("aborted", "AbortError");
    });

    await bekenDoFlash(asHost(host));

    expect(host._step).toBe("bk-connect");
    expect(host._errorMessage).toBe("");
  });

  it("leaves the abort of a newer flash in place", async () => {
    const host = readyHost();
    const newer = new AbortController();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashBeken.mockImplementation(async () => {
      host._flashAbort = newer;
    });

    await bekenDoFlash(asHost(host));

    expect(host._flashAbort).toBe(newer);
  });
});

describe("bekenInstall", () => {
  it("hands its UF2 to web.esphome.io's Beken flasher, checked as the in-app flow checks it", async () => {
    const handoff = bekenInstall.handoff!;

    expect(handoff).toMatchObject({
      flasher: "bk-uart",
      erase: false,
      noArtifactKey: "firmware.no_uf2",
    });
    expect(
      handoff.pick([bin("firmware.bin", "bin"), bin("firmware.uf2", "uf2")], "bk72xx")
        ?.file
    ).toBe("firmware.uf2");
    expect(await handoff.check!(new Uint8Array(uf2()))).toBeNull();
    expect(await handoff.check!(new Uint8Array(uf2(AMBZ2)))).toMatchObject({
      key: "firmware.bk_wrong_family",
    });
  });

  it("goes back to the ready step as the Retry target", () => {
    const host = readyHost();
    host._step = "error";

    bekenInstall.showFirstStep(asHost(host));

    expect(host._step).toBe("bk-ready");
    expect(host._statusMessage).toBe("firmware.bk_ready_title");
  });

  it("flashes from the ready step's button", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue(null);

    await bekenInstall.steps["bk-ready"].footer!().primary!.run(asHost(host));

    expect(mocks.requestSerialPort).toHaveBeenCalledOnce();
  });

  it("links the LibreTiny guide from the reset step", async () => {
    const { render } = await import("lit");
    const into = document.createElement("div");

    render(bekenInstall.steps["bk-wait"].extra!(asHost(readyHost())), into);

    const link = into.querySelector("a")!;
    expect(link.href).toBe("https://docs.libretiny.eu/docs/platform/beken-72xx/");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.textContent).toBe("firmware.bk_guide_link");
  });
});

describe("bekenInstall.holdsPort", () => {
  it.each([
    { why: "logs on UART1", config: logging("UART1"), holds: true },
    { why: "the default UART2", config: logging(null), holds: false },
    { why: "an explicit UART2", config: logging("UART2"), holds: false },
    { why: "a disabled logger", config: logging("UART1", 0), holds: false },
    { why: "no device", config: null, holds: false },
  ])("is $holds for $why", ({ config, holds }) => {
    expect(bekenInstall.holdsPort(config)).toBe(holds);
  });
});
