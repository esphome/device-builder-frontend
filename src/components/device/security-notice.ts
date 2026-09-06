/**
 * Inline security nudge shown above a section's form when a recommended
 * security setting is missing, per
 * https://esphome.io/guides/security_best_practices/. One config-driven
 * component covers every setting in `SECURITY_SETTINGS`:
 *
 * - `api` — missing `encryption:` → generate a Noise key.
 * - `ota.esphome` — missing `password:` (and no `encryption:`) → generate a
 *   passphrase; yields to the OTA encryption nudge when that applies.
 * - `web_server` — missing `auth:` → generate an inline username + a password.
 *
 * On confirm it stores each generated secret in secrets.yaml (via
 * `ensureSecretInYaml`) and emits `apply-section-values` so the host points
 * the config field(s) at them (a `!secret` ref for secret fields, the literal
 * value for inline fields). The user can reveal the stored value inline from the
 * field's secret picker. Adding a setting is a single registry entry + its copy.
 */
import { consume } from "@lit/context";
import { mdiLockAlert } from "@mdi/js";
import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  devicesContext,
  localizeContext,
  versionContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { generateApiEncryptionKey } from "../../util/api-encryption-key.js";
import { resolveDeviceName } from "../../util/device-name.js";
import { notifyError, notifySuccess } from "../../util/notify.js";
import { otaEncryptionNudge } from "../../util/ota-encryption-nudge.js";
import { generatePassphrase } from "../../util/passphrase.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { recommendedSecretKeys } from "../../util/secret-eligibility.js";
import { ensureSecretInYaml } from "../../util/secrets-write.js";
import { splitYamlDocLines } from "../../util/yaml-doc-lines.js";
import { findDirectChildLine } from "../../util/yaml-section-reader.js";
import { dispatchApplySectionValues } from "./notice-banner.js";
import { noticeBannerStyles } from "./notice-banner.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";

registerMdiIcons({ "lock-alert": mdiLockAlert });

/** A value the setting generates: where it goes and how it's made. */
interface GeneratedField {
  /** `setIn` path into the section's draft values. */
  path: string[];
  /** Produces the value (the passphrase generator is async — lazy wordlist). */
  generate: () => string | Promise<string>;
  /** When set, the value is stored in secrets.yaml under the per-device key for
   *  this `recommendedSecretKeys` field and referenced via `!secret`. When
   *  absent, the generated value is written inline (e.g. the web username). */
  secretField?: string;
}

/** What a suppression predicate can see about the device and the draft. */
interface SuppressInputs {
  device: ConfiguredDevice | undefined;
  yaml: string;
  esphomeVersion: string;
}

/** A recommended security setting and how to satisfy it. */
interface SecuritySetting {
  /** Section name passed to `recommendedSecretKeys`; matches the field picker's
   *  `sectionKey` so both derive the same secret name (e.g. `ota.esphome`). */
  secretSection: string;
  /** Direct-child keys any one of which means the setting is already configured. */
  markers: string[];
  /** `device.<copyPrefix>_*` localization keys for this setting's copy. */
  copyPrefix: string;
  /** The value(s) to generate, store/inline, and reference. */
  fields: GeneratedField[];
  /** When true the nudge stays hidden even though the marker is absent. */
  suppressWhen?: (inputs: SuppressInputs) => boolean;
}

/** A 4-word passphrase (strong); a single random word (memorable, non-secret). */
const passphrase = () => generatePassphrase();
const word = () => generatePassphrase(1);

/** Registry keyed by the editor `sectionKey`. */
export const SECURITY_SETTINGS: Record<string, SecuritySetting> = {
  api: {
    secretSection: "api",
    markers: ["encryption"],
    copyPrefix: "api_encryption",
    fields: [
      {
        path: ["encryption", "key"],
        generate: generateApiEncryptionKey,
        secretField: "key",
      },
    ],
  },
  "ota.esphome": {
    secretSection: "ota.esphome",
    markers: ["password", "encryption"],
    copyPrefix: "ota_password",
    fields: [{ path: ["password"], generate: passphrase, secretField: "password" }],
    // Yields to the OTA encryption nudge.
    suppressWhen: (inputs) => otaEncryptionNudge(inputs) !== null,
  },
  web_server: {
    secretSection: "web_server",
    markers: ["auth"],
    copyPrefix: "web_auth",
    fields: [
      // Username isn't sensitive and its field isn't a secret field — inline it.
      { path: ["auth", "username"], generate: word },
      { path: ["auth", "password"], generate: passphrase, secretField: "password" },
    ],
  },
};

/** Whether this section has a security nudge. Own-property check so a top-level
 *  YAML key like `__proto__` can't resolve to an inherited (non-setting) value. */
export const isSecuritySection = (sectionKey: string): boolean =>
  Object.prototype.hasOwnProperty.call(SECURITY_SETTINGS, sectionKey);

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

  @consume({ context: versionContext, subscribe: true })
  @state()
  private _esphomeVersion = "";

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

  private _device?: ConfiguredDevice;

  @state() private _generating = false;

  @query("esphome-confirm-dialog") private _dialog?: ESPHomeConfirmDialog;

  private get _setting(): SecuritySetting | undefined {
    return isSecuritySection(this.sectionKey)
      ? SECURITY_SETTINGS[this.sectionKey]
      : undefined;
  }

  protected willUpdate(changed: PropertyValues) {
    const yamlDriven =
      changed.has("yaml") || changed.has("fromLine") || changed.has("sectionKey");
    // The devices context is replaced on every fleet event; only this device's row matters.
    const device = this._devices.find((d) => d.configuration === this.configuration);
    const deviceDriven =
      device !== this._device ||
      changed.has("_esphomeVersion") ||
      changed.has("configuration");
    this._device = device;
    if (yamlDriven || (deviceDriven && this._setting?.suppressWhen)) {
      this._markerAbsent =
        !!this._setting && !this._markerPresent() && !this._suppressed();
    }
  }

  /** Each field with its resolved secrets.yaml key (`""` for inline fields, or
   *  until the device name resolves for secret fields). */
  private _resolvedFields(): { field: GeneratedField; key: string }[] {
    const setting = this._setting;
    if (!setting) return [];
    const deviceName = resolveDeviceName(this._devices, this.configuration);
    return setting.fields.map((field) => ({
      field,
      key: field.secretField
        ? (recommendedSecretKeys(
            setting.secretSection,
            field.secretField,
            deviceName,
            true
          )[0] ?? "")
        : "",
    }));
  }

  /** Every secret field's key resolved (device known) — gates the generate flow. */
  private get _ready(): boolean {
    const fields = this._resolvedFields();
    return fields.length > 0 && fields.every((f) => !f.field.secretField || f.key !== "");
  }

  /** Whether a marker is a *direct child* of the section. A line scan, since the
   *  parser drops a keyless block (an HA-provisioned `encryption:`) that counts. */
  private _markerPresent(): boolean {
    const setting = this._setting;
    if (!setting) return false;
    // `ota.esphome` → scan from the esphome list-item dash (its fromLine).
    const baseKey = this.sectionKey.split(".")[0];
    const marker = new RegExp(`^(?:${setting.markers.join("|")})\\s*:`);
    return (
      findDirectChildLine(splitYamlDocLines(this.yaml), baseKey, marker, this.fromLine) >=
      0
    );
  }

  private _suppressed(): boolean {
    const suppress = this._setting?.suppressWhen;
    if (!suppress) return false;
    return suppress({
      device: this._device,
      yaml: this.yaml,
      esphomeVersion: this._esphomeVersion,
    });
  }

  private _onCta = (): void => {
    // Guard the open so a missing device name can't route into a failure path.
    if (this._ready) this._dialog?.open();
  };

  private _onGenerate = async (): Promise<void> => {
    const setting = this._setting;
    const fields = this._resolvedFields();
    if (this._generating || !this._api || !setting || !this._ready) return;
    this._generating = true;
    try {
      const applied: { path: string[]; value: string }[] = [];
      for (const { field, key } of fields) {
        const generated = await field.generate();
        if (field.secretField) {
          await ensureSecretInYaml(this._api, key, generated);
          applied.push({ path: field.path, value: `!secret ${key}` });
        } else {
          applied.push({ path: field.path, value: generated });
        }
      }
      dispatchApplySectionValues(this, applied);
      notifySuccess(this._localize("device.security_applied"));
    } catch (err) {
      // ensureSecretInYaml aborts (throws) on a read failure rather than
      // clobbering secrets.yaml; log the cause and leave the config untouched.
      console.error("Security secret generation failed", err);
      notifyError(this._localize(`device.${setting.copyPrefix}_error`));
    } finally {
      this._generating = false;
    }
  };

  static styles = [
    espHomeStyles,
    noticeBannerStyles,
    css`
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
    // wherever the locale positions it. Inline fields have no key to show.
    const [before, after = ""] = this._localize(
      `device.${setting.copyPrefix}_dialog_body`
    ).split("{key}");
    const codes = this._resolvedFields()
      .filter((f) => f.field.secretField)
      .map((f, i) => html`${i > 0 ? ", " : ""}<code>${f.key}</code>`);
    return html`${before}${codes}${after}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-security-notice": ESPHomeSecurityNotice;
  }
}
