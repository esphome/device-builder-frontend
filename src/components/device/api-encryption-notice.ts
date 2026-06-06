/**
 * Inline security nudge shown above the API section form when its
 * `encryption:` block is absent. Pushes the user toward Native API Noise
 * encryption: a confirm dialog generates a unique key, stores it in
 * secrets.yaml as `<host>__encryption_key`, and emits `apply-encryption-key`
 * so the host points `api.encryption.key` at it in the unsaved draft.
 *
 * Kept out of `device-section-config.ts` (already over the file-size cap) and
 * self-contained: it consumes its own contexts and owns the detection,
 * dialog, key generation, and secrets write.
 */
import { consume } from "@lit/context";
import { mdiLockAlert } from "@mdi/js";
import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, devicesContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { generateApiEncryptionKey } from "../../util/api-encryption-key.js";
import { resolveDeviceName } from "../../util/device-name.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { recommendedSecretKeys } from "../../util/secret-eligibility.js";
import { ensureSecretInYaml } from "../../util/secrets-write.js";
import { TOP_LEVEL_KEY_START_RE } from "../../util/yaml-section-lexer.js";
import { findSectionStart } from "../../util/yaml-section-reader.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";

registerMdiIcons({ "lock-alert": mdiLockAlert });

/** Detail for the `apply-encryption-key` event. */
export interface ApplyEncryptionKeyDetail {
  /** The secrets.yaml key the field should reference via `!secret <key>`. */
  secretKey: string;
}

@customElement("esphome-api-encryption-notice")
export class ESPHomeApiEncryptionNotice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  /** The full device YAML (the live editor buffer). */
  @property() yaml = "";

  /** Device configuration id, to resolve the node name. */
  @property() configuration = "";

  /** The api section's resolved start line, to disambiguate duplicates. */
  @property({ type: Number }) fromLine?: number;

  /** Memoized: whether the api section has no `encryption:` child. Recomputed
   *  only when the YAML or resolved section line changes. */
  @state() private _encryptionAbsent = false;

  @state() private _generating = false;

  @query("esphome-confirm-dialog") private _dialog?: ESPHomeConfirmDialog;

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("yaml") || changed.has("fromLine")) {
      this._encryptionAbsent = !this._encryptionLinePresent();
    }
  }

  /** The recommended per-device secret key for the API encryption key, e.g.
   *  ``acfloatmonitor32__encryption_key``. Empty until the device resolves. */
  private get _secretKey(): string {
    const deviceName = resolveDeviceName(this._devices, this.configuration);
    return recommendedSecretKeys("api", "key", deviceName, true)[0] ?? "";
  }

  /** Whether the api section's body has an `encryption:` *direct child*. A
   *  line scan (not the parsed values) because the section parser drops a
   *  keyless `encryption:` block — and a keyless block (HA auto-provisions it)
   *  must NOT trigger the prompt. Only the section's first-level child indent
   *  matches, so a deeper `encryption:` (e.g. under an action's `variables:`)
   *  doesn't count. */
  private _encryptionLinePresent(): boolean {
    const lines = this.yaml.split("\n");
    const start = findSectionStart(lines, "api", this.fromLine);
    if (start < 0) return false;
    let childIndent: number | null = null;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === "" || l.trimStart().startsWith("#")) continue;
      if (TOP_LEVEL_KEY_START_RE.test(l)) break; // next top-level section
      const indent = l.length - l.trimStart().length;
      if (childIndent === null) childIndent = indent; // first child sets the level
      if (indent !== childIndent) continue; // deeper-nested key, not a direct child
      if (/^encryption\s*:/.test(l.trimStart())) return true;
    }
    return false;
  }

  private _onCta = (): void => {
    // Guard the open so a missing device name can't route into a failure path.
    if (this._secretKey) this._dialog?.open();
  };

  private _onGenerate = async (): Promise<void> => {
    const secretKey = this._secretKey;
    if (this._generating || !this._api || !secretKey) return;
    this._generating = true;
    try {
      // `created` false = the device-scoped key already existed (rare: made
      // earlier without being referenced); reuse it rather than overwrite, and
      // say "linked" instead of "added".
      const { created } = await ensureSecretInYaml(
        this._api,
        secretKey,
        generateApiEncryptionKey()
      );
      this.dispatchEvent(
        new CustomEvent<ApplyEncryptionKeyDetail>("apply-encryption-key", {
          detail: { secretKey },
          bubbles: true,
          composed: true,
        })
      );
      toast.success(
        this._localize(
          created ? "device.api_encryption_success" : "device.api_encryption_linked",
          { key: secretKey }
        ),
        { richColors: true }
      );
    } catch (err) {
      // ensureSecretInYaml aborts (throws) on a read failure rather than
      // clobbering secrets.yaml; log the cause and leave the config untouched.
      console.error("API encryption key generation failed", err);
      toast.error(this._localize("device.api_encryption_error"), { richColors: true });
    } finally {
      this._generating = false;
    }
  };

  static styles = [
    espHomeStyles,
    css`
      .notice {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-s);
        margin-bottom: var(--wa-space-m);
        padding: var(--wa-space-s) var(--wa-space-m);
        border: var(--wa-border-width-s) solid var(--esphome-warning, #f59e0b);
        background: color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 90%);
        border-radius: var(--wa-border-radius-m);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
        line-height: 1.5;
      }

      .notice wa-icon {
        flex-shrink: 0;
        font-size: 20px;
        color: var(--esphome-warning, #f59e0b);
      }

      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        flex: 1;
        min-width: 0;
      }

      .body p {
        margin: 0;
      }

      .cta {
        align-self: flex-start;
        padding: var(--wa-space-2xs) var(--wa-space-m);
        border: none;
        border-radius: var(--wa-border-radius-m);
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        font-family: inherit;
        font-size: inherit;
        font-weight: var(--wa-font-weight-bold);
        cursor: pointer;
        transition:
          background 0.12s,
          opacity 0.12s;
      }

      .cta:hover:not(:disabled) {
        background: var(--esphome-primary-hover);
      }

      .cta:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .dialog-body code {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-size: var(--wa-font-size-s);
        padding: 1px 5px;
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-surface-lowered);
        word-break: break-all;
      }
    `,
  ];

  protected render() {
    if (!this._encryptionAbsent) return nothing;
    return html`
      <div class="notice" role="note">
        <wa-icon library="mdi" name="lock-alert"></wa-icon>
        <div class="body">
          <p>${this._localize("device.api_encryption_notice")}</p>
          <button
            type="button"
            class="cta"
            ?disabled=${this._generating || !this._secretKey}
            @click=${this._onCta}
          >
            ${this._localize("device.api_encryption_enable")}
          </button>
        </div>
      </div>
      <esphome-confirm-dialog
        heading=${this._localize("device.api_encryption_dialog_title")}
        confirm-label=${this._localize("device.api_encryption_dialog_confirm")}
        @confirm=${this._onGenerate}
      >
        <div slot="body" class="dialog-body">${this._renderDialogBody()}</div>
      </esphome-confirm-dialog>
    `;
  }

  private _renderDialogBody() {
    // Called without params, `_localize` leaves the `{key}` placeholder intact,
    // so we split on it and render the key as a real `<code>` element wherever
    // the locale positions it.
    const [before, after = ""] = this._localize(
      "device.api_encryption_dialog_body"
    ).split("{key}");
    return html`${before}<code>${this._secretKey}</code>${after}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-api-encryption-notice": ESPHomeApiEncryptionNotice;
  }
}
