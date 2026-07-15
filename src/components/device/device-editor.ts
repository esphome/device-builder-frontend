import { consume } from "@lit/context";
import {
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
import {
  NO_INSTANCE_ERRORS,
  type InstanceBackendErrors,
} from "../../util/backend-field-errors.js";
import { effectiveDeviceLayout } from "../../util/editor-layout.js";
import { notifyError, notifyWarning } from "../../util/notify.js";
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
import type { BannerError, YamlDiagnosticsDetail } from "../../util/yaml-lint-backend.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import {
  TOUR_REVEAL_EVENT,
  tourAnchor,
  type TourRevealEventDetail,
} from "../guided-tour/tour-anchor.js";
import { TOUR_LAYOUT_CHANGE_EVENT } from "../guided-tour/tour-layout-controller.js";
import type { ESPHomeYamlEditor, HighlightRange } from "../yaml-editor.js";
import { renderEditorToolbar } from "./device-editor-toolbar.js";
import { deviceEditorStyles } from "./device-editor.styles.js";
import type {
  BannerAutoFixDetail,
  BannerGotoLineDetail,
} from "./editor-invalid-banner.js";
import { renderInstallAction } from "./install-action.js";
import { layoutRevealingAnchor } from "./tour-reveal-layout.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../confirm-dialog.js";
import "../yaml-diff.js";
import "../yaml-editor.js";
import "./device-actions-menu.js";
import "./device-board-info.js";
import "./editor-invalid-banner.js";

registerMdiIcons({
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

  /** Prebuilt device web-UI URL; empty hides the actions-menu item. */
  @property({ attribute: false })
  webUiUrl = "";

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
    window.addEventListener(TOUR_REVEAL_EVENT, this._onTourReveal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._mql.removeEventListener("change", this._onMqlChange);
    window.removeEventListener(TOUR_REVEAL_EVENT, this._onTourReveal);
  }

  private _onTourReveal = (event: Event): void => {
    const { id } = (event as CustomEvent<TourRevealEventDetail>).detail;
    const next = layoutRevealingAnchor(id, this.layout, this._isMobile);
    if (next) {
      this.dispatchEvent(
        new CustomEvent(TOUR_LAYOUT_CHANGE_EVENT, {
          detail: next,
          bubbles: true,
          composed: true,
        })
      );
    }
  };

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

  /** Indexed key path at the cursor, for automation deep-targeting. */
  @property({ attribute: false })
  focusYamlPath?: (string | number)[];

  /** The selected section's backend errors; forwarded to the section editor. */
  @property({ attribute: false })
  backendErrors: InstanceBackendErrors = NO_INSTANCE_ERRORS;

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

  /** A save round-trip (validate + write) is in flight; the Save
   *  button shows a spinner and stays disabled until it settles. */
  @property({ type: Boolean })
  saving = false;

  @property({ type: Boolean })
  showModified = false;

  @property({ type: Boolean })
  showUpdate = false;

  // Installed + target ESPHome versions for the Update button hover.
  @property()
  installedVersion = "";

  @property()
  availableVersion = "";

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
   *  "configuration invalid" banner below the editor. */
  @state()
  private _liveErrors: BannerError[] = [];

  /** Caret's 1-indexed line from the yaml-cursor-line event; feeds the banner's
   *  near-caret reveal suppression. */
  @state()
  private _caretLine = 0;

  @state()
  private _editorFocused = false;

  /** The editor's completion popup is showing; holds the banner reveal. */
  @state()
  private _completionOpen = false;

  /** performance.now() of the last YAML edit; read by the banner through
   *  the stable accessor below so keystrokes don't re-render this host.
   *  Starts (and resets, on device switch) to -Infinity — "never typed",
   *  so a pre-existing error is never deferred by the idle backstop. */
  private _lastEditAt = Number.NEGATIVE_INFINITY;

  private _getLastEditAt = () => this._lastEditAt;

  @state()
  private _splitRatio = loadSplitRatio();

  @state()
  private _dragging = false;

  @query(".editor-layout")
  private _layoutEl?: HTMLElement;

  @query("esphome-yaml-editor")
  private _yamlEditor?: ESPHomeYamlEditor;

  @query("esphome-confirm-dialog.auto-fix-confirm")
  private _autoFixConfirmDialog?: ESPHomeConfirmDialog;

  static styles = [espHomeStyles, deviceEditorStyles];

  protected render() {
    // On mobile we collapse the split view down to a single pane to
    // keep things readable; otherwise honour whatever layout the user
    // last chose. We deliberately do NOT force "right" when there's
    // no board — a missing board catalog entry shouldn't make the
    // navigator + section editor disappear.
    const effectiveLayout = effectiveDeviceLayout(this.layout, this._isMobile);
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
              ${
                this.configuration && !compactHeader
                  ? html`<span class="editor-header-file">${this.configuration}</span>`
                  : nothing
              }
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
            <!-- Leftmost so it stays clear of Save in the lower-right corner:
                 a mis-tap on Save must not land on the overflow menu.
                 Carries Validate too (Install validates anyway, so the
                 explicit button rarely earned its slot on the bar). -->
            <esphome-device-actions-menu
              ?busy=${this.busy}
              ?validate-disabled=${this.hasUnsavedEdits}
              .webUiUrl=${this.webUiUrl}
              @validate=${this._onValidate}
            ></esphome-device-actions-menu>
            ${this._renderPrimaryAction()}
            <button
              type="button"
              class="save-button"
              ?disabled=${!this.hasUnsavedEdits || this.saving}
              aria-busy=${this.saving}
              @click=${this._onSave}
              title=${this._localize("device.save_yaml")}
            >
              ${
                this.saving
                  ? html`<wa-spinner></wa-spinner>`
                  : html`<wa-icon library="mdi" name="content-save"></wa-icon>`
              }
              ${this._localize("device.save")}
            </button>
          </div>
          <div
            class="editor-layout ${layoutClass} ${this._dragging ? "dragging" : ""}"
            style=${
              effectiveLayout === "both"
                ? `grid-template-columns: ${this._splitRatio}fr var(--pane-divider-width) ${1 - this._splitRatio}fr`
                : ""
            }
          >
            <div class="editor-pane editor-pane--left" ${tourAnchor("central")}>
              <esphome-device-board-info
                .board=${this.board}
                .yaml=${this.yaml}
                .configuration=${this.configuration}
                .selectedSection=${this.selectedSection}
                .selectedFromLine=${this.selectedFromLine}
                .focusFieldPath=${this.focusFieldPath}
                .focusYamlPath=${this.focusYamlPath}
                .backendErrors=${this.backendErrors}
                .justCreated=${this.justCreated}
                .yamlPaneVisible=${effectiveLayout !== "left"}
                @show-yaml-editor=${this._onShowYamlEditor}
              ></esphome-device-board-info>
            </div>
            ${
              effectiveLayout === "both"
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
                : nothing
            }
            <div class="editor-pane editor-pane--right" ${tourAnchor("yaml")}>
              <div class="editor-pane-body">
                ${
                  this._showDiff
                    ? html`<esphome-yaml-diff
                        .oldValue=${this.savedYaml}
                        .newValue=${this.yaml}
                      ></esphome-yaml-diff>`
                    : html`<esphome-yaml-editor
                        .value=${this.yaml}
                        .configuration=${this.configuration}
                        .board=${this.board}
                        .highlightRange=${this.highlightRange}
                        .scrollToHighlight=${this.scrollToHighlight}
                        .revealSensitive=${this._revealSensitive}
                        @yaml-change=${this._onYamlChange}
                        @yaml-diagnostics=${this._onYamlDiagnostics}
                        @yaml-auto-fix=${this._onBannerAutoFix}
                        @yaml-cursor-line=${this._onYamlCursorLine}
                        @yaml-completion-open=${this._onYamlCompletionOpen}
                        @focusin=${this._onEditorFocusIn}
                        @focusout=${this._onEditorFocusOut}
                      ></esphome-yaml-editor>`
                }
              </div>
              ${
                !this._showDiff
                  ? html`<esphome-editor-invalid-banner
                      .errors=${this._liveErrors}
                      .caretLine=${this._caretLine}
                      .editorFocused=${this._editorFocused}
                      .completionOpen=${this._completionOpen}
                      .getLastEditAt=${this._getLastEditAt}
                      @banner-auto-fix=${this._onBannerAutoFix}
                      @banner-goto-line=${this._onBannerGotoLine}
                    ></esphome-editor-invalid-banner>`
                  : nothing
              }
            </div>
          </div>
        </div>
        ${
          this._autoFixConfirmOpen
            ? html`<esphome-confirm-dialog
                class="auto-fix-confirm"
                heading=${this._localize("yaml_editor.auto_fix_confirm_heading")}
                message=${this._localize("yaml_editor.auto_fix_confirm_message")}
                confirm-label=${this._localize("yaml_editor.auto_fix_confirm_apply")}
              ></esphome-confirm-dialog>`
            : nothing
        }
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
      showUpdate: this.showUpdate,
      showModified: this.showModified,
      busy: this.busy,
      installedVersion: this.installedVersion,
      availableVersion: this.availableVersion,
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
    if (changed.has("configuration")) {
      if (this._liveErrors.length) this._liveErrors = [];
      this._caretLine = 0;
      this._lastEditAt = Number.NEGATIVE_INFINITY;
      // The editor remounts on a device switch, silently dropping focus and
      // any open completion popup (a removed focused node fires no focusout,
      // and the popup's close never transitions on a fresh view) — clear
      // both so the new config's banner can't stay suppressed.
      this._editorFocused = false;
      this._completionOpen = false;
    }
    if (this._showDiff && changed.has("_showDiffButton") && !this._showDiffButton) {
      this._showDiff = false;
      return;
    }
    if (this._showDiff && changed.has("savedYaml") && this.yaml === this.savedYaml) {
      this._showDiff = false;
    }
  }

  private _onYamlDiagnostics(e: CustomEvent<YamlDiagnosticsDetail>) {
    // Ignore a late lint result for a since-switched device, so a stale
    // "invalid" banner can't flash over the freshly-opened config.
    if (e.detail.configuration !== this.configuration) return;
    const next = e.detail.errors;
    // The banner is an `aria-live` region — only reassign when the list
    // actually changed so an unchanged lint pass doesn't re-announce it.
    // Compare the fix too: its payload can change (or appear/disappear) while
    // a localized message stays the same, and it drives the auto-fix button.
    if (
      next.length === this._liveErrors.length &&
      next.every((err, i) => {
        const prev = this._liveErrors[i];
        return (
          err.message === prev.message &&
          err.line === prev.line &&
          err.kind === prev.kind &&
          err.fix?.line === prev.fix?.line &&
          err.fix?.indent === prev.fix?.indent &&
          err.fix?.key === prev.fix?.key
        );
      })
    ) {
      return;
    }
    this._liveErrors = next;
  }

  private _onYamlCursorLine(e: CustomEvent<{ line: number }>) {
    this._caretLine = e.detail.line;
  }

  private _onYamlCompletionOpen(e: CustomEvent<{ open: boolean }>) {
    this._completionOpen = e.detail.open;
  }

  private _onEditorFocusIn = () => {
    this._editorFocused = true;
  };

  /** CM-internal focus shifts (tooltips, completion) stay inside the
   *  editor's shadow tree, so their retargeted relatedTarget is the editor
   *  host itself — only a move outside it counts as leaving. */
  private _onEditorFocusOut = (e: FocusEvent) => {
    const editor = e.currentTarget as HTMLElement;
    this._editorFocused =
      e.relatedTarget instanceof Node && editor.contains(e.relatedTarget);
  };

  private _onBannerAutoFix(e: CustomEvent<BannerAutoFixDetail>) {
    this._autoFix(e.detail.fix);
  }

  private _onBannerGotoLine(e: CustomEvent<BannerGotoLineDetail>) {
    this._gotoErrorLine(e.detail.line);
  }

  /** Apply a banner error's one-click indentation repair in the editor. The
   *  editor validates the proposed edit first and calls back through
   *  ``_confirmAutoFix`` when the fix parses but other YAML errors remain. */
  private _autoFix(fix: NonNullable<BannerError["fix"]>) {
    const editor = this._yamlEditor;
    if (!editor) {
      // The button only renders under a mounted editor, so a missing ref is a
      // wiring bug, not a normal path — surface it rather than a dead click.
      console.error("[auto-fix] no editor ref");
      notifyError(this._localize("yaml_editor.auto_fix_failed"));
      return;
    }
    editor
      .applyAutoFix(fix, () => this._confirmAutoFix())
      .then((outcome) => {
        if (outcome === "stale") {
          // A stale click (the doc shifted since the banner) is a safe no-op,
          // but say so rather than letting the button look dead.
          notifyWarning(this._localize("yaml_editor.auto_fix_stale"));
        } else if (outcome === "unavailable") {
          // Defensive (no view/api); shouldn't happen, but don't stay silent.
          console.error("[auto-fix] editor unavailable");
          notifyError(this._localize("yaml_editor.auto_fix_failed"));
        }
      })
      .catch((err: unknown) => {
        // A validation round-trip failure (WS drop, server error), or the
        // confirm dialog failing to mount, must not leave the click ignored.
        console.error("[auto-fix] could not run:", err);
        notifyError(this._localize("yaml_editor.auto_fix_failed"));
      });
  }

  /** Mounts the confirm dialog only while a prompt is pending — its
   *  form-associated buttons are expensive to instantiate otherwise. */
  @state()
  private _autoFixConfirmOpen = false;

  /** Open the "errors remain" prompt and resolve with the user's choice. A
   *  second call while a prompt is already up declines rather than opening a
   *  competing dialog. */
  private async _confirmAutoFix(): Promise<boolean> {
    if (this._autoFixConfirmOpen) return false;
    this._autoFixConfirmOpen = true;
    await this.updateComplete;
    const dialog = this._autoFixConfirmDialog;
    if (!dialog) {
      this._autoFixConfirmOpen = false;
      // A missing dialog is a wiring/timing bug, not a user decision — throw so
      // the caller surfaces it instead of silently treating it as a decline.
      throw new Error("auto-fix confirm dialog failed to mount");
    }
    try {
      return await new Promise<boolean>((resolve) => {
        const settle = (apply: boolean) => {
          dialog.removeEventListener("confirm", onConfirm);
          dialog.removeEventListener("cancel", onCancel);
          resolve(apply);
        };
        const onConfirm = () => settle(true);
        const onCancel = () => settle(false);
        dialog.addEventListener("confirm", onConfirm);
        dialog.addEventListener("cancel", onCancel);
        dialog.open();
      });
    } finally {
      this._autoFixConfirmOpen = false;
    }
  }

  /** Ask the page to highlight and scroll to a banner error's line. */
  private _gotoErrorLine(line: number) {
    this.dispatchEvent(
      new CustomEvent("goto-line", {
        detail: { line },
        bubbles: true,
        composed: true,
      })
    );
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
    this._lastEditAt = performance.now();
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
