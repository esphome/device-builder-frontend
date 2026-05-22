/**
 * Action / condition picker dialog — the discoverable surface the
 * user reaches by clicking "+ Add action" / "+ Add condition" (or
 * the action/condition name on an existing row).
 *
 * Modelled after Home Assistant's three-tab picker:
 *
 * - **By target** — list applicable actions grouped by configured
 *   component instance. Picking "Warmtepomp → Turn On" here also
 *   pre-fills the action's ``id:`` field with ``relay1`` so the
 *   user doesn't have to scroll the id dropdown again.
 *
 * - **By type** — list actions grouped by domain (Light, Switch,
 *   Logger, …). Same actions as the By-target tab but sliced
 *   differently — useful when the user knows the action they want
 *   but not which instance to wire it to yet.
 *
 * - **Building blocks** — core helpers (``if`` / ``while`` /
 *   ``repeat`` / ``wait_until`` / ``delay`` / ``lambda``). For
 *   conditions: the boolean combinators (``and`` / ``or`` / ``not``
 *   / ``all`` / ``any`` / ``xor``) + ``lambda`` + ``for``.
 *
 * Search box at the top filters across all three tabs.
 *
 * Emits ``catalog-picked`` (``{ id: string; preFilledParams?:
 * Record<string, unknown> }``) when the user picks an item. The
 * parent (an action-list, action-node, or condition-tree) creates
 * the appropriate node and adds / replaces it.
 *
 * Generic over the catalog kind (actions vs conditions) so we
 * don't fork the recursion logic between the two; the only
 * difference is whether the By-target tab renders at all
 * (conditions don't have a target — they're tested against the
 * whole device state).
 */
import { consume } from "@lit/context";
import { mdiClose, mdiMagnify, mdiPlus } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import type {
  AutomationAction,
  AutomationCondition,
  AvailableComponentInstance,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { inputStyles } from "../../../styles/inputs.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { registerMdiIcons } from "../../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ close: mdiClose, magnify: mdiMagnify, plus: mdiPlus });

/** Catalog kind the dialog is rendering. Drives the "By target"
 *  tab visibility and the result-shape of picks. */
type CatalogKind = "action" | "condition";

type CatalogItem = AutomationAction | AutomationCondition;

/** Detail of the ``catalog-picked`` event. ``preFilledParams`` is
 *  optional — only the By-target tab sets it (to seed the action's
 *  ``id:`` field with the picked instance). */
export interface CatalogPickedDetail {
  id: string;
  preFilledParams?: Record<string, unknown>;
}

type Tab = "by-target" | "by-type" | "building-blocks";

@customElement("esphome-catalog-picker-dialog")
export class ESPHomeCatalogPickerDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** What kind of catalog we're presenting. Drives the tab strip
   *  (conditions hide "By target") and the label of the
   *  empty-state and the dialog heading. */
  @property() kind: CatalogKind = "action";

  /** The scoped catalog list — pass ``_available.actions`` or
   *  ``_available.conditions``. ``core`` items land under the
   *  "Building blocks" tab. */
  @property({ attribute: false })
  items: CatalogItem[] = [];

  /** Configured component instances on this device. Powers the
   *  "By target" tab. */
  @property({ attribute: false })
  devices: AvailableComponentInstance[] = [];

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  @state() private _activeTab: Tab = "by-target";
  @state() private _query = "";

  /**
   * Open the dialog. Resets the active tab to a sensible default
   * for the kind: ``by-target`` for actions, ``by-type`` for
   * conditions (which lack a target tab).
   */
  public open() {
    this._activeTab = this.kind === "action" ? "by-target" : "by-type";
    this._query = "";
    this._dialog.open = true;
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      wa-dialog {
        --width: 640px;
      }

      wa-dialog::part(body) {
        padding: 0;
      }

      /* Search field — mirrors the dashboard's .search-wrap +
         .search-input pattern (absolute-positioned leading icon over
         a fully-chromed native <input> that inherits styling from
         inputStyles). Padding lives on the outer container so the
         input has breathing room from the dialog edges. */
      .picker-search {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      .picker-search-wrap {
        position: relative;
      }

      .picker-search-icon {
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 18px;
        color: var(--wa-color-text-quiet);
        pointer-events: none;
        z-index: 1;
      }

      .picker-search-wrap .picker-search-input {
        padding-left: 36px;
      }

      .picker-tabs {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        margin: 0 var(--wa-space-l) var(--wa-space-s);
        background: var(--wa-color-surface-lowered);
        border-radius: var(--wa-border-radius-m);
        color: var(--wa-color-text-quiet);
      }

      .picker-tab {
        appearance: none;
        border: none;
        background: transparent;
        color: inherit;
        padding: 4px var(--wa-space-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        font-family: inherit;
        cursor: pointer;
        border-radius: calc(var(--wa-border-radius-m) - 2px);
        transition:
          background 0.12s,
          color 0.12s,
          box-shadow 0.12s;
      }

      .picker-tab:hover:not(.active) {
        color: var(--wa-color-text-normal);
      }

      .picker-tab.active {
        background: var(--wa-color-surface-raised);
        color: var(--wa-color-text-normal);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      }

      .picker-body {
        height: min(60vh, 500px);
        min-height: 320px;
        overflow-y: auto;
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }

      .picker-group-label {
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin: var(--wa-space-m) var(--wa-space-2xs) var(--wa-space-2xs);
      }

      .picker-group-label:first-child {
        margin-top: var(--wa-space-2xs);
      }

      .picker-row {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: var(--wa-space-m);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        transition: background 0.12s;
      }

      .picker-row:hover,
      .picker-row:focus-visible {
        background: var(--wa-color-surface-lowered);
        outline: none;
      }

      .picker-row-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .picker-row-title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-normal);
      }

      .picker-row-desc {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.4;
        /* Clamp to two lines — descriptions can be long but the
           picker shouldn't grow each row past a manageable height. */
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .picker-row-add {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: transparent;
        color: var(--wa-color-text-quiet);
        flex: 0 0 auto;
        line-height: 0;
        transition:
          background 0.12s,
          color 0.12s;
      }

      .picker-row-add wa-icon {
        display: block;
        width: 18px;
        height: 18px;
        font-size: 18px;
        line-height: 0;
      }

      .picker-row:hover .picker-row-add,
      .picker-row:focus-visible .picker-row-add {
        background: var(--wa-color-brand-fill-loud, #009fee);
        color: var(--wa-color-brand-on-loud, #ffffff);
      }

      .picker-empty {
        text-align: center;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        padding: var(--wa-space-xl) var(--wa-space-l);
        font-style: italic;
      }
    `,
  ];

  protected render() {
    const title =
      this.kind === "action"
        ? this._localize("device.automation_pick_action")
        : this._localize("device.automation_pick_condition");
    const placeholder = this._localize("device.automation_pick_search");

    // Conditions don't have a "by target" surface — they test the
    // whole device's state rather than running on a specific
    // component. Skip the tab when ``kind === "condition"``.
    const tabs: Tab[] =
      this.kind === "action"
        ? ["by-target", "by-type", "building-blocks"]
        : ["by-type", "building-blocks"];

    return html`<wa-dialog light-dismiss label=${title}>
      <div class="picker-search">
        <div class="picker-search-wrap">
          <wa-icon
            class="picker-search-icon"
            library="mdi"
            name="magnify"
            aria-hidden="true"
          ></wa-icon>
          <input
            class="picker-search-input"
            type="search"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            aria-label=${placeholder}
            .value=${this._query}
            placeholder=${placeholder}
            @input=${(e: Event) => (this._query = (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div class="picker-tabs" role="tablist">
        ${tabs.map(
          (tab) =>
            html`<button
              type="button"
              role="tab"
              class="picker-tab ${this._activeTab === tab ? "active" : ""}"
              aria-selected=${this._activeTab === tab}
              @click=${() => (this._activeTab = tab)}
            >
              ${this._tabLabel(tab)}
            </button>`
        )}
      </div>
      <div class="picker-body" role="tabpanel">${this._renderActiveTab()}</div>
    </wa-dialog>`;
  }

  private _tabLabel(tab: Tab): string {
    switch (tab) {
      case "by-target":
        return this._localize("device.automation_pick_tab_by_target");
      case "by-type":
        return this._localize("device.automation_pick_tab_by_type");
      case "building-blocks":
        return this._localize("device.automation_pick_tab_building_blocks");
    }
  }

  private _renderActiveTab() {
    const filtered = this._applyQuery(this.items);
    switch (this._activeTab) {
      case "by-target":
        return this._renderByTarget(filtered);
      case "by-type":
        return this._renderByType(filtered);
      case "building-blocks":
        return this._renderBuildingBlocks(filtered);
    }
  }

  /**
   * Filter the catalog by the search query. Match against the
   * id, name, and description fields. Case-insensitive substring
   * match — anything fancier (fuzzy / weighted) would surprise the
   * user with hits they couldn't explain.
   */
  private _applyQuery(items: CatalogItem[]): CatalogItem[] {
    const q = this._query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => {
      return (
        i.id.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q)
      );
    });
  }

  /**
   * "By target" — one section per configured device. Each section
   * lists actions whose domain matches the device's catalog
   * domain. Picking pre-fills the action's ``id:`` param (the
   * first ConfigEntry with ``references_component`` pointing at
   * this domain) so the user doesn't have to re-select the
   * instance after picking.
   */
  private _renderByTarget(items: CatalogItem[]) {
    if (this.devices.length === 0) {
      return html`<p class="picker-empty">
        ${this._localize("device.automation_pick_no_targets")}
      </p>`;
    }
    const sections = this.devices.map((device) => {
      const [domain] = device.component_id.split(".");
      const matching = items.filter((i) => {
        if (!("domain" in i)) return false;
        return i.domain === domain || i.domain === device.component_id;
      });
      return { device, matching };
    });
    const nonEmpty = sections.filter((s) => s.matching.length > 0);
    if (nonEmpty.length === 0) {
      return html`<p class="picker-empty">
        ${this._localize("device.automation_pick_no_results")}
      </p>`;
    }
    return html`${nonEmpty.map(
      ({ device, matching }) => html`
        <p class="picker-group-label">
          ${device.name ?? device.id}
          <span class="ae-muted">(${device.component_id})</span>
        </p>
        ${matching.map((item) =>
          this._renderRow(item, () => this._pick(item.id, this._preFillFor(item, device)))
        )}
      `
    )}`;
  }

  /**
   * "By type" — group actions by their bare domain. Skip ``core``
   * (those live under Building blocks). One section per domain;
   * domains sorted alphabetically.
   */
  private _renderByType(items: CatalogItem[]) {
    const byDomain = new Map<string, CatalogItem[]>();
    for (const item of items) {
      if (!("domain" in item)) continue;
      if (item.domain === "core") continue;
      // Normalise to bare ``<domain>``: an item with
      // ``switch.template`` lives under the "switch" group.
      const bare = item.domain.split(".")[0];
      const list = byDomain.get(bare) ?? [];
      list.push(item);
      byDomain.set(bare, list);
    }
    const domains = Array.from(byDomain.keys()).sort();
    if (domains.length === 0) {
      return html`<p class="picker-empty">
        ${this._localize("device.automation_pick_no_results")}
      </p>`;
    }
    return html`${domains.map(
      (domain) => html`
        <p class="picker-group-label">${domain}</p>
        ${(byDomain.get(domain) ?? []).map((item) =>
          this._renderRow(item, () => this._pick(item.id))
        )}
      `
    )}`;
  }

  /**
   * "Building blocks" — items whose ``domain === "core"``. These
   * are the helpers (delay / lambda) plus the control-flow
   * actions (if / while / repeat / wait_until) for the action
   * picker; combinators (and / or / …) + ``for`` + ``lambda``
   * for the condition picker.
   */
  private _renderBuildingBlocks(items: CatalogItem[]) {
    const core = items.filter((i) => "domain" in i && i.domain === "core");
    if (core.length === 0) {
      return html`<p class="picker-empty">
        ${this._localize("device.automation_pick_no_results")}
      </p>`;
    }
    return html`${core.map((item) => this._renderRow(item, () => this._pick(item.id)))}`;
  }

  private _renderRow(item: CatalogItem, onClick: () => void) {
    return html`<div
      class="picker-row"
      role="button"
      tabindex="0"
      @click=${onClick}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div class="picker-row-body">
        <span class="picker-row-title">${item.name}</span>
        ${item.description
          ? html`<span class="picker-row-desc">
              ${renderMarkdown(item.description)}
            </span>`
          : nothing}
      </div>
      <span class="picker-row-add" aria-hidden="true">
        <wa-icon library="mdi" name="plus"></wa-icon>
      </span>
    </div>`;
  }

  /**
   * Find the action's id-shaped ConfigEntry that references the
   * picked device's domain and pre-fill it with the device's id.
   * Returns ``undefined`` when no such field exists (e.g. core
   * actions, conditions that don't take an id).
   */
  private _preFillFor(
    item: CatalogItem,
    device: AvailableComponentInstance
  ): Record<string, unknown> | undefined {
    const [domain] = device.component_id.split(".");
    const idEntry = item.config_entries.find((e) => e.references_component === domain);
    if (!idEntry) return undefined;
    return { [idEntry.key]: device.id };
  }

  private _pick(id: string, preFilledParams?: Record<string, unknown>) {
    this.dispatchEvent(
      new CustomEvent<CatalogPickedDetail>("catalog-picked", {
        detail: { id, preFilledParams },
        bubbles: true,
        composed: true,
      })
    );
    this._dialog.open = false;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-catalog-picker-dialog": ESPHomeCatalogPickerDialog;
  }
}
