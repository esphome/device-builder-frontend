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
