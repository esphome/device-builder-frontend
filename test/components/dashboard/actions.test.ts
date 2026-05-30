import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { FirmwareBinary } from "../../../src/api/types/firmware-jobs.js";
import type { LocalizeFunc } from "../../../src/common/localize.js";
import {
  deleteDevice,
  downloadFirmware,
  downloadFirmwareBinary,
} from "../../../src/components/dashboard/actions.js";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner-js", () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const { downloadBase64Binary } = vi.hoisted(() => ({
  downloadBase64Binary: vi.fn(),
}));
vi.mock("../../../src/util/download-text.js", () => ({
  downloadBase64Binary: (...args: unknown[]) => downloadBase64Binary(...args),
  downloadAnsiText: vi.fn(),
}));

const localize = ((key: string) => key) as LocalizeFunc;

function makeDevice(): ConfiguredDevice {
  return {
    name: "kitchen",
    friendly_name: "Kitchen",
    configuration: "kitchen.yaml",
  } as ConfiguredDevice;
}

describe("deleteDevice", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires the success toast only after the backend confirms the delete", async () => {
    let resolveDelete!: () => void;
    const api = {
      deleteDevice: vi.fn(
        () =>
          new Promise<void>((r) => {
            resolveDelete = r;
          })
      ),
    } as unknown as ESPHomeAPI;

    const pending = deleteDevice(makeDevice(), api, localize);
    // The delete is still in flight: nothing toasted yet. A deferred
    // promise pins the ordering an immediately-resolved mock can't —
    // an optimistic toast fired before the await would show up here
    // and fail the test.
    expect(toastSuccess).not.toHaveBeenCalled();

    resolveDelete();
    const ok = await pending;

    expect(ok).toBe(true);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("toasts an error and reports failure when the backend rejects", async () => {
    const api = {
      deleteDevice: vi.fn(async () => {
        throw new Error("backend said no");
      }),
    } as unknown as ESPHomeAPI;

    const ok = await deleteDevice(makeDevice(), api, localize);

    expect(ok).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

function makeBinaries(): FirmwareBinary[] {
  return [
    { title: "Factory format", file: "firmware.factory.bin" },
    { title: "OTA format", file: "firmware.ota.bin" },
  ];
}

describe("downloadFirmware", () => {
  beforeEach(() => {
    toastError.mockClear();
    downloadBase64Binary.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads the only binary directly when a single one is offered", async () => {
    const firmwareDownload = vi.fn(async () => ({
      data: "ZGF0YQ==",
      filename: "kitchen-firmware.bin",
    }));
    const api = {
      firmwareGetBinaries: vi.fn(async () => [
        { title: "Firmware", file: "firmware.bin" },
      ]),
      firmwareDownload,
    } as unknown as ESPHomeAPI;
    const onMultiple = vi.fn();

    await downloadFirmware(makeDevice(), api, localize, onMultiple);

    expect(onMultiple).not.toHaveBeenCalled();
    expect(firmwareDownload).toHaveBeenCalledWith("kitchen.yaml", "firmware.bin");
    expect(downloadBase64Binary).toHaveBeenCalledWith("ZGF0YQ==", "kitchen-firmware.bin");
  });

  it("defers to the picker without downloading when several binaries exist", async () => {
    const binaries = makeBinaries();
    const firmwareDownload = vi.fn();
    const api = {
      firmwareGetBinaries: vi.fn(async () => binaries),
      firmwareDownload,
    } as unknown as ESPHomeAPI;
    const device = makeDevice();
    const onMultiple = vi.fn();

    await downloadFirmware(device, api, localize, onMultiple);

    expect(onMultiple).toHaveBeenCalledWith(device, binaries);
    expect(firmwareDownload).not.toHaveBeenCalled();
    expect(downloadBase64Binary).not.toHaveBeenCalled();
  });

  it("falls back to the first binary when no picker callback is supplied", async () => {
    const firmwareDownload = vi.fn(async () => ({
      data: "ZA==",
      filename: "kitchen.factory.bin",
    }));
    const api = {
      firmwareGetBinaries: vi.fn(async () => makeBinaries()),
      firmwareDownload,
    } as unknown as ESPHomeAPI;

    await downloadFirmware(makeDevice(), api, localize);

    expect(firmwareDownload).toHaveBeenCalledWith("kitchen.yaml", "firmware.factory.bin");
    expect(downloadBase64Binary).toHaveBeenCalledTimes(1);
  });

  it("toasts an error and skips the picker when no binaries are available", async () => {
    const api = {
      firmwareGetBinaries: vi.fn(async () => []),
      firmwareDownload: vi.fn(),
    } as unknown as ESPHomeAPI;
    const onMultiple = vi.fn();

    await downloadFirmware(makeDevice(), api, localize, onMultiple);

    expect(onMultiple).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(downloadBase64Binary).not.toHaveBeenCalled();
  });

  it("toasts an error when listing binaries fails", async () => {
    const api = {
      firmwareGetBinaries: vi.fn(async () => {
        throw new Error("boom");
      }),
      firmwareDownload: vi.fn(),
    } as unknown as ESPHomeAPI;

    await downloadFirmware(makeDevice(), api, localize);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(downloadBase64Binary).not.toHaveBeenCalled();
  });
});

describe("downloadFirmwareBinary", () => {
  beforeEach(() => {
    toastError.mockClear();
    downloadBase64Binary.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads the chosen binary by file name", async () => {
    const firmwareDownload = vi.fn(async () => ({
      data: "b3Rh",
      filename: "kitchen-firmware.ota.bin",
    }));
    const api = { firmwareDownload } as unknown as ESPHomeAPI;
    const binary: FirmwareBinary = { title: "OTA format", file: "firmware.ota.bin" };

    await downloadFirmwareBinary(makeDevice(), binary, api, localize);

    expect(firmwareDownload).toHaveBeenCalledWith("kitchen.yaml", "firmware.ota.bin");
    expect(downloadBase64Binary).toHaveBeenCalledWith("b3Rh", "kitchen-firmware.ota.bin");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("toasts an error when the download fails", async () => {
    const api = {
      firmwareDownload: vi.fn(async () => {
        throw new Error("nope");
      }),
    } as unknown as ESPHomeAPI;
    const binary: FirmwareBinary = { title: "OTA format", file: "firmware.ota.bin" };

    await downloadFirmwareBinary(makeDevice(), binary, api, localize);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(downloadBase64Binary).not.toHaveBeenCalled();
  });
});
