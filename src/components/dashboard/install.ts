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
  host._commandDialog.openForDevice(device, type, { port, ...options });
}

export function showJobProgress(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice
): void {
  const job = host._activeJobs.get(device.configuration);
  if (!job) return;
  host._commandDialog.followJob(
    job,
    firmwareJobDisplayName(job, host._devices, host._localize)
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
