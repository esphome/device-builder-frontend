/**
 * Pins the Web Serial flash path after the WS→HTTP download migration: it must
 * fetch the firmware bytes over HTTP (api.firmwareDownloadBytes), bound to the
 * factory image, and flash them — the removed WS firmware/download command is
 * never touched. Also covers the byte-fetch failure path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const wsSerial = vi.hoisted(() => ({
  connectToPort: vi.fn(),
  detectChip: vi.fn(),
  disconnect: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(),
}));
vi.mock("../../src/util/web-serial.js", () => wsSerial);
vi.mock("../../src/util/download-text.js", () => ({ triggerDownload: vi.fn() }));
vi.mock("../../src/util/post-install-logs.js", () => ({
  dispatchShowLogsAfterInstall: vi.fn(() => false),
}));

import { JobSource, JobStatus } from "../../src/api/types/firmware-jobs.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { startWebSerialInstall } from "../../src/components/firmware-install-dialog/install-flow.js";

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
    _logLines: [] as string[],
    _open: true,
    _showLogsAfterInstall: false,
    _detected: null as unknown,
    _failedDuringCompile: false,
    _failedDuringValidate: false,
    _jobId: "",
    _streamId: "",
    _jobSource: JobSource.LOCAL,
    _jobSourceLabel: "",
    _compileReject: null as null | ((e: unknown) => void),
    _localize: (key: string) => key,
    _fail: vi.fn(),
  };
  host._fail = vi.fn((msg: string) => {
    host._step = "error";
    host._statusMessage = msg;
  });
  return { host, api };
}

const CHIP = { chipName: "ESP32", transport: {}, port: {}, loader: {} };

afterEach(() => vi.clearAllMocks());

describe("Web Serial install — HTTP byte download", () => {
  it("fetches firmware bytes over HTTP and flashes them", async () => {
    const { host, api } = makeHost();
    wsSerial.detectChip.mockResolvedValue(CHIP);
    wsSerial.connectToPort.mockResolvedValue(CHIP);
    wsSerial.disconnect.mockResolvedValue(undefined);
    wsSerial.flashFirmware.mockResolvedValue(undefined);
    wsSerial.resetAndDisconnect.mockResolvedValue(undefined);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "device.yaml",
      "firmware.factory.bin"
    );
    expect(wsSerial.flashFirmware).toHaveBeenCalledTimes(1);
    const [, bytes, address] = wsSerial.flashFirmware.mock.calls[0];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3, 4]);
    expect(address).toBe(0x0); // factory image flashes at 0x0
    expect(host._step).toBe("done");
  });

  it("streams esptool detect + flash output into the log (#346)", async () => {
    const { host } = makeHost();
    wsSerial.detectChip.mockImplementation(async (onLog?: (l: string) => void) => {
      onLog?.("Detecting chip type... ESP32");
      return CHIP;
    });
    wsSerial.connectToPort.mockImplementation(
      async (_port: unknown, onLog?: (l: string) => void) => {
        onLog?.("Writing at 0x00010000...");
        return CHIP;
      }
    );
    wsSerial.disconnect.mockResolvedValue(undefined);
    wsSerial.flashFirmware.mockResolvedValue(undefined);
    wsSerial.resetAndDisconnect.mockResolvedValue(undefined);

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    // Before the fix detectChip/connectToPort were called with no onLog, so
    // esptool output never reached the log buffer.
    expect(host._logLines).toContain("Detecting chip type... ESP32");
    expect(host._logLines).toContain("Writing at 0x00010000...");
  });

  it("fails cleanly when the HTTP byte fetch errors", async () => {
    const { host, api } = makeHost();
    wsSerial.detectChip.mockResolvedValue(CHIP);
    wsSerial.disconnect.mockResolvedValue(undefined);
    api.firmwareDownloadBytes.mockRejectedValueOnce(new Error("boom"));

    await startWebSerialInstall(host as unknown as ESPHomeFirmwareInstallDialog);

    expect(host._fail).toHaveBeenCalledWith("firmware.download_failed");
    expect(wsSerial.flashFirmware).not.toHaveBeenCalled();
  });
});
