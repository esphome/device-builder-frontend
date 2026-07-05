import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { firmwareJobDisplayName } from "../../util/firmware-job-display.js";
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

export async function openLogs(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice
): Promise<void> {
  // Offer the OTA-vs-serial choice whenever a serial path exists — browser
  // WebSerial, or serial ports on the server (mirrors the old dashboard's
  // logs-target behavior; see #525). With no serial option at all, skip the
  // picker and open OTA logs directly. The device's online/offline state is
  // intentionally not consulted: the picker (or OTA fallback) is purely
  // serial-path driven, and the picker already gates its own OTA row on state.
  const hasWebSerial = "serial" in navigator;
  let hasServerPorts = false;
  if (!hasWebSerial) {
    // Only pay the backend round-trip when WebSerial can't already provide a
    // serial path.
    try {
      hasServerPorts = (await host._api.getSerialPorts()).length > 0;
    } catch (err) {
      // Lockstep deployment means this command exists, so a rejection is a
      // real WS/backend fault, not version drift; log it but still fall
      // through to OTA logs so the user isn't left without any path.
      console.warn("getSerialPorts failed; falling back to OTA logs", err);
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
