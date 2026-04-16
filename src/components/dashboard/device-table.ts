import { consume } from "@lit/context";
import { mdiChevronDown, mdiChevronUp, mdiUnfoldMoreHorizontal } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import {
  TableController,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/lit-table";
import type { LocalizeFunc } from "../../common/localize.js";
import type { ConfiguredDevice } from "../../api/types.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { createDeviceColumns, type DeviceRow } from "./table-columns.js";
import type { ToggleableColumn } from "./table-column-toggle.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./table-column-toggle.js";
import "./table-pagination.js";

registerMdiIcons({
  "chevron-up": mdiChevronUp,
  "chevron-down": mdiChevronDown,
  "unfold-more-horizontal": mdiUnfoldMoreHorizontal,
});

// ─── Cached row-model factories (created once, reused forever) ───

const coreRowModel = getCoreRowModel<DeviceRow>();
const sortedRowModel = getSortedRowModel<DeviceRow>();
const filteredRowModel = getFilteredRowModel<DeviceRow>();
const paginatedRowModel = getPaginationRowModel<DeviceRow>();

@customElement("esphome-device-table")
export class ESPHomeDeviceTable extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  devices: ConfiguredDevice[] = [];

  @property({ attribute: false })
  deviceStates: Record<string, boolean> = {};

  @property({ attribute: false })
  search = "";

  @state()
  private _sorting: SortingState = [];

  @state()
  private _columnVisibility: VisibilityState = {};

  private _tableController = new TableController<DeviceRow>(this);

  /** Stable data array — only rebuilt when inputs change. */
  private _rows: DeviceRow[] = [];

  /** Columns — rebuilt when localise function changes. */
  private _columns: ColumnDef<DeviceRow>[] = [];
  private _prevLocalize: LocalizeFunc | null = null;

  // ─── Stable callbacks (no inline arrows in render) ───

  private _handleSortingChange = (updater: SortingState | ((old: SortingState) => SortingState)) => {
    this._sorting = typeof updater === "function" ? updater(this._sorting) : updater;
  };

  private _handleVisibilityChange = (updater: VisibilityState | ((old: VisibilityState) => VisibilityState)) => {
    this._columnVisibility = typeof updater === "function" ? updater(this._columnVisibility) : updater;
  };

  private _globalFilterFn = (row: any, _columnId: string, filterValue: unknown): boolean => {
    const q = (filterValue as string).trim().toLowerCase();
    if (!q) return true;
    const d: DeviceRow = row.original;
    return (
      (d.friendly_name || d.name).toLowerCase().includes(q) ||
      d.config.toLowerCase().includes(q) ||
      d.ip.toLowerCase().includes(q) ||
      d.platform.toLowerCase().includes(q)
    );
  };

  // ─── Lifecycle ───

  protected willUpdate(changed: PropertyValues) {
    if (this._localize !== this._prevLocalize) {
      this._prevLocalize = this._localize;
      this._columns = createDeviceColumns(this._localize);
    }
    if (changed.has("devices") || changed.has("deviceStates")) {
      this._rows = this.devices.map((d) => ({
        status: this.deviceStates[d.configuration] ?? false,
        name: d.name,
        friendly_name: d.friendly_name,
        ip: d.address || "",
        platform: d.target_platform || "",
        version: d.current_version || "",
        comment: d.comment || "",
        tags: d.loaded_integrations?.slice(0, 3) || [],
        config: d.configuration,
        _device: d,
      }));
    }
  }

  // ─── Styles ───

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .controls {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 0 var(--wa-space-l);
        margin-bottom: var(--wa-space-s);
      }

      /* ─── Table ─── */

      .table-wrap {
        margin: 0 var(--wa-space-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        overflow: hidden;
        background: var(--wa-color-surface-raised);
      }

      .table-scroll {
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--wa-font-size-xs);
      }

      /* ─── Header ─── */

      thead {
        background: var(--wa-color-surface-lowered);
      }

      th {
        padding: 10px 14px;
        text-align: left;
        font-weight: var(--wa-font-weight-bold);
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        white-space: nowrap;
        border-bottom: var(--wa-border-width-s) solid
          var(--wa-color-surface-border);
        user-select: none;
      }

      th.sortable {
        cursor: pointer;
        transition: color 0.12s;
      }
      th.sortable:hover {
        color: var(--esphome-primary);
      }
      th.sorted {
        color: var(--esphome-primary);
      }

      .th-content {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .sort-icon {
        font-size: 14px;
        opacity: 0.4;
        transition: opacity 0.12s;
      }
      th.sorted .sort-icon {
        opacity: 1;
      }
      th.sortable:hover .sort-icon {
        opacity: 0.7;
      }

      /* ─── Body ─── */

      tbody tr {
        border-bottom: var(--wa-border-width-s) solid
          var(--wa-color-surface-border);
        transition: background 0.1s;
        cursor: pointer;
      }
      tbody tr:last-child {
        border-bottom: none;
      }
      tbody tr:hover {
        background: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 95%
        );
      }

      td {
        padding: 11px 14px;
        color: var(--wa-color-text-normal);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 250px;
      }

      /* ─── Cell helpers (used by column defs) ─── */

      .status-dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        vertical-align: middle;
      }
      .status-dot.online {
        background: var(--esphome-success);
        box-shadow: 0 0 6px
          color-mix(in srgb, var(--esphome-success), transparent 50%);
      }
      .status-dot.offline {
        background: var(--esphome-error);
        box-shadow: 0 0 6px
          color-mix(in srgb, var(--esphome-error), transparent 60%);
      }

      .cell-name {
        font-weight: var(--wa-font-weight-bold);
      }

      .cell-mono {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
          monospace;
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
      }

      .cell-badge {
        display: inline-flex;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        background: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 88%
        );
        color: var(--esphome-primary);
        letter-spacing: 0.02em;
      }

      .cell-muted {
        color: var(--wa-color-text-quiet);
        font-style: italic;
      }

      .cell-comment {
        color: var(--wa-color-text-quiet);
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .cell-tags {
        display: inline-flex;
        gap: 4px;
      }

      .tag {
        display: inline-flex;
        padding: 1px 8px;
        border-radius: var(--wa-border-radius-m);
        font-size: 10px;
        font-weight: var(--wa-font-weight-bold);
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .cell-config {
        color: var(--wa-color-text-quiet);
      }

      .no-results {
        text-align: center;
        padding: var(--wa-space-4xl) var(--wa-space-l);
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }
    `,
  ];

  // ─── Render ───

  protected render() {
    const table = this._tableController.table({
      data: this._rows,
      columns: this._columns,
      state: {
        sorting: this._sorting,
        columnVisibility: this._columnVisibility,
        globalFilter: this.search,
      },
      onSortingChange: this._handleSortingChange as any,
      onColumnVisibilityChange: this._handleVisibilityChange as any,
      getCoreRowModel: coreRowModel,
      getSortedRowModel: sortedRowModel,
      getFilteredRowModel: filteredRowModel,
      getPaginationRowModel: paginatedRowModel,
      globalFilterFn: this._globalFilterFn,
      initialState: { pagination: { pageSize: 25 } },
    });

    const headerGroups = table.getHeaderGroups();
    const rows = table.getRowModel().rows;

    // Build column info for toggle
    const toggleCols: ToggleableColumn[] = table
      .getAllColumns()
      .filter((c) => c.getCanHide())
      .map((c) => ({
        id: c.id,
        header: c.columnDef.header as string,
        visible: c.getIsVisible(),
      }));

    // Pagination props
    const pgState = table.getState().pagination;

    return html`
      <div class="controls">
        <esphome-table-column-toggle
          .columns=${toggleCols}
          @column-visibility-change=${(e: CustomEvent<{ id: string; visible: boolean }>) => {
            table.getColumn(e.detail.id)?.toggleVisibility(e.detail.visible);
          }}
        ></esphome-table-column-toggle>
      </div>

      <div class="table-wrap">
        <div class="table-scroll">
          <table>
            <thead>
              ${headerGroups.map(
                (hg) => html`
                  <tr>
                    ${hg.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      const canSort = header.column.getCanSort();
                      return html`
                        <th
                          class="${canSort ? "sortable" : ""} ${sorted ? "sorted" : ""}"
                          style="width:${header.getSize()}px"
                          @click=${canSort ? () => header.column.toggleSorting() : nothing}
                        >
                          <span class="th-content">
                            ${header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                            ${canSort
                              ? html`<wa-icon
                                  class="sort-icon"
                                  library="mdi"
                                  name=${sorted === "asc"
                                    ? "chevron-up"
                                    : sorted === "desc"
                                      ? "chevron-down"
                                      : "unfold-more-horizontal"}
                                ></wa-icon>`
                              : nothing}
                          </span>
                        </th>
                      `;
                    })}
                  </tr>
                `,
              )}
            </thead>
            <tbody>
              ${rows.length > 0
                ? rows.map(
                    (row) => html`
                      <tr @click=${() => this._onRowClick(row.original._device)}>
                        ${row.getVisibleCells().map(
                          (cell) => html`
                            <td>
                              ${flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          `,
                        )}
                      </tr>
                    `,
                  )
                : html`
                    <tr>
                      <td colspan=${table.getVisibleLeafColumns().length} class="no-results">
                        ${this._localize("dashboard.table_no_results")}
                      </td>
                    </tr>
                  `}
            </tbody>
          </table>
        </div>

        <esphome-table-pagination
          page-index=${pgState.pageIndex}
          page-count=${table.getPageCount()}
          page-size=${pgState.pageSize}
          total-rows=${table.getFilteredRowModel().rows.length}
          ?can-previous-page=${table.getCanPreviousPage()}
          ?can-next-page=${table.getCanNextPage()}
          @page-change=${(e: CustomEvent<number>) => table.setPageIndex(e.detail)}
          @page-size-change=${(e: CustomEvent<number>) => table.setPageSize(e.detail)}
        ></esphome-table-pagination>
      </div>
    `;
  }

  private _onRowClick(device: ConfiguredDevice) {
    this.dispatchEvent(
      new CustomEvent("row-click", {
        detail: device,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-table": ESPHomeDeviceTable;
  }
}
