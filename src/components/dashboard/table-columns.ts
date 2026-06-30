import type { ColumnDef } from "@tanstack/lit-table";
import { html, nothing } from "lit";
import type { ConfiguredDevice, Label } from "../../api/types/devices.js";
import { DeviceState } from "../../api/types/devices.js";
import type { FirmwareJob } from "../../api/types/firmware-jobs.js";
import { JobStatus } from "../../api/types/firmware-jobs.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { DEVICE_SORT_COLLATOR, deviceSortKey } from "../../util/device-sort.js";
import { getCompactEncryptionVisual } from "../../util/encryption-state.js";
import { formatFileSize } from "../../util/format-file-size.js";
import { renderLabelChips } from "../../util/label-chip-template.js";
import { updateButtonTitle } from "../../util/update-tooltip.js";
import { renderVisitWebUiLink } from "../../util/visit-web-ui-link.js";
import { buildWebUiUrl } from "../../util/web-ui-url.js";

export interface DeviceRow {
  status: DeviceState;
  name: string;
  friendly_name: string;
  address: string;
  ip: string;
  ip_addresses: string[];
  mac_address: string;
  platform: string;
  version: string;
  comment: string;
  area: string;
  /** Resolved label objects (catalog joined against
   *  ``device.labels``) so the cell renderer doesn't need access to
   *  the catalog itself. ``device-table`` performs the resolve when
   *  building rows. */
  labels: Label[];
  config: string;
  build_size_bytes: number;
  // Raw has_pending_changes (device truth) — drives the encryption lock only.
  hasPendingChanges: boolean;
  // mDNS-gated display flags (see util/device-sync.ts): modified dot + install
  // button, update column + update button.
  showModified: boolean;
  showUpdate: boolean;
  api_enabled: boolean;
  api_encrypted: boolean;
  api_encryption_active: string | null;
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
    new CustomEvent(name, { detail: device, bubbles: true, composed: true })
  );
};

// One "no data" placeholder for every column. Rendered in the muted
// proportional style rather than a column's value font so the em dash is
// the same width everywhere — embedding it in cell-mono made it render as
// a narrow monospace glyph that read as a hyphen next to the wide dashes
// in the proportional columns (#1038).
const EMPTY_CELL = html`<span class="cell-muted">—</span>`;

// Populated cells keep their column's value font; empty cells fall back to
// the shared placeholder so the "no data" dash is identical everywhere.
const valueCell = (cls: string, val: string) =>
  val ? html`<span class=${cls}>${val}</span>` : EMPTY_CELL;

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
            ><wa-spinner
              class="status-spinner"
              style="font-size:14px;--indicator-color:var(--esphome-primary);--track-color:transparent;"
            ></wa-spinner
          ></span>`;
        }
        if (row.recentJob) {
          const status = row.recentJob.status;
          const icon = RECENT_ICON[status];
          if (icon) {
            return html`<span
              class="cell-status status-recent ${RECENT_CLASS[status]}"
              title=${localize(RECENT_LABEL_KEY[status])}
              ><wa-icon library="mdi" name=${icon}></wa-icon
            ></span>`;
          }
        }
        const state = info.getValue() as DeviceState;
        const dotClass =
          state === DeviceState.ONLINE
            ? "online"
            : state === DeviceState.OFFLINE
              ? "offline"
              : "unknown";
        const title =
          state === DeviceState.ONLINE
            ? localize("dashboard.table_status_online")
            : state === DeviceState.OFFLINE
              ? localize("dashboard.table_status_offline")
              : localize("dashboard.table_status_unknown");
        return html`<span class="cell-status"
          ><span class="status-dot ${dotClass}" title="${title}"></span
        ></span>`;
      },
      size: 80,
      enableHiding: true,
    },
    {
      accessorKey: "name",
      header: localize("dashboard.table_col_name"),
      cell: (info) => {
        const row = info.row.original;
        // Compact view: no lock for encrypted devices, only the
        // attention states (plaintext / pending / mismatch) get an icon.
        const encVisual = getCompactEncryptionVisual({
          api_enabled: row.api_enabled,
          api_encrypted: row.api_encrypted,
          api_encryption_active: row.api_encryption_active,
          // Raw flag, not the mDNS-gated ``showModified``: the encryption
          // "pending" state is about a local YAML edit not yet flashed, so it
          // must match the drawer's raw-flag badge (mDNS freshness is irrelevant).
          has_pending_changes: row.hasPendingChanges,
        });
        return html`<span class="cell-name-wrap">
          <span class="cell-name">${row.friendly_name || row.name}</span>
          ${row.showModified
            ? html`<span
                class="cell-indicator cell-indicator--modified"
                title=${localize("dashboard.status_modified")}
              ></span>`
            : nothing}
          ${row.showUpdate
            ? html`<span
                class="cell-indicator cell-indicator--update"
                title=${localize("dashboard.status_update_available")}
              ></span>`
            : nothing}
          ${encVisual
            ? html`<wa-icon
                class="cell-encryption ${encVisual.cssClass}"
                library="mdi"
                name=${encVisual.iconName}
                title=${localize(encVisual.tooltipKey)}
              ></wa-icon>`
            : nothing}
        </span>`;
      },
      sortingFn: (rowA, rowB) =>
        DEVICE_SORT_COLLATOR.compare(
          deviceSortKey(rowA.original),
          deviceSortKey(rowB.original)
        ),
      size: 200,
      enableHiding: true,
    },
    {
      accessorKey: "address",
      header: localize("dashboard.table_col_hostname"),
      cell: (info) => valueCell("cell-mono", info.getValue() as string),
      size: 180,
      enableHiding: true,
    },
    {
      accessorKey: "ip",
      header: localize("dashboard.table_col_ip"),
      cell: (info) => valueCell("cell-mono", info.getValue() as string),
      size: 140,
      enableHiding: true,
    },
    {
      accessorKey: "mac_address",
      header: localize("dashboard.table_col_mac"),
      cell: (info) => valueCell("cell-mono", info.getValue() as string),
      size: 160,
      enableHiding: true,
    },
    {
      accessorKey: "platform",
      header: localize("dashboard.table_col_platform"),
      cell: (info) => valueCell("cell-badge", info.getValue() as string),
      size: 120,
      enableHiding: true,
    },
    {
      accessorKey: "version",
      header: localize("dashboard.table_col_version"),
      cell: (info) => valueCell("cell-mono", info.getValue() as string),
      size: 150,
      enableHiding: true,
    },
    {
      accessorKey: "comment",
      header: localize("dashboard.table_col_comment"),
      cell: (info) => valueCell("cell-comment", info.getValue() as string),
      size: 180,
      enableHiding: true,
    },
    {
      accessorKey: "area",
      header: localize("dashboard.table_col_area"),
      cell: (info) => valueCell("cell-comment", info.getValue() as string),
      size: 160,
      enableHiding: true,
    },
    {
      accessorKey: "labels",
      header: localize("dashboard.table_col_labels"),
      cell: (info) => {
        const labels = info.getValue() as Label[];
        if (!labels || labels.length === 0) return EMPTY_CELL;
        return renderLabelChips(labels, { max: 3 });
      },
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.labels.map((l) => l.name).join(",");
        const b = rowB.original.labels.map((l) => l.name).join(",");
        return a.localeCompare(b);
      },
      size: 200,
      enableHiding: true,
    },
    {
      accessorKey: "config",
      header: localize("dashboard.table_col_config"),
      cell: (info) => html`<span class="cell-mono cell-config">${info.getValue()}</span>`,
      size: 180,
      enableHiding: true,
    },
    {
      accessorKey: "build_size_bytes",
      header: localize("dashboard.table_col_build_size"),
      cell: (info) => {
        const bytes = info.getValue() as number;
        return bytes
          ? html`<span class="cell-mono">${formatFileSize(bytes)}</span>`
          : EMPTY_CELL;
      },
      // Compare the raw byte counts directly. ``"basic"`` /
      // ``"alphanumeric"`` would sort by the accessor value too
      // in theory, but stringifying-then-comparing has bitten us
      // here — a 1024-byte file lands above a 2048-byte one on
      // lex compare ("1" < "2" inside "1024" vs "2048" works,
      // but "16777216" vs "2097152" puts the smaller value
      // above the larger one). Explicit ``a - b`` is the
      // canonical numeric sort and removes the ambiguity.
      sortingFn: (rowA, rowB) =>
        rowA.original.build_size_bytes - rowB.original.build_size_bytes,
      size: 120,
      enableHiding: true,
    },
    {
      id: "actions",
      header: localize("dashboard.table_col_actions"),
      cell: (info) => {
        const row = info.row.original;
        const device = row._device;
        /* Update wins over install when both flags are set: an
           available newer ESPHome version is the more pressing nudge,
           and OTA-update will pick up any pending YAML changes as a
           free side-effect. Mirrors the legacy dashboard. */
        const showUpdate = row.showUpdate;
        const showInstall = !showUpdate && row.showModified;
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
            class="cell-action-btn cell-action-btn--accent cell-action-btn--edit"
            aria-label=${localize("dashboard.table_action_edit")}
            title=${localize("dashboard.table_action_edit")}
            ?disabled=${row.busy}
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
                title=${updateButtonTitle(
                  localize,
                  device.deployed_version,
                  device.current_version,
                  "dashboard.table_action_update"
                )}
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
            <wa-icon library="mdi" name="text-box-outline"></wa-icon>
          </button>
          ${showVisit
            ? renderVisitWebUiLink(visitUrl, localize, {
                className: "cell-action-btn cell-action-btn--visit-web",
                onClick: (e) => e.stopPropagation(),
              })
            : nothing}
        </span>`;
      },
      size: 160,
      enableSorting: false,
      enableHiding: false,
    },
  ];
}
