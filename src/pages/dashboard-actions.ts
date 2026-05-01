import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type { BulkDeleteResult, ConfiguredDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";

export function editDevice(device: ConfiguredDevice) {
  window.history.pushState({}, "", `/device/${device.configuration}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function deleteDevice(
  device: ConfiguredDevice,
  api: ESPHomeAPI,
  devices: ConfiguredDevice[],
  localize: LocalizeFunc
) {
  const name = device.friendly_name || device.name;
  toast.success(localize("dashboard.deleted", { name }), { richColors: true });
  api.deleteDevice(device.configuration).catch(() => {
    if (devices.some((d) => d.configuration === device.configuration)) {
      toast.error(localize("dashboard.delete_failed", { name }), { richColors: true });
    }
  });
}

export async function deleteBulkDevices(
  configurations: string[],
  devices: ConfiguredDevice[],
  api: ESPHomeAPI,
  localize: LocalizeFunc
) {
  let results: BulkDeleteResult[];
  try {
    results = await api.deleteBulkDevices(configurations);
  } catch {
    toast.error(localize("dashboard.delete_bulk_failed"), { richColors: true });
    return;
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);

  if (succeeded > 0) {
    toast.success(localize("dashboard.delete_bulk_success", { count: succeeded }), {
      richColors: true,
    });
  }
  for (const result of failed) {
    const device = devices.find((d) => d.configuration === result.configuration);
    const name = device ? device.friendly_name || device.name : result.configuration;
    toast.error(localize("dashboard.delete_failed", { name }), { richColors: true });
  }
}

export async function downloadYaml(
  device: ConfiguredDevice,
  api: ESPHomeAPI,
  localize: LocalizeFunc
) {
  const name = device.friendly_name || device.name;
  let url: string | undefined;
  try {
    const yaml = await api.getConfig(device.configuration);
    const blob = new Blob([yaml], { type: "text/yaml" });
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = device.configuration.endsWith(".yaml")
      ? device.configuration
      : `${device.configuration}.yaml`;
    a.click();
  } catch {
    toast.error(localize("dashboard.action_download_yaml_failed", { name }), {
      richColors: true,
    });
  } finally {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}

export async function fetchApiKey(
  device: ConfiguredDevice,
  api: ESPHomeAPI
): Promise<string> {
  // Server-side resolution — uses ESPHome's YAML loader so !secret /
  // !include / packages all resolve the same way as a real compile.
  // (Previously named ``extractApiKey`` when this was a regex on the
  // raw YAML; the new name reflects that the work is on the backend.)
  try {
    return await api.getApiKey(device.configuration);
  } catch {
    return "";
  }
}

export function streamSerialToDialog(port: any, dialog: any) {
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  const reader = decoder.readable.getReader();
  let buffer = "";
  const readLoop = async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          dialog._lines = [...dialog._lines, line];
        }
      }
    } catch {
      /* Port closed */
    }
  };
  readLoop();
}

