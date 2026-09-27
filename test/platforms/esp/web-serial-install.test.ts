/**
 * Pins the Web Serial flash path after the WS→HTTP download migration: it must
 * fetch the firmware bytes over HTTP (api.firmwareDownloadBytes), bound to the
 * factory image, and flash them — the removed WS firmware/download command is
 * never touched. Also covers the byte-fetch failure path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const esptool = vi.hoisted(() => ({
  connectToPort: vi.fn(),
  disconnect: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(),
}));
vi.mock("../../../src/platforms/esp/esptool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/platforms/esp/esptool.js")>()),
  ...esptool,
}));
// The picker runs before the engine chunk loads; both are the flow's seams.
const seams = vi.hoisted(() => ({ requestSerialPort: vi.fn(), loadEsptool: vi.fn() }));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/util/web-serial.js")>()),
  requestSerialPort: seams.requestSerialPort,
}));
vi.mock("../../../src/platforms/esp/esptool-loader.js", () => ({
  loadEsptool: seams.loadEsptool,
}));
vi.mock("../../../src/util/download-text.js", () => ({ triggerDownload: vi.fn() }));
vi.mock("../../../src/util/post-install-dispatch.js", () => ({
  dispatchShowLogsAfterInstall: vi.fn(() => false),
}));

import { identityLocalize } from "../../_dom.js";
import { fakeBuildState, fakeLogBuffer } from "../../_fake-host.js";
import { lapsedPick } from "../../_web-serial.js";
import { JobSource, JobStatus } from "../../../src/api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";
import { startWebSerialInstall } from "../../../src/platforms/esp/web-serial-install.js";
import { _clearBoardBodyCache } from "../../../src/util/board-body-cache.js";
import {
  markOpenFailure,
  SerialDeviceLostError,
} from "../../../src/util/serial-open-error.js";

type Follow = { onResult: (d: unknown) => void; onError: (e: string) => void };

function makeHost() {
  const api = {
    getBoard: vi.fn(),
    firmwareCompile: vi
      .fn()
      .mockResolvedValue({ job_id: "j1", source: JobSource.LOCAL, source_label: "" }),
    firmwareFollowJob: vi.fn((_id: string, cbs: Follow) => {
      cbs.onResult({ status: JobStatus.COMPLETED });
      return "s1";
    }),
    firmwareGetBinaries: vi
      .fn()
      .mockResolvedValue([{ title: "Factory", file: "firmware.factory.bin" }]),
    firmwareDownloadBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
  };
  const host = {
    // board_id empty + target_platform "esp32" → coarse-esp32 chip check passes.
    _device: {
      configuration: "device.yaml",
      name: "dev",
      friendly_name: "Dev",
      target_platform: "esp32",
      board_id: "",
    },
    _api: api,
    _step: "connecting",
    _statusMessage: "",
    _flashPercent: 0,
    _log: fakeLogBuffer(),
    _open: true,
    _installRun: 1,
    _showLogsAfterInstall: false,
    _detected: null as unknown,
    _failureKind: null,
    _jobId: "",
    _streamId: "",
    _jobSource: JobSource.LOCAL,
    _jobSourceLabel: "",
    _compileReject: null as null | ((e: unknown) => void),
    _localize: identityLocalize,
    ...fakeBuildState(),
    _fail: vi.fn(),
    _close: vi.fn(),
  };
  host._fail = vi.fn((msg: string) => {
    host._step = "error";
    host._statusMessage = msg;
  });
  return { host, api };
}

const CHIP = { chipName: "ESP32", transport: {}, port: {}, loader: {} };

beforeEach(() => {
  seams.requestSerialPort.mockResolvedValue({ getInfo: () => ({}) } as SerialPort);
  seams.loadEsptool.mockImplementation(
    () => import("../../../src/platforms/esp/esptool.js")
  );
});

afterEach(() => {
  vi.clearAllMocks();
  _clearBoardBodyCache();
});

describe("Web Serial install — HTTP byte download", () => {
  it("fetches firmware bytes over HTTP and flashes them", async () => {
    const { host, api } = makeHost();
    esptool.connectToPort.mockResolvedValue(CHIP);
    esptool.disconnect.mockResolvedValue(undefined);
    esptool.flashFirmware.mockResolvedValue(undefined);
    esptool.resetAndDisconnect.mockResolvedValue(undefined);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "device.yaml",
      "firmware.factory.bin"
    );
    expect(esptool.flashFirmware).toHaveBeenCalledTimes(1);
    const [, bytes, address] = esptool.flashFirmware.mock.calls[0];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3, 4]);
    expect(address).toBe(0x0); // factory image flashes at 0x0
    expect(host._step).toBe("done");
  });

  it("streams esptool detect + flash output into the log (#346)", async () => {
    const { host } = makeHost();
    let captured: ((l: string) => void) | undefined;
    esptool.connectToPort.mockImplementation(
      async (_port: SerialPort, onLog?: (l: string) => void) => {
        captured = onLog;
        onLog?.("Detecting chip type... ESP32");
        return CHIP;
      }
    );
    // Flash output reaches the log through the terminal wired at detect: the
    // session stays open across compile and flash, so no reconnect is needed.
    esptool.flashFirmware.mockImplementation(async () => {
      captured?.("Writing at 0x00010000...");
    });
    esptool.disconnect.mockResolvedValue(undefined);
    esptool.resetAndDisconnect.mockResolvedValue(undefined);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._log.lines).toContain("Detecting chip type... ESP32");
    expect(host._log.lines).toContain("Writing at 0x00010000...");
  });

  it("releases the port when the post-flash reset throws", async () => {
    const { host } = makeHost();
    esptool.connectToPort.mockResolvedValue(CHIP);
    esptool.flashFirmware.mockResolvedValue(undefined);
    esptool.disconnect.mockResolvedValue(undefined);
    esptool.resetAndDisconnect.mockRejectedValueOnce(new Error("reset boom"));

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    // Flash succeeded, so the install still completes; the failed reset must not
    // leak the held port.
    expect(host._step).toBe("done");
    expect(esptool.disconnect).toHaveBeenCalledWith(CHIP.transport);
  });

  it("never lets a failed release mask the failure on an early return", async () => {
    const { host, api } = makeHost();
    esptool.disconnect.mockRejectedValue(new Error("disconnect boom"));
    api.firmwareDownloadBytes.mockRejectedValueOnce(new Error("boom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).toHaveBeenCalledWith("firmware.download_failed");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("closes silently when the user cancels the port picker", async () => {
    const { host } = makeHost();
    seams.requestSerialPort.mockResolvedValueOnce(null);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._close).toHaveBeenCalledTimes(1);
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("says to click again, once, for a picker refused after the click ran out", async () => {
    const { host } = makeHost();
    seams.requestSerialPort.mockRejectedValueOnce(lapsedPick());

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).toHaveBeenCalledWith("serial.picker_needs_click", "");
    expect(esptool.connectToPort).not.toHaveBeenCalled();
  });

  it("names a failed engine chunk fetch and touches no port", async () => {
    const { host } = makeHost();
    seams.loadEsptool.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).toHaveBeenCalledWith(
      "firmware.engine_load_failed",
      "Failed to fetch"
    );
    expect(esptool.connectToPort).not.toHaveBeenCalled();
  });

  it("opens the picker in the click without waiting for the engine chunk", async () => {
    const { host } = makeHost();
    esptool.connectToPort.mockResolvedValue(CHIP);
    // The chunk stays pending until the pick is in: the fetch overlaps the
    // picker instead of delaying it.
    let deliver: (engine: unknown) => void = () => {};
    seams.loadEsptool.mockReturnValueOnce(new Promise((resolve) => (deliver = resolve)));
    seams.requestSerialPort.mockImplementationOnce(async () => {
      deliver(await import("../../../src/platforms/esp/esptool.js"));
      return { getInfo: () => ({}) } as SerialPort;
    });
    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);
    expect(seams.requestSerialPort).toHaveBeenCalledOnce();
    expect(esptool.connectToPort).toHaveBeenCalledOnce();
  });

  it("surfaces a connect failure instead of closing the dialog (#1414)", async () => {
    const { host } = makeHost();
    esptool.connectToPort.mockRejectedValueOnce(
      new Error("Failed to connect with the device")
    );

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._close).not.toHaveBeenCalled();
    expect(host._fail).toHaveBeenCalledWith(
      "serial.connect_failed",
      "Failed to connect with the device"
    );
  });

  it("says the port may be in use when the open fails with NetworkError", async () => {
    const { host } = makeHost();
    const inUse = new DOMException("Failed to open serial port.", "NetworkError");
    markOpenFailure(inUse);
    esptool.connectToPort.mockRejectedValueOnce(inUse);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).toHaveBeenCalledWith(
      "serial.port_in_use",
      "Failed to open serial port."
    );
  });

  it("fails cleanly when the HTTP byte fetch errors", async () => {
    const { host, api } = makeHost();
    esptool.connectToPort.mockResolvedValue(CHIP);
    esptool.disconnect.mockResolvedValue(undefined);
    api.firmwareDownloadBytes.mockRejectedValueOnce(new Error("boom"));

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).toHaveBeenCalledWith("firmware.download_failed");
    expect(esptool.flashFirmware).not.toHaveBeenCalled();
    // The held session must be released on the bail-out, not leaked into a retry.
    expect(esptool.disconnect).toHaveBeenCalledTimes(1);
  });

  // ESP8285 is an ESP8266 with embedded flash; `board: esp8285` resolves to the
  // esp8266 platform, so a detected ESP8285 must not trip the chip-mismatch guard.
  it("flashes an ESP8285 chip on an esp8266 config (#1673)", async () => {
    const { host, api } = makeHost();
    host._device.target_platform = "esp8266";
    host._device.board_id = "esp8285";
    api.getBoard.mockResolvedValue({ esphome: { platform: "esp8266" } });
    api.firmwareGetBinaries.mockResolvedValue([
      { title: "Firmware", file: "firmware.bin" },
    ]);
    esptool.connectToPort.mockResolvedValue({ ...CHIP, chipName: "ESP8285" });
    esptool.disconnect.mockResolvedValue(undefined);
    esptool.flashFirmware.mockResolvedValue(undefined);
    esptool.resetAndDisconnect.mockResolvedValue(undefined);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).not.toHaveBeenCalled();
    expect(esptool.flashFirmware).toHaveBeenCalledTimes(1);
    expect(esptool.flashFirmware.mock.calls[0][2]).toBe(0x0); // esp8266 flashes at 0x0
    expect(host._step).toBe("done");
  });

  it("still rejects a genuine chip mismatch (#1673)", async () => {
    const { host, api } = makeHost();
    host._device.target_platform = "esp8266";
    host._device.board_id = "esp8285";
    api.getBoard.mockResolvedValue({ esphome: { platform: "esp8266" } });
    esptool.connectToPort.mockResolvedValue({ ...CHIP, chipName: "ESP32" });
    esptool.disconnect.mockResolvedValue(undefined);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).toHaveBeenCalledWith("firmware.chip_mismatch");
    // The kind routes the footer to the change-board hand-off.
    expect(host._failureKind).toBe("chip-mismatch");
    expect(esptool.flashFirmware).not.toHaveBeenCalled();
  });

  it("leaves the chip-mismatch flag unset on a matching chip", async () => {
    const { host } = makeHost();
    esptool.connectToPort.mockResolvedValue(CHIP);
    esptool.disconnect.mockResolvedValue(undefined);
    esptool.flashFirmware.mockResolvedValue(undefined);
    esptool.resetAndDisconnect.mockResolvedValue(undefined);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._failureKind).toBe(null);
  });
});

describe("Web Serial install while someone else's build runs (#1893)", () => {
  type Output = Follow & { onOutput: (line: string) => void };

  function busyHost() {
    const made = makeHost();
    made.host._activeJobs.set("device.yaml", { job_id: "foreign-1" });
    esptool.connectToPort.mockResolvedValue(CHIP);
    esptool.disconnect.mockResolvedValue(undefined);
    esptool.flashFirmware.mockResolvedValue(undefined);
    esptool.resetAndDisconnect.mockResolvedValue(undefined);
    return made;
  }
  const run = (host: unknown) =>
    startWebSerialInstall(host as ESPHomeFirmwareInstallDialog);

  it("asks for the port in the click itself, with nothing awaited before it", async () => {
    const { host } = busyHost();
    // Not awaited: the picker has to be asked for before the click's turn ends.
    const install = run(host);
    expect(seams.requestSerialPort).toHaveBeenCalledOnce();
    await install;
  });

  it("waits the build out after the connect, then compiles as if nothing ran", async () => {
    const { host, api } = busyHost();
    const seen: string[] = [];
    api.firmwareFollowJob.mockImplementation((id: string, cbs: Follow) => {
      seen.push(`${id} ${host._step}: ${host._statusMessage}`);
      // A followed build replays its lines, which move the step on.
      (cbs as Output).onOutput("Compiling .pio/build/main.cpp.o");
      if (id === "j1") seen.push(`${id} ${host._step}: ${host._statusMessage}`);
      cbs.onResult({ status: JobStatus.COMPLETED });
      return "s1";
    });

    await run(host);

    expect(seen).toEqual([
      "foreign-1 queued: firmware.status_waiting_build",
      "j1 queued: firmware.status_queued",
      "j1 compiling: firmware.status_compiling",
    ]);
    // The clocks the other build's lines started are not this compile's.
    expect(host._timer.reset).toHaveBeenCalledOnce();
    expect(host._timer.reset.mock.invocationCallOrder[0]).toBeLessThan(
      api.firmwareCompile.mock.invocationCallOrder[0]
    );
    expect(esptool.connectToPort.mock.invocationCallOrder[0]).toBeLessThan(
      api.firmwareFollowJob.mock.invocationCallOrder[0]
    );
    expect(host._step).toBe("done");
  });

  it("releases the port and does not compile when the wait fails", async () => {
    const { host, api } = busyHost();
    api.firmwareFollowJob.mockImplementation((_id: string, cbs: Follow) => {
      cbs.onError("stream lost");
      return "s1";
    });

    await run(host);

    expect(host._fail).toHaveBeenCalledWith("firmware.install_failed");
    expect(api.firmwareCompile).not.toHaveBeenCalled();
    expect(esptool.disconnect).toHaveBeenCalled();
    expect(esptool.flashFirmware).not.toHaveBeenCalled();
  });
});

describe("Web Serial install when the board is unplugged during the flash (#1896)", () => {
  function lostAt(percent: number, err: Error = new SerialDeviceLostError()) {
    const { host } = makeHost();
    esptool.connectToPort.mockResolvedValue(CHIP);
    esptool.resetAndDisconnect.mockResolvedValue(undefined);
    esptool.flashFirmware.mockImplementation(async (_l, _d, _a, onProgress) => {
      onProgress({ percent });
      throw err;
    });
    // The release takes its whole deadline when the hung write holds the port.
    const shown: string[] = [];
    esptool.disconnect.mockImplementation(async () => {
      shown.push(host._statusMessage);
    });
    const run = startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);
    return { host, shown, run };
  }

  it("fails with the device lost line before it releases the port, and leaves Retry", async () => {
    const { host, shown, run } = lostAt(60);
    await run;

    expect(host._fail).toHaveBeenCalledWith("serial.device_lost");
    expect(shown).toEqual(["serial.device_lost"]);
    expect(esptool.resetAndDisconnect).not.toHaveBeenCalled();
    // Retry is only offered for a failure with no kind of its own.
    expect(host._failureKind).toBeNull();
  });

  it("does not call a board that went away at the end done: the tail may be unwritten", async () => {
    const { host, run } = lostAt(100);
    await run;

    expect(host._fail).toHaveBeenCalledWith("serial.device_lost");
    expect(esptool.resetAndDisconnect).not.toHaveBeenCalled();
  });

  it("still counts any other failure at the end as done", async () => {
    const { host, run } = lostAt(100, new Error("Invalid head of packet"));
    await run;

    expect(host._fail).not.toHaveBeenCalled();
    expect(host._step).toBe("done");
  });
});

describe("Web Serial install dismissed before the flash (#1900)", () => {
  function ready() {
    const made = makeHost();
    esptool.connectToPort.mockResolvedValue(CHIP);
    esptool.disconnect.mockResolvedValue(undefined);
    esptool.flashFirmware.mockResolvedValue(undefined);
    esptool.resetAndDisconnect.mockResolvedValue(undefined);
    return made;
  }
  const run = (host: unknown) =>
    startWebSerialInstall(host as ESPHomeFirmwareInstallDialog);
  // X and Escape flip the open flag and leave the device in place.
  const dismiss = (host: { _open: boolean }) => {
    host._open = false;
  };
  // A reopen for the same device is a new install run on an open dialog.
  const reopen = (host: { _open: boolean; _installRun: number; _step: string }) => {
    host._installRun++;
    host._open = true;
    host._step = "connecting";
  };

  type Made = ReturnType<typeof ready>;
  it.each([
    {
      name: "the port pick",
      arm: ({ host }: Made) =>
        seams.requestSerialPort.mockImplementationOnce(async () => {
          dismiss(host);
          return { getInfo: () => ({}) } as SerialPort;
        }),
      released: false,
    },
    {
      name: "a port pick that then fails",
      arm: ({ host }: Made) =>
        seams.requestSerialPort.mockImplementationOnce(async () => {
          dismiss(host);
          throw lapsedPick();
        }),
      released: false,
    },
    {
      name: "the connect",
      arm: ({ host }: Made) =>
        esptool.connectToPort.mockImplementationOnce(async () => {
          dismiss(host);
          return CHIP;
        }),
      released: true,
    },
    {
      name: "a connect that then fails",
      arm: ({ host }: Made) =>
        esptool.connectToPort.mockImplementationOnce(async () => {
          dismiss(host);
          throw new Error("Failed to connect with the device");
        }),
      released: false,
    },
    {
      name: "the chip check",
      arm: ({ host, api }: Made) => {
        host._device.board_id = "esp32dev";
        api.getBoard.mockImplementationOnce(async () => {
          dismiss(host);
          return { esphome: { platform: "esp32" } };
        });
      },
      released: true,
    },
    {
      name: "the image listing",
      arm: ({ host, api }: Made) =>
        api.firmwareGetBinaries.mockImplementationOnce(async () => {
          dismiss(host);
          return [{ title: "Factory", file: "firmware.factory.bin" }];
        }),
      released: true,
    },
    {
      name: "the image listing, which then finds none",
      arm: ({ host, api }: Made) =>
        api.firmwareGetBinaries.mockImplementationOnce(async () => {
          dismiss(host);
          return [];
        }),
      released: true,
    },
    {
      name: "the wait for a build someone else started",
      arm: ({ host, api }: Made) => {
        host._activeJobs.set("device.yaml", { job_id: "foreign-1" });
        api.firmwareFollowJob.mockImplementationOnce((_id: string, cbs: Follow) => {
          dismiss(host);
          cbs.onError("stream lost");
          return "s1";
        });
      },
      released: true,
    },
    {
      name: "the download",
      arm: ({ host, api }: Made) =>
        api.firmwareDownloadBytes.mockImplementationOnce(async () => {
          dismiss(host);
          return new Uint8Array([1]).buffer;
        }),
      released: true,
      downloads: true,
    },
    {
      name: "a download that then fails",
      arm: ({ host, api }: Made) =>
        api.firmwareDownloadBytes.mockImplementationOnce(async () => {
          dismiss(host);
          throw new Error("boom");
        }),
      released: true,
      downloads: true,
    },
  ])(
    "stands down quietly when dismissed during $name",
    async ({ arm, released, downloads }) => {
      const made = ready();
      arm(made);

      await run(made.host);

      expect(esptool.flashFirmware).not.toHaveBeenCalled();
      expect(made.host._fail).not.toHaveBeenCalled();
      expect(made.host._close).not.toHaveBeenCalled();
      // A dismissal before the download never starts one.
      if (!downloads) expect(made.api.firmwareDownloadBytes).not.toHaveBeenCalled();
      if (released) expect(esptool.disconnect).toHaveBeenCalledWith(CHIP.transport);
      else expect(esptool.disconnect).not.toHaveBeenCalled();
    }
  );

  it("does not mark a reopened dialog with a chip mismatch found for the run before", async () => {
    const { host, api } = ready();
    host._device.target_platform = "esp8266";
    host._device.board_id = "esp8285";
    api.getBoard.mockResolvedValue({ esphome: { platform: "esp8266" } });
    esptool.disconnect.mockImplementationOnce(async () => {
      dismiss(host);
      reopen(host);
    });

    await run(host);

    expect(esptool.disconnect).toHaveBeenCalledTimes(1);
    expect(host._fail).not.toHaveBeenCalled();
    expect(host._failureKind).toBeNull();
  });

  it.each([
    { name: "dismissed", reopened: false },
    { name: "dismissed and reopened for the same device", reopened: true },
  ])("stands down quietly when $name during the compile", async ({ reopened }) => {
    const { host, api } = ready();
    api.firmwareFollowJob.mockImplementationOnce(() => {
      queueMicrotask(() => {
        dismiss(host);
        if (reopened) reopen(host);
        host._compileReject?.(new Error("Install dialog dismissed"));
      });
      return "s1";
    });

    await run(host);

    expect(esptool.disconnect).toHaveBeenCalledWith(CHIP.transport);
    expect(esptool.flashFirmware).not.toHaveBeenCalled();
    expect(host._fail).not.toHaveBeenCalled();
    expect(host._failureKind).toBeNull();
  });

  it("finishes a flash the same device was reopened during without painting on the new run", async () => {
    const { host } = ready();
    esptool.flashFirmware.mockImplementationOnce(async (_l, _d, _a, onProgress) => {
      onProgress({ percent: 40 });
      dismiss(host);
      reopen(host);
      onProgress({ percent: 100 });
    });

    await run(host);

    // The board still gets its reset, so the new firmware boots.
    expect(esptool.resetAndDisconnect).toHaveBeenCalledTimes(1);
    expect(host._flashPercent).toBe(40);
    expect(host._step).toBe("connecting");
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("stays quiet when a flash fails after the same device was reopened", async () => {
    const { host } = ready();
    esptool.flashFirmware.mockImplementationOnce(async (_l, _d, _a, onProgress) => {
      onProgress({ percent: 40 });
      dismiss(host);
      reopen(host);
      throw new SerialDeviceLostError();
    });

    await run(host);

    expect(esptool.disconnect).toHaveBeenCalledWith(CHIP.transport);
    expect(esptool.resetAndDisconnect).not.toHaveBeenCalled();
    expect(host._fail).not.toHaveBeenCalled();
    expect(host._step).toBe("connecting");
  });

  it("does not follow a compile submitted for the run before a reopen", async () => {
    const { host, api } = ready();
    api.firmwareCompile.mockImplementationOnce(async () => {
      dismiss(host);
      // The reopen's _init settles the compile and drops its hook.
      host._compileReject?.(new Error("Install dialog dismissed"));
      host._compileReject = null;
      reopen(host);
      return { job_id: "j-old", source: JobSource.LOCAL, source_label: "" };
    });

    await run(host);

    expect(api.firmwareFollowJob).not.toHaveBeenCalled();
    expect(host._jobId).toBe("");
    expect(esptool.disconnect).toHaveBeenCalledWith(CHIP.transport);
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("does not carry on with a build that ended after a dismissal", async () => {
    const { host, api } = ready();
    api.firmwareFollowJob.mockImplementationOnce((_id: string, cbs: Follow) => {
      // The close flipped the flag; its after-hide, and the rejection, come later.
      dismiss(host);
      cbs.onResult({ status: JobStatus.COMPLETED });
      return "s1";
    });

    await run(host);

    expect(api.firmwareGetBinaries).not.toHaveBeenCalled();
    expect(esptool.disconnect).toHaveBeenCalledWith(CHIP.transport);
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("does not compile after a build it waited for ended past a dismissal", async () => {
    const { host, api } = ready();
    host._activeJobs.set("device.yaml", { job_id: "foreign-1" });
    api.firmwareFollowJob.mockImplementationOnce((_id: string, cbs: Follow) => {
      dismiss(host);
      cbs.onResult({ status: JobStatus.COMPLETED });
      return "s1";
    });

    await run(host);

    expect(api.firmwareCompile).not.toHaveBeenCalled();
    expect(esptool.disconnect).toHaveBeenCalledWith(CHIP.transport);
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("leaves the next run's reject hook alone when the run before's submit fails", async () => {
    const { host, api } = ready();
    const nextHook = vi.fn();
    api.firmwareCompile.mockImplementationOnce(async () => {
      dismiss(host);
      reopen(host);
      host._compileReject?.(new Error("Install dialog dismissed"));
      // The next run has reached its own compile meanwhile.
      host._compileReject = nextHook;
      throw new Error("submit refused");
    });

    await run(host);

    expect(host._compileReject).toBe(nextHook);
    expect(nextHook).not.toHaveBeenCalled();
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("does not follow a compile whose dialog was torn down while the submit was out", async () => {
    const { host, api } = ready();
    api.firmwareCompile.mockImplementationOnce(async () => {
      // The after-hide came before the submit returned: its teardown settled
      // the compile and dropped the hook.
      dismiss(host);
      host._compileReject?.(new Error("Install dialog dismissed"));
      host._compileReject = null;
      return { job_id: "j-old", source: JobSource.LOCAL, source_label: "" };
    });

    await run(host);

    expect(api.firmwareFollowJob).not.toHaveBeenCalled();
    expect(host._jobId).toBe("");
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("still records a compile submitted for a run that was only dismissed", async () => {
    const { host, api } = ready();
    api.firmwareCompile.mockImplementationOnce(async () => {
      dismiss(host);
      host._compileReject?.(new Error("Install dialog dismissed"));
      return { job_id: "j-old", source: JobSource.LOCAL, source_label: "" };
    });
    // The build keeps running; the after-hide detaches this follow later.
    api.firmwareFollowJob.mockImplementationOnce(() => "s1");

    await run(host);

    // The after-hide's "continues in the background" notice needs the id.
    expect(host._jobId).toBe("j-old");
    expect(api.firmwareFollowJob).toHaveBeenCalledWith("j-old", expect.anything());
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("does not mark a reopened dialog with the run before's missing image", async () => {
    const { host, api } = ready();
    api.firmwareGetBinaries.mockResolvedValueOnce([]);
    esptool.disconnect.mockImplementationOnce(async () => {
      dismiss(host);
      reopen(host);
    });

    await run(host);

    expect(esptool.disconnect).toHaveBeenCalledTimes(1);
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("stands down when the same device was reopened during the connect", async () => {
    const { host, api } = ready();
    esptool.connectToPort.mockImplementationOnce(async () => {
      dismiss(host);
      reopen(host);
      return CHIP;
    });

    await run(host);

    expect(esptool.disconnect).toHaveBeenCalledWith(CHIP.transport);
    expect(api.firmwareCompile).not.toHaveBeenCalled();
    expect(host._fail).not.toHaveBeenCalled();
    expect(host._detected).toBeNull();
    expect(host._step).toBe("connecting");
  });

  it("does not close a reopened dialog when its own picker was dismissed", async () => {
    const { host } = ready();
    seams.requestSerialPort.mockImplementationOnce(async () => {
      dismiss(host);
      reopen(host);
      return null;
    });

    await run(host);

    expect(host._close).not.toHaveBeenCalled();
    expect(host._fail).not.toHaveBeenCalled();
  });
});
