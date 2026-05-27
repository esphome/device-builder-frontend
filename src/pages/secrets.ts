import { consume } from "@lit/context";
import { mdiContentSave, mdiEye, mdiEyeOff } from "@mdi/js";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/divider/divider.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../components/yaml-editor.js";

registerMdiIcons({
  "content-save": mdiContentSave,
  eye: mdiEye,
  "eye-off": mdiEyeOff,
});

const SECRETS_FILE = "secrets.yaml";

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

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      "secrets-saved",
      this._onExternalSecretsSaved as EventListener
    );
    await this._loadFromServer();
  }

  disconnectedCallback() {
    window.removeEventListener(
      "secrets-saved",
      this._onExternalSecretsSaved as EventListener
    );
    super.disconnectedCallback();
  }

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
        padding: var(--wa-space-l);
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
        box-shadow: 0 2px 8px color-mix(in srgb, var(--esphome-primary), transparent 50%);
        transition:
          background 0.12s,
          box-shadow 0.12s,
          transform 0.12s;
      }

      .save-button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
        box-shadow: 0 4px 14px color-mix(in srgb, var(--esphome-primary), transparent 35%);
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
        background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
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
        background: color-mix(in srgb, var(--esphome-primary), transparent 80%);
      }

      .reveal-toggle wa-icon {
        font-size: 16px;
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
        <wa-divider></wa-divider>
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
                <esphome-yaml-editor
                  .value=${this._yaml}
                  .maskAllValues=${true}
                  .revealSensitive=${this._revealSensitive}
                  @yaml-change=${(e: CustomEvent) => {
                    this._yaml = e.detail.value;
                  }}
                ></esphome-yaml-editor>
              `
            : html`<div class="loading"><wa-spinner></wa-spinner></div>`}
        </div>
      </div>
    `;
  }

  private _toggleRevealSensitive() {
    this._revealSensitive = !this._revealSensitive;
  }

  private async _save() {
    // Optimistic update: dirty-state UI flips back to "saved"
    // immediately so the Save button disables. Snapshot the
    // previous saved buffer first so a real (non-timeout)
    // failure can revert and let the user retry.
    const previousSaved = this._savedYaml;
    this._savedYaml = this._yaml;
    // ``_saving`` covers the in-flight window so a rapid second
    // click can't queue a duplicate write; the dirty-check would
    // also disable on the success path (savedYaml === yaml), but
    // _saving stays true through both branches so the "Saving…"
    // label and disabled state hold until the API call returns.
    this._saving = true;
    toast.success(this._localize("secrets.saved"), { richColors: true });
    try {
      await this._api.updateConfig(SECRETS_FILE, this._yaml);
      // Window-level so other mounted components (app-shell's
      // onboarding-state refresh, peer secrets-page instances)
      // can react regardless of where they live in the tree.
      // ``detail.source`` lets self-listeners short-circuit.
      window.dispatchEvent(
        new CustomEvent("secrets-saved", { detail: { source: this } })
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // WS commands may time out client-side while the server
      // still completes the write — keep the optimistic buffer
      // so the user isn't told their save failed when it
      // probably succeeded. Any other error is a real failure:
      // restore the previous saved buffer so the dirty state
      // returns and the user can retry.
      if (!msg.includes("timed out")) {
        this._savedYaml = previousSaved;
        toast.error(this._localize("secrets.save_error"), {
          richColors: true,
        });
      }
    } finally {
      this._saving = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-secrets": ESPHomePageSecrets;
  }
}
