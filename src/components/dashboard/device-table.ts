import { consume } from "@lit/context";
import {
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiChevronDown,
  mdiChevronUp,
  mdiDotsVertical,
  mdiUnfoldMoreHorizontal,
} from "@mdi/js";
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
import type { PropertyValues } from "lit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ConfiguredDevice } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { tableCellStyles } from "./table-cell-styles.js";
import type { ToggleableColumn } from "./table-column-toggle.js";
import { createDeviceColumns, type DeviceRow } from "./table-columns.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./table-column-toggle.js";
import "./table-pagination.js";
import "./table-row-menu.js";

registerMdiIcons({
  "checkbox-blank-outline": mdiCheckboxBlankOutline,
  "checkbox-marked": mdiCheckboxMarked,
  "chevron-up": mdiChevronUp,
  "chevron-down": mdiChevronDown,
  "dots-vertical": mdiDotsVertical,
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

  @property({ type: Boolean, attribute: "select-mode" })
  selectMode = false;

  @property({ attribute: false })
  selectedDevices = new Set<string>();

  @state()
  private _sorting: SortingState = [];

  @state()
  private _columnVisibility: VisibilityState = {};

  @state()
  private _contextMenuDevice: ConfiguredDevice | null = null;

  @state()
  private _contextMenuPos: { x: number; y: number } | null = null;

  @state()
  private _contextMenuAnchorRight = false;

  @query(".table-scroll")
  private _scrollContainer!: HTMLDivElement;

  private _tableController = new TableController<DeviceRow>(this);

  /** Stable data array — only rebuilt when inputs change. */
  private _rows: DeviceRow[] = [];

  /** Columns — rebuilt when localise function changes. */
  private _columns: ColumnDef<DeviceRow>[] = [];
  private _prevLocalize: LocalizeFunc | null = null;

  // ─── Stable callbacks (no inline arrows in render) ───

  private _handleSortingChange = (
    updater: SortingState | ((old: SortingState) => SortingState)
  ) => {
    this._sorting = typeof updater === "function" ? updater(this._sorting) : updater;
  };

  private _handleVisibilityChange = (
    updater: VisibilityState | ((old: VisibilityState) => VisibilityState)
  ) => {
    this._columnVisibility =
      typeof updater === "function" ? updater(this._columnVisibility) : updater;
  };

  private _globalFilterFn = (
    row: any,
    _columnId: string,
    filterValue: unknown
  ): boolean => {
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
    tableCellStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .controls {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-l) var(--wa-space-l) 0;
        margin-bottom: var(--wa-space-l);
        flex-shrink: 0;
      }

      .controls ::slotted([slot="toolbar"]) {
        flex: 1;
        min-width: 0;
      }

      .controls-right {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        flex-shrink: 0;
      }

      /* ─── Table ─── */

      .table-wrap {
        margin: 0 var(--wa-space-l) var(--wa-space-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        overflow: hidden;
        background: var(--wa-color-surface-raised);
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .table-scroll {
        overflow: auto;
        flex: 1;
        min-height: 0;
        /* Horizontal scroll shadows — appear only when content overflows */
        background:
          linear-gradient(to right, var(--wa-color-surface-raised) 30%, transparent) left
            center,
          linear-gradient(to left, var(--wa-color-surface-raised) 30%, transparent) right
            center,
          radial-gradient(farthest-side at 0 50%, rgba(0, 0, 0, 0.12), transparent) left
            center,
          radial-gradient(farthest-side at 100% 50%, rgba(0, 0, 0, 0.12), transparent)
            right center;
        background-repeat: no-repeat;
        background-size:
          40px 100%,
          40px 100%,
          14px 100%,
          14px 100%;
        background-attachment: local, local, scroll, scroll;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--wa-font-size-xs);
      }

      /* ─── Header ─── */

      thead {
        position: sticky;
        top: 0;
        z-index: 1;
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
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
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
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        transition: background 0.1s;
        cursor: pointer;
      }
      tbody tr:last-child {
        border-bottom: none;
      }
      tbody tr:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 95%);
      }
      tbody tr:focus-visible {
        outline: 2px solid var(--esphome-primary);
        outline-offset: -2px;
      }

      td {
        padding: 11px 14px;
        color: var(--wa-color-text-normal);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 250px;
      }

      /* ─── Select / Checkbox ─── */

      .select-col {
        width: 40px;
        min-width: 40px;
        max-width: 40px;
        padding: 0;
        text-align: center;
        vertical-align: middle;
        overflow: visible;
      }

      .row-checkbox {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        cursor: pointer;
        color: var(--wa-color-text-quiet);
        transition: color 0.12s;
      }

      .row-checkbox:hover {
        color: var(--esphome-primary);
      }

      .row-checkbox wa-icon {
        font-size: 20px;
      }

      tbody tr.selected {
        background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
      }

      tbody tr.selected .row-checkbox {
        color: var(--esphome-primary);
      }

      thead .row-checkbox {
        color: var(--wa-color-text-quiet);
      }

      /* ─── Actions column ─── */

      .actions-col {
        width: 40px;
        min-width: 40px;
        max-width: 40px;
        padding: 0;
        text-align: center;
        vertical-align: middle;
        overflow: visible;
      }

      .actions-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border: none;
        border-radius: var(--wa-border-radius-m);
        background: transparent;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        padding: 0;
        transition: background 0.12s, color 0.12s;
      }

      .actions-btn:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
      }

      .actions-btn wa-icon {
        font-size: 18px;
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
        <slot name="toolbar"></slot>
        <div class="controls-right">
          <esphome-table-column-toggle
            .columns=${toggleCols}
            @column-visibility-change=${(
              e: CustomEvent<{ id: string; visible: boolean }>
            ) => {
              table.getColumn(e.detail.id)?.toggleVisibility(e.detail.visible);
            }}
          ></esphome-table-column-toggle>
          <slot name="actions"></slot>
        </div>
      </div>

      <div class="table-wrap">
        <div class="table-scroll">
          <table role="grid">
            <thead>
              ${headerGroups.map(
                (hg) => html`
                  <tr role="row">
                    ${this.selectMode
                      ? html`<th class="select-col" style="width:40px">
                          <span class="row-checkbox" @click=${this._onToggleAll}>
                            <wa-icon
                              library="mdi"
                              name=${this._allSelected
                                ? "checkbox-marked"
                                : "checkbox-blank-outline"}
                            ></wa-icon>
                          </span>
                        </th>`
                      : nothing}
                    ${hg.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      const canSort = header.column.getCanSort();
                      return html`
                        <th
                          role="columnheader"
                          aria-sort=${sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"}
                          class="${canSort ? "sortable" : ""} ${sorted ? "sorted" : ""}"
                          style="width:${header.getSize()}px"
                          @click=${canSort
                            ? () => header.column.toggleSorting()
                            : nothing}
                        >
                          <span class="th-content">
                            ${header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
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
                    <th class="actions-col"></th>
                  </tr>
                `
              )}
            </thead>
            <tbody>
              ${rows.length > 0
                ? rows.map(
                    (row) => html`
                      <tr
                        role="row"
                        tabindex="0"
                        class="${this.selectMode &&
                        this.selectedDevices.has(row.original.config)
                          ? "selected"
                          : ""}"
                        @click=${() =>
                          this.selectMode
                            ? this._onToggleSelect(row.original.config)
                            : this._onRowClick(row.original._device)}
                        @contextmenu=${(e: MouseEvent) =>
                          this._onRowContextMenu(e, row.original._device)}
                        @keydown=${(e: KeyboardEvent) =>
                          this._onRowKeydown(e, row.original._device)}
                      >
                        ${this.selectMode
                          ? html`<td role="gridcell" class="select-col">
                              <span class="row-checkbox">
                                <wa-icon
                                  library="mdi"
                                  name=${this.selectedDevices.has(row.original.config)
                                    ? "checkbox-marked"
                                    : "checkbox-blank-outline"}
                                ></wa-icon>
                              </span>
                            </td>`
                          : nothing}
                        ${row
                          .getVisibleCells()
                          .map(
                            (cell) => html`
                              <td role="gridcell">
                                ${flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext()
                                )}
                              </td>
                            `
                          )}
                        <td role="gridcell" class="actions-col">
                          <button
                            class="actions-btn"
                            @click=${(e: MouseEvent) => { e.stopPropagation(); this._openActionsMenu(e, row.original._device); }}
                          >
                            <wa-icon library="mdi" name="dots-vertical"></wa-icon>
                          </button>
                        </td>
                      </tr>
                    `
                  )
                : html`
                    <tr>
                      <td
                        colspan=${table.getVisibleLeafColumns().length +
                        (this.selectMode ? 1 : 0) + 1}
                        class="no-results"
                      >
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
          @page-change=${(e: CustomEvent<number>) => {
            table.setPageIndex(e.detail);
            this._scrollToTop();
          }}
          @page-size-change=${(e: CustomEvent<number>) => {
            table.setPageSize(e.detail);
            this._scrollToTop();
          }}
        ></esphome-table-pagination>
      </div>

      <esphome-table-row-menu
        .device=${this._contextMenuDevice}
        .position=${this._contextMenuPos}
        ?anchor-right=${this._contextMenuAnchorRight}
        @menu-close=${this._closeContextMenu}
        @edit-device=${(e: CustomEvent) => this._forwardEvent("edit-device", e.detail)}
        @update-device=${(e: CustomEvent) =>
          this._forwardEvent("update-device", e.detail)}
        @open-logs=${(e: CustomEvent) => this._forwardEvent("open-logs", e.detail)}
        @delete-device=${(e: CustomEvent) =>
          this._forwardEvent("delete-device", e.detail)}
        @enter-select=${(e: CustomEvent<ConfiguredDevice>) => this._enterSelectMode(e.detail)}
      ></esphome-table-row-menu>
    `;
  }

  private get _allSelected(): boolean {
    return (
      this._rows.length > 0 && this._rows.every((r) => this.selectedDevices.has(r.config))
    );
  }

  private _onToggleSelect(config: string) {
    this.dispatchEvent(
      new CustomEvent("toggle-select", {
        detail: config,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onToggleAll() {
    this.dispatchEvent(
      new CustomEvent(this._allSelected ? "deselect-all" : "select-all", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onRowKeydown(e: KeyboardEvent, device: ConfiguredDevice) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (this.selectMode) {
        this._onToggleSelect(device.configuration);
      } else {
        this._onRowClick(device);
      }
    }
  }

  private _openActionsMenu(e: MouseEvent, device: ConfiguredDevice) {
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    this._contextMenuDevice = device;
    this._contextMenuPos = { x: rect.right, y: rect.bottom + 4 };
    this._contextMenuAnchorRight = true;
  }

  private _onRowContextMenu(e: MouseEvent, device: ConfiguredDevice) {
    e.preventDefault();
    this._contextMenuDevice = device;
    this._contextMenuPos = { x: e.clientX, y: e.clientY };
    this._contextMenuAnchorRight = false;
  }

  private _closeContextMenu() {
    this._contextMenuDevice = null;
    this._contextMenuPos = null;
    this._contextMenuAnchorRight = false;
  }

  private _forwardEvent(name: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _enterSelectMode(device: ConfiguredDevice) {
    this.dispatchEvent(
      new CustomEvent("enter-select-mode", {
        detail: device.configuration,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _scrollToTop() {
    this._scrollContainer?.scrollTo({ top: 0 });
  }

  private _onRowClick(device: ConfiguredDevice) {
    this.dispatchEvent(
      new CustomEvent("row-click", {
        detail: device,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-table": ESPHomeDeviceTable;
  }
}
