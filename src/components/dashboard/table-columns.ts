import { html, nothing } from "lit";
import type { ColumnDef } from "@tanstack/lit-table";
import { DeviceState } from "../../api/types.js";
import type { ConfiguredDevice } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";

export interface DeviceRow {
  status: DeviceState;
  name: string;
  friendly_name: string;
  ip: string;
  platform: string;
  version: string;
  comment: string;
  config: string;
  hasPendingChanges: boolean;
  hasUpdateAvailable: boolean;
  busy: boolean;
  _device: ConfiguredDevice;
}

const dispatchRowEvent = (e: Event, name: string, device: ConfiguredDevice) => {
  e.stopPropagation();
  (e.currentTarget as HTMLElement).dispatchEvent(
    new CustomEvent(name, { detail: device, bubbles: true, composed: true }),
  );
};

export function createDeviceColumns(localize: LocalizeFunc): ColumnDef<DeviceRow>[] {
  return [
    {
      accessorKey: "status",
      header: localize("dashboard.table_col_status"),
      cell: (info) => {
        const row = info.row.original;
        if (row.busy) {
          return html`<span
            class="cell-status-center cell-status-busy"
            role="button"
            tabindex="0"
            title=${localize("dashboard.table_action_view_progress")}
            @click=${(e: Event) => dispatchRowEvent(e, "show-progress", row._device)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                dispatchRowEvent(e, "show-progress", row._device);
              }
            }}
          ><wa-spinner class="status-spinner" style="font-size:12px;--indicator-color:var(--esphome-primary);--track-color:transparent;"></wa-spinner></span>`;
        }
        const state = info.getValue() as DeviceState;
        const dotClass = state === DeviceState.ONLINE ? "online" : state === DeviceState.OFFLINE ? "offline" : "unknown";
        const title = state === DeviceState.ONLINE
          ? localize("dashboard.table_status_online")
          : state === DeviceState.OFFLINE
            ? localize("dashboard.table_status_offline")
            : localize("dashboard.table_status_unknown");
        return html`<span class="cell-status-center"><span
          class="status-dot ${dotClass}"
          title="${title}"
        ></span></span>`;
      },
      size: 80,
      enableHiding: true,
    },
    {
      accessorKey: "name",
      header: localize("dashboard.table_col_name"),
      cell: (info) => {
        const row = info.row.original;
        return html`<span class="cell-name-wrap">
          <span class="cell-name">${row.friendly_name || row.name}</span>
          ${row.hasPendingChanges
            ? html`<span class="cell-indicator cell-indicator--modified" title=${localize("dashboard.status_modified")}></span>`
            : nothing}
          ${row.hasUpdateAvailable
            ? html`<span class="cell-indicator cell-indicator--update" title=${localize("dashboard.status_update_available")}></span>`
            : nothing}
        </span>`;
      },
      size: 200,
      enableHiding: true,
    },
    {
      accessorKey: "ip",
      header: localize("dashboard.table_col_ip"),
      cell: (info) =>
        html`<span class="cell-mono">${info.getValue() || "—"}</span>`,
      size: 140,
      enableHiding: true,
    },
    {
      accessorKey: "platform",
      header: localize("dashboard.table_col_platform"),
      cell: (info) => {
        const val = info.getValue() as string;
        return val
          ? html`<span class="cell-badge">${val}</span>`
          : html`<span class="cell-muted">—</span>`;
      },
      size: 120,
      enableHiding: true,
    },
    {
      accessorKey: "version",
      header: localize("dashboard.table_col_version"),
      cell: (info) =>
        html`<span class="cell-mono">${info.getValue() || "—"}</span>`,
      size: 150,
      enableHiding: true,
    },
    {
      accessorKey: "comment",
      header: localize("dashboard.table_col_comment"),
      cell: (info) =>
        html`<span class="cell-comment">${info.getValue() || "—"}</span>`,
      size: 180,
      enableHiding: true,
    },
    {
      accessorKey: "config",
      header: localize("dashboard.table_col_config"),
      cell: (info) =>
        html`<span class="cell-mono cell-config">${info.getValue()}</span>`,
      size: 180,
      enableHiding: true,
    },
    {
      id: "actions",
      header: localize("dashboard.table_col_actions"),
      cell: (info) => {
        const row = info.row.original;
        const device = row._device;
        const showInstall = row.hasPendingChanges;
        const showUpdate = !row.hasPendingChanges && row.hasUpdateAvailable;
        return html`<span class="cell-actions">
          <button
            class="cell-action-btn"
            aria-label=${localize("dashboard.table_action_logs")}
            title=${localize("dashboard.table_action_logs")}
            @click=${(e: Event) => dispatchRowEvent(e, "open-logs", device)}
          >
            <wa-icon library="mdi" name="console"></wa-icon>
          </button>
          ${showInstall
            ? html`<button
                class="cell-action-btn cell-action-btn--accent"
                aria-label=${localize("dashboard.table_action_install")}
                title=${localize("dashboard.table_action_install")}
                ?disabled=${row.busy}
                @click=${(e: Event) => dispatchRowEvent(e, "install-device", device)}
              >
                <wa-icon library="mdi" name="upload"></wa-icon>
              </button>`
            : nothing}
          ${showUpdate
            ? html`<button
                class="cell-action-btn cell-action-btn--accent"
                aria-label=${localize("dashboard.table_action_update")}
                title=${localize("dashboard.table_action_update")}
                ?disabled=${row.busy}
                @click=${(e: Event) => dispatchRowEvent(e, "update-device", device)}
              >
                <wa-icon library="mdi" name="upload"></wa-icon>
              </button>`
            : nothing}
        </span>`;
      },
      size: 120,
      enableSorting: false,
      enableHiding: false,
    },
  ];
}
