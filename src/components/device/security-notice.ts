/**
 * Inline security nudge shown above a section's form when a recommended
 * security setting is missing, per
 * https://esphome.io/guides/security_best_practices/. One config-driven
 * component covers every setting in `SECURITY_SETTINGS`:
 *
 * - `api` — missing `encryption:` → generate a Noise key.
 * - `ota.esphome` — missing `password:` → generate a passphrase.
 * - `web_server` — missing `auth:` → generate a username + password.
 *
 * On confirm it stores each generated value in secrets.yaml (via
 * `ensureSecretInYaml`) and emits `apply-security-secrets` so the host points
 * the config field(s) at them with `!secret` in the unsaved draft. Adding a
 * setting is a single registry entry + its copy — no per-setting code.
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
import { generatePassphrase } from "../../util/passphrase.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { recommendedSecretKeys } from "../../util/secret-eligibility.js";
import { ensureSecretInYaml } from "../../util/secrets-write.js";
import { TOP_LEVEL_KEY_START_RE } from "../../util/yaml-section-lexer.js";
import { findSectionStart } from "../../util/yaml-section-reader.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";

registerMdiIcons({ "lock-alert": mdiLockAlert });

/** One secret a setting generates: where it's referenced and how it's made. */
interface SecretSpec {
  /** `recommendedSecretKeys` leaf, e.g. `key` / `password` / `username`. */
  field: string;
  /** `setIn` path into the section's draft values. */
  path: string[];
  /** Produces the secret's value (the passphrase generator is async — it
   *  lazy-loads its wordlist). */
  generate: () => string | Promise<string>;
}

/** A recommended security setting and how to satisfy it. */
interface SecuritySetting {
  /** Section name passed to `recommendedSecretKeys` (e.g. `ota` for `ota.esphome`). */
  secretSection: string;
  /** Direct-child key whose presence means the setting is already configured. */
  marker: string;
  /** `device.<copyPrefix>_*` localization keys for this setting's copy. */
  copyPrefix: string;
  /** The secret(s) to generate, store, and reference. */
  secrets: SecretSpec[];
}

const passphrase = () => generatePassphrase();

/** Registry keyed by the editor `sectionKey`. */
export const SECURITY_SETTINGS: Record<string, SecuritySetting> = {
  api: {
    secretSection: "api",
    marker: "encryption",
    copyPrefix: "api_encryption",
    secrets: [
      { field: "key", path: ["encryption", "key"], generate: generateApiEncryptionKey },
    ],
  },
  "ota.esphome": {
    secretSection: "ota",
    marker: "password",
    copyPrefix: "ota_password",
    secrets: [{ field: "password", path: ["password"], generate: passphrase }],
  },
  web_server: {
    secretSection: "web_server",
    marker: "auth",
    copyPrefix: "web_auth",
    secrets: [
      { field: "username", path: ["auth", "username"], generate: passphrase },
      { field: "password", path: ["auth", "password"], generate: passphrase },
    ],
  },
};

/** Whether this section has a security nudge. Own-property check so a top-level
 *  YAML key like `__proto__` can't resolve to an inherited (non-setting) value. */
export const isSecuritySection = (sectionKey: string): boolean =>
  Object.prototype.hasOwnProperty.call(SECURITY_SETTINGS, sectionKey);

/** Detail for the `apply-security-secrets` event. */
export interface ApplySecuritySecretsDetail {
  /** Each generated secret's draft path and the `!secret <key>` reference. */
  secrets: { path: string[]; ref: string }[];
}

@customElement("esphome-security-notice")
export class ESPHomeSecurityNotice extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  /** The section whose form this notice sits above. */
  @property() sectionKey = "";

  /** The full device YAML (the live editor buffer). */
  @property() yaml = "";

  /** Device configuration id, to resolve the node name. */
  @property() configuration = "";

  /** The section's resolved start line, to disambiguate duplicates. */
  @property({ type: Number }) fromLine?: number;

  /** Memoized: whether the setting's marker is absent (so the nudge shows).
   *  Recomputed only when the YAML, section, or resolved line changes. */
  @state() private _markerAbsent = false;

  @state() private _generating = false;

  @query("esphome-confirm-dialog") private _dialog?: ESPHomeConfirmDialog;

  private get _setting(): SecuritySetting | undefined {
    return isSecuritySection(this.sectionKey)
      ? SECURITY_SETTINGS[this.sectionKey]
      : undefined;
  }

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("yaml") || changed.has("fromLine") || changed.has("sectionKey")) {
      this._markerAbsent = !!this._setting && !this._markerPresent();
    }
  }

  /** The recommended secret key for each of the setting's secrets, in order.
   *  An entry is `""` until the device name resolves. */
  private _secretKeys(): { spec: SecretSpec; key: string }[] {
    const setting = this._setting;
    if (!setting) return [];
    const deviceName = resolveDeviceName(this._devices, this.configuration);
    return setting.secrets.map((spec) => ({
      spec,
      key:
        recommendedSecretKeys(setting.secretSection, spec.field, deviceName, true)[0] ??
        "",
    }));
  }

  /** All secret keys resolved (device known) — gates the generate flow. */
  private get _ready(): boolean {
    const keys = this._secretKeys();
    return keys.length > 0 && keys.every((k) => k.key !== "");
  }

  /** Whether the section body has the setting's marker as a *direct child*. A
   *  line scan (not the parsed values) because the parser drops a keyless block
   *  (e.g. a keyless `encryption:` that HA auto-provisions) which must NOT
   *  suppress the nudge. The dedent stop keeps a list section (`ota.esphome`)
   *  scoped to its own item, and the indent check ignores deeper-nested keys. */
  private _markerPresent(): boolean {
    const setting = this._setting;
    if (!setting) return false;
    const lines = this.yaml.split("\n");
    // `ota.esphome` → scan from the esphome list-item dash (its fromLine).
    const baseKey = this.sectionKey.split(".")[0];
    const start = findSectionStart(lines, baseKey, this.fromLine);
    if (start < 0) return false;
    const marker = new RegExp(`^${setting.marker}\\s*:`);
    let childIndent: number | null = null;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === "" || l.trimStart().startsWith("#")) continue;
      if (TOP_LEVEL_KEY_START_RE.test(l)) break; // next top-level section
      const indent = l.length - l.trimStart().length;
      if (childIndent === null) childIndent = indent; // first child sets the level
      if (indent < childIndent) break; // dedent — left this block (e.g. next list item)
      if (indent !== childIndent) continue; // deeper-nested key, not a direct child
      if (marker.test(l.trimStart())) return true;
    }
    return false;
  }

  private _onCta = (): void => {
    // Guard the open so a missing device name can't route into a failure path.
    if (this._ready) this._dialog?.open();
  };

  private _onGenerate = async (): Promise<void> => {
    const setting = this._setting;
    const entries = this._secretKeys();
    if (this._generating || !this._api || !setting || !this._ready) return;
    this._generating = true;
    try {
      const applied: { path: string[]; ref: string }[] = [];
      // `created` false = a secret already existed (rare); reuse it rather than
      // overwrite, and say "linked" instead of "added".
      let allCreated = true;
      for (const { spec, key } of entries) {
        const { created } = await ensureSecretInYaml(
          this._api,
          key,
          await spec.generate()
        );
        if (!created) allCreated = false;
        applied.push({ path: spec.path, ref: `!secret ${key}` });
      }
      this.dispatchEvent(
        new CustomEvent<ApplySecuritySecretsDetail>("apply-security-secrets", {
          detail: { secrets: applied },
          bubbles: true,
          composed: true,
        })
      );
      toast.success(
        this._localize(
          `device.${setting.copyPrefix}_${allCreated ? "success" : "linked"}`,
          {
            key: entries.map((e) => e.key).join(", "),
          }
        ),
        { richColors: true }
      );
    } catch (err) {
      // ensureSecretInYaml aborts (throws) on a read failure rather than
      // clobbering secrets.yaml; log the cause and leave the config untouched.
      console.error("Security secret generation failed", err);
      toast.error(this._localize(`device.${setting.copyPrefix}_error`), {
        richColors: true,
      });
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
    const setting = this._setting;
    if (!setting || !this._markerAbsent) return nothing;
    return html`
      <div class="notice" role="note">
        <wa-icon library="mdi" name="lock-alert"></wa-icon>
        <div class="body">
          <p>${this._localize(`device.${setting.copyPrefix}_notice`)}</p>
          <button
            type="button"
            class="cta"
            ?disabled=${this._generating || !this._ready}
            @click=${this._onCta}
          >
            ${this._localize(`device.${setting.copyPrefix}_enable`)}
          </button>
        </div>
      </div>
      <esphome-confirm-dialog
        heading=${this._localize(`device.${setting.copyPrefix}_dialog_title`)}
        confirm-label=${this._localize("device.security_generate")}
        @confirm=${this._onGenerate}
      >
        <div slot="body" class="dialog-body">${this._renderDialogBody(setting)}</div>
      </esphome-confirm-dialog>
    `;
  }

  private _renderDialogBody(setting: SecuritySetting) {
    // Called without params, `_localize` leaves the `{key}` placeholder intact,
    // so we split on it and render each secret key as a real `<code>` element
    // wherever the locale positions it.
    const [before, after = ""] = this._localize(
      `device.${setting.copyPrefix}_dialog_body`
    ).split("{key}");
    const codes = this._secretKeys().map(
      (k, i) => html`${i > 0 ? ", " : ""}<code>${k.key}</code>`
    );
    return html`${before}${codes}${after}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-security-notice": ESPHomeSecurityNotice;
  }
}
