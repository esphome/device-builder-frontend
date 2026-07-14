import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { followActiveJob } from "../../util/firmware-job-display.js";
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
  // A job may have started while the picker sat open; enqueuing now
  // would supersede it. Covers the firmwareDialog methods too, which
  // never reach openCommand's guard.
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

/** Re-attach the command dialog to the device's running job; true when one existed. */
export function showJobProgress(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice
): boolean {
  return followActiveJob(
    host._activeJobs,
    device.configuration,
    host._commandDialog,
    host._devices,
    host._localize
  );
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
