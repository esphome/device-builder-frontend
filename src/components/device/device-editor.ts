import { consume } from "@lit/context";
import {
  mdiCheckCircleOutline,
  mdiContentSave,
  mdiDockLeft,
  mdiDockRight,
  mdiEye,
  mdiEyeOff,
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
import type { HighlightRange } from "../yaml-editor.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../yaml-editor.js";
import "../yaml-diff.js";
import "./device-board-info.js";

registerMdiIcons({
  "check-circle-outline": mdiCheckCircleOutline,
  "content-save": mdiContentSave,
  eye: mdiEye,
  "eye-off": mdiEyeOff,
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

  /** Forwarded from the page so the editor can shrink its own header
   *  chrome when both side panels are out of view (navigator hidden +
   *  YAML-only layout). With nothing else on screen the title bar
   *  ate vertical space the user couldn't reclaim. */
  @property({ type: Boolean })
  navCollapsed = false;

  @property()
  deviceTitle = "";

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  /** Forwarded from the page — when true, the content pane shows a
   *  "just created" welcome banner above the next-step panels. */
  @property({ type: Boolean })
  justCreated = false;

  @state()
  private _isMobile = false;

  private _mql = window.matchMedia("(max-width: 900px)");

  private _onMqlChange = (e: MediaQueryListEvent) => {
    this._isMobile = e.matches;
  };

  /** Cmd/Ctrl+S → save the YAML if there are unsaved changes.
   *  Listens at the window level so the shortcut works regardless of
   *  which child (CodeMirror, navigator, etc.) currently has focus. */
  private _onGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (this.hasUnsavedEdits) {
        this._onSave();
      }
    }
  };

  connectedCallback() {
    super.connectedCallback();
    this._isMobile = this._mql.matches;
    this._mql.addEventListener("change", this._onMqlChange);
    window.addEventListener("keydown", this._onGlobalKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._mql.removeEventListener("change", this._onMqlChange);
    window.removeEventListener("keydown", this._onGlobalKeyDown);
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

  /** True when the page has any unsaved edits — covers both
   *  ``yaml !== savedYaml`` AND the section editor's transient
   *  pre-debounce-flush state. The page passes this in (rather
   *  than us computing ``yaml !== savedYaml`` locally) so a click
   *  on Save inside the form's 200ms debounce window still
   *  enables the button: the page's save handler flushes the
   *  form synchronously before reading ``yaml``, so the
   *  resulting commit is correct. */
  @property({ type: Boolean })
  hasUnsavedEdits = false;

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

  // Mirrors the per-field `<esphome-password-input>` reveal toggle —
  // off by default so passwords/keys render as bullets in the YAML
  // pane just as they do in the form. The toolbar button below flips
  // this for the whole editor at once. Note: this is unrelated to
  // ESPHome's `!secret`-tag indirection (those lines only carry the
  // secret *name* and are passed through as-is).
  @state()
  private _revealSensitive = false;

  static styles = [espHomeStyles, deviceEditorStyles];

  protected render() {
    // On mobile we collapse the split view down to a single pane to
    // keep things readable; otherwise honour whatever layout the user
    // last chose. We deliberately do NOT force "right" when there's
    // no board — a missing board catalog entry shouldn't make the
    // navigator + section editor disappear.
    const effectiveLayout =
      this._isMobile && this.layout === "both" ? "right" : this.layout;
    const layoutClass =
      effectiveLayout === "both"
        ? "editor-layout--both"
        : effectiveLayout === "left"
          ? "editor-layout--left"
          : "editor-layout--right";
    /* When the user has hidden the navigator AND chosen YAML-only,
       the only thing on screen is the YAML editor — the bulky title
       bar is just chrome at that point. Compact it (less padding,
       smaller title) so the editor reclaims the vertical space.
       Mobile already has its own header treatment so we leave that
       alone. */
    const compactHeader =
      !this._isMobile && this.navCollapsed && effectiveLayout === "right";

    // Single, calm title — guidance for empty / partially-filled
    // devices belongs in the content pane (the cards / step prompts),
    // not the editor's chrome.
    const title = this._localize("device.editor_title_ready", {
      name: this.deviceTitle,
    });

    return html`
      <section class="card">
        <header class="card-header ${compactHeader ? "card-header--compact" : ""}">
          <slot name="header-start"></slot>
          <div class="editor-header-main">
            <h2 class="editor-header-title">${title}</h2>
          </div>
          <div class="header-actions">
            ${effectiveLayout !== "left"
              ? (() => {
                  const sensitiveLabel = this._localize(
                    this._revealSensitive
                      ? "device.yaml_mask_sensitive"
                      : "device.yaml_reveal_sensitive",
                  );
                  return html`<button
                    type="button"
                    class="diff-toggle"
                    aria-pressed=${this._revealSensitive}
                    aria-label=${sensitiveLabel}
                    @click=${this._toggleRevealSensitive}
                    title=${sensitiveLabel}
                  >
                    <wa-icon
                      library="mdi"
                      name=${this._revealSensitive ? "eye-off" : "eye"}
                    ></wa-icon>
                  </button>`;
                })()
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
                @click=${() => this._setLayout("left")}
                title=${this._localize("device.layout_components_only")}
              >
                <wa-icon library="mdi" name="layout-left"></wa-icon>
              </button>
              <button
                class="split-btn"
                type="button"
                aria-pressed=${effectiveLayout === "both"}
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
          <div class="editor-floating-actions">
            ${this.hasUpdateAvailable
              ? html`<button
                  type="button"
                  class="install-fab"
                  ?disabled=${this.busy}
                  @click=${this._onUpdate}
                  title=${this._localize("dashboard.update")}
                >
                  <wa-icon library="mdi" name="upload"></wa-icon>
                  ${this._localize("dashboard.update")}
                </button>`
              : this.hasPendingChanges
                ? html`<button
                    type="button"
                    class="install-fab"
                    ?disabled=${this.busy}
                    @click=${this._onInstall}
                    title=${this._localize("dashboard.install")}
                  >
                    <wa-icon library="mdi" name="upload"></wa-icon>
                    ${this._localize("dashboard.install")}
                  </button>`
                : nothing}
            <!-- Span wrapper carries the title because a disabled
                 button isn't focusable and most browsers won't
                 surface its tooltip on hover. The disabled state
                 is still announced via the button's own disabled
                 attribute; the span just makes the why-disabled
                 hint reachable for mouse users. -->
            <span
              class="validate-button-wrap"
              title=${this.hasUnsavedEdits
                ? this._localize("device.validate_disabled_pending")
                : this._localize("device.validate_yaml")}
            >
              <button
                type="button"
                class="validate-button"
                ?disabled=${this.hasUnsavedEdits}
                @click=${this._onValidate}
              >
                <wa-icon library="mdi" name="check-circle-outline"></wa-icon>
                ${this._localize("device.validate")}
              </button>
            </span>
            <button
              type="button"
              class="save-button"
              ?disabled=${!this.hasUnsavedEdits}
              @click=${this._onSave}
              title=${this._localize("device.save_yaml")}
            >
              <wa-icon library="mdi" name="content-save"></wa-icon>
              ${this._localize("device.save")}
            </button>
          </div>
          <div class=${`editor-layout ${layoutClass}`}>
            <div class="editor-pane editor-pane--left">
              <esphome-device-board-info
                .board=${this.board}
                .yaml=${this.yaml}
                .configuration=${this.configuration}
                .selectedSection=${this.selectedSection}
                .selectedFromLine=${this.selectedFromLine}
                .justCreated=${this.justCreated}
                ?yamlPaneVisible=${effectiveLayout !== "left"}
                @show-yaml-editor=${this._onShowYamlEditor}
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
                      .configuration=${this.configuration}
                      .highlightRange=${this.highlightRange}
                      .scrollToHighlight=${this.scrollToHighlight}
                      .revealSensitive=${this._revealSensitive}
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

  private _onValidate() {
    this.dispatchEvent(
      new CustomEvent("validate-device", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _toggleDiff() {
    this._showDiff = !this._showDiff;
  }

  private _toggleRevealSensitive() {
    this._revealSensitive = !this._revealSensitive;
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

  /**
   * Called when a "Show YAML editor" CTA bubbles up from the section
   * editor (e.g. for substitutions/globals). Switches the layout to
   * the split view so both panes are visible — keeps the section
   * editor in context while exposing the YAML pane the user needs.
   */
  private _onShowYamlEditor(e: Event) {
    e.stopPropagation();
    this._setLayout("both");
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
