import { describe, expect, it, vi } from "vitest";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { applyInstallMethod } from "../../src/components/apply-install-method.js";
import type { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";

const device = { configuration: "x.yaml", name: "x" } as ConfiguredDevice;

function deps() {
  const firmwareDialog = {
    installWebSerial: vi.fn(),
    installUsbFlash: vi.fn(),
    installBinaryDownload: vi.fn(),
  } as unknown as ESPHomeFirmwareInstallDialog;
  return { device, openInstall: vi.fn(), firmwareDialog };
}

describe("applyInstallMethod", () => {
  it("ota uses the default-address sentinel", () => {
    const d = deps();
    applyInstallMethod("ota", undefined, d);
    expect(d.openInstall).toHaveBeenCalledWith("OTA");
  });

  it("ota passes a typed address override through", () => {
    const d = deps();
    applyInstallMethod("ota", "1.2.3.4", d);
    expect(d.openInstall).toHaveBeenCalledWith("1.2.3.4");
  });

  it("server-serial passes the chosen port through", () => {
    const d = deps();
    applyInstallMethod("server-serial", "/dev/ttyUSB0", d);
    expect(d.openInstall).toHaveBeenCalledWith("/dev/ttyUSB0");
  });

  it("server-serial without a port does nothing (no portless install)", () => {
    const d = deps();
    applyInstallMethod("server-serial", undefined, d);
    expect(d.openInstall).not.toHaveBeenCalled();
  });

  it("web-serial routes to the firmware dialog, not the install command", () => {
    const d = deps();
    applyInstallMethod("web-serial", undefined, d);
    expect(d.firmwareDialog.installWebSerial).toHaveBeenCalledWith(device);
    expect(d.openInstall).not.toHaveBeenCalled();
  });

  it("web-flash routes to the dialog's USB-flash flow (compile, then hand off)", () => {
    const d = deps();
    applyInstallMethod("web-flash", undefined, d);
    expect(d.firmwareDialog.installUsbFlash).toHaveBeenCalledWith(device);
    expect(d.openInstall).not.toHaveBeenCalled();
    expect(d.firmwareDialog.installWebSerial).not.toHaveBeenCalled();
  });

  it("binary-download routes to the firmware dialog", () => {
    const d = deps();
    applyInstallMethod("binary-download", undefined, d);
    expect(d.firmwareDialog.installBinaryDownload).toHaveBeenCalledWith(device);
  });

  it("bootloader opens an OTA install carrying the bootloader flag", () => {
    const d = deps();
    applyInstallMethod("bootloader", undefined, d);
    expect(d.openInstall).toHaveBeenCalledWith("OTA", { bootloader: true });
  });
});
