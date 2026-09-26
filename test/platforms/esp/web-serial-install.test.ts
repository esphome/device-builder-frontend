/**
 * Pins the Web Serial flash path after the WS→HTTP download migration: it must
 * fetch the firmware bytes over HTTP (api.firmwareDownloadBytes), bound to the
 * factory image, and flash them — the removed WS firmware/download command is
 * never touched. Also covers the byte-fetch failure path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const esptool = vi.hoisted(() => ({
  detectChip: vi.fn(),
  disconnect: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(),
}));
vi.mock("../../../src/platforms/esp/esptool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/platforms/esp/esptool.js")>()),
  ...esptool,
}));
vi.mock("../../../src/util/download-text.js", () => ({ triggerDownload: vi.fn() }));
vi.mock("../../../src/util/post-install-dispatch.js", () => ({
  dispatchShowLogsAfterInstall: vi.fn(() => false),
}));

import { identityLocalize } from "../../_dom.js";
import { fakeLogBuffer } from "../../_fake-host.js";
import { JobSource, JobStatus } from "../../../src/api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../../src/components/firmware-install-dialog.js";
import { startWebSerialInstall } from "../../../src/platforms/esp/web-serial-install.js";
import { _clearBoardBodyCache } from "../../../src/util/board-body-cache.js";

function makeHost() {
  const api = {
    getBoard: vi.fn(),
    firmwareCompile: vi
      .fn()
      .mockResolvedValue({ job_id: "j1", source: JobSource.LOCAL, source_label: "" }),
    firmwareFollowJob: vi.fn((_id: string, cbs: { onResult: (d: unknown) => void }) => {
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
    _showLogsAfterInstall: false,
    _detected: null as unknown,
    _failureKind: null,
    _jobId: "",
    _streamId: "",
    _jobSource: JobSource.LOCAL,
    _jobSourceLabel: "",
    _compileReject: null as null | ((e: unknown) => void),
    _localize: identityLocalize,
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

afterEach(() => {
  vi.clearAllMocks();
  _clearBoardBodyCache();
});

describe("Web Serial install — HTTP byte download", () => {
  it("fetches firmware bytes over HTTP and flashes them", async () => {
    const { host, api } = makeHost();
    esptool.detectChip.mockResolvedValue(CHIP);
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
    esptool.detectChip.mockImplementation(async (onLog?: (l: string) => void) => {
      captured = onLog;
      onLog?.("Detecting chip type... ESP32");
      return CHIP;
    });
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
    esptool.detectChip.mockResolvedValue(CHIP);
    esptool.flashFirmware.mockResolvedValue(undefined);
    esptool.disconnect.mockResolvedValue(undefined);
    esptool.resetAndDisconnect.mockRejectedValueOnce(new Error("reset boom"));

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    // Flash succeeded, so the install still completes; the failed reset must not
    // leak the held port.
    expect(host._step).toBe("done");
    expect(esptool.disconnect).toHaveBeenCalledWith(CHIP.transport);
  });

  it("closes the port directly when disconnect throws on an early return", async () => {
    const { host, api } = makeHost();
    const port = { close: vi.fn().mockResolvedValue(undefined) };
    esptool.detectChip.mockResolvedValue({ ...CHIP, port });
    esptool.disconnect.mockRejectedValue(new Error("disconnect boom"));
    api.firmwareDownloadBytes.mockRejectedValueOnce(new Error("boom"));

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).toHaveBeenCalledWith("firmware.download_failed");
    // disconnect failed, so the OS handle must still be released via port.close.
    expect(port.close).toHaveBeenCalledTimes(1);
  });

  it("closes silently when the user cancels the port picker", async () => {
    const { host } = makeHost();
    esptool.detectChip.mockRejectedValueOnce(
      new DOMException("No port selected by the user.", "NotFoundError")
    );

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._close).toHaveBeenCalledTimes(1);
    expect(host._fail).not.toHaveBeenCalled();
  });

  it("surfaces a connect failure instead of closing the dialog (#1414)", async () => {
    const { host } = makeHost();
    esptool.detectChip.mockRejectedValueOnce(
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
    esptool.detectChip.mockRejectedValueOnce(
      new DOMException("Failed to open serial port.", "NetworkError")
    );

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).toHaveBeenCalledWith(
      "serial.port_in_use",
      "Failed to open serial port."
    );
  });

  it("fails cleanly when the HTTP byte fetch errors", async () => {
    const { host, api } = makeHost();
    esptool.detectChip.mockResolvedValue(CHIP);
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
    esptool.detectChip.mockResolvedValue({ ...CHIP, chipName: "ESP8285" });
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
    esptool.detectChip.mockResolvedValue({ ...CHIP, chipName: "ESP32" });
    esptool.disconnect.mockResolvedValue(undefined);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).toHaveBeenCalledWith("firmware.chip_mismatch");
    // The kind routes the footer to the change-board hand-off.
    expect(host._failureKind).toBe("chip-mismatch");
    expect(esptool.flashFirmware).not.toHaveBeenCalled();
  });

  it("leaves the chip-mismatch flag unset on a matching chip", async () => {
    const { host } = makeHost();
    esptool.detectChip.mockResolvedValue(CHIP);
    esptool.disconnect.mockResolvedValue(undefined);
    esptool.flashFirmware.mockResolvedValue(undefined);
    esptool.resetAndDisconnect.mockResolvedValue(undefined);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._failureKind).toBe(null);
  });
});
