import { html } from "lit";
import type { ColumnDef } from "@tanstack/lit-table";
import type { ConfiguredDevice } from "../../api/types.js";

export interface DeviceRow {
  status: boolean;
  name: string;
  friendly_name: string;
  ip: string;
  platform: string;
  version: string;
  comment: string;
  tags: string[];
  config: string;
  _device: ConfiguredDevice;
}

export const deviceColumns: ColumnDef<DeviceRow, any>[] = [
  {
    accessorKey: "status",
    header: "Status",
    cell: (info) => {
      const online = info.getValue() as boolean;
      return html`<span
        class="status-dot ${online ? "online" : "offline"}"
        title="${online ? "Online" : "Offline"}"
      ></span>`;
    },
    size: 80,
    enableHiding: true,
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: (info) => {
      const row = info.row.original;
      return html`<span class="cell-name"
        >${row.friendly_name || row.name}</span
      >`;
    },
    size: 200,
    enableHiding: true,
  },
  {
    accessorKey: "ip",
    header: "IP Address",
    cell: (info) =>
      html`<span class="cell-mono">${info.getValue() || "\u2014"}</span>`,
    size: 140,
    enableHiding: true,
  },
  {
    accessorKey: "platform",
    header: "Platform",
    cell: (info) => {
      const val = info.getValue() as string;
      return val
        ? html`<span class="cell-badge">${val}</span>`
        : html`<span class="cell-muted">\u2014</span>`;
    },
    size: 120,
    enableHiding: true,
  },
  {
    accessorKey: "version",
    header: "ESPHome Version",
    cell: (info) =>
      html`<span class="cell-mono">${info.getValue() || "\u2014"}</span>`,
    size: 150,
    enableHiding: true,
  },
  {
    accessorKey: "comment",
    header: "Comment",
    cell: (info) =>
      html`<span class="cell-comment">${info.getValue() || "\u2014"}</span>`,
    size: 180,
    enableHiding: true,
  },
  {
    accessorKey: "tags",
    header: "Tags",
    cell: (info) => {
      const tags = info.getValue() as string[];
      if (!tags || tags.length === 0)
        return html`<span class="cell-muted">\u2014</span>`;
      return html`<span class="cell-tags"
        >${tags.map((t) => html`<span class="tag">${t}</span>`)}</span
      >`;
    },
    size: 160,
    enableHiding: true,
  },
  {
    accessorKey: "config",
    header: "Config File",
    cell: (info) =>
      html`<span class="cell-mono cell-config">${info.getValue()}</span>`,
    size: 180,
    enableHiding: true,
  },
];
