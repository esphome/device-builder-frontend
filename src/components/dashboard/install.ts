import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { firmwareJobDisplayName } from "../../util/firmware-job-display.js";
import { launchLogs } from "../../util/logs-launch.js";
import { applyInstallMethod } from "../apply-install-method.js";
import type { CommandType } from "../command-dialog.js";
import { openLogsWithMethod } from "./actions-ui.js";

export function openInstallMethod(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice
): void {
  if (showJobProgress(host, device)) return;
  host._installMethodDevice = device;
  host._installMethodMode = "install";
  host._installMethodOpen = true;
}

export function onInstallMethodSelect(
  host: ESPHomePageDashboard,
  e: CustomEvent<{ method: string; port?: string }>
): void {
  const device = host._installMethodDevice;
  host._installMethodOpen = false;
  if (!device) return;
  const { method, port } = e.detail;
  if (host._installMethodMode === "logs") {
    void openLogsWithMethod(host, device, method, port);
    return;
  }
  // A job may have started while the picker sat open (second tab, a
  // deferred queued update firing); enqueuing now would supersede it.
  if (showJobProgress(host, device)) return;
  applyInstallMethod(method, port, {
    device,
    firmwareDialog: host._firmwareDialog,
    openInstall: (p, options) => openCommand(host, device, "install", p, options),
  });
}

export function openCommand(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice,
  type: CommandType,
  port?: string,
  options?: { bootloader?: boolean }
): void {
  if (type === "install" && showJobProgress(host, device)) return;
  host._commandDialog.openForDevice(device, type, { port, ...options });
}

/**
 * Re-attach the command dialog to the device's running job.
 *
 * Returns true when a job was open — the install seams bail on it,
 * since enqueuing would supersede: the backend cancels and restarts
 * the configuration's in-flight jobs.
 */
export function showJobProgress(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice
): boolean {
  const job = host._activeJobs.get(device.configuration);
  if (!job) return false;
  host._commandDialog.followJob(
    job,
    firmwareJobDisplayName(job, host._devices, host._localize)
  );
  return true;
}

export function openLogs(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice
): Promise<void> {
  return launchLogs(
    { api: host._api, logsDialog: host._logsDialog, localize: host._localize },
    device,
    () => {
      host._installMethodDevice = device;
      host._installMethodMode = "logs";
      host._installMethodOpen = true;
    }
  );
}
