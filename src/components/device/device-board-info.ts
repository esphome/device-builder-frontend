import { consume } from "@lit/context";
import {
  mdiArrowDecisionOutline,
  mdiMemory,
  mdiOpenInNew,
  mdiPlusCircleOutline,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  categorizeSections,
  parseYamlAutomations,
  parseYamlTopLevelSections,
} from "../../util/yaml-sections.js";
import type { ESPHomeAddAutomationDialog } from "./add-automation-dialog.js";
import type { ESPHomeAddComponentDialog } from "./add-component-dialog.js";
import type { ESPHomeDeviceSectionConfig } from "./device-section-config.js";

import "@home-assistant/webawesome/dist/components/badge/badge.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./add-automation-dialog.js";
import "./add-component-dialog.js";
import "./device-section-config.js";

registerMdiIcons({
  "open-in-new": mdiOpenInNew,
  memory: mdiMemory,
  "arrow-decision-outline": mdiArrowDecisionOutline,
  "plus-circle-outline": mdiPlusCircleOutline,
});

@customElement("esphome-device-board-info")
export class ESPHomeDeviceBoardInfo extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property()
  yaml = "";

  @property({ type: Boolean })
  justCreated = false;

  @property()
  configuration = "";

  @property({ attribute: false })
  selectedSection: string | null = null;

  @property({ type: Number })
  selectedFromLine?: number;

  @query("esphome-device-section-config")
  private _sectionConfig!: ESPHomeDeviceSectionConfig;

  @query("esphome-add-component-dialog")
  private _addComponentDialog!: ESPHomeAddComponentDialog;

  @query("esphome-add-automation-dialog")
  private _addAutomationDialog!: ESPHomeAddAutomationDialog;

  private _reloadTimer: ReturnType<typeof setTimeout> | null = null;

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("yaml") && this.selectedSection && this._sectionConfig) {
      // Debounce reload so typing in the YAML editor doesn't spam the API
      if (this._reloadTimer) clearTimeout(this._reloadTimer);
      this._reloadTimer = setTimeout(() => this._sectionConfig?.reload(), 1000);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._reloadTimer) clearTimeout(this._reloadTimer);
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
      }

      .board-header {
        display: flex;
        flex-direction: row;
        align-items: center;
        width: 100%;
        gap: var(--wa-space-l);
      }

      .board-info {
        display: flex;
        flex-direction: column;
        flex: 1;
        gap: var(--wa-space-s);
        min-width: 0;
      }

      .board-name {
        margin: 0;
      }

      .board-image {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 140px;
        height: 100px;
        padding: var(--wa-space-s);
        background: var(--wa-color-surface-lowered);
        border-radius: var(--wa-border-radius-l);
        box-sizing: border-box;
      }

      .board-image img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .board-tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-2xs);
      }

      .board-info-link {
        display: inline-flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        font-size: var(--wa-font-size-xs);
        color: var(--esphome-primary);
        text-decoration: underline;
        margin-left: 10px;
      }

      .board-info-link:hover {
        text-decoration: none;
      }

      .board-description {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .board-separator {
        height: 1px;
        background-color: var(--wa-color-surface-lowered);
        width: 100%;
        margin-top: var(--wa-space-m);
      }

      /* ─── Step CTA ─── */

      .step-section {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        padding-top: var(--wa-space-m);
      }

      .step-title {
        margin: 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .step-desc {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
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
        transition: background 0.1s;
        width: 220px;
        align-self: center;
        margin-top: var(--wa-space-m);
      }

      .action-item:hover {
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
        align-items: center;
        gap: var(--wa-space-2xs);
      }
    `,
  ];

  protected render() {
    if (!this.board) return nothing;

    const { components } = categorizeSections(parseYamlTopLevelSections(this.yaml));
    const inlineAutomations = parseYamlAutomations(this.yaml);
    const hasComponents = components.length > 0;
    const hasAutomations = inlineAutomations.length > 0;

    const showAddComponent = this.justCreated && !hasComponents;
    const showAddAutomations = hasComponents && !hasAutomations;

    return html`
      <div class="board-header">
        <div class="board-info">
          <h3 class="board-name">${this.board.name}</h3>
          <div class="board-tags">
            ${this.board.tags.map(
              (tag) => html`<wa-badge variant="brand" pill>${tag}</wa-badge>`,
            )}
            <a
              class="board-info-link"
              href=${this.board.docs_url}
              target="_blank"
              rel="noreferrer"
            >
              ${this._localize("device.more_info")}
              <wa-icon library="mdi" name="open-in-new"></wa-icon>
            </a>
          </div>
          <p class="board-description">${this.board.description}</p>
        </div>
        <div class="board-image">
          <img src=${this._boardImageUrl(this.board)} alt=${this.board.name} />
        </div>
      </div>

      <div class="board-separator"></div>

      ${this.selectedSection
        ? html`
            <esphome-device-section-config
              .configuration=${this.configuration}
              .sectionKey=${this.selectedSection}
              .fromLine=${this.selectedFromLine}
            ></esphome-device-section-config>
          `
        : html`
            ${showAddComponent
              ? html`
                  <div class="step-section">
                    <h4 class="step-title">
                      ${this._localize("device.step_add_component")}
                    </h4>
                    <p class="step-desc">
                      ${this._localize("device.step_add_component_desc")}
                    </p>
                    <div
                      class="action-item"
                      @click=${() => this._addComponentDialog.open()}
                    >
                      <div>
                        <wa-icon library="mdi" name="memory"></wa-icon>
                        <p>${this._localize("device.add_component")}</p>
                      </div>
                      <wa-icon library="mdi" name="plus-circle-outline"></wa-icon>
                    </div>
                  </div>
                `
              : nothing}
            ${showAddAutomations
              ? html`
                  <div class="step-section">
                    <h4 class="step-title">
                      ${this._localize("device.step_add_automations")}
                    </h4>
                    <p class="step-desc">
                      ${this._localize("device.step_add_automations_desc")}
                    </p>
                    <div
                      class="action-item"
                      @click=${() => this._addAutomationDialog.open()}
                    >
                      <div>
                        <wa-icon library="mdi" name="arrow-decision-outline"></wa-icon>
                        <p>${this._localize("device.add_automation")}</p>
                      </div>
                      <wa-icon library="mdi" name="plus-circle-outline"></wa-icon>
                    </div>
                  </div>
                `
              : nothing}
          `}

      <esphome-add-component-dialog
        .boardName=${this.board.name}
        .configuration=${this.configuration}
      ></esphome-add-component-dialog>
      <esphome-add-automation-dialog
        .boardName=${this.board.name}
        .configuration=${this.configuration}
      ></esphome-add-automation-dialog>
    `;
  }

  private _boardImageUrl(board: BoardCatalogEntry): string {
    if (board.images.length > 0) return board.images[0];
    return "/assets/board/default.svg";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-board-info": ESPHomeDeviceBoardInfo;
  }
}
