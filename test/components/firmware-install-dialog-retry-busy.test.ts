/**
 * @vitest-environment happy-dom
 *
 * The error-screen Retry re-runs the install in the click, awaiting nothing:
 * the Web Serial install asks for its port first, and a port picker needs the
 * click (#1893). A build someone else started meanwhile is waited out by the
 * compile, not here (#1202).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/util/web-serial.js", () => ({}));
vi.mock("../../src/platforms/esp/esptool.js", () => ({
  connectToPort: vi.fn(),
  disconnect: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(),
}));

import { identityLocalize } from "../_dom.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import type { FirmwareJob } from "../../src/api/types/firmware-jobs.js";
import { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import type { Installer } from "../../src/components/firmware-install-dialog/types.js";

const runningJob = { job_id: "foreign-1", configuration: "device.yaml" } as FirmwareJob;

function makeDialog(installer: Installer) {
  const dialog = new ESPHomeFirmwareInstallDialog();
  const followJob = vi.fn(() => "s1");
  Object.assign(dialog, {
    _device: { configuration: "device.yaml" } as ConfiguredDevice,
    _installer: installer,
    _step: "error",
    _localize: identityLocalize,
    _activeJobs: new Map([["device.yaml", runningJob]]),
    _api: { firmwareFollowJob: followJob },
  });
  const installs = {
    installWebSerial: vi.fn(),
    installUsbFlash: vi.fn(),
    installBrowserFlasher: vi.fn(),
  };
  Object.assign(dialog, installs);
  return { dialog, followJob, ...installs };
}

describe("install-dialog Retry while a foreign build runs", () => {
  it.each([
    ["web-serial", "installWebSerial"],
    ["web-flash", "installUsbFlash"],
  ] as const)("re-runs a %s install in the click", (installer, install) => {
    const made = makeDialog(installer);
    // Not awaited: the install has to start before the click's turn ends.
    void made.dialog._retry();
    expect(made[install]).toHaveBeenCalledTimes(1);
    expect(made.followJob).not.toHaveBeenCalled();
  });

  it("re-runs a platform flasher that has no image yet", () => {
    const made = makeDialog("web-serial");
    const flasher = { id: "rtl-ambz2", image: { get: () => null } };
    Object.assign(made.dialog, { _installer: flasher.id, _flasher: flasher });
    void made.dialog._retry();
    expect(made.installBrowserFlasher).toHaveBeenCalledTimes(1);
    expect(made.installWebSerial).not.toHaveBeenCalled();
    expect(made.followJob).not.toHaveBeenCalled();
  });

  it("opens no port picker for an install that is not the Web Serial one", () => {
    const made = makeDialog("binary-download");
    void made.dialog._retry();
    expect(made.installWebSerial).not.toHaveBeenCalled();
    expect(made.installUsbFlash).not.toHaveBeenCalled();
  });

  it("does nothing without a device", () => {
    const made = makeDialog("web-serial");
    made.dialog._device = null;
    void made.dialog._retry();
    expect(made.installWebSerial).not.toHaveBeenCalled();
  });
});
