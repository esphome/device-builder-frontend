import { DeviceState, type ConfiguredDevice } from "../../api/types.js";
import type { CommandType } from "../command-dialog.js";
import { firmwareJobDisplayName } from "../../util/firmware-job-display.js";
import { openLogsWithMethod } from "./actions-ui.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";

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

export function openLogs(host: ESPHomePageDashboard, device: ConfiguredDevice): void {
  if (device.state === DeviceState.ONLINE) {
    host._logsDialog.configuration = device.configuration;
    host._logsDialog.name = device.friendly_name || device.name;
    host._logsDialog.open();
  } else {
    host._installMethodDevice = device;
    host._installMethodMode = "logs";
    host._installMethodOpen = true;
  }
}
