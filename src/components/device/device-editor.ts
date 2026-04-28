import { consume } from "@lit/context";
import {
  mdiContentSave,
  mdiDockLeft,
  mdiDockRight,
  mdiUpload,
  mdiVectorDifference,
  mdiViewSplitHorizontal,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, yamlDiffButtonContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { deviceEditorStyles } from "./device-editor.styles.js";
import {
  categorizeSections,
  parseYamlAutomations,
  parseYamlTopLevelSections,
} from "../../util/yaml-sections.js";
import type { HighlightRange } from "../yaml-editor.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../yaml-editor.js";
import "../yaml-diff.js";
import "./device-board-info.js";

registerMdiIcons({
  "content-save": mdiContentSave,
  "layout-left": mdiDockLeft,
  "layout-right": mdiDockRight,
  "layout-split": mdiViewSplitHorizontal,
  upload: mdiUpload,
  "vector-difference": mdiVectorDifference,
});

export type DeviceLayoutMode = "both" | "left" | "right";

@customElement("esphome-device-editor")
export class ESPHomeDeviceEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  yaml = "";

  @property()
  layout: DeviceLayoutMode = "both";

  @property()
  deviceTitle = "";

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property({ type: Boolean })
  justCreated = false;

  @state()
  private _isMobile = false;

  private _mql = window.matchMedia("(max-width: 900px)");

  private _onMqlChange = (e: MediaQueryListEvent) => {
    this._isMobile = e.matches;
  };

  connectedCallback() {
    super.connectedCallback();
    this._isMobile = this._mql.matches;
    this._mql.addEventListener("change", this._onMqlChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._mql.removeEventListener("change", this._onMqlChange);
  }

  @property({ attribute: false })
  highlightRange: HighlightRange | null = null;

  @property({ type: Boolean })
  scrollToHighlight = false;

  @property()
  configuration = "";

  @property({ attribute: false })
  selectedSection: string | null = null;

  @property({ type: Number })
  selectedFromLine?: number;

  /** Yaml content at last save/load — compared against current yaml to detect changes. */
  @property({ attribute: false })
  savedYaml = "";

  @property({ type: Boolean })
  hasPendingChanges = false;

  @property({ type: Boolean })
  hasUpdateAvailable = false;

  @property({ type: Boolean })
  busy = false;

  @consume({ context: yamlDiffButtonContext, subscribe: true })
  @state()
  private _showDiffButton = false;

  @state()
  private _showDiff = false;

  static styles = [espHomeStyles, deviceEditorStyles];

  protected render() {
    const hasBoard = !!this.board;
    const effectiveLayout = !hasBoard
      ? "right"
      : this._isMobile && this.layout === "both"
        ? "right"
        : this.layout;
    const layoutClass =
      effectiveLayout === "both"
        ? "editor-layout--both"
        : effectiveLayout === "left"
          ? "editor-layout--left"
          : "editor-layout--right";

    const { components } = categorizeSections(parseYamlTopLevelSections(this.yaml));
    const automations = parseYamlAutomations(this.yaml);
    const hasComponents = components.length > 0;
    const hasAutomations = automations.length > 0;

    const title = !hasComponents
      ? this._localize("device.editor_title_no_components", { name: this.deviceTitle })
      : !hasAutomations
        ? this._localize("device.editor_title_no_automations", { name: this.deviceTitle })
        : this._localize("device.editor_title_ready", { name: this.deviceTitle });

    return html`
      <section class="card">
        <header class="card-header">
          <slot name="mobile-menu"></slot>
          <div class="editor-header-main">
            <h2 class="editor-header-title">${title}</h2>
          </div>
          <div class="header-actions">
            ${this.hasPendingChanges
              ? html`<button
                  type="button"
                  class="install-button"
                  ?disabled=${this.busy}
                  @click=${this._onInstall}
                  title=${this._localize("dashboard.install")}
                >
                  <wa-icon library="mdi" name="upload"></wa-icon>
                </button>`
              : this.hasUpdateAvailable
                ? html`<button
                    type="button"
                    class="install-button"
                    ?disabled=${this.busy}
                    @click=${this._onUpdate}
                    title=${this._localize("dashboard.update")}
                  >
                    <wa-icon library="mdi" name="upload"></wa-icon>
                  </button>`
                : nothing}
            ${this._showDiffButton
              ? html`<button
                  type="button"
                  class="diff-toggle"
                  aria-pressed=${this._showDiff}
                  ?disabled=${this.yaml === this.savedYaml && !this._showDiff}
                  @click=${this._toggleDiff}
                  title=${this._showDiff
                    ? this._localize("device.diff_view_editor")
                    : this._localize("device.diff_view_diff")}
                >
                  <wa-icon library="mdi" name="vector-difference"></wa-icon>
                </button>`
              : nothing}
            <div
              class="layout-toggle"
              aria-label=${this._localize("device.editor_layout_label")}
            >
              <button
                type="button"
                aria-pressed=${effectiveLayout === "left"}
                ?disabled=${!hasBoard}
                @click=${() => this._setLayout("left")}
                title=${this._localize("device.layout_components_only")}
              >
                <wa-icon library="mdi" name="layout-left"></wa-icon>
              </button>
              <button
                class="split-btn"
                type="button"
                aria-pressed=${effectiveLayout === "both"}
                ?disabled=${!hasBoard}
                @click=${() => this._setLayout("both")}
                title=${this._localize("device.layout_split")}
              >
                <wa-icon library="mdi" name="layout-split"></wa-icon>
              </button>
              <button
                type="button"
                aria-pressed=${effectiveLayout === "right"}
                @click=${() => this._setLayout("right")}
                title=${this._localize("device.layout_yaml_only")}
              >
                <wa-icon library="mdi" name="layout-right"></wa-icon>
              </button>
            </div>
          </div>
        </header>
        <div class="card-body">
          <button
            type="button"
            class="save-button"
            ?disabled=${this.yaml === this.savedYaml}
            @click=${this._onSave}
            title=${this._localize("device.save_yaml")}
          >
            <wa-icon library="mdi" name="content-save"></wa-icon>
            ${this._localize("device.save")}
          </button>
          <div class=${`editor-layout ${layoutClass}`}>
            <div class="editor-pane editor-pane--left">
              <esphome-device-board-info
                .board=${this.board}
                .yaml=${this.yaml}
                .justCreated=${this.justCreated}
                .configuration=${this.configuration}
                .selectedSection=${this.selectedSection}
                .selectedFromLine=${this.selectedFromLine}
              ></esphome-device-board-info>
            </div>
            ${effectiveLayout === "both"
              ? html`<div class="pane-divider"></div>`
              : nothing}
            <div class="editor-pane editor-pane--right">
              <div class="editor-pane-body">
                ${this._showDiff
                  ? html`<esphome-yaml-diff
                      .oldValue=${this.savedYaml}
                      .newValue=${this.yaml}
                    ></esphome-yaml-diff>`
                  : html`<esphome-yaml-editor
                      .value=${this.yaml}
                      .highlightRange=${this.highlightRange}
                      .scrollToHighlight=${this.scrollToHighlight}
                      @yaml-change=${this._onYamlChange}
                    ></esphome-yaml-editor>`}
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  private _onSave() {
    this.dispatchEvent(
      new CustomEvent("save-yaml", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _toggleDiff() {
    this._showDiff = !this._showDiff;
  }

  private _onInstall() {
    this.dispatchEvent(
      new CustomEvent("install-device", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onUpdate() {
    this.dispatchEvent(
      new CustomEvent("update-device", {
        bubbles: true,
        composed: true,
      })
    );
  }

  updated(changed: Map<string, unknown>) {
    if (this._showDiff && changed.has("_showDiffButton") && !this._showDiffButton) {
      this._showDiff = false;
      return;
    }
    if (
      this._showDiff &&
      changed.has("savedYaml") &&
      this.yaml === this.savedYaml
    ) {
      this._showDiff = false;
    }
  }

  private _setLayout(layout: DeviceLayoutMode) {
    this.dispatchEvent(
      new CustomEvent("layout-change", {
        detail: layout,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onYamlChange(e: CustomEvent) {
    this.dispatchEvent(
      new CustomEvent("yaml-change", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-editor": ESPHomeDeviceEditor;
  }
}
