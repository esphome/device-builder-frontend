import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type {
  AdoptableDevice,
  ConfiguredDevice,
  Label,
} from "../../api/types/devices.js";
import { DeviceState } from "../../api/types/devices.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { getErrorMessage } from "../../util/error-message.js";
import { firmwareJobDisplayName } from "../../util/firmware-job-display.js";
import { clearJustCreated } from "../../util/just-created.js";
import {
  attachSerialLogStream,
  reconnectWebSerialLogs,
  requestAndOpenSerialPort,
} from "../../util/post-install-logs.js";

export async function executeFriendlyName(
  host: ESPHomePageDashboard,
  e: CustomEvent<{ newFriendlyName: string; install: boolean }>
): Promise<void> {
  const device = host._actionDevice;
  if (!device) return;
  const { newFriendlyName, install } = e.detail;
  let result: Awaited<ReturnType<ESPHomeAPI["editFriendlyName"]>>;
  try {
    result = await host._api.editFriendlyName(device.configuration, newFriendlyName);
  } catch (err) {
    const reason = getErrorMessage(err);
    toast.error(
      host._localize("dashboard.action_friendly_name_failed", {
        name: device.name,
        reason,
      }),
      { richColors: true }
    );
    return;
  }
  if (!result.rewritten) {
    toast.success(host._localize("dashboard.action_friendly_name_unchanged"), {
      richColors: true,
    });
    return;
  }
  if (!install) {
    toast.success(
      host._localize("dashboard.action_friendly_name_success", {
        name: newFriendlyName,
      }),
      { richColors: true }
    );
    return;
  }
  toast.success(
    host._localize("dashboard.action_friendly_name_success", {
      name: newFriendlyName,
    }),
    { richColors: true }
  );
  host._openInstallMethod(device);
}

export async function executeClone(
  host: ESPHomePageDashboard,
  e: CustomEvent<{ newName: string; newFriendlyName: string }>
): Promise<void> {
  const device = host._actionDevice;
  if (!device) return;
  const { newName, newFriendlyName } = e.detail;
  try {
    const friendly = newFriendlyName.length > 0 ? newFriendlyName : undefined;
    await host._api.cloneDevice(device.configuration, newName, friendly);
  } catch (err) {
    const reason = getErrorMessage(err);
    toast.error(
      host._localize("dashboard.action_clone_failed", {
        name: device.name,
        reason,
      }),
      { richColors: true }
    );
    return;
  }
  toast.success(host._localize("dashboard.action_clone_success", { name: newName }), {
    richColors: true,
  });
}

export async function executeRename(
  host: ESPHomePageDashboard,
  e: CustomEvent<string>
): Promise<void> {
  const device = host._actionDevice;
  if (!device) return;
  const newName = e.detail;
  if (newName === device.name) return;
  // The default rename compiles + OTA-installs, which only works against a
  // reachable device. Route offline/unknown devices to a confirm before a
  // config-only rename (renames the YAML now; the device keeps its old name
  // until reflashed, which the prompt spells out).
  if (device.state !== DeviceState.ONLINE) {
    host._openConfirm({ kind: "rename-config-only", device, newName });
    return;
  }
  await performRename(host, device, newName, false);
}

/** Call ``devices/rename`` and surface the result (job-follow, success, or error). */
export async function performRename(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice,
  newName: string,
  configOnly: boolean
): Promise<void> {
  let response: Awaited<ReturnType<ESPHomeAPI["renameDevice"]>>;
  try {
    response = await host._api.renameDevice(device.configuration, newName, configOnly);
  } catch (err) {
    const reason = getErrorMessage(err);
    toast.error(
      host._localize("dashboard.action_rename_failed", {
        name: device.name,
        reason,
      }),
      { richColors: true }
    );
    return;
  }
  clearJustCreated();
  if (response.job) {
    host._commandDialog.followJob(
      response.job,
      firmwareJobDisplayName(response.job, host._devices, host._localize)
    );
    return;
  }
  toast.success(host._localize("dashboard.action_rename_success", { name: newName }), {
    richColors: true,
  });
}

export async function toggleIgnore(
  host: ESPHomePageDashboard,
  device: AdoptableDevice
): Promise<void> {
  try {
    await host._api.ignoreDevice(device.name, !device.ignored);
  } catch {
    const name = device.friendly_name || device.name;
    toast.error(
      host._localize(
        device.ignored
          ? "dashboard.action_unignore_failed"
          : "dashboard.action_ignore_failed",
        { name }
      ),
      { richColors: true }
    );
  }
}

export async function deleteLabel(
  host: ESPHomePageDashboard,
  label: Label
): Promise<void> {
  if (!host._api) return;
  try {
    await host._api.deleteLabel(label.id);
    if (host._selectedLabels.includes(label.id)) {
      host._selectedLabels = host._selectedLabels.filter((id) => id !== label.id);
    }
  } catch (err) {
    console.warn("label delete failed", err);
    toast.error(host._localize("dashboard.labels_delete_failed"), {
      richColors: true,
    });
  }
}

export async function openLogsWithMethod(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice,
  method: string,
  port?: string
): Promise<void> {
  if (method === "ota") {
    host._logsDialog.configuration = device.configuration;
    host._logsDialog.name = device.friendly_name || device.name;
    host._logsDialog.open();
  } else if (method === "server-serial") {
    host._logsDialog.configuration = device.configuration;
    host._logsDialog.name = device.friendly_name || device.name;
    host._logsDialog.open(port);
  } else if (method === "web-serial") {
    if (!("serial" in navigator)) {
      toast.error(host._localize("dashboard.logs_web_serial_unsupported"), {
        richColors: true,
      });
      return;
    }
    let serialPort: SerialPort | null;
    try {
      serialPort = await requestAndOpenSerialPort();
    } catch {
      // The user picked a port but it couldn't open (claimed by another tab,
      // driver error); unlike a picker dismissal this needs feedback.
      toast.error(host._localize("dashboard.logs_web_serial_open_failed"), {
        richColors: true,
      });
      return;
    }
    if (!serialPort) return; // User dismissed the port picker.
    host._logsDialog.configuration = device.configuration;
    host._logsDialog.name = device.friendly_name || device.name;
    // Reconnect (the dialog's "click Start to reconnect") re-acquires a fresh
    // port via the picker — the cached handle can be dead after a device reset.
    host._logsDialog.openPassive({
      onReconnect: () => reconnectWebSerialLogs(host._logsDialog, host._localize),
    });
    // attach toasts the reopen-retry failure itself; cover any other rejection
    // so it can't escape this fire-and-forget call as an unhandled rejection.
    try {
      await attachSerialLogStream(serialPort, host._logsDialog, host._localize);
    } catch {
      toast.error(host._localize("dashboard.logs_web_serial_open_failed"), {
        richColors: true,
      });
    }
  }
}

export function scheduleScrollIntoView(
  host: ESPHomePageDashboard,
  configuration: string
): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => scrollAdoptedIntoView(host, configuration))
  );
}

function scrollAdoptedIntoView(host: ESPHomePageDashboard, configuration: string): void {
  const root = host.shadowRoot;
  if (!root) return;
  const escaped = CSS.escape(configuration);
  const card = root.querySelector<HTMLElement>(
    `esphome-device-card[data-configuration="${escaped}"]`
  );
  if (card) {
    card.scrollIntoView({ behavior: "instant", block: "center" });
    return;
  }
  const table = root.querySelector("esphome-device-table") as
    | (HTMLElement & {
        scrollConfigurationIntoView?: (configuration: string) => void;
      })
    | null;
  table?.scrollConfigurationIntoView?.(configuration);
}
