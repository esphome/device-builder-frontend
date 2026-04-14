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
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
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

  @property()
  boardName = "";

  @property()
  configuration = "";

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
    // Sync _selectedLine from selectedKey/selectedFromLine when set externally (e.g. URL restore)
    if (
      (changedProperties.has("selectedKey") || changedProperties.has("yaml") || changedProperties.has("selectedFromLine")) &&
      this.selectedKey &&
      this._selectedLine === null &&
      this.yaml
    ) {
      const allSections = [
        ...parseYamlTopLevelSections(this.yaml),
        ...parseYamlAutomations(this.yaml),
      ];
      // Match by fromLine first (exact), fall back to key/platform match
      const match = this.selectedFromLine !== undefined
        ? allSections.find((s) => s.fromLine === this.selectedFromLine)
        : allSections.find((s) => (s.platform || s.key) === this.selectedKey);
      if (match) {
        this._selectedLine = match.fromLine;
        this._selectedRange = { fromLine: match.fromLine, toLine: match.toLine };
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

    const sections = [
      {
        label: this._localize("device.section_core"),
        desc: this._localize("device.section_core_desc"),
        items: core,
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
        action: {
          label: this._localize("device.add_automation"),
          icon: "arrow-decision-outline",
          onClick: () => this._addAutomationDialog.open(),
        },
      },
    ];

    return html`
      <section class="card">
        <esphome-add-config-dialog
          .boardName=${this.boardName}
          .configuration=${this.configuration}
        ></esphome-add-config-dialog>
        <esphome-add-component-dialog
          .boardName=${this.boardName}
          .configuration=${this.configuration}
        ></esphome-add-component-dialog>
        <esphome-add-automation-dialog
          .boardName=${this.boardName}
          .configuration=${this.configuration}
        ></esphome-add-automation-dialog>
        <header class="card-header">
          <h2 class="card-title">${this._localize("device.navigator_title")}</h2>
        </header>
        <div class="card-body">
          <p class="italic">${this._localize("device.navigator_desc")}</p>
          <div class="separator"></div>
          ${sections.map(({ label, desc, items, action }, i) => {
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
                            ${items.map(
                              (item) => html`
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
                                    <p>${item.name
                                      ? `${item.name} - ${item.platform || item.key}`
                                      : item.platform || item.key}</p>
                                    ${item.parentKey && (item.name || item.platform)
                                      ? html`<span class="nav-item-subtitle">${item.parentKey}</span>`
                                      : nothing}
                                  </div>
                                  <wa-icon library="mdi" name="chevron-right"></wa-icon>
                                </div>
                              `
                            )}
                          </div>
                        `
                      : nothing}
                    <div class="nav-items" @click=${() => action.onClick()}>
                      <div class="action-item">
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
    const sectionKey = item.platform || item.key;

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
