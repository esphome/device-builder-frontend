import { flexRender } from "@tanstack/lit-table";
import { html, nothing, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";

export interface DeviceTableHeadProps {
  table: any;
  selectMode: boolean;
  allSelected: boolean;
  onToggleAll: () => void;
}

export interface DeviceTableBodyProps {
  table: any;
  rows: any[];
  selectMode: boolean;
  selectedDevices: Set<string>;
  highlightConfiguration: string | null;
  localize: LocalizeFunc;
  onToggleSelect: (config: string) => void;
  onRowClick: (device: ConfiguredDevice) => void;
  onRowContextMenu: (e: MouseEvent, device: ConfiguredDevice) => void;
  onRowKeydown: (e: KeyboardEvent, device: ConfiguredDevice) => void;
  openActionsMenu: (e: MouseEvent, device: ConfiguredDevice) => void;
}

/**
 * The device table's `<thead>`. Rendered into the
 * `<esphome-device-table>` shadow root, so its column / sort-icon
 * styles apply. Sorting is driven through TanStack's column API on
 * the passed table instance.
 */
export function renderDeviceTableHead(p: DeviceTableHeadProps): TemplateResult {
  return html`
    <thead>
      ${p.table.getHeaderGroups().map(
        (hg: any) => html`
          <tr role="row">
            ${
              p.selectMode
                ? html`<th class="select-col" style="width:40px">
                    <span class="row-checkbox" @click=${p.onToggleAll}>
                      <wa-icon
                        library="mdi"
                        name=${p.allSelected ? "checkbox-marked" : "checkbox-blank-outline"}
                      ></wa-icon>
                    </span>
                  </th>`
                : nothing
            }
            ${hg.headers.map((header: any) => {
              const sorted = header.column.getIsSorted();
              const canSort = header.column.getCanSort();
              return html`
                <th
                  role="columnheader"
                  aria-sort=${
                    sorted === "asc"
                      ? "ascending"
                      : sorted === "desc"
                        ? "descending"
                        : "none"
                  }
                  class="${canSort ? "sortable" : ""} ${
                    sorted ? "sorted" : ""
                  } col-${header.column.id}"
                  style="width:${header.getSize()}px"
                  @click=${canSort ? () => header.column.toggleSorting() : nothing}
                >
                  <span class="th-content">
                    ${
                      header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())
                    }
                    ${
                      canSort
                        ? html`<wa-icon
                            class="sort-icon"
                            library="mdi"
                            name=${
                              sorted === "asc"
                                ? "chevron-up"
                                : sorted === "desc"
                                  ? "chevron-down"
                                  : "unfold-more-horizontal"
                            }
                          ></wa-icon>`
                        : nothing
                    }
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

/**
 * The device table's `<tbody>`. Rendered into the
 * `<esphome-device-table>` shadow root, so its row / cell-stack-label
 * styles apply. Row interactions (click, context-menu, keyboard,
 * selection, actions menu) are dispatched back through the callbacks
 * the host supplies.
 */
export function renderDeviceTableBody(p: DeviceTableBodyProps): TemplateResult {
  return html`
    <tbody>
      ${
        p.rows.length > 0
          ? repeat(
              p.rows,
              // Key on the device config so Lit reuses each row's DOM
              // across re-renders (job-progress ticks, selection) instead
              // of re-diffing every row — matters most with "All" selected.
              (row) => row.original.config,
              (row) => html`
                <tr
                  role="row"
                  tabindex="0"
                  data-configuration=${row.original.config}
                  class=${classMap({
                    selected: p.selectMode && p.selectedDevices.has(row.original.config),
                    highlight: p.highlightConfiguration === row.original.config,
                  })}
                  @click=${() =>
                    p.selectMode
                      ? p.onToggleSelect(row.original.config)
                      : p.onRowClick(row.original._device)}
                  @contextmenu=${(e: MouseEvent) =>
                    p.onRowContextMenu(e, row.original._device)}
                  @keydown=${(e: KeyboardEvent) => p.onRowKeydown(e, row.original._device)}
                >
                  ${
                    p.selectMode
                      ? html`<td role="gridcell" class="select-col">
                          <span class="row-checkbox">
                            <wa-icon
                              library="mdi"
                              name=${
                                p.selectedDevices.has(row.original.config)
                                  ? "checkbox-marked"
                                  : "checkbox-blank-outline"
                              }
                            ></wa-icon>
                          </span>
                        </td>`
                      : nothing
                  }
                  ${row.getVisibleCells().map((cell: any) => {
                    // The stacked mobile layout (table-styles.ts) shows each
                    // cell's column header as a field label. It's a real
                    // span (not a CSS ::before) so screen readers announce
                    // it on mobile, where the <thead> is hidden; the span is
                    // display:none on desktop, so it stays out of the a11y
                    // tree there (the column header already provides context).
                    // Name is the card title and actions is a button row, so
                    // neither gets a label. Only string headers can be used as
                    // a label; a future flexRender (template/function) header
                    // would stringify to "[object Object]", so skip it.
                    const id = cell.column.id;
                    const header = cell.column.columnDef.header;
                    const label =
                      id !== "name" && id !== "actions" && typeof header === "string"
                        ? header
                        : null;
                    return html`<td role="gridcell" class="col-${id}">
                      ${
                        label !== null
                          ? html`<span class="cell-stack-label">${label}</span>`
                          : nothing
                      }
                      ${flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>`;
                  })}
                  <td role="gridcell" class="actions-col">
                    <button
                      class="actions-btn"
                      aria-label=${p.localize("dashboard.more_options")}
                      @click=${(e: MouseEvent) => {
                        e.stopPropagation();
                        p.openActionsMenu(e, row.original._device);
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
                  colspan=${
                    p.table.getVisibleLeafColumns().length + (p.selectMode ? 1 : 0) + 1
                  }
                  class="no-results"
                >
                  ${p.localize("dashboard.table_no_results")}
                  <slot name="no-results-extra"></slot>
                </td>
              </tr>
            `
      }
    </tbody>
  `;
}
