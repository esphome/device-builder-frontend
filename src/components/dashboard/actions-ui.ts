import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { AdoptableDevice, ConfiguredDevice, Label } from "../../api/types.js";
import { firmwareJobDisplayName } from "../../util/firmware-job-display.js";
import { clearJustCreated } from "../../util/just-created.js";
import { streamSerialToDialog } from "./actions.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";

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
    const reason = err instanceof Error ? err.message : String(err);
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
    const reason = err instanceof Error ? err.message : String(err);
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
  let response: Awaited<ReturnType<ESPHomeAPI["renameDevice"]>>;
  try {
    response = await host._api.renameDevice(device.configuration, newName);
  } catch {
    toast.error(host._localize("dashboard.action_rename_failed", { name: device.name }), {
      richColors: true,
    });
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
    try {
      const serialPort = await (
        navigator as unknown as {
          serial: { requestPort: () => Promise<SerialPortLike> };
        }
      ).serial.requestPort();
      await serialPort.open({ baudRate: 115200 });
      host._logsDialog.configuration = device.configuration;
      host._logsDialog.name = device.friendly_name || device.name;
      host._logsDialog.openPassive();
      const cancelSerial = streamSerialToDialog(serialPort, host._logsDialog);
      host._logsDialog.setSerialCancel(cancelSerial);
    } catch {
      /* User cancelled */
    }
  }
}

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
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
