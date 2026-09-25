import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyError: vi.fn(),
  requestBleNusDevice: vi.fn(),
  isWebBluetoothSupported: vi.fn(() => true),
}));
vi.mock("../../src/util/notify.js", () => ({
  LONG_TOAST_DURATION_MS: 8000,
  notifyError: mocks.notifyError,
}));
vi.mock("../../src/util/ble-nus-stream.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isWebBluetoothSupported: mocks.isWebBluetoothSupported,
  requestBleNusDevice: mocks.requestBleNusDevice,
}));

import { pickBleNusDevice } from "../../src/util/ble-nus-picker.js";
import { BleUnavailableError } from "../../src/util/ble-nus-stream.js";

const localize = (key: string) => key;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isWebBluetoothSupported.mockReturnValue(true);
});

describe("pickBleNusDevice", () => {
  it("hands the chosen device back, passing the names through", async () => {
    const device = {};
    mocks.requestBleNusDevice.mockResolvedValue(device);
    await expect(pickBleNusDevice(localize, ["a", "b"])).resolves.toBe(device);
    expect(mocks.requestBleNusDevice).toHaveBeenCalledWith(["a", "b"]);
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("is quiet when the chooser is dismissed", async () => {
    mocks.requestBleNusDevice.mockResolvedValue(null);
    await expect(pickBleNusDevice(localize, [])).resolves.toBeNull();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("says when the browser has no Web Bluetooth at all", async () => {
    mocks.isWebBluetoothSupported.mockReturnValue(false);
    await expect(pickBleNusDevice(localize, [])).resolves.toBeNull();
    expect(mocks.notifyError).toHaveBeenCalledWith("dashboard.logs_ble_nus_unsupported");
    expect(mocks.requestBleNusDevice).not.toHaveBeenCalled();
  });

  it("tells an adapter that is off apart from Brave's switched-off API", async () => {
    mocks.requestBleNusDevice.mockRejectedValue(new BleUnavailableError("off"));
    await pickBleNusDevice(localize, []);
    expect(mocks.notifyError).toHaveBeenLastCalledWith(
      "dashboard.logs_ble_nus_unavailable"
    );

    mocks.requestBleNusDevice.mockRejectedValue(new BleUnavailableError("brave"));
    await pickBleNusDevice(localize, []);
    expect(mocks.notifyError).toHaveBeenLastCalledWith(
      "dashboard.logs_ble_nus_unavailable",
      {
        description: "dashboard.logs_method_ble_nus_brave",
        duration: 8000,
      }
    );
  });

  it("reports any other chooser failure as a failed open", async () => {
    mocks.requestBleNusDevice.mockRejectedValue(new Error("boom"));
    await expect(pickBleNusDevice(localize, [])).resolves.toBeNull();
    expect(mocks.notifyError).toHaveBeenLastCalledWith(
      "dashboard.logs_ble_nus_open_failed"
    );
  });
});
