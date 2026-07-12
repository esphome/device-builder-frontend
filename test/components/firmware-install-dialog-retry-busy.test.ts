/**
 * @vitest-environment happy-dom
 *
 * The error-screen Retry bypasses the page-level seam guards, so it waits
 * out a foreign running build (never claiming it) before re-running the
 * install flow (#1202).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("../../src/util/web-serial.js", () => ({
  connectToPort: vi.fn(),
  detectChip: vi.fn(),
  disconnect: vi.fn(),
  flashFirmware: vi.fn(),
  resetAndDisconnect: vi.fn(),
  SERIAL_ACTIVITY_WINDOW_MS: 6000,
}));

import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import type { FirmwareJob } from "../../src/api/types/firmware-jobs.js";
import { ESPHomeFirmwareInstallDialog } from "../../src/components/firmware-install-dialog.js";
import { identityLocalize } from "../_dom.js";

type FollowCbs = {
  onResult?: (d: unknown) => void;
  onError?: (e: string) => void;
};

const runningJob = { job_id: "foreign-1", configuration: "device.yaml" } as FirmwareJob;

function makeDialog(busy: boolean) {
  const dialog = new ESPHomeFirmwareInstallDialog();
  const followJob = vi.fn((_id: string, cbs: FollowCbs) => {
    cbs.onResult?.({ status: "completed" });
    return "s1";
  });
  Object.assign(dialog, {
    _device: { configuration: "device.yaml" } as ConfiguredDevice,
    _installer: "web-serial",
    _step: "error",
    _logLines: ["old failure line"],
    _localize: identityLocalize,
    _activeJobs: busy ? new Map([["device.yaml", runningJob]]) : new Map(),
    _api: { firmwareFollowJob: followJob },
  });
  const installWebSerial = vi.fn();
  const installUsbFlash = vi.fn();
  dialog.installWebSerial = installWebSerial;
  dialog.installUsbFlash = installUsbFlash;
  return { dialog, followJob, installWebSerial, installUsbFlash };
}

describe("install-dialog Retry while a foreign build runs", () => {
  it("waits out the running job (without claiming it), then retries", async () => {
    const { dialog, followJob, installWebSerial } = makeDialog(true);
    await dialog._retry();
    expect(followJob).toHaveBeenCalledWith("foreign-1", expect.anything());
    expect(installWebSerial).toHaveBeenCalledTimes(1);
    // Never claims the foreign job: dismissal must not cancel it.
    expect(dialog._jobId).toBe("");
    // The failed run's log was dropped, not concatenated with the wait's.
    expect(dialog._logLines).not.toContain("old failure line");
  });

  it("resets the compile clocks before streaming the foreign build", async () => {
    const { dialog } = makeDialog(true);
    const reset = vi.spyOn(dialog._timer, "reset");
    await dialog._retry();
    expect(reset).toHaveBeenCalled();
  });

  it("routes a web-flash retry through the USB flow after the wait", async () => {
    const { dialog, installUsbFlash, installWebSerial } = makeDialog(true);
    dialog._installer = "web-flash";
    await dialog._retry();
    expect(installUsbFlash).toHaveBeenCalledTimes(1);
    expect(installWebSerial).not.toHaveBeenCalled();
  });

  it("fails with the install message and does not retry on a stream error", async () => {
    const { dialog, followJob, installWebSerial } = makeDialog(true);
    followJob.mockImplementationOnce((_id: string, cbs: FollowCbs) => {
      cbs.onError?.("stream lost");
      return "s1";
    });
    await dialog._retry();
    expect(dialog._step).toBe("error");
    expect(dialog._statusMessage).toBe("firmware.install_failed");
    expect(installWebSerial).not.toHaveBeenCalled();
  });

  it("bails when dismissed mid-wait", async () => {
    const { dialog, followJob, installWebSerial } = makeDialog(true);
    followJob.mockImplementationOnce(() => "s1"); // never completes
    const flow = dialog._retry();
    expect(dialog._compileReject).not.toBeNull();
    dialog._compileReject!(new Error("Install dialog dismissed"));
    await flow;
    expect(installWebSerial).not.toHaveBeenCalled();
  });

  it("retries immediately when nothing is running", async () => {
    const { dialog, followJob, installWebSerial } = makeDialog(false);
    await dialog._retry();
    expect(followJob).not.toHaveBeenCalled();
    expect(installWebSerial).toHaveBeenCalledTimes(1);
  });
});
