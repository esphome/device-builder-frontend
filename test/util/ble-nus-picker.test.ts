import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copyAddressToClipboard: vi.fn(async () => {}),
  notifyError: vi.fn(),
  requestBleNusDevice: vi.fn(),
  isWebBluetoothSupported: vi.fn(() => true),
}));
vi.mock("../../src/util/copy-address.js", () => ({
  copyAddressToClipboard: mocks.copyAddressToClipboard,
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
import {
  BleUnavailableError,
  BRAVE_WEB_BLUETOOTH_FLAG,
} from "../../src/util/ble-nus-stream.js";

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
        description: `dashboard.logs_method_ble_nus_brave ${BRAVE_WEB_BLUETOOTH_FLAG}`,
        duration: 8000,
        action: {
          label: "settings.remote_build_address_copy",
          onClick: expect.any(Function),
        },
      }
    );
    // The action copies the flag address, since no page can link to it.
    mocks.notifyError.mock.lastCall![1].action.onClick();
    expect(mocks.copyAddressToClipboard).toHaveBeenCalledWith(
      localize,
      BRAVE_WEB_BLUETOOTH_FLAG
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
