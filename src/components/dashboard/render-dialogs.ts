import { html, type TemplateResult } from "lit";
import type { ConfiguredDevice, Label } from "../../api/types/devices.js";
import { DeviceState } from "../../api/types/devices.js";
import type { ArchivedDevice } from "../../api/types/system.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { computeLabelUsage } from "../../util/label-usage.js";
import { performRename } from "./actions-ui.js";
import { archiveBulkDevices, deleteBulkDevices, deleteDevice } from "./actions.js";

export type PendingConfirm =
  | { kind: "delete-single"; device: ConfiguredDevice }
  | { kind: "delete-archived"; device: ArchivedDevice }
  | { kind: "delete-bulk" }
  | { kind: "archive-single"; device: ConfiguredDevice }
  | { kind: "archive-bulk" }
  | { kind: "rename-config-only"; device: ConfiguredDevice; newName: string }
  | { kind: "delete-label"; label: Label };

interface ConfirmCopy {
  heading: string;
  message: string;
  confirm: string;
  destructive: boolean;
}

export function confirmDialogCopy(
  pending: PendingConfirm | null,
  localize: LocalizeFunc,
  selectedDevicesSize: number,
  labelUsage: () => Record<string, number>
): ConfirmCopy {
  const t = localize;
  if (!pending) {
    return {
      heading: t("dashboard.delete_selected_title"),
      message: t("dashboard.delete_selected_desc", { count: selectedDevicesSize }),
      confirm: t("dashboard.delete_selected_confirm"),
      destructive: true,
    };
  }
  switch (pending.kind) {
    case "delete-bulk":
      return {
        heading: t("dashboard.delete_selected_title"),
        message: t("dashboard.delete_selected_desc", { count: selectedDevicesSize }),
        confirm: t("dashboard.delete_selected_confirm"),
        destructive: true,
      };
    case "delete-single": {
      const name = pending.device.friendly_name || pending.device.name;
      return {
        heading: t("dashboard.delete_single_title"),
        message: t("dashboard.delete_single_desc", { name }),
        confirm: t("dashboard.delete_selected_confirm"),
        destructive: true,
      };
    }
    case "delete-archived": {
      const name =
        pending.device.friendly_name ||
        pending.device.name ||
        pending.device.configuration;
      return {
        heading: t("dashboard.delete_archived_title"),
        message: t("dashboard.delete_archived_desc", { name }),
        confirm: t("dashboard.action_delete_permanently"),
        destructive: true,
      };
    }
    case "archive-bulk":
      return {
        heading: t("dashboard.archive_selected_title"),
        message: t("dashboard.archive_selected_desc", { count: selectedDevicesSize }),
        confirm: t("dashboard.archive_selected_confirm"),
        destructive: false,
      };
    case "archive-single": {
      const name = pending.device.friendly_name || pending.device.name;
      return {
        heading: t("dashboard.archive_title"),
        message: t("dashboard.archive_desc", { name }),
        confirm: t("dashboard.archive_confirm"),
        destructive: false,
      };
    }
    case "rename-config-only": {
      const name = pending.device.friendly_name || pending.device.name;
      return {
        heading: t("dashboard.action_rename_offline_title"),
        message: t("dashboard.action_rename_offline_desc", { name }),
        confirm: t("dashboard.action_rename_offline_confirm"),
        // Mark destructive so a stray Enter can't confirm an offline rename
        // (renames the file + drops into divergence until reflash).
        destructive: true,
      };
    }
    case "delete-label": {
      const usage = labelUsage()[pending.label.id] ?? 0;
      return {
        heading: t("dashboard.labels_delete_title"),
        message: t("dashboard.labels_delete_confirm", {
          name: pending.label.name,
          count: usage,
        }),
        confirm: t("dashboard.labels_delete_submit"),
        destructive: true,
      };
    }
  }
}

export function computeLabelUsageCached(
  source: ConfiguredDevice[],
  cache: { source: ConfiguredDevice[]; map: Record<string, number> } | null
): {
  map: Record<string, number>;
  cache: { source: ConfiguredDevice[]; map: Record<string, number> };
} {
  if (cache?.source === source) return { map: cache.map, cache };
  const map = computeLabelUsage(source);
  return { map, cache: { source, map } };
}

export function executeConfirm(
  host: ESPHomePageDashboard,
  pending: PendingConfirm
): void {
  switch (pending.kind) {
    case "delete-bulk": {
      const selected = [...host._selectedDevices];
      host._selectMode = false;
      host._selectedDevices = new Set();
      deleteBulkDevices(selected, host._devices, host._api, host._localize);
      return;
    }
    case "archive-bulk": {
      const selected = [...host._selectedDevices];
      host._selectMode = false;
      host._selectedDevices = new Set();
      archiveBulkDevices(selected, host._devices, host._api, host._localize);
      return;
    }
    case "delete-single":
      void deleteDevice(pending.device, host._api, host._localize);
      return;
    case "delete-archived":
      void host._deleteArchivedDevice(pending.device);
      return;
    case "archive-single":
      void host._archiveDevice(pending.device);
      return;
    case "rename-config-only":
      void performRename(host, pending.device, pending.newName, true);
      return;
    case "delete-label":
      void host._deleteLabel(pending.label);
      return;
  }
}

export function renderDialogs(host: ESPHomePageDashboard): TemplateResult {
  const { heading, message, confirm, destructive } = confirmDialogCopy(
    host._pendingConfirm,
    host._localize,
    host._selectedDevices.size,
    () => host._computeLabelUsage()
  );
  return html`
    <esphome-confirm-dialog
      heading=${heading}
      message=${message}
      confirm-label=${confirm}
      ?destructive=${destructive}
      @confirm=${host._executeConfirm}
      @cancel=${() => (host._pendingConfirm = null)}
    ></esphome-confirm-dialog>
    <esphome-clone-device-dialog
      @clone-confirm=${host._executeClone}
    ></esphome-clone-device-dialog>
    <esphome-friendly-name-dialog
      @friendly-name-confirm=${host._executeFriendlyName}
    ></esphome-friendly-name-dialog>
    <esphome-rename-device-dialog
      @rename-confirm=${host._executeRename}
    ></esphome-rename-device-dialog>
    <esphome-bulk-labels-dialog></esphome-bulk-labels-dialog>
    <esphome-label-dialog
      ?open=${host._labelDialogOpen}
      .editing=${host._labelDialogEditing}
      @label-created=${(e: CustomEvent<Label>) => {
        // Auto-select: whoever just created a label intends to filter by it.
        if (!host._selectedLabels.includes(e.detail.id)) {
          host._selectedLabels = [...host._selectedLabels, e.detail.id];
        }
        host._labelDialogOpen = false;
      }}
      @label-saved=${() => {
        // LABEL_UPDATED push refreshes the catalog; just close.
        host._labelDialogOpen = false;
      }}
      @request-close=${() => {
        host._labelDialogOpen = false;
      }}
      @after-hide=${() => {
        host._labelDialogOpen = false;
        host._labelDialogEditing = null;
      }}
    ></esphome-label-dialog>
    <esphome-adopt-dialog @adopted=${host._onAdopted}></esphome-adopt-dialog>
    <esphome-api-key-dialog></esphome-api-key-dialog>
    <esphome-create-config-dialog></esphome-create-config-dialog>
    <esphome-command-dialog
      @request-show-logs-after-install=${host._onPostInstallShowLogs}
      @request-open-editor=${host._onRequestOpenEditor}
    ></esphome-command-dialog>
    <esphome-firmware-install-dialog
      @request-show-logs-after-install=${host._onPostInstallShowLogs}
      @clean-build=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openCommand(e.detail, "clean")}
      @request-open-editor=${host._onRequestOpenEditor}
    ></esphome-firmware-install-dialog>
    <esphome-logs-dialog></esphome-logs-dialog>
    <esphome-install-method-dialog
      ?open=${host._installMethodOpen}
      .deviceState=${host._installMethodDevice?.state ?? DeviceState.UNKNOWN}
      .deviceTargetPlatform=${host._installMethodDevice?.target_platform ?? ""}
      .deviceCurrentAddress=${
        host._installMethodDevice?.ip || host._installMethodDevice?.address || ""
      }
      .mode=${host._installMethodMode}
      @close=${() => {
        host._installMethodOpen = false;
      }}
      @select-method=${host._onInstallMethodSelect}
    ></esphome-install-method-dialog>
    <esphome-archived-devices-dialog
      @unarchive=${(e: CustomEvent<ArchivedDevice>) => host._unarchiveDevice(e.detail)}
      @delete-archived=${(e: CustomEvent<ArchivedDevice>) =>
        host._confirmDeleteArchived(e.detail)}
    ></esphome-archived-devices-dialog>
  `;
}
