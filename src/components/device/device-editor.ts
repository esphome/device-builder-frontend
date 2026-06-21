import { consume } from "@lit/context";
import {
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiContentSave,
  mdiDockLeft,
  mdiDockRight,
  mdiEye,
  mdiEyeOff,
  mdiFileCompare,
  mdiUpload,
  mdiViewSplitVertical,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { expertModeContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { SaveShortcutController } from "../../util/save-shortcut-controller.js";
import {
  clampSplitRatio,
  loadSplitRatio,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  nextSplitRatioForKey,
  saveSplitRatio,
} from "../../util/split-ratio.js";
import type { HighlightRange } from "../yaml-editor.js";
import { renderEditorToolbar } from "./device-editor-toolbar.js";
import { deviceEditorStyles } from "./device-editor.styles.js";
import { renderInstallAction } from "./install-action.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../yaml-diff.js";
import "../yaml-editor.js";
import "./device-board-info.js";

registerMdiIcons({
  "alert-circle-outline": mdiAlertCircleOutline,
  "check-circle-outline": mdiCheckCircleOutline,
  "chevron-down": mdiChevronDown,
  "content-save": mdiContentSave,
  eye: mdiEye,
  "eye-off": mdiEyeOff,
  "dock-left": mdiDockLeft,
  "dock-right": mdiDockRight,
  "view-split-vertical": mdiViewSplitVertical,
  upload: mdiUpload,
  "file-compare": mdiFileCompare,
});

export type DeviceLayoutMode = "both" | "left" | "right";

/** Cap the errors listed in the invalid banner; the rest collapse to "+N more". */
const MAX_BANNER_ERRORS = 6;

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

  // Cmd/Ctrl+S → save the YAML if there are unsaved changes.
  private _saveShortcut = new SaveShortcutController(this, () => {
    if (this.hasUnsavedEdits) {
      this._onSave();
    }
  });

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

  /** Instance-relative field path to scroll into view, from the YAML cursor. */
  @property({ attribute: false })
  focusFieldPath?: string[];

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

  @consume({ context: expertModeContext, subscribe: true })
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

  /** Live lint error messages from the editor's backend linter. Drives the
   *  "configuration invalid" banner above the editor. */
  @state()
  private _liveErrors: string[] = [];

  @state()
  private _splitRatio = loadSplitRatio();

  @state()
  private _dragging = false;

  @query(".editor-layout")
  private _layoutEl?: HTMLElement;

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
            <div class="editor-header-titlerow">
              <h2 class="editor-header-title">${title}</h2>
              ${this.configuration && !compactHeader
                ? html`<span class="editor-header-file">${this.configuration}</span>`
                : nothing}
            </div>
          </div>
          ${renderEditorToolbar({
            localize: this._localize,
            effectiveLayout,
            revealSensitive: this._revealSensitive,
            showDiffButton: this._showDiffButton,
            showDiff: this._showDiff,
            yaml: this.yaml,
            savedYaml: this.savedYaml,
            onToggleRevealSensitive: () => this._toggleRevealSensitive(),
            onToggleDiff: () => this._toggleDiff(),
            onSetLayout: (layout) => this._setLayout(layout),
          })}
        </header>
        <div class="card-body">
          <div class="editor-floating-actions">
            ${this._renderPrimaryAction()}
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
          <div
            class="editor-layout ${layoutClass} ${this._dragging ? "dragging" : ""}"
            style=${effectiveLayout === "both"
              ? `grid-template-columns: ${this._splitRatio}fr var(--pane-divider-width) ${1 - this._splitRatio}fr`
              : ""}
          >
            <div class="editor-pane editor-pane--left">
              <esphome-device-board-info
                .board=${this.board}
                .yaml=${this.yaml}
                .configuration=${this.configuration}
                .selectedSection=${this.selectedSection}
                .selectedFromLine=${this.selectedFromLine}
                .focusFieldPath=${this.focusFieldPath}
                .justCreated=${this.justCreated}
                ?yamlPaneVisible=${effectiveLayout !== "left"}
                @show-yaml-editor=${this._onShowYamlEditor}
              ></esphome-device-board-info>
            </div>
            ${effectiveLayout === "both"
              ? html`<div
                  class="pane-divider ${this._dragging ? "dragging" : ""}"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label=${this._localize("device.resize_panes")}
                  aria-valuemin=${Math.round(MIN_SPLIT_RATIO * 100)}
                  aria-valuemax=${Math.round(MAX_SPLIT_RATIO * 100)}
                  aria-valuenow=${Math.round(this._splitRatio * 100)}
                  aria-valuetext=${this._localize("device.resize_panes_value", {
                    percent: Math.round(this._splitRatio * 100),
                  })}
                  tabindex="0"
                  @pointerdown=${this._onDividerPointerDown}
                  @keydown=${this._onDividerKeydown}
                ></div>`
              : nothing}
            <div class="editor-pane editor-pane--right">
              ${!this._showDiff && this._liveErrors.length > 0
                ? html`<div class="invalid-banner" role="alert">
                    <wa-icon
                      library="mdi"
                      name="alert-circle-outline"
                      class="invalid-banner-icon"
                    ></wa-icon>
                    <div class="invalid-banner-text">
                      ${this._liveErrors
                        .slice(0, MAX_BANNER_ERRORS)
                        .map(
                          (msg) => html`<span class="invalid-banner-error">${msg}</span>`
                        )}
                      ${this._liveErrors.length > MAX_BANNER_ERRORS
                        ? html`<span class="invalid-banner-more"
                            >${this._localize("device.editor_invalid_more", {
                              count: this._liveErrors.length - MAX_BANNER_ERRORS,
                            })}</span
                          >`
                        : nothing}
                    </div>
                  </div>`
                : nothing}
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
                      @yaml-diagnostics=${this._onYamlDiagnostics}
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

  private _renderPrimaryAction() {
    return renderInstallAction({
      localize: this._localize,
      hasUpdateAvailable: this.hasUpdateAvailable,
      hasPendingChanges: this.hasPendingChanges,
      busy: this.busy,
      onUpdate: () => this._onUpdate(),
      onInstall: () => this._onInstall(),
    });
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

  willUpdate(changed: Map<string, unknown>) {
    // Switching device clears the banner until the new file re-lints, so a
    // stale "invalid" never flashes over a freshly-opened valid config.
    if (changed.has("configuration") && this._liveErrors.length) {
      this._liveErrors = [];
    }
    if (this._showDiff && changed.has("_showDiffButton") && !this._showDiffButton) {
      this._showDiff = false;
      return;
    }
    if (this._showDiff && changed.has("savedYaml") && this.yaml === this.savedYaml) {
      this._showDiff = false;
    }
  }

  private _onYamlDiagnostics(
    e: CustomEvent<{ errors: string[]; configuration: string }>
  ) {
    // Ignore a late lint result for a since-switched device, so a stale
    // "invalid" banner can't flash over the freshly-opened config.
    if (e.detail.configuration !== this.configuration) return;
    const next = e.detail.errors;
    // The banner is an `aria-live` region — only reassign when the list
    // actually changed so an unchanged lint pass doesn't re-announce it.
    if (
      next.length === this._liveErrors.length &&
      next.every((msg, i) => msg === this._liveErrors[i])
    ) {
      return;
    }
    this._liveErrors = next;
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

  private _onDividerPointerDown = (e: PointerEvent) => {
    // Primary button only; let right/middle click through (context menu).
    if (e.button !== 0) return;
    const layout = this._layoutEl;
    if (!layout) return;
    e.preventDefault();
    const rect = layout.getBoundingClientRect();
    this._dragging = true;

    // Pointer capture keeps move/up/cancel on the divider (no global
    // listener leak) and auto-releases on up/cancel.
    const divider = e.currentTarget as HTMLElement;
    divider.setPointerCapture(e.pointerId);

    // The fr tracks split the width left after the fixed divider column,
    // so normalize against that (minus half the divider) for the bar to
    // track the cursor instead of drifting a couple px.
    const dividerPx = divider.getBoundingClientRect().width;
    const usable = rect.width - dividerPx;

    const onMove = (ev: PointerEvent) => {
      if (usable <= 0) return;
      this._splitRatio = clampSplitRatio(
        (ev.clientX - rect.left - dividerPx / 2) / usable
      );
    };
    // lostpointercapture covers up/cancel plus OS/browser interrupts
    // that release capture without firing either.
    const onEnd = () => {
      this._dragging = false;
      saveSplitRatio(this._splitRatio);
      divider.removeEventListener("pointermove", onMove);
      divider.removeEventListener("pointerup", onEnd);
      divider.removeEventListener("pointercancel", onEnd);
      divider.removeEventListener("lostpointercapture", onEnd);
    };
    divider.addEventListener("pointermove", onMove);
    divider.addEventListener("pointerup", onEnd);
    divider.addEventListener("pointercancel", onEnd);
    divider.addEventListener("lostpointercapture", onEnd);
  };

  private _onDividerKeydown = (e: KeyboardEvent) => {
    const next = nextSplitRatioForKey(this._splitRatio, e.key);
    if (next === null) return;
    e.preventDefault();
    this._splitRatio = next;
    saveSplitRatio(this._splitRatio);
  };

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
