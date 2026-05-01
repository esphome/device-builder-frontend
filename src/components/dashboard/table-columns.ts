import { html, nothing } from "lit";
import type { ColumnDef } from "@tanstack/lit-table";
import { DeviceState, JobStatus } from "../../api/types.js";
import type { ConfiguredDevice, FirmwareJob } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { buildWebUiUrl } from "../../util/web-ui-url.js";

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
  api_enabled: boolean;
  api_encrypted: boolean;
  busy: boolean;
  recentJob: FirmwareJob | null;
  _device: ConfiguredDevice;
}

const RECENT_ICON: Record<JobStatus, string | null> = {
  [JobStatus.QUEUED]: null,
  [JobStatus.RUNNING]: null,
  [JobStatus.COMPLETED]: "check-circle",
  [JobStatus.FAILED]: "close-circle",
  [JobStatus.CANCELLED]: "cancel",
};

const RECENT_CLASS: Record<JobStatus, string> = {
  [JobStatus.QUEUED]: "",
  [JobStatus.RUNNING]: "",
  [JobStatus.COMPLETED]: "status-recent--success",
  [JobStatus.FAILED]: "status-recent--failed",
  [JobStatus.CANCELLED]: "status-recent--cancelled",
};

const RECENT_LABEL_KEY: Record<JobStatus, string> = {
  [JobStatus.QUEUED]: "",
  [JobStatus.RUNNING]: "",
  [JobStatus.COMPLETED]: "firmware_jobs.status_completed",
  [JobStatus.FAILED]: "firmware_jobs.status_failed",
  [JobStatus.CANCELLED]: "firmware_jobs.status_cancelled",
};

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
            class="cell-status cell-status-busy"
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
          ><wa-spinner class="status-spinner" style="font-size:14px;--indicator-color:var(--esphome-primary);--track-color:transparent;"></wa-spinner></span>`;
        }
        if (row.recentJob) {
          const status = row.recentJob.status;
          const icon = RECENT_ICON[status];
          if (icon) {
            return html`<span
              class="cell-status status-recent ${RECENT_CLASS[status]}"
              title=${localize(RECENT_LABEL_KEY[status])}
            ><wa-icon library="mdi" name=${icon}></wa-icon></span>`;
          }
        }
        const state = info.getValue() as DeviceState;
        const dotClass = state === DeviceState.ONLINE ? "online" : state === DeviceState.OFFLINE ? "offline" : "unknown";
        const title = state === DeviceState.ONLINE
          ? localize("dashboard.table_status_online")
          : state === DeviceState.OFFLINE
            ? localize("dashboard.table_status_offline")
            : localize("dashboard.table_status_unknown");
        return html`<span class="cell-status"><span
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
        // No lock at all when the device doesn't expose the Native API.
        // "Insecure" only makes sense for a surface that's actually on.
        const encryptionIcon = row.api_encrypted ? "lock" : "lock-open-variant";
        // Icon-only indicator → use the longer descriptive tooltip;
        // there's no visible label competing for space.
        const encryptionTitle = row.api_encrypted
          ? localize("dashboard.table_status_encrypted_tooltip")
          : localize("dashboard.table_status_unencrypted_tooltip");
        const encryptionClass = row.api_encrypted ? "secure" : "insecure";
        return html`<span class="cell-name-wrap">
          <span class="cell-name">${row.friendly_name || row.name}</span>
          ${row.hasPendingChanges
            ? html`<span class="cell-indicator cell-indicator--modified" title=${localize("dashboard.status_modified")}></span>`
            : nothing}
          ${row.hasUpdateAvailable
            ? html`<span class="cell-indicator cell-indicator--update" title=${localize("dashboard.status_update_available")}></span>`
            : nothing}
          ${row.api_enabled
            ? html`<wa-icon
                class="cell-encryption ${encryptionClass}"
                library="mdi"
                name=${encryptionIcon}
                title=${encryptionTitle}
              ></wa-icon>`
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
        const visitUrl = buildWebUiUrl(device);
        const showVisit = visitUrl !== "";
        // Priority order (highest → lowest, last to drop on narrow
        // viewports): edit > install/update > logs > visit web. Each
        // button carries a per-action class (cell-action-btn--edit,
        // --install, --logs, --visit-web) so the media queries in
        // table-cell-styles can hide them progressively as room runs
        // out; the row-end kebab keeps every action reachable.
        return html`<span class="cell-actions">
          <button
            class="cell-action-btn cell-action-btn--edit"
            aria-label=${localize("dashboard.table_action_edit")}
            title=${localize("dashboard.table_action_edit")}
            @click=${(e: Event) => dispatchRowEvent(e, "edit-device", device)}
          >
            <wa-icon library="mdi" name="pencil"></wa-icon>
          </button>
          ${showInstall
            ? html`<button
                class="cell-action-btn cell-action-btn--accent cell-action-btn--install"
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
                class="cell-action-btn cell-action-btn--accent cell-action-btn--install"
                aria-label=${localize("dashboard.table_action_update")}
                title=${localize("dashboard.table_action_update")}
                ?disabled=${row.busy}
                @click=${(e: Event) => dispatchRowEvent(e, "update-device", device)}
              >
                <wa-icon library="mdi" name="upload"></wa-icon>
              </button>`
            : nothing}
          <button
            class="cell-action-btn cell-action-btn--logs"
            aria-label=${localize("dashboard.table_action_logs")}
            title=${localize("dashboard.table_action_logs")}
            @click=${(e: Event) => dispatchRowEvent(e, "open-logs", device)}
          >
            <wa-icon library="mdi" name="console"></wa-icon>
          </button>
          ${showVisit
            ? html`<a
                class="cell-action-btn cell-action-btn--visit-web"
                href=${visitUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label=${localize("dashboard.action_visit_web_ui")}
                title=${localize("dashboard.action_visit_web_ui")}
                @click=${(e: Event) => e.stopPropagation()}
              >
                <wa-icon library="mdi" name="open-in-new"></wa-icon>
              </a>`
            : nothing}
        </span>`;
      },
      size: 160,
      enableSorting: false,
      enableHiding: false,
    },
  ];
}
