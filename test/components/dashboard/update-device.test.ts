import { describe, expect, it, vi } from "vitest";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import { updateDevice } from "../../../src/components/dashboard/install.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";

function makeHost() {
  return {
    _openInstallMethod: vi.fn(),
    _openCommand: vi.fn(),
  } as unknown as ESPHomePageDashboard & {
    _openInstallMethod: ReturnType<typeof vi.fn>;
    _openCommand: ReturnType<typeof vi.fn>;
  };
}

describe("updateDevice", () => {
  it("installs directly for a device that takes an OTA", () => {
    const host = makeHost();
    const device = makeConfiguredDevice();
    updateDevice(host, device);
    expect(host._openCommand).toHaveBeenCalledWith(device, "install");
    expect(host._openInstallMethod).not.toHaveBeenCalled();
  });

  it("opens the picker for a device only USB can take", () => {
    const host = makeHost();
    const device = makeConfiguredDevice({ runtime_state: { ota_signed: true } });
    updateDevice(host, device);
    expect(host._openInstallMethod).toHaveBeenCalledWith(device);
    expect(host._openCommand).not.toHaveBeenCalled();
  });
});
