/**
 * @vitest-environment happy-dom
 *
 * Pins the dashboard install seams' busy guard: a running job re-attaches
 * instead of enqueuing over it, including the mid-picker race (#1194).
 */
import { describe, expect, it, vi } from "vitest";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { FirmwareJob } from "../../../src/api/types/firmware-jobs.js";
import {
  onInstallMethodSelect,
  openCommand,
  openInstallMethod,
} from "../../../src/components/dashboard/install.js";
import { makeDashboardHost } from "./_host.js";

const device = {
  name: "kitchen",
  friendly_name: "Kitchen",
  configuration: "kitchen.yaml",
} as ConfiguredDevice;

interface HostInternals {
  _activeJobs: Map<string, FirmwareJob>;
  _installMethodOpen: boolean;
}

function makeHost(busyConfigs: string[] = []) {
  const followJob = vi.fn();
  const openForDevice = vi.fn();
  const host = makeDashboardHost({
    _activeJobs: new Map(
      busyConfigs.map((c) => [c, { job_id: "job-1", configuration: c } as FirmwareJob])
    ),
    _commandDialog: { followJob, openForDevice },
    _devices: [device],
    _firmwareDialog: null,
    _installMethodDevice: null,
    _installMethodMode: "install",
    _installMethodOpen: false,
  });
  return {
    host,
    internals: host as unknown as HostInternals,
    followJob,
    openForDevice,
  };
}

const selectOta = () => new CustomEvent("select-method", { detail: { method: "ota" } });

describe("dashboard install seam busy guard", () => {
  it("openInstallMethod re-attaches instead of opening the picker while busy", () => {
    const { host, internals, followJob } = makeHost(["kitchen.yaml"]);
    openInstallMethod(host, device);
    expect(followJob).toHaveBeenCalledTimes(1);
    expect(internals._installMethodOpen).toBe(false);
  });

  it("openCommand(install) re-attaches instead of enqueuing while busy", () => {
    const { host, followJob, openForDevice } = makeHost(["kitchen.yaml"]);
    openCommand(host, device, "install");
    expect(followJob).toHaveBeenCalledTimes(1);
    expect(openForDevice).not.toHaveBeenCalled();
  });

  it("openCommand passes non-install commands through while busy", () => {
    // Validate/clean never enqueue an install; they keep working mid-job.
    const { host, followJob, openForDevice } = makeHost(["kitchen.yaml"]);
    openCommand(host, device, "validate");
    expect(followJob).not.toHaveBeenCalled();
    expect(openForDevice).toHaveBeenCalledTimes(1);
  });

  it("a job started while the picker sat open blocks the select from superseding", () => {
    const { host, internals, followJob, openForDevice } = makeHost();
    openInstallMethod(host, device);
    expect(internals._installMethodOpen).toBe(true);
    // The race: a job starts (second tab, deferred update firing) mid-picker.
    internals._activeJobs.set("kitchen.yaml", {
      job_id: "job-2",
      configuration: "kitchen.yaml",
    } as FirmwareJob);
    onInstallMethodSelect(host, selectOta());
    expect(followJob).toHaveBeenCalledTimes(1);
    expect(openForDevice).not.toHaveBeenCalled();
  });

  it("an idle select still enqueues the install", () => {
    const { host, followJob, openForDevice } = makeHost();
    openInstallMethod(host, device);
    onInstallMethodSelect(host, selectOta());
    expect(followJob).not.toHaveBeenCalled();
    expect(openForDevice).toHaveBeenCalledTimes(1);
  });
});
