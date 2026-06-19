import { consume } from "@lit/context";
import { mdiContentSave, mdiDockLeft, mdiDockRight, mdiEye, mdiEyeOff } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import { apiErrorDetails } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeConfirmDialog } from "../components/confirm-dialog.js";
import type { ESPHomeUnsavedChangesDialog } from "../components/unsaved-changes-dialog.js";
import { apiContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { withBase } from "../util/base-path.js";
import {
  prefToSecretsLayout,
  secretsLayoutToPref,
  type SecretsLayout,
} from "../util/editor-layout.js";
import { setLeaveGuard } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { SaveShortcutController } from "../util/save-shortcut-controller.js";
import { parseSecretsEntries } from "../util/secrets-entries.js";
import { UnsavedGuard } from "../util/unsaved-guard.js";
import { secretsStyles } from "./secrets.styles.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../components/confirm-dialog.js";
import "../components/secrets/secrets-structured-editor.js";
import "../components/unsaved-changes-dialog.js";
import "../components/yaml-editor.js";

registerMdiIcons({
  "content-save": mdiContentSave,
  "dock-left": mdiDockLeft,
  "dock-right": mdiDockRight,
  eye: mdiEye,
  "eye-off": mdiEyeOff,
});

const SECRETS_FILE = "secrets.yaml";

const LAYOUT_STORAGE_KEY = "esphome-secrets-layout";
const LAYOUTS: readonly SecretsLayout[] = ["form", "yaml"];

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

  // Persisted form | yaml choice; defaults to the structured form on
  // first visit since raw YAML is beyond many users.
  @state()
  private _layout: SecretsLayout = "form";

  @query("esphome-unsaved-changes-dialog")
  private _unsavedDialog?: ESPHomeUnsavedChangesDialog;

  @query("esphome-confirm-dialog")
  private _wipeDialog?: ESPHomeConfirmDialog;

  private _unsavedGuard = new UnsavedGuard();

  // Cmd/Ctrl+S → save when there's something to save. Covers both the
  // structured and YAML views, which share the single _yaml buffer.
  private _saveShortcut = new SaveShortcutController(this, () => {
    if (this._isDirty && !this._saving && this._yaml.trim() !== "") {
      void this._save();
    }
  });

  // Set true once the leave guard has cleared a navigation, so the
  // synthetic popstate it triggers isn't re-intercepted.
  private _allowingLeave = false;

  // Resolver for an in-flight wipe confirm, settled (as cancelled) on
  // disconnect so the awaiting _save() can't hang if the page unmounts
  // while the dialog is open.
  private _settlePendingWipe: ((confirmed: boolean) => void) | null = null;

  async connectedCallback() {
    super.connectedCallback();
    const stored = this._readStoredLayout();
    if (stored) {
      this._layout = stored;
    } else {
      // No local choice (new browser): restore from the backend pref.
      void this._seedLayoutFromBackend();
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

  private _readStoredLayout(): SecretsLayout | null {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return LAYOUTS.includes(stored as SecretsLayout) ? (stored as SecretsLayout) : null;
  }

  private async _seedLayoutFromBackend() {
    try {
      const prefs = await this._api.getPreferences();
      // A toggle during the in-flight fetch writes localStorage; honor that
      // newer user choice instead of clobbering it with the stored seed.
      if (this._readStoredLayout() === null) {
        this._layout = prefToSecretsLayout(prefs.secrets_editor_layout);
      }
    } catch (err) {
      // Layout is not critical; keep the default form view on failure.
      console.warn("Failed to load secrets layout preference:", err);
    }
  }

  private _setLayout(layout: SecretsLayout) {
    this._layout = layout;
    localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
    this._api
      .updatePreferences({ secrets_editor_layout: secretsLayoutToPref(layout) })
      .catch((err) => console.warn("Failed to persist secrets layout preference:", err));
  }

  disconnectedCallback() {
    setLeaveGuard(null);
    window.removeEventListener("beforeunload", this._onBeforeUnload);
    window.removeEventListener("popstate", this._onPopState, { capture: true });
    this._unsavedGuard.cancelPending();
    // A wipe confirm open at unmount resolves as cancelled, never dangling.
    this._settlePendingWipe?.(false);
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

  static styles = [espHomeStyles, secretsStyles];

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
              aria-pressed=${this._layout === "form"}
              aria-label=${this._localize("secrets.layout_form")}
              title=${this._localize("secrets.layout_form")}
              @click=${() => this._setLayout("form")}
            >
              <wa-icon library="mdi" name="dock-left"></wa-icon>
            </button>
            <button
              type="button"
              aria-pressed=${this._layout === "yaml"}
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
                  ?disabled=${this._saving || this._yaml === this._savedYaml}
                  @click=${this._save}
                >
                  <wa-icon library="mdi" name="content-save"></wa-icon>
                  ${this._saving
                    ? this._localize("secrets.saving")
                    : this._localize("secrets.save")}
                </button>
                <div class=${`editor-layout editor-layout--${this._layout}`}>
                  <div class="editor-pane editor-pane--form">
                    <esphome-secrets-structured-editor
                      .value=${this._yaml}
                      .revealSensitive=${this._revealSensitive}
                      @yaml-change=${this._onYamlChange}
                    ></esphome-secrets-structured-editor>
                  </div>
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
      <esphome-confirm-dialog
        ?destructive=${true}
        heading=${this._localize("secrets.wipe_title")}
        message=${this._localize("secrets.wipe_message")}
        confirm-label=${this._localize("secrets.wipe_confirm")}
      ></esphome-confirm-dialog>
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

  // Opens the destructive confirm dialog and resolves true only on the user's
  // explicit click. A stray Enter can't confirm — the dialog skips Enter when
  // destructive (see confirm-dialog's EnterController).
  private _confirmWipe(): Promise<boolean> {
    const dialog = this._wipeDialog;
    if (!dialog) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const settle = (confirmed: boolean) => {
        dialog.removeEventListener("confirm", onConfirm);
        dialog.removeEventListener("cancel", onCancel);
        this._settlePendingWipe = null;
        resolve(confirmed);
      };
      const onConfirm = () => settle(true);
      const onCancel = () => settle(false);
      this._settlePendingWipe = settle;
      dialog.addEventListener("confirm", onConfirm);
      dialog.addEventListener("cancel", onCancel);
      dialog.open();
    });
  }

  // Returns whether the save succeeded (timeout counts as success), so the
  // leave guard can decide whether navigation may proceed.
  private async _save(): Promise<boolean> {
    // Removing the last secret is destructive (device configs referencing
    // those !secret values stop building), so confirm it. Only a real
    // transition — had secrets, now none — is worth confirming; editing a
    // secrets.yaml that was already entry-less (comments only) is not. Covers
    // both the Save button and the navigate-away path, which share this method.
    const clearingSecrets =
      parseSecretsEntries(this._yaml).length === 0 &&
      parseSecretsEntries(this._savedYaml).length > 0;
    if (clearingSecrets && !(await this._confirmWipe())) {
      return false;
    }
    // The backend refuses a truly blank secrets.yaml unless allow_wipe is set;
    // a comment-only file saves without it. Match that exact gate.
    const allowWipe = this._yaml.trim() === "";
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
      if (allowWipe) {
        await this._api.updateConfig(SECRETS_FILE, this._yaml, { allowWipe: true });
      } else {
        await this._api.updateConfig(SECRETS_FILE, this._yaml);
      }
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
