import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { firmwareJobDisplayName } from "../../util/firmware-job-display.js";
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
  if (method === "ota") {
    openCommand(host, device, "install", port ?? "OTA");
  } else if (method === "server-serial") {
    openCommand(host, device, "install", port!);
  } else if (method === "web-serial") {
    host._firmwareDialog.installWebSerial(device);
  } else if (method === "web-download") {
    host._firmwareDialog.installWebDownload(device);
  } else if (method === "binary-download") {
    host._firmwareDialog.installBinaryDownload(device);
  }
}

export function openCommand(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice,
  type: CommandType,
  port?: string
): void {
  host._commandDialog.configuration = device.configuration;
  host._commandDialog.name = device.friendly_name || device.name;
  host._commandDialog.open(type, port ? { port } : undefined);
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

export async function openLogs(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice
): Promise<void> {
  // Offer the OTA-vs-serial choice whenever a serial path exists — browser
  // WebSerial, or serial ports on the server (mirrors the old dashboard's
  // logs-target behavior; see #525). With no serial option at all, skip the
  // picker and open OTA logs directly.
  const hasWebSerial = "serial" in navigator;
  let hasServerPorts = false;
  if (!hasWebSerial) {
    // Only pay the backend round-trip when WebSerial can't already provide a
    // serial path.
    try {
      hasServerPorts = (await host._api.getSerialPorts()).length > 0;
    } catch {
      hasServerPorts = false;
    }
  }
  if (hasWebSerial || hasServerPorts) {
    host._installMethodDevice = device;
    host._installMethodMode = "logs";
    host._installMethodOpen = true;
    return;
  }
  host._logsDialog.configuration = device.configuration;
  host._logsDialog.name = device.friendly_name || device.name;
  host._logsDialog.open();
}
