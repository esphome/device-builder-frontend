// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  flashMcubootOverBle as FlashOverBle,
  flashMcubootOverSerial as FlashOverSerial,
} from "../../../src/platforms/nrf52/smp-engine.js";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  pickBleDevice: vi.fn(),
  flashMcubootOverBle: vi.fn<typeof FlashOverBle>(),
  flashMcubootOverSerial: vi.fn<typeof FlashOverSerial>(),
}));
vi.mock("../../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/platforms/nrf52/ble-nus-picker.js", () => ({
  pickBleDevice: mocks.pickBleDevice,
}));
vi.mock("../../../src/platforms/nrf52/smp-engine.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  flashMcubootOverBle: mocks.flashMcubootOverBle,
  flashMcubootOverSerial: mocks.flashMcubootOverSerial,
}));

import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { SMP_BLE_SERVICE_UUID } from "../../../src/platforms/nrf52/smp-ble-service.js";
import { SmpBleServiceNotFoundError } from "../../../src/platforms/nrf52/smp-engine.js";
import {
  nrfSmpBleInstall,
  nrfSmpSerialInstall,
} from "../../../src/platforms/nrf52/smp-install.js";
import type { AnyBrowserInstall } from "../../../src/platforms/platform-support.js";
import {
  asHost,
  bin,
  makeFlashHost,
} from "../../components/firmware-install-dialog/_flash-host.js";
import { makeMcubootImage } from "./_mcuboot-image.js";

const device = {
  configuration: "itsy.yaml",
  name: "itsy",
  target_platform: "nrf52",
} as ConfiguredDevice;

const INSTALLS = [
  ["Bluetooth", nrfSmpBleInstall, "nrf-smp-ble-ready", "ble"],
  ["serial", nrfSmpSerialInstall, "nrf-smp-serial-ready", "serial"],
] as const;

function makeHost(
  bytes: Uint8Array = makeMcubootImage(),
  file = "zephyr/app_update.bin"
) {
  return makeFlashHost(device, {
    binaries: [bin("firmware.zip"), bin(file)],
    downloadBytes: bytes.buffer as ArrayBuffer,
  });
}

/** The footer's primary action for the step the host is on. */
const flash = (install: AnyBrowserInstall, host: ReturnType<typeof makeHost>) => {
  const steps = install.steps as Record<
    string,
    { footer(): { primary: { run(h: unknown): Promise<void> } } }
  >;
  return steps[host._step].footer().primary.run(asHost(host));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestSerialPort.mockResolvedValue({ port: true });
  mocks.pickBleDevice.mockResolvedValue({ name: "itsy" });
  mocks.flashMcubootOverBle.mockResolvedValue(undefined);
  mocks.flashMcubootOverSerial.mockResolvedValue(undefined);
});

describe.each(INSTALLS)("MCUboot install over %s", (_name, install, readyStep, kind) => {
  const engineFlash =
    kind === "ble" ? mocks.flashMcubootOverBle : mocks.flashMcubootOverSerial;

  it("downloads the update image and shows the ready step", async () => {
    const host = makeHost();
    await install.start(asHost(host));

    expect(host._api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "itsy.yaml",
      "zephyr/app_update.bin"
    );
    expect(host._step).toBe(readyStep);
    expect(install.image.get(asHost(host))).toMatchObject({
      info: { version: "1.2.3" },
    });
  });

  it("fails a build with no update image", async () => {
    const host = makeHost(makeMcubootImage(), "firmware.hex");
    await install.start(asHost(host));

    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.nrf_no_mcuboot_bin");
  });

  it("fails an image that is not MCUboot's", async () => {
    const host = makeHost(makeMcubootImage({ magic: 0xdeadbeef }));
    await install.start(asHost(host));

    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.nrf_bad_mcuboot_image");
    expect(host._errorMessage).toContain("bad magic");
  });

  it("flashes what the chooser picked and reports progress", async () => {
    const host = makeHost();
    await install.start(asHost(host));
    engineFlash.mockImplementation(async (_target, _image, hooks) => {
      hooks.onLog?.("Checking device image status");
      hooks.onProgress(40);
    });

    await flash(install, host);

    expect(engineFlash).toHaveBeenCalledWith(
      kind === "ble" ? { name: "itsy" } : { port: true },
      install.image.get(asHost(host)),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(host._log.lines).toEqual(["Checking device image status"]);
    expect(host._flashPercent).toBe(40);
    expect(host._step).toBe("done");
    expect(host._flashAbort).toBeNull();
  });

  it("stays on the ready step when the chooser is dismissed", async () => {
    const host = makeHost();
    await install.start(asHost(host));
    mocks.pickBleDevice.mockResolvedValue(null);
    mocks.requestSerialPort.mockRejectedValue(
      new DOMException("No port selected", "NotFoundError")
    );

    await flash(install, host);

    expect(engineFlash).not.toHaveBeenCalled();
    expect(host._step).not.toBe("flashing");
    expect(host._step).not.toBe("done");
  });

  it("reports a failed upload with the engine's reason", async () => {
    const host = makeHost();
    await install.start(asHost(host));
    engineFlash.mockRejectedValue(new Error("SMP: no response from the device"));

    await flash(install, host);

    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe(`firmware.nrf_smp_${kind}_failed`);
    expect(host._errorMessage).toBe("SMP: no response from the device");
    expect(host._flashAbort).toBeNull();
  });

  it("drops a late result once the dialog moved on", async () => {
    const host = makeHost();
    await install.start(asHost(host));
    engineFlash.mockImplementation(async (_target, _image, hooks) => {
      host._device = { ...device, name: "other" } as ConfiguredDevice;
      hooks.onLog?.("late");
      throw new Error("aborted");
    });

    await flash(install, host);

    expect(host._log.lines).toEqual([]);
    expect(host._step).toBe("flashing");
  });
});

describe("MCUboot install over Bluetooth", () => {
  it("asks the chooser for the device by name and the SMP service", async () => {
    const host = makeHost();
    await nrfSmpBleInstall.start(asHost(host));
    await flash(nrfSmpBleInstall, host);

    expect(mocks.pickBleDevice).toHaveBeenCalledWith(
      host._localize,
      ["itsy"],
      SMP_BLE_SERVICE_UUID
    );
  });

  it("says so when the picked device has no SMP service", async () => {
    const host = makeHost();
    await nrfSmpBleInstall.start(asHost(host));
    mocks.flashMcubootOverBle.mockRejectedValue(new SmpBleServiceNotFoundError());

    await flash(nrfSmpBleInstall, host);

    expect(host._statusMessage).toBe("firmware.nrf_smp_ble_service_not_found");
  });
});
