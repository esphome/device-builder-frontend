import type { ESPHomeAPI } from "../../api/index.js";
import type {
  AdoptableDevice,
  ConfiguredDevice,
  Label,
  RenameDeviceResponse,
} from "../../api/types/devices.js";
import { DeviceState } from "../../api/types/devices.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { getErrorMessage } from "../../util/error-message.js";
import { firmwareJobDisplayName } from "../../util/firmware-job-display.js";
import { clearJustCreated } from "../../util/just-created.js";
import { launchLogsWithMethod } from "../../util/logs-launch.js";
import { notifyError, notifySuccess } from "../../util/notify.js";
import { otaNeedsUsb } from "../../util/ota-signed.js";
import type { RenameConfirmDetail } from "../rename-device-dialog.js";

export async function executeClone(
  host: ESPHomePageDashboard,
  e: CustomEvent<{ newName: string; newFriendlyName: string }>
): Promise<void> {
  const device = host._actionDevice;
  if (!device) return;
  const { newName, newFriendlyName } = e.detail;
  let result: Awaited<ReturnType<ESPHomeAPI["cloneDevice"]>>;
  try {
    const friendly = newFriendlyName.length > 0 ? newFriendlyName : undefined;
    result = await host._api.cloneDevice(device.configuration, newName, friendly);
  } catch (err) {
    const reason = getErrorMessage(err);
    notifyError(
      host._localize("dashboard.action_clone_failed", {
        name: device.name,
        reason,
      })
    );
    return;
  }
  notifySuccess(host._localize("dashboard.action_clone_success", { name: newName }));
  host._onCloned(result.configuration);
}

export async function executeRename(
  host: ESPHomePageDashboard,
  e: CustomEvent<RenameConfirmDetail>
): Promise<void> {
  const device = host._actionDevice;
  if (!device) return;
  const { newName, newFriendlyName, install } = e.detail;
  if (newName === undefined) {
    if (newFriendlyName !== undefined) {
      await editFriendlyName(host, device, newFriendlyName, install);
    }
    return;
  }
  const request: RenameRequest = {
    configuration: device.configuration,
    currentName: device.name,
    newName,
    newFriendlyName,
  };
  // The default rename compiles + OTA-installs, which only works against a
  // reachable device. Route offline/unknown devices to a confirm before a
  // config-only rename (renames the YAML now; the device keeps its old name
  // until reflashed, which the prompt spells out). A device that rejects
  // unsigned OTA images takes the same route.
  if (
    install &&
    (device.runtime_state.state !== DeviceState.ONLINE || otaNeedsUsb(device))
  ) {
    host._openConfirm({ kind: "rename-config-only", device, request });
    return;
  }
  await performRename(host, { ...request, configOnly: !install });
}

/** Friendly-name-only edit: rewrite the YAML, then offer the install picker. */
async function editFriendlyName(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice,
  newFriendlyName: string,
  install: boolean
): Promise<void> {
  let result: Awaited<ReturnType<ESPHomeAPI["editFriendlyName"]>>;
  try {
    result = await host._api.editFriendlyName(device.configuration, newFriendlyName);
  } catch (err) {
    const reason = getErrorMessage(err);
    notifyError(
      host._localize("dashboard.action_rename_failed", { name: device.name, reason })
    );
    return;
  }
  if (!result.rewritten) {
    notifySuccess(host._localize("dashboard.action_friendly_name_unchanged"));
    return;
  }
  notifySuccess(
    host._localize("dashboard.action_friendly_name_success", {
      name: newFriendlyName,
    })
  );
  if (install) host._openInstallMethod(device);
}

/** Payload of the adopt dialog's ``adopted`` event — the one shape the
 *  dialog fires, ``_onAdopted`` annotates, and this module consumes. */
export interface AdoptedDetail {
  name: string;
  configuration: string;
  friendlyName: string;
  renameTo: string | null;
}

/** Post-adopt follow-up: highlight the fresh card, then start the rename for an edited name. */
export async function adoptFollowUp(
  host: ESPHomePageDashboard,
  detail: AdoptedDetail
): Promise<void> {
  // ``configuration`` is the backend-reported YAML the import landed
  // under (the factory broadcast name); the rename flow re-keys the
  // card when the OTA tail succeeds, and a failed rename leaves the
  // device adopted under the factory name. Always the OTA path —
  // ``executeRename``'s offline config-only route is deliberately
  // excluded here: a config-only rewrite would strand a hostname the
  // running factory firmware never broadcasts.
  host._highlightFreshDevice(detail.configuration);
  if (detail.renameTo) {
    await performRename(host, {
      configuration: detail.configuration,
      currentName: detail.name,
      newName: detail.renameTo,
    });
  }
}

/** One ``devices/rename`` call; ``currentName`` only labels the failure toast. */
export interface RenameRequest {
  configuration: string;
  currentName: string;
  newName: string;
  newFriendlyName?: string;
  configOnly?: boolean;
}

/** Call ``devices/rename`` and surface the result (job-follow, success, or error). */
export async function performRename(
  host: ESPHomePageDashboard,
  { configuration, currentName, newName, newFriendlyName, configOnly }: RenameRequest
): Promise<void> {
  let response: RenameDeviceResponse;
  try {
    response = await host._api.renameDevice(configuration, newName, {
      configOnly,
      newFriendlyName,
    });
  } catch (err) {
    const reason = getErrorMessage(err);
    notifyError(
      host._localize("dashboard.action_rename_failed", {
        name: currentName,
        reason,
      })
    );
    return;
  }
  clearJustCreated();
  if (response.job) {
    // The chain head is a COMPILE of the new YAML; the tail carries the
    // "old → new" naming. Older backends return the fused RENAME, no tail.
    host._commandDialog.followJob(
      response.job,
      firmwareJobDisplayName(
        response.tail_job ?? response.job,
        host._devices,
        host._localize
      ),
      "rename"
    );
    return;
  }
  notifySuccess(
    newFriendlyName === undefined
      ? host._localize("dashboard.action_rename_success", { name: newName })
      : host._localize("dashboard.action_rename_both_success", {
          name: newName,
          friendly: newFriendlyName,
        })
  );
}

export async function toggleIgnore(
  host: ESPHomePageDashboard,
  device: AdoptableDevice
): Promise<void> {
  try {
    await host._api.ignoreDevice(device.name, !device.ignored);
  } catch {
    const name = device.friendly_name || device.name;
    notifyError(
      host._localize(
        device.ignored
          ? "dashboard.action_unignore_failed"
          : "dashboard.action_ignore_failed",
        { name }
      )
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
    notifyError(host._localize("dashboard.labels_delete_failed"));
  }
}

export function openLogsWithMethod(
  host: ESPHomePageDashboard,
  device: ConfiguredDevice,
  method: string,
  port?: string
): Promise<void> {
  return launchLogsWithMethod(
    { api: host._api, logsDialog: host._logsDialog, localize: host._localize },
    device,
    method,
    port
  );
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
