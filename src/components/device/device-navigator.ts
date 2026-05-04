import { consume } from "@lit/context";
import {
  mdiArrowDecisionOutline,
  mdiChevronDown,
  mdiChevronRight,
  mdiChevronUp,
  mdiCog,
  mdiMemory,
  mdiPlusCircleOutline,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { AUTOMATIONS_ENABLED } from "../../feature-flags.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  type YamlSection,
  categorizeSections,
  parseYamlAutomations,
  parseYamlTopLevelSections,
} from "../../util/yaml-sections.js";
import type { HighlightRange } from "../yaml-editor.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./add-automation-dialog.js";
import type { ESPHomeAddAutomationDialog } from "./add-automation-dialog.js";
import "./add-component-dialog.js";
import type { ESPHomeAddComponentDialog } from "./add-component-dialog.js";
import "./add-config-dialog.js";
import type { ESPHomeAddConfigDialog } from "./add-config-dialog.js";

registerMdiIcons({
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  "chevron-right": mdiChevronRight,
  cog: mdiCog,
  "arrow-decision-outline": mdiArrowDecisionOutline,
  memory: mdiMemory,
  "plus-circle-outline": mdiPlusCircleOutline,
});

@customElement("esphome-device-navigator")
export class ESPHomeDeviceNavigator extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  openSections: Set<number> = new Set();

  @property({ attribute: false })
  yaml = "";

  /** Optional board metadata; forwarded to the add-component dialog so
   * the embedded form can render GPIO pin selectors. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property()
  boardName = "";

  @property()
  configuration = "";

  /** Device's target platform — forwarded to add-component / add-config
   * dialogs so the backend can resolve per-platform default values. */
  @property()
  platform = "";

  @query("esphome-add-config-dialog")
  private _addConfigDialog!: ESPHomeAddConfigDialog;

  @query("esphome-add-component-dialog")
  private _addComponentDialog!: ESPHomeAddComponentDialog;

  @query("esphome-add-automation-dialog")
  private _addAutomationDialog!: ESPHomeAddAutomationDialog;

  @property({ attribute: false })
  selectedKey: string | null = null;

  @property({ attribute: false })
  selectedFromLine?: number;

  @state()
  private _selectedLine: number | null = null;

  @state()
  private _selectedRange: HighlightRange | null = null;

  @state()
  private _hoveredLine: number | null = null;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: contents;
      }

      .card {
        background: var(--wa-color-surface-default);
        border-radius: var(--navigator-border-radius, var(--wa-border-radius-l));
        border: var(--navigator-border, var(--wa-border-width-s) solid var(--wa-color-surface-border));
        box-shadow: var(--wa-elevation-02);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .card-header {
        display: flex;
        align-items: center;
        padding: var(--wa-space-s) var(--wa-space-m);
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        flex-shrink: 0;
      }

      .card-title {
        margin: 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .card-body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }

      .italic {
        font-style: italic;
        font-size: var(--wa-font-size-2xs);
        padding: 0 var(--wa-space-m);
        margin: var(--wa-space-xs) 0;
        flex-shrink: 0;
      }

      .separator {
        height: 1px;
        background: var(--wa-color-surface-border);
        margin: var(--wa-space-2xs) 0;
        flex-shrink: 0;
      }

      .nav-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--wa-space-m);
        cursor: pointer;
        user-select: none;
        flex-shrink: 0;
      }

      .nav-content:hover p {
        color: var(--esphome-primary);
      }

      .nav-content p {
        margin: var(--wa-space-xs) 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .nav-content wa-icon {
        font-size: var(--wa-font-size-xl);
        color: var(--esphome-primary);
      }

      .nav-items {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        padding: var(--wa-space-xs) var(--wa-space-m);
      }

      .nav-item {
        padding: 0 var(--wa-space-2xs);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        user-select: none;
        transition:
          background 0.1s,
          border-color 0.1s;
      }

      .nav-item:hover,
      .nav-item--hovered {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        border-color: var(--esphome-primary);
      }

      .nav-item--selected {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        border-color: var(--esphome-primary);
      }

      .nav-item-content {
        display: flex;
        flex-direction: column;
        min-width: 0;
        padding: var(--wa-space-xs) 0;
      }

      .nav-item-content p {
        margin: 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .nav-item-subtitle {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        font-weight: normal;
        margin: 0;
        line-height: 1.2;
      }

      .nav-item wa-icon {
        font-size: var(--wa-font-size-xl);
        color: var(--esphome-primary);
      }

      .action-item {
        padding: 0 var(--wa-space-2xs);
        border-radius: var(--wa-border-radius-m);
        display: flex;
        align-items: center;
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        justify-content: space-between;
        cursor: pointer;
        user-select: none;
        transition:
          background 0.1s,
          border-color 0.1s;
      }

      .action-item:hover,
      .action-item--hovered {
        opacity: 0.9;
      }

      /* Disabled action: greyed out, no hover, no pointer. The wrapper
         drops its click handler so the underlying dialog is never
         opened — this is purely visual confirmation. */
      .action-item--disabled,
      .action-item--disabled:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
        cursor: not-allowed;
        opacity: 0.65;
      }

      .action-item--disabled wa-icon {
        color: var(--wa-color-text-quiet);
      }

      .action-item p {
        margin: var(--wa-space-xs) 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .action-item wa-icon {
        font-size: var(--wa-font-size-l);
      }

      .action-item div {
        display: flex;
        flex-direction: wrap;
        align-items: center;
        gap: var(--wa-space-2xs);
      }
    `,
  ];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    // Sync `_selectedLine`/`_selectedRange` whenever the externally-
    // controlled selection changes (URL restore, "go to component"
    // events from the dialog, YAML edits that shift line numbers).
    // We don't gate on `_selectedLine === null` here — that used to
    // be a guard against re-sync loops, but it also meant external
    // updates couldn't move the highlight off whatever was previously
    // selected.
    if (
      (changedProperties.has("selectedKey") ||
        changedProperties.has("yaml") ||
        changedProperties.has("selectedFromLine")) &&
      this.yaml
    ) {
      if (!this.selectedKey) {
        // Cleared externally — drop the local highlight.
        this._selectedLine = null;
        this._selectedRange = null;
        return;
      }
      const allSections = [
        ...parseYamlTopLevelSections(this.yaml),
        ...parseYamlAutomations(this.yaml),
      ];
      // Try fromLine first (exact match), fall back to key/platform
      // match (handles the case where the YAML shifted under us, e.g.
      // the user just added a component before the selected one).
      const matchByKey = (s: YamlSection) => {
        if (!s.platform) return s.key === this.selectedKey;
        const candidate = s.platform.startsWith(`${s.key}.`)
          ? s.platform
          : `${s.key}.${s.platform}`;
        return candidate === this.selectedKey;
      };
      const match =
        (this.selectedFromLine !== undefined
          ? allSections.find((s) => s.fromLine === this.selectedFromLine)
          : undefined) ?? allSections.find(matchByKey);
      if (match) {
        this._selectedLine = match.fromLine;
        this._selectedRange = {
          fromLine: match.fromLine,
          toLine: match.toLine,
        };
      }
    }
  }

  protected render() {
    const {
      core,
      components,
      automations: topLevelAutomations,
    } = categorizeSections(parseYamlTopLevelSections(this.yaml));
    const automations = [...topLevelAutomations, ...parseYamlAutomations(this.yaml)].sort(
      (a, b) => a.fromLine - b.fromLine
    );

    interface NavAction {
      label: string;
      icon: string;
      onClick: () => void;
      disabled?: boolean;
      disabledReason?: string;
    }
    interface NavSection {
      label: string;
      desc: string;
      items: YamlSection[];
      category: "core" | "component" | "automation";
      action: NavAction;
    }
    const sections: NavSection[] = [
      {
        label: this._localize("device.section_core"),
        desc: this._localize("device.section_core_desc"),
        items: core,
        category: "core",
        action: {
          label: this._localize("device.add_config"),
          icon: "cog",
          onClick: () => this._addConfigDialog.open(),
        },
      },
      {
        label: this._localize("device.section_components"),
        desc: this._localize("device.section_components_desc"),
        items: components,
        category: "component",
        action: {
          label: this._localize("device.add_component"),
          icon: "memory",
          onClick: () => this._addComponentDialog.open(),
        },
      },
      {
        label: this._localize("device.section_automations"),
        desc: this._localize("device.section_automations_desc"),
        items: automations,
        category: "automation",
        // Add-automation is gated on a backend that doesn't yet exist
        // — see `feature-flags.ts` and the README "Status" section.
        // The list still renders existing automations parsed from
        // YAML; only the action button is disabled.
        action: {
          label: this._localize("device.add_automation"),
          icon: "arrow-decision-outline",
          onClick: () => this._addAutomationDialog.open(),
          disabled: !AUTOMATIONS_ENABLED,
          disabledReason: this._localize("device.add_automation_unavailable"),
        },
      },
    ];

    return html`
      <section class="card">
        <esphome-add-config-dialog
          .boardName=${this.boardName}
          .configuration=${this.configuration}
          .platform=${this.platform}
          .board=${this.board}
          .yaml=${this.yaml}
        ></esphome-add-config-dialog>
        <esphome-add-component-dialog
          .boardName=${this.boardName}
          .configuration=${this.configuration}
          .platform=${this.platform}
          .board=${this.board}
          .yaml=${this.yaml}
        ></esphome-add-component-dialog>
        ${AUTOMATIONS_ENABLED
          ? html`<esphome-add-automation-dialog
              .boardName=${this.boardName}
              .configuration=${this.configuration}
            ></esphome-add-automation-dialog>`
          : nothing}
        <header class="card-header">
          <h2 class="card-title">${this._localize("device.navigator_title")}</h2>
        </header>
        <div class="card-body">
          <p class="italic">${this._localize("device.navigator_desc")}</p>
          <div class="separator"></div>
          ${sections.map(({ label, desc, items, category, action }, i) => {
            const open = this.openSections.has(i);
            return html`
              <div class="nav-content" @click=${() => this._toggleSection(i)}>
                <p>${label}</p>
                <wa-icon
                  library="mdi"
                  name=${open ? "chevron-up" : "chevron-down"}
                ></wa-icon>
              </div>
              ${open
                ? html`
                    <div class="separator"></div>
                    <p class="italic">${desc}</p>
                    ${items.length > 0
                      ? html`
                          <div class="nav-items">
                            ${items.map((item) => {
                              const { primary, secondary } =
                                this._navItemLabels(item, category);
                              return html`
                                <div
                                  class="nav-item ${this._selectedLine === item.fromLine
                                    ? "nav-item--selected"
                                    : ""} ${this._hoveredLine === item.fromLine
                                    ? "nav-item--hovered"
                                    : ""}"
                                  @mouseenter=${() =>
                                    this._onItemHover(item.fromLine, item.fromLine, item.toLine)}
                                  @mouseleave=${() => this._onItemLeave()}
                                  @click=${() => this._onItemClick(item)}
                                >
                                  <div class="nav-item-content">
                                    <p>${primary}</p>
                                    ${secondary
                                      ? html`<span class="nav-item-subtitle"
                                          >${secondary}</span
                                        >`
                                      : nothing}
                                  </div>
                                  <wa-icon library="mdi" name="chevron-right"></wa-icon>
                                </div>
                              `;
                            })}
                          </div>
                        `
                      : nothing}
                    <div
                      class="nav-items"
                      @click=${action.disabled
                        ? undefined
                        : () => action.onClick()}
                    >
                      <div
                        class="action-item ${action.disabled
                          ? "action-item--disabled"
                          : ""}"
                        title=${action.disabled
                          ? action.disabledReason ?? ""
                          : ""}
                        aria-disabled=${action.disabled ? "true" : "false"}
                      >
                        <div>
                          <wa-icon library="mdi" name=${action.icon}></wa-icon>
                          <p>${action.label}</p>
                        </div>
                        <wa-icon library="mdi" name="plus-circle-outline"></wa-icon>
                      </div>
                    </div>
                  `
                : nothing}
              <div class="separator"></div>
            `;
          })}
        </div>
      </section>
    `;
  }

  private _toggleSection(index: number) {
    this.dispatchEvent(
      new CustomEvent("section-toggle", {
        detail: { index },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Decide what to show on the two lines of a nav item. Same shape
   * for core, components, and automations:
   *
   *   line 1 (primary)   <domain>.<platform> when this is a list
   *                      item under a platform domain (e.g.
   *                      `sensor.dht`, `time.homeassistant`),
   *                      otherwise just the domain key (`wifi`,
   *                      `api`, `uart`).
   *   line 2 (secondary) the user-supplied `name:` if present, else
   *                      the `id:`. Hidden when neither is set or
   *                      when it's identical to the primary.
   *
   * Putting the domain on the first line keeps the navigator scanable
   * — you can tell at a glance what kind of thing each entry is —
   * while the user-friendly label sits underneath as the personal
   * identifier.
   */
  private _navItemLabels(
    item: YamlSection,
    _category: "core" | "component" | "automation",
  ): { primary: string; secondary?: string } {
    let primary: string;
    if (item.platform) {
      primary = item.platform.startsWith(`${item.key}.`)
        ? item.platform
        : `${item.key}.${item.platform}`;
    } else {
      primary = item.key;
    }

    const named = item.name || item.id;
    const secondary = named && named !== primary ? named : undefined;

    return { primary, secondary };
  }

  private _onItemHover(line: number, fromLine: number, toLine: number) {
    this._hoveredLine = line;
    this._emitHighlight({ fromLine, toLine }, false);
  }

  private _onItemLeave() {
    this._hoveredLine = null;
    this._emitHighlight(this._selectedRange, false);
  }

  private _onItemClick(item: YamlSection) {
    const { fromLine, toLine } = item;
    // Component IDs in the catalog are namespaced as `parent.platform` for
    // platform-based components (e.g. `switch.template`, `binary_sensor.gpio`).
    // Top-level components use just their key (e.g. `wifi`, `api`).
    // Guard: if the platform value already starts with the parent key (e.g.
    // a malformed YAML or a stale value), don't double-prefix it.
    let sectionKey: string;
    if (item.platform) {
      const platform = item.platform;
      sectionKey = platform.startsWith(`${item.key}.`)
        ? platform
        : `${item.key}.${platform}`;
    } else {
      sectionKey = item.key;
    }

    if (this._selectedLine === fromLine) {
      this.selectedKey = null;
      this._selectedLine = null;
      this._selectedRange = null;
      this._emitHighlight(this._hoveredLine === fromLine ? { fromLine, toLine } : null, false);
      this._emitSectionSelect(null, undefined);
    } else {
      this.selectedKey = sectionKey;
      this._selectedLine = fromLine;
      this._selectedRange = { fromLine, toLine };
      this._emitHighlight({ fromLine, toLine }, true);
      this._emitSectionSelect(sectionKey, fromLine);
    }
  }

  private _emitHighlight(range: HighlightRange | null, scroll: boolean) {
    this.dispatchEvent(
      new CustomEvent("yaml-highlight", {
        detail: { range, scroll },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _emitSectionSelect(sectionKey: string | null, fromLine: number | undefined) {
    this.dispatchEvent(
      new CustomEvent("section-select", {
        detail: { sectionKey, fromLine },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-navigator": ESPHomeDeviceNavigator;
  }
}
