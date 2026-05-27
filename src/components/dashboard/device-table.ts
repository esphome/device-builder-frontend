import { consume } from "@lit/context";
import {
  mdiCancel,
  mdiCheckCircle,
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiChevronDown,
  mdiChevronUp,
  mdiCloseCircle,
  mdiConsole,
  mdiDotsVertical,
  mdiLock,
  mdiLockAlert,
  mdiLockClock,
  mdiLockOpenVariant,
  mdiOpenInNew,
  mdiPencil,
  mdiUnfoldMoreHorizontal,
  mdiUpload,
} from "@mdi/js";
import {
  TableController,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/lit-table";
import type { PropertyValues } from "lit";
import { LitElement, html, nothing } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ConfiguredDevice, FirmwareJob, Label } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { labelsContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { labelChipStyles, resolveLabelIds } from "../../util/label-chip-template.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { tableCellStyles } from "./table-cell-styles.js";
import type { ToggleableColumn } from "./table-column-toggle.js";
import { createDeviceColumns, type DeviceRow } from "./table-columns.js";
import { tableLayoutStyles } from "./table-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./table-column-toggle.js";
import "./table-pagination.js";
import "./table-row-menu.js";

registerMdiIcons({
  cancel: mdiCancel,
  "check-circle": mdiCheckCircle,
  "checkbox-blank-outline": mdiCheckboxBlankOutline,
  "checkbox-marked": mdiCheckboxMarked,
  "chevron-up": mdiChevronUp,
  "chevron-down": mdiChevronDown,
  "close-circle": mdiCloseCircle,
  console: mdiConsole,
  "dots-vertical": mdiDotsVertical,
  lock: mdiLock,
  "lock-alert": mdiLockAlert,
  "lock-clock": mdiLockClock,
  "lock-open-variant": mdiLockOpenVariant,
  "open-in-new": mdiOpenInNew,
  pencil: mdiPencil,
  "unfold-more-horizontal": mdiUnfoldMoreHorizontal,
  upload: mdiUpload,
});

// ─── Cached row-model factories (created once, reused forever) ───

const coreRowModel = getCoreRowModel<DeviceRow>();
const sortedRowModel = getSortedRowModel<DeviceRow>();
const filteredRowModel = getFilteredRowModel<DeviceRow>();
const paginatedRowModel = getPaginationRowModel<DeviceRow>();

// Columns hidden by default unless the user explicitly enables them via preferences.
const DEFAULT_HIDDEN_COLUMNS: VisibilityState = {
  comment: false,
  area: false,
  labels: false,
  version: false,
  ip: false,
  mac_address: false,
  build_size_bytes: false,
};

@customElement("esphome-device-table")
export class ESPHomeDeviceTable extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: labelsContext, subscribe: true })
  @state()
  private _labelCatalog: Label[] = [];

  @property({ attribute: false })
  devices: ConfiguredDevice[] = [];

  @property({ attribute: false })
  search = "";

  @property({ type: Boolean, attribute: "select-mode" })
  selectMode = false;

  @property({ attribute: false })
  selectedDevices = new Set<string>();

  /** Configuration filename of the row to highlight briefly — used
   *  by the dashboard to flash the freshly-adopted device. ``null``
   *  when nothing should be highlighted. */
  @property({ attribute: false })
  highlightConfiguration: string | null = null;

  @property({ attribute: false })
  activeJobs = new Map<string, unknown>();

  @property({ attribute: false })
  recentJobs = new Map<string, FirmwareJob>();

  /** Initial sorting from preferences — applied once when first set. */
  @property({ attribute: false })
  initialSorting: SortingState | null = null;

  /** Initial column visibility from preferences — applied once when first set. */
  @property({ attribute: false })
  initialColumnVisibility: VisibilityState | null = null;

  /** Initial page size from preferences — applied once when first set. */
  @property({ type: Number, attribute: "initial-page-size" })
  initialPageSize = 25;

  @state()
  private _sorting: SortingState = [];

  @state()
  private _columnVisibility: VisibilityState = { ...DEFAULT_HIDDEN_COLUMNS };

  @state()
  private _pageSize = 25;

  @state()
  private _pageIndex = 0;

  @state()
  private _contextMenuDevice: ConfiguredDevice | null = null;

  @state()
  private _contextMenuPos: { x: number; y: number } | null = null;

  @state()
  private _contextMenuAnchorRight = false;

  @query(".table-scroll")
  private _scrollContainer!: HTMLDivElement;

  private _tableController = new TableController<DeviceRow>(this);
  private _rows: DeviceRow[] = [];
  private _visibleConfigs: string[] = [];
  private _columns: ColumnDef<DeviceRow>[] = [];
  private _prevLocalize: LocalizeFunc | null = null;

  // ─── Stable callbacks ───

  private _handleSortingChange = (
    updater: SortingState | ((old: SortingState) => SortingState)
  ) => {
    this._sorting = typeof updater === "function" ? updater(this._sorting) : updater;
    this.dispatchEvent(
      new CustomEvent("table-sort-change", {
        detail: this._sorting,
        bubbles: true,
        composed: true,
      })
    );
  };

  private _handleVisibilityChange = (
    updater: VisibilityState | ((old: VisibilityState) => VisibilityState)
  ) => {
    this._columnVisibility =
      typeof updater === "function" ? updater(this._columnVisibility) : updater;
    this.dispatchEvent(
      new CustomEvent("table-visibility-change", {
        detail: this._columnVisibility,
        bubbles: true,
        composed: true,
      })
    );
  };

  private _handlePaginationChange = (
    updater: PaginationState | ((old: PaginationState) => PaginationState)
  ) => {
    const current = { pageSize: this._pageSize, pageIndex: this._pageIndex };
    const next = typeof updater === "function" ? updater(current) : updater;
    const pageSizeChanged = next.pageSize !== this._pageSize;
    this._pageSize = next.pageSize;
    this._pageIndex = next.pageIndex;
    if (pageSizeChanged) {
      this.dispatchEvent(
        new CustomEvent("table-page-size-change", {
          detail: this._pageSize,
          bubbles: true,
          composed: true,
        })
      );
    }
  };

  private _globalFilterFn = (
    row: any,
    _columnId: string,
    filterValue: unknown
  ): boolean => {
    const q = (filterValue as string).trim().toLowerCase();
    if (!q) return true;
    const d: DeviceRow = row.original;
    if (
      (d.friendly_name || d.name).toLowerCase().includes(q) ||
      d.config.toLowerCase().includes(q) ||
      d.address.toLowerCase().includes(q) ||
      d.ip_addresses.some((ip) => ip.toLowerCase().includes(q)) ||
      d.platform.toLowerCase().includes(q)
    ) {
      return true;
    }
    // MAC search: strip ``:`` / ``-`` / ``.`` from both haystack
    // and needle so a user can find a device by typing any of
    // ``94:c9:60``, ``94-C9-60``, or the bare ``94c960`` —
    // the canonical wire form is ``XX:XX:XX:XX:XX:XX`` but users
    // copy-paste from router admin pages, vendor labels, etc.
    if (d.mac_address) {
      const macStripped = d.mac_address.toLowerCase().replace(/[:.-]/g, "");
      const qStripped = q.replace(/[:.-]/g, "");
      if (qStripped && macStripped.includes(qStripped)) return true;
    }
    return false;
  };

  // ─── Lifecycle ───

  protected willUpdate(changed: PropertyValues) {
    // Apply initial values from preferences when they arrive
    if (changed.has("initialSorting") && this.initialSorting !== null) {
      this._sorting = this.initialSorting;
    }
    if (changed.has("initialColumnVisibility") && this.initialColumnVisibility !== null) {
      // Merge defaults so columns the user hasn't explicitly toggled stay hidden.
      this._columnVisibility = {
        ...DEFAULT_HIDDEN_COLUMNS,
        ...this.initialColumnVisibility,
      };
    }
    if (changed.has("initialPageSize")) {
      this._pageSize = this.initialPageSize;
      this._pageIndex = 0;
    }

    if (this._localize !== this._prevLocalize) {
      this._prevLocalize = this._localize;
      this._columns = createDeviceColumns(this._localize);
    }
    if (
      changed.has("devices") ||
      changed.has("activeJobs") ||
      changed.has("recentJobs") ||
      changed.has("_labelCatalog")
    ) {
      this._rows = this.devices.map((d) => ({
        status: d.state,
        name: d.name,
        friendly_name: d.friendly_name,
        address: d.address || "",
        ip: d.ip || "",
        ip_addresses: d.ip_addresses,
        mac_address: d.mac_address || "",
        // ``ethernet_mac`` / ``bluetooth_mac`` aren't surfaced in
        // the device list — those are drawer-only fields. The table
        // column shows the primary MAC (``mac_address``) since
        // that's the universally-meaningful identifier; the per-
        // interface derived values are diagnostic detail that
        // belongs in the per-device drawer.
        platform: d.target_platform || "",
        version: d.deployed_version || "",
        build_size_bytes: d.build_size_bytes || 0,
        comment: d.comment || "",
        area: d.area || "",
        // Resolve labels here once per render rather than from the
        // cell renderer — TanStack's sortingFn / filterFn read the
        // accessor value, so they need the resolved objects rather
        // than opaque ids.
        labels: resolveLabelIds(d.labels, this._labelCatalog),
        config: d.configuration,
        hasPendingChanges: d.has_pending_changes === true,
        hasUpdateAvailable: d.update_available,
        api_enabled: d.api_enabled === true,
        api_encrypted: d.api_encrypted === true,
        api_encryption_active: d.api_encryption_active ?? null,
        busy: this.activeJobs.has(d.configuration),
        recentJob: this.recentJobs.get(d.configuration) ?? null,
        _device: d,
      }));
    }
  }

  static styles = [espHomeStyles, tableCellStyles, tableLayoutStyles, labelChipStyles];

  // ─── Render ───

  protected render() {
    const table = this._tableController.table({
      data: this._rows,
      columns: this._columns,
      state: {
        sorting: this._sorting,
        columnVisibility: this._columnVisibility,
        globalFilter: this.search,
        pagination: { pageSize: this._pageSize, pageIndex: this._pageIndex },
      },
      onSortingChange: this._handleSortingChange as any,
      onColumnVisibilityChange: this._handleVisibilityChange as any,
      onPaginationChange: this._handlePaginationChange as any,
      getCoreRowModel: coreRowModel,
      getSortedRowModel: sortedRowModel,
      getFilteredRowModel: filteredRowModel,
      getPaginationRowModel: paginatedRowModel,
      globalFilterFn: this._globalFilterFn,
    });

    const rows = table.getRowModel().rows;
    this._visibleConfigs = table.getFilteredRowModel().rows.map((r) => r.original.config);
    const pgState = table.getState().pagination;
    const toggleCols: ToggleableColumn[] = table
      .getAllColumns()
      .filter((c) => c.getCanHide())
      .map((c) => ({
        id: c.id,
        header: c.columnDef.header as string,
        visible: c.getIsVisible(),
      }));

    return html`
      ${this._renderControls(table, toggleCols)}
      <div class="table-wrap">
        <div class="table-scroll">
          <table role="grid">
            ${this._renderThead(table)} ${this._renderTbody(table, rows)}
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
        ?busy=${this._contextMenuDevice
          ? this.activeJobs.has(this._contextMenuDevice.configuration)
          : false}
        @menu-close=${this._closeContextMenu}
        @edit-device=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("edit-device", e.detail);
        }}
        @update-device=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("update-device", e.detail);
        }}
        @open-logs=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("open-logs", e.detail);
        }}
        @delete-device=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("delete-device", e.detail);
        }}
        @validate-device=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("validate-device", e.detail);
        }}
        @install-device=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("install-device", e.detail);
        }}
        @show-api-key=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("show-api-key", e.detail);
        }}
        @download-yaml=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("download-yaml", e.detail);
        }}
        @rename-device=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("rename-device", e.detail);
        }}
        @clone-device=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("clone-device", e.detail);
        }}
        @edit-friendly-name=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("edit-friendly-name", e.detail);
        }}
        @clean-build=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("clean-build", e.detail);
        }}
        @download-elf=${(e: CustomEvent) => {
          e.stopPropagation();
          this._forwardEvent("download-elf", e.detail);
        }}
        @enter-select=${(e: CustomEvent<ConfiguredDevice>) => {
          e.stopPropagation();
          this._enterSelectMode(e.detail);
        }}
      ></esphome-table-row-menu>
    `;
  }

  private _renderControls(table: any, toggleCols: ToggleableColumn[]) {
    return html`
      <div class="controls">
        <slot name="toolbar"></slot>
        <div class="controls-right">
          <slot name="before-columns"></slot>
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
    `;
  }

  private _renderThead(table: any) {
    return html`
      <thead>
        ${table.getHeaderGroups().map(
          (hg: any) => html`
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
              ${hg.headers.map((header: any) => {
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
                    class="${canSort ? "sortable" : ""} ${sorted
                      ? "sorted"
                      : ""} col-${header.column.id}"
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
              <th class="actions-col"></th>
            </tr>
          `
        )}
      </thead>
    `;
  }

  private _renderTbody(table: any, rows: any[]) {
    return html`
      <tbody>
        ${rows.length > 0
          ? rows.map(
              (row) => html`
                <tr
                  role="row"
                  tabindex="0"
                  data-configuration=${row.original.config}
                  class=${classMap({
                    selected:
                      this.selectMode && this.selectedDevices.has(row.original.config),
                    highlight: this.highlightConfiguration === row.original.config,
                  })}
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
                      (cell: any) =>
                        html`<td role="gridcell" class="col-${cell.column.id}">
                          ${flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>`
                    )}
                  <td role="gridcell" class="actions-col">
                    <button
                      class="actions-btn"
                      aria-label=${this._localize("dashboard.more_options")}
                      @click=${(e: MouseEvent) => {
                        e.stopPropagation();
                        this._openActionsMenu(e, row.original._device);
                      }}
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
                  (this.selectMode ? 1 : 0) +
                  1}
                  class="no-results"
                >
                  ${this._localize("dashboard.table_no_results")}
                  <slot name="no-results-extra"></slot>
                </td>
              </tr>
            `}
      </tbody>
    `;
  }

  // ─── Event handlers ───

  private get _allSelected(): boolean {
    return (
      this._visibleConfigs.length > 0 &&
      this._visibleConfigs.every((cfg) => this.selectedDevices.has(cfg))
    );
  }

  private _onToggleSelect(config: string) {
    this.dispatchEvent(
      new CustomEvent("toggle-select", { detail: config, bubbles: true, composed: true })
    );
  }

  private _onToggleAll() {
    this.dispatchEvent(
      new CustomEvent(this._allSelected ? "deselect-all" : "select-all", {
        detail: this._visibleConfigs.slice(),
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Scroll the row matching *configuration* into view.
   *
   *  Exposed so the dashboard can highlight a freshly-adopted device
   *  without reaching across the table's shadow-DOM boundary —
   *  ``shadowRoot.querySelector`` from the dashboard can't see rows
   *  rendered in this component's shadow root. No-op when the row
   *  isn't on the current page. ``behavior: "instant"`` dodges
   *  Chrome mobile's smooth-scroll abort and lands the row at the
   *  intended position — the highlight pulse handles transition
   *  feedback. */
  public scrollConfigurationIntoView(configuration: string): void {
    const root = this.shadowRoot;
    if (!root) return;
    const row = root.querySelector<HTMLElement>(
      `tr[data-configuration="${CSS.escape(configuration)}"]`
    );
    row?.scrollIntoView({ behavior: "instant", block: "center" });
  }

  private _onRowKeydown(e: KeyboardEvent, device: ConfiguredDevice) {
    if (e.key !== "Enter" && e.key !== " ") return;
    /* Don't double-fire when the user is keyboard-activating an
       inline action control (Edit / Logs / Install / Update / Visit
       Web / kebab). The native button/anchor handles its own activation
       and the event bubbles up to the row — without this guard,
       pressing Enter on a focused action also opens the row drawer
       behind it. */
    if ((e.target as Element)?.closest("button, a")) return;
    e.preventDefault();
    this.selectMode
      ? this._onToggleSelect(device.configuration)
      : this._onRowClick(device);
  }

  private _openActionsMenu(e: MouseEvent, device: ConfiguredDevice) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
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
      })
    );
  }

  private _scrollToTop() {
    this._scrollContainer?.scrollTo({ top: 0 });
  }

  private _onRowClick(device: ConfiguredDevice) {
    this.dispatchEvent(
      new CustomEvent("row-click", { detail: device, bubbles: true, composed: true })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-table": ESPHomeDeviceTable;
  }
}
