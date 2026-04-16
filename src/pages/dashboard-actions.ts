import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";

export function editDevice(device: ConfiguredDevice) {
  window.history.pushState({}, "", `/device/${device.configuration}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function deleteDevice(
  device: ConfiguredDevice,
  api: ESPHomeAPI,
  devices: ConfiguredDevice[],
  localize: LocalizeFunc,
) {
  const name = device.friendly_name || device.name;
  toast.success(localize("dashboard.deleted", { name }), { richColors: true });
  api.deleteDevice(device.configuration).catch(() => {
    if (devices.some((d) => d.configuration === device.configuration)) {
      toast.error(localize("dashboard.delete_failed", { name }), { richColors: true });
    }
  });
}

export function validateDevice(device: ConfiguredDevice, localize: LocalizeFunc) {
  const name = device.friendly_name || device.name;
  toast.success(localize("dashboard.action_validate_success", { name }), { richColors: true });
}

export function installDevice(device: ConfiguredDevice, localize: LocalizeFunc) {
  const name = device.friendly_name || device.name;
  toast.success(localize("dashboard.action_install_success", { name }), { richColors: true });
}

export function cleanBuild(device: ConfiguredDevice, localize: LocalizeFunc) {
  const name = device.friendly_name || device.name;
  toast.success(localize("dashboard.action_clean_success", { name }), { richColors: true });
}

export function downloadElf(device: ConfiguredDevice, localize: LocalizeFunc) {
  const name = device.friendly_name || device.name;
  toast.success(localize("dashboard.action_download_elf_success", { name }), { richColors: true });
}

export async function downloadYaml(device: ConfiguredDevice, api: ESPHomeAPI) {
  const yaml = await api.getConfig(device.configuration);
  const blob = new Blob([yaml], { type: "text/yaml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = device.configuration.endsWith(".yaml")
    ? device.configuration
    : `${device.configuration}.yaml`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function extractApiKey(device: ConfiguredDevice, api: ESPHomeAPI): Promise<string> {
  try {
    const yaml = await api.getConfig(device.configuration);
    // Look for api: encryption: key: "..."
    const match = yaml.match(/api:\s[\s\S]*?encryption:\s[\s\S]*?key:\s*["']([^"']+)["']/);
    return match?.[1] ?? "";
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
    } catch { /* Port closed */ }
  };
  readLoop();
}

export function compileAndUpload(
  configuration: string,
  name: string,
  api: ESPHomeAPI,
  localize: LocalizeFunc,
): Promise<void> {
  return new Promise((resolve) => {
    api.compile(configuration, {
      onOutput: () => {},
      onResult: (data: { success: boolean; code: number }) => {
        if (data.success) {
          api.upload(configuration, "OTA", {
            onOutput: () => {},
            onResult: (d: { success: boolean; code: number }) => {
              toast[d.success ? "success" : "error"](
                localize(
                  d.success ? "dashboard.update_device_success" : "dashboard.update_device_failed",
                  { name },
                ),
                { richColors: true },
              );
              resolve();
            },
            onError: () => {
              toast.error(localize("dashboard.update_device_failed", { name }), { richColors: true });
              resolve();
            },
          });
        } else {
          toast.error(localize("dashboard.update_device_failed", { name }), { richColors: true });
          resolve();
        }
      },
      onError: () => {
        toast.error(localize("dashboard.update_device_failed", { name }), { richColors: true });
        resolve();
      },
    });
  });
}
