/**
 * @vitest-environment happy-dom
 *
 * The dashboard's install seams re-attach to a running job instead of
 * enqueuing over it — the backend supersedes on enqueue (cancels and
 * restarts the configuration's in-flight jobs) (#1194).
 */
import { describe, expect, it, vi } from "vitest";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { FirmwareJob } from "../../../src/api/types/firmware-jobs.js";
import {
  onInstallMethodSelect,
  openCommand,
  openInstallMethod,
} from "../../../src/components/dashboard/install.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";

const device = {
  name: "kitchen",
  friendly_name: "Kitchen",
  configuration: "kitchen.yaml",
} as ConfiguredDevice;

function makeHost(busyConfigs: string[] = []) {
  const followJob = vi.fn();
  const openForDevice = vi.fn();
  const host = {
    _activeJobs: new Map(
      busyConfigs.map((c) => [c, { job_id: "job-1", configuration: c } as FirmwareJob])
    ),
    _commandDialog: { followJob, openForDevice },
    _devices: [device],
    _localize: (key: string) => key,
    _firmwareDialog: null,
    _installMethodDevice: null as ConfiguredDevice | null,
    _installMethodMode: "install" as const,
    _installMethodOpen: false,
  };
  return {
    host: host as unknown as ESPHomePageDashboard,
    raw: host,
    followJob,
    openForDevice,
  };
}

const selectOta = () =>
  new CustomEvent("select-method", { detail: { method: "ota" as string } });

describe("dashboard install seam busy guard", () => {
  it("openInstallMethod re-attaches instead of opening the picker while busy", () => {
    const { host, raw, followJob } = makeHost(["kitchen.yaml"]);
    openInstallMethod(host, device);
    expect(followJob).toHaveBeenCalledTimes(1);
    expect(raw._installMethodOpen).toBe(false);
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
    const { host, raw, followJob, openForDevice } = makeHost();
    openInstallMethod(host, device);
    expect(raw._installMethodOpen).toBe(true);
    // The race: a job starts (second tab, deferred update firing) mid-picker.
    raw._activeJobs.set("kitchen.yaml", {
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
