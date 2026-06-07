import { consume } from "@lit/context";
import {
  mdiContentSave,
  mdiDockLeft,
  mdiDockRight,
  mdiEye,
  mdiEyeOff,
  mdiViewSplitHorizontal,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import { apiErrorDetails } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeUnsavedChangesDialog } from "../components/unsaved-changes-dialog.js";
import { apiContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { withBase } from "../util/base-path.js";
import { setLeaveGuard } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { UnsavedGuard } from "../util/unsaved-guard.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../components/secrets/secrets-structured-editor.js";
import "../components/unsaved-changes-dialog.js";
import "../components/yaml-editor.js";

registerMdiIcons({
  "content-save": mdiContentSave,
  "dock-left": mdiDockLeft,
  "dock-right": mdiDockRight,
  eye: mdiEye,
  "eye-off": mdiEyeOff,
  "view-split": mdiViewSplitHorizontal,
});

const SECRETS_FILE = "secrets.yaml";

type SecretsLayout = "form" | "split" | "yaml";

const LAYOUT_STORAGE_KEY = "esphome-secrets-layout";
const LAYOUTS: readonly SecretsLayout[] = ["form", "split", "yaml"];

@customElement("esphome-page-secrets")
export class ESPHomePageSecrets extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _yaml = "";

  @state()
  private _savedYaml = "";

  @state()
  private _saving = false;

  @state()
  private _loaded = false;

  // Mirrors the device editor's per-field reveal toggle. Default
  // hidden so values render as bullets the moment the page paints —
  // anyone glancing at the screen sees masks, not the raw secrets.
  @state()
  private _revealSensitive = false;

  // Persisted form | split | yaml choice; defaults to the structured
  // form on first visit since raw YAML is beyond many users.
  @state()
  private _layout: SecretsLayout = "form";

  // True below the 900px breakpoint where the split pane collapses to a
  // single column; drives the effective layout so the toggle's pressed
  // state matches what's shown when the split button is hidden.
  @state()
  private _narrow = false;

  private _narrowMq: MediaQueryList | null = null;

  @query("esphome-unsaved-changes-dialog")
  private _unsavedDialog?: ESPHomeUnsavedChangesDialog;

  private _unsavedGuard = new UnsavedGuard();

  // Set true once the leave guard has cleared a navigation, so the
  // synthetic popstate it triggers isn't re-intercepted.
  private _allowingLeave = false;

  async connectedCallback() {
    super.connectedCallback();
    this._layout = this._readStoredLayout();
    if (typeof window.matchMedia === "function") {
      this._narrowMq = window.matchMedia("(max-width: 900px)");
      this._narrow = this._narrowMq.matches;
      this._narrowMq.addEventListener("change", this._onNarrowChange);
    }
    setLeaveGuard(this._confirmLeave);
    window.addEventListener("beforeunload", this._onBeforeUnload);
    window.addEventListener("popstate", this._onPopState, { capture: true });
    window.addEventListener(
      "secrets-saved",
      this._onExternalSecretsSaved as EventListener
    );
    await this._loadFromServer();
  }

  private _readStoredLayout(): SecretsLayout {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return LAYOUTS.includes(stored as SecretsLayout) ? (stored as SecretsLayout) : "form";
  }

  private _setLayout(layout: SecretsLayout) {
    this._layout = layout;
    localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
  }

  private _onNarrowChange = (e: MediaQueryListEvent) => {
    this._narrow = e.matches;
  };

  // Below the breakpoint the split pane collapses to the form, so the
  // hidden split choice presents as the form for both layout and ARIA.
  private get _effectiveLayout(): SecretsLayout {
    return this._narrow && this._layout === "split" ? "form" : this._layout;
  }

  disconnectedCallback() {
    this._narrowMq?.removeEventListener("change", this._onNarrowChange);
    setLeaveGuard(null);
    window.removeEventListener("beforeunload", this._onBeforeUnload);
    window.removeEventListener("popstate", this._onPopState, { capture: true });
    this._unsavedGuard.cancelPending();
    window.removeEventListener(
      "secrets-saved",
      this._onExternalSecretsSaved as EventListener
    );
    super.disconnectedCallback();
  }

  private get _isDirty(): boolean {
    return this._yaml !== this._savedYaml;
  }

  // In-app navigation (nav links, header back arrow, command palette) runs
  // this through ``runLeaveGuard``; prompt to save / discard when dirty.
  private _confirmLeave = async (): Promise<boolean> => {
    const ok = await this._unsavedGuard.run({
      dirty: this._isDirty,
      open: () => this._unsavedDialog?.open(),
      save: async () => {
        const saved = await this._save();
        if (saved) this._allowingLeave = true;
        return saved;
      },
    });
    if (ok) this._allowingLeave = true;
    return ok;
  };

  // Native tab / window close: a dirty buffer triggers the browser's own
  // "leave site?" prompt (custom dialogs can't run here).
  private _onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this._isDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  };

  // The browser back/forward buttons fire popstate straight at the router,
  // bypassing ``navigate``; re-assert our URL and run the guard, then replay
  // the back once the user has decided.
  private _onPopState = (e: PopStateEvent) => {
    if (this._allowingLeave) {
      this._allowingLeave = false;
      return;
    }
    if (!this._isDirty) return;
    e.stopImmediatePropagation();
    window.history.pushState({}, "", withBase("/secrets"));
    void this._confirmLeave().then((canLeave) => {
      if (canLeave) {
        this._allowingLeave = true;
        window.history.back();
      }
    });
  };

  private _onUnsavedDiscard = () => this._unsavedGuard.onDiscard();
  private _onUnsavedSave = () => this._unsavedGuard.onSave();
  private _onUnsavedCancel = () => this._unsavedGuard.onCancel();

  /** Pull `secrets.yaml` from the server and reset both buffers.
   *  On read error (file missing) seeds the editor with the
   *  localized header so the user has a starting point. */
  private async _loadFromServer() {
    try {
      const yaml = await this._api.getConfig(SECRETS_FILE);
      this._yaml = yaml;
      this._savedYaml = yaml;
    } catch {
      const yaml = this._localize("secrets.file_header");
      this._yaml = yaml;
      this._savedYaml = yaml;
    }
    this._loaded = true;
  }

  /** Another component (typically the onboarding wizard) just
   *  wrote `secrets.yaml`. Reload from the server so the editor
   *  doesn't show stale content. Skip when this page initiated
   *  the save (no work to do — buffers already reflect the new
   *  content) and when the user has unsaved edits in the editor
   *  (silently overwriting their typing would lose work; they'll
   *  see the disk's view next time they reload the page or save). */
  private _onExternalSecretsSaved = (e: CustomEvent<{ source: EventTarget }>) => {
    if (e.detail?.source === this) return;
    if (this._yaml !== this._savedYaml) return;
    void this._loadFromServer();
  };

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: calc(100vh - var(--esphome-header-height) - var(--esphome-footer-height));
        box-sizing: border-box;
      }

      .page {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: var(--wa-space-l) var(--content-gutter);
        gap: var(--wa-space-m);
        overflow: hidden;
      }

      .page-header {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        flex-shrink: 0;
      }

      .page-title {
        flex: 1;
      }

      .page-title h1 {
        margin: 0 0 2px;
        font-size: var(--wa-font-size-l);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .page-title p {
        margin: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }

      .editor-card {
        flex: 1;
        position: relative;
        background: var(--wa-color-surface-default);
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        box-shadow: var(--wa-elevation-02);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .save-button {
        position: absolute;
        bottom: var(--wa-space-m);
        right: var(--wa-space-m);
        z-index: 10;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: none;
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        padding: 8px 16px;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        box-shadow: var(--esphome-primary-shadow);
        transition:
          background 0.12s,
          box-shadow 0.12s,
          transform 0.12s;
      }

      .save-button:hover:not(:disabled) {
        background: var(--esphome-primary-hover);
        box-shadow: var(--esphome-primary-shadow-hover);
        transform: translateY(-1px);
      }

      .save-button:active:not(:disabled) {
        transform: translateY(0);
      }

      .save-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        box-shadow: none;
      }

      .save-button wa-icon {
        font-size: 16px;
      }

      .reveal-toggle {
        border: var(--wa-border-width-s) solid var(--esphome-primary);
        background: var(--esphome-tint);
        color: var(--esphome-primary);
        padding: 6px 12px;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        transition: background 0.12s;
      }

      .reveal-toggle:hover {
        background: var(--esphome-tint-strong);
      }

      .reveal-toggle wa-icon {
        font-size: 16px;
      }

      .layout-toggle {
        display: inline-flex;
        align-items: center;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        overflow: hidden;
        flex-shrink: 0;
      }

      .layout-toggle button {
        border: none;
        background: transparent;
        color: var(--wa-color-text-quiet);
        padding: 6px 10px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .layout-toggle button + button {
        border-left: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .layout-toggle button[aria-pressed="true"] {
        background: var(--esphome-tint);
        color: var(--esphome-primary);
      }

      .layout-toggle wa-icon {
        font-size: 18px;
      }

      .editor-layout {
        flex: 1;
        min-height: 0;
        display: grid;
        gap: 0;
      }

      .editor-layout--split {
        grid-template-columns: 1fr 1px 1fr;
      }

      .editor-layout--form,
      .editor-layout--yaml {
        grid-template-columns: 1fr;
      }

      .editor-pane {
        min-height: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .editor-pane > * {
        flex: 1;
        min-height: 0;
      }

      /* The structured editor is its own scroll container (and owns the
         Save-button clearance padding), so the pane just frames it. */
      .editor-pane--form {
        padding: var(--wa-space-m);
      }

      .editor-layout--yaml .editor-pane--form,
      .editor-layout--form .editor-pane--yaml {
        display: none;
      }

      .pane-divider {
        background: var(--wa-color-surface-border);
        width: 1px;
        align-self: stretch;
      }

      /* Below the breakpoint the split button is hidden; the collapse of
         the split layout itself is driven by the effective-layout getter
         in JS (matching the device editor), so no layout rules are
         duplicated here. */
      @media (max-width: 900px) {
        .page {
          padding-block: var(--wa-space-s);
        }
        .page-header {
          flex-wrap: wrap;
        }
        .page-title {
          flex-basis: 100%;
        }
        .layout-toggle .split-btn {
          display: none;
        }
      }

      .loading {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        color: var(--wa-color-text-quiet);
      }
    `,
  ];

  protected render() {
    const revealLabel = this._localize(
      this._revealSensitive ? "secrets.hide_values" : "secrets.reveal_values"
    );
    return html`
      <div class="page">
        <div class="page-header">
          <div class="page-title">
            <h1>${this._localize("secrets.title")}</h1>
            <p>${this._localize("secrets.desc")}</p>
          </div>
          <div
            class="layout-toggle"
            role="group"
            aria-label=${this._localize("secrets.layout_label")}
          >
            <button
              type="button"
              aria-pressed=${this._effectiveLayout === "form"}
              aria-label=${this._localize("secrets.layout_form")}
              title=${this._localize("secrets.layout_form")}
              @click=${() => this._setLayout("form")}
            >
              <wa-icon library="mdi" name="dock-left"></wa-icon>
            </button>
            <button
              type="button"
              class="split-btn"
              aria-pressed=${this._effectiveLayout === "split"}
              aria-label=${this._localize("secrets.layout_split")}
              title=${this._localize("secrets.layout_split")}
              @click=${() => this._setLayout("split")}
            >
              <wa-icon library="mdi" name="view-split"></wa-icon>
            </button>
            <button
              type="button"
              aria-pressed=${this._effectiveLayout === "yaml"}
              aria-label=${this._localize("secrets.layout_yaml")}
              title=${this._localize("secrets.layout_yaml")}
              @click=${() => this._setLayout("yaml")}
            >
              <wa-icon library="mdi" name="dock-right"></wa-icon>
            </button>
          </div>
          <button
            type="button"
            class="reveal-toggle"
            aria-pressed=${this._revealSensitive}
            @click=${this._toggleRevealSensitive}
          >
            <wa-icon
              library="mdi"
              name=${this._revealSensitive ? "eye-off" : "eye"}
            ></wa-icon>
            ${revealLabel}
          </button>
        </div>
        <div class="editor-card">
          ${this._loaded
            ? html`
                <button
                  type="button"
                  class="save-button"
                  ?disabled=${this._saving ||
                  this._yaml === this._savedYaml ||
                  this._yaml.trim() === ""}
                  @click=${this._save}
                >
                  <wa-icon library="mdi" name="content-save"></wa-icon>
                  ${this._saving
                    ? this._localize("secrets.saving")
                    : this._localize("secrets.save")}
                </button>
                <div class=${`editor-layout editor-layout--${this._effectiveLayout}`}>
                  <div class="editor-pane editor-pane--form">
                    <esphome-secrets-structured-editor
                      .value=${this._yaml}
                      .revealSensitive=${this._revealSensitive}
                      @yaml-change=${this._onYamlChange}
                    ></esphome-secrets-structured-editor>
                  </div>
                  ${this._effectiveLayout === "split"
                    ? html`<div class="pane-divider"></div>`
                    : nothing}
                  <div class="editor-pane editor-pane--yaml">
                    <esphome-yaml-editor
                      .value=${this._yaml}
                      .maskAllValues=${true}
                      .revealSensitive=${this._revealSensitive}
                      @yaml-change=${this._onYamlChange}
                    ></esphome-yaml-editor>
                  </div>
                </div>
              `
            : html`<div class="loading"><wa-spinner></wa-spinner></div>`}
        </div>
      </div>
      <esphome-unsaved-changes-dialog
        heading=${this._localize("secrets.unsaved_title")}
        message=${this._localize("secrets.unsaved_message")}
        @discard=${this._onUnsavedDiscard}
        @save=${this._onUnsavedSave}
        @cancel=${this._onUnsavedCancel}
      ></esphome-unsaved-changes-dialog>
    `;
  }

  private _toggleRevealSensitive() {
    this._revealSensitive = !this._revealSensitive;
  }

  // Both panes are views over the same buffer, so either editor's
  // change advances ``_yaml`` and the other pane re-renders from it.
  private _onYamlChange = (e: CustomEvent<{ value: string }>) => {
    this._yaml = e.detail.value;
  };

  // Returns whether the save succeeded (timeout counts as success), so the
  // leave guard can decide whether navigation may proceed.
  private async _save(): Promise<boolean> {
    // Optimistic update: dirty-state UI flips back to "saved"
    // immediately so the Save button disables. Snapshot the
    // previous saved buffer first so a real (non-timeout)
    // failure can revert and let the user retry.
    const previousSaved = this._savedYaml;
    this._savedYaml = this._yaml;
    // ``_saving`` holds the "Saving…" label and disabled state
    // until the API call returns, so a rapid second click can't
    // queue a duplicate write.
    this._saving = true;
    // Toast only after the round-trip resolves. Toasting success
    // optimistically would flash "Secrets saved" then "Failed to
    // save secrets" on a real backend rejection — the misleading
    // sequence the device editor fixed under issue #436.
    let saved = true;
    // Backend rejection detail (e.g. the secrets.yaml parse error with
    // line/column) so the failure toast can name what's wrong. Read the
    // structured APIError.details, not Error.message, which is prefixed
    // with the internal error_code.
    let errorDetail = "";
    try {
      await this._api.updateConfig(SECRETS_FILE, this._yaml);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // A timeout likely still wrote the file, so keep the
      // optimistic buffer and treat it as success. Any other error
      // is real: restore the previous buffer so the dirty state
      // returns and the user can retry.
      if (!msg.includes("timed out")) {
        saved = false;
        this._savedYaml = previousSaved;
        errorDetail = apiErrorDetails(e);
      }
    } finally {
      this._saving = false;
    }
    if (saved) {
      // Window-level so other mounted components (app-shell's
      // onboarding-state refresh, peer secrets-page instances) can
      // react wherever they live in the tree. ``detail.source``
      // lets self-listeners short-circuit. The timeout-as-success
      // path notifies too, matching the success toast.
      window.dispatchEvent(
        new CustomEvent("secrets-saved", { detail: { source: this } })
      );
    }
    if (saved) {
      toast.success(this._localize("secrets.saved"), { richColors: true });
      return true;
    }
    const base = this._localize("secrets.save_error");
    toast.error(errorDetail ? `${base}: ${errorDetail}` : base, {
      richColors: true,
    });
    return false;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-secrets": ESPHomePageSecrets;
  }
}
