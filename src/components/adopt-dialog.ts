import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { AdoptableDevice } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import {
  dialogActionButtonStyles,
  dialogActionsRowStyles,
} from "../styles/dialog-action-buttons.js";
import { dialogChromeStyles } from "../styles/dialog-chrome.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { validateDeviceName } from "../util/config-validation.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { EnterController } from "../util/enter-controller.js";
import { fireEvent } from "../util/fire-event.js";
import { formatApiError } from "../util/format-api-error.js";
import { markJustCreated } from "../util/just-created.js";
import { previewPackageImportUrl } from "../util/package-import-url.js";
import { renderInlineError } from "../util/render-error.js";
import { fetchSecretKeys, hasSharedWifiSecret } from "../util/secrets-cache.js";
import { wifiFieldsStyles } from "./onboarding/wifi-fields-styles.js";
import { isWifiPasswordTooShort, renderWifiFields } from "./onboarding/wifi-fields.js";

import "./base-dialog.js";

@customElement("esphome-adopt-dialog")
export class ESPHomeAdoptDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  @state()
  private _api?: ESPHomeAPI;

  @state() private _device: AdoptableDevice | null = null;
  @state() private _name = "";
  @state() private _friendlyName = "";
  // Default on — the legacy dashboard added an encryption key to
  // every adopted device unconditionally and the lack of a way to
  // opt out was the actual annoyance. Keep the secure-by-default
  // behaviour, just expose a checkbox so users who don't want it
  // (e.g. they're staying with plain MQTT) can untick it.
  @state() private _encryption = true;
  @state() private _busy = false;
  @state() private _error: string | null = null;
  @state() private _ssid = "";
  @state() private _password = "";
  // undefined until config/get_secrets resolves; only fetched for a
  // network=wifi device, so a non-wifi adopt never blocks on it.
  @state() private _hasWifiSecrets?: boolean;

  static styles = [
    espHomeStyles,
    inputStyles,
    // Neutral header + title + footer (shared) — dialog-chrome.ts.
    dialogChromeStyles,
    // Before the local block so this dialog's own `.field` / `label`
    // spacing wins; only `.field-label` / `.error` (unique here) apply.
    wifiFieldsStyles,
    dialogActionsRowStyles,
    dialogActionButtonStyles,
    css`
      esphome-base-dialog {
        --width: 460px;
      }

      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      .description {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
        margin: 0 0 var(--wa-space-m);
        line-height: 1.5;
      }

      /* Surface the package_import_url so the user can see where
         the adoption flow is fetching its YAML / Python from.
         Most "Made for ESPHome" firmware advertises this routinely
         (Athom, Apollo, etc.), so neutral informational treatment
         rather than a warning. The user can still notice if the
         hostname looks unfamiliar. See
         esphome/device-builder#120 finding B-2. */
      .source-info {
        margin-bottom: var(--wa-space-m);
      }

      .source-info-label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
        margin-bottom: var(--wa-space-2xs);
      }

      /* Show the URL in monospace; long URLs wrap inside the
         dialog instead of overflowing or getting truncated. The
         word-break:break-word + overflow-wrap:anywhere pair
         (same one yaml-diff.ts and ansi-log.ts use) breaks only
         on the longest unbreakable run rather than mid-token —
         hostnames stay intact, which matters here because the
         hostname is the highest-signal part for deciding trust.
         break-all would happily split github.com across two
         lines and hide the signal. */
      .source-info-url {
        font-family: var(--wa-font-family-code);
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-normal);
        word-break: break-word;
        overflow-wrap: anywhere;
        background: var(--wa-color-surface-lowered);
        padding: 6px 10px;
        border-radius: var(--wa-border-radius-s);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        display: block;
      }

      /* Anchor variant of the URL block for when the value is a
         recognised github / gitlab shorthand and we can resolve a
         clickable browse URL. Same monospace + wrap shape as the
         plain-text variant; just adds hover affordance and the
         primary-colour underline so the user can tell it's
         interactive. */
      a.source-info-url {
        color: var(--esphome-primary);
        text-decoration: none;
      }

      a.source-info-url:hover {
        text-decoration: underline;
      }

      a.source-info-url:focus-visible {
        outline: 2px solid var(--esphome-primary-light);
        outline-offset: 2px;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        padding-bottom: var(--wa-space-m);
      }

      label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .checkbox-row {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-s);
        padding-bottom: var(--wa-space-m);
        cursor: pointer;
        user-select: none;
      }

      .checkbox-row input[type="checkbox"] {
        margin-top: 3px;
      }

      .checkbox-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .checkbox-title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .checkbox-hint {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      /* Adoption's commit affordance is success-green rather than the
         standard primary tint (dialogActionButtonStyles); per that
         module's guidance, divergent colour intents stay local. This
         block sits after the shared fragment so it wins the cascade. */
      .btn--primary {
        background: var(--esphome-success);
      }

      .btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-success), black 10%);
      }

      .field-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-xs);
        margin-top: var(--wa-space-2xs);
      }

      .submit-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-xs);
        padding-bottom: var(--wa-space-s);
      }
    `,
  ];

  private readonly _dialog = new DialogOpenController(this);

  // Enter submits; _submit self-guards on name validity and re-entry.
  private _enter = new EnterController(this, () => this._submit());

  protected willUpdate(): void {
    // Re-sync every update (set() no-ops on same value) — the open flag
    // lives on the controller, so it never appears in `changed`.
    this._enter.set(this._dialog.open);
  }

  open(device: AdoptableDevice) {
    this._device = device;
    /* Default to the discovered hostname verbatim — including the
       MAC-suffix factory firmware appends. The backend writes the
       new YAML with ``name_add_mac_suffix: False`` so whatever the
       user picks sticks; users who want a cleaner name can edit the
       suffix off, but defaulting to a stripped form silently dropped
       the disambiguator on devices like ``apollo-plt-1-983300``. */
    this._name = device.name;
    this._friendlyName = device.friendly_name || "";
    this._encryption = true;
    this._busy = false;
    this._error = null;
    this._ssid = "";
    this._password = "";
    this._hasWifiSecrets = undefined;
    this._dialog.open = true;
    // A Wi-Fi device whose install has no shared wifi_ssid/wifi_password
    // would import a config referencing an undefined !secret and fail to
    // validate (esphome/device-builder#1742). Probe the shared secrets so
    // the Wi-Fi step can prompt + store them before importing.
    if (this._needsWifi && this._api) {
      fetchSecretKeys(this._api).then((keys) => {
        this._hasWifiSecrets = hasSharedWifiSecret(keys);
      });
    }
  }

  // Strictly "wifi" to match the legacy dashboard's adopt gate. A device
  // that advertised no network (older firmware, network === "") isn't
  // prompted; closing that hole belongs in the backend import generator,
  // not a frontend heuristic that would wrongly prompt Ethernet devices.
  private get _needsWifi(): boolean {
    return this._device?.network === "wifi";
  }

  // Show the Wi-Fi step only for a Wi-Fi device with no shared secret yet;
  // a device with its own network or an install that already has the secret
  // skips it, mirroring the create wizard and the legacy adopt dialog.
  private get _collectWifi(): boolean {
    return this._needsWifi && this._hasWifiSecrets === false;
  }

  // Block submit while a wifi device's secrets are still loading
  // (_hasWifiSecrets undefined) so a fast Enter can't skip the store, and
  // once the Wi-Fi step shows require an SSID + a valid-length password.
  // Read by both canSubmit and _submit so the Enter path (which bypasses
  // the disabled button) is guarded too.
  private get _wifiBlocking(): boolean {
    return (
      (this._needsWifi && this._hasWifiSecrets === undefined) ||
      (this._collectWifi &&
        (!this._ssid.trim() || isWifiPasswordTooShort(this._password)))
    );
  }

  close = () => {
    /* Arrow function so ``@click=${this.close}`` from the cancel
       button keeps ``this`` bound to the dialog. With a plain method,
       Lit hands the listener to ``addEventListener`` which calls it
       with ``this === undefined`` (strict mode) and the property
       access below would blow up. */
    this._dialog.open = false;
  };

  protected render() {
    /* Always render the dialog with the same template shape,
       even before a device is set. Returning a different
       template on the first render and then a fully-populated
       one on the second made Lit swap the element instance —
       so the open-flag flip we set in ``open()`` was applied
       to an element that was about to be thrown away, and the
       user had to click Take Control twice for the dialog to
       actually appear. */
    const device = this._device;
    const nameTrimmed = this._name.trim();
    const nameErr = nameTrimmed ? validateDeviceName(nameTrimmed) : null;
    const canSubmit =
      !!device && !!nameTrimmed && !nameErr && !this._busy && !this._wifiBlocking;
    const displayName = device ? device.friendly_name || device.name : "";

    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        ?busy=${this._busy}
        .label=${this._localize("dashboard.adopt_title")}
        @after-hide=${this._dialog.onAfterHide}
      >
        ${
          device
            ? html`
                <p class="description">
                  ${this._localize("dashboard.adopt_description", {
                    name: displayName,
                  })}
                </p>

                ${this._renderSource(device.package_import_url)}

                <div class="field">
                  <label for="adopt-name">
                    ${this._localize("dashboard.adopt_field_name")}
                  </label>
                  <input
                    id="adopt-name"
                    type="text"
                    class=${nameErr ? "invalid" : ""}
                    .value=${this._name}
                    ?disabled=${this._busy}
                    @input=${(e: Event) => {
                      this._name = (e.target as HTMLInputElement).value;
                    }}
                  />
                  ${renderInlineError(
                    nameErr ? this._localize(nameErr.code, nameErr.params) : undefined
                  )}
                </div>

                <div class="field">
                  <label for="adopt-friendly-name">
                    ${this._localize("dashboard.adopt_field_friendly_name")}
                  </label>
                  <input
                    id="adopt-friendly-name"
                    type="text"
                    .value=${this._friendlyName}
                    ?disabled=${this._busy}
                    @input=${(e: Event) => {
                      this._friendlyName = (e.target as HTMLInputElement).value;
                    }}
                  />
                </div>

                ${
                  this._collectWifi
                    ? html`
                        <p class="description">
                          ${this._localize("onboarding.wifi.intro")}
                        </p>
                        ${renderWifiFields({
                          localize: this._localize,
                          ssid: this._ssid,
                          password: this._password,
                          disabled: this._busy,
                          onSsidInput: (value) => {
                            this._ssid = value;
                          },
                          onPasswordInput: (value) => {
                            this._password = value;
                          },
                        })}
                      `
                    : nothing
                }

                <label class="checkbox-row">
                  <input
                    type="checkbox"
                    .checked=${this._encryption}
                    ?disabled=${this._busy}
                    @change=${(e: Event) => {
                      this._encryption = (e.target as HTMLInputElement).checked;
                    }}
                  />
                  <span class="checkbox-text">
                    <span class="checkbox-title"
                      >${this._localize("dashboard.adopt_encryption_title")}</span
                    >
                    <span class="checkbox-hint"
                      >${this._localize("dashboard.adopt_encryption_hint")}</span
                    >
                  </span>
                </label>

                ${
                  this._error
                    ? html`<div class="submit-error">${this._error}</div>`
                    : nothing
                }

                <div class="actions">
                  <button
                    class="btn btn--cancel"
                    ?disabled=${this._busy}
                    @click=${this.close}
                  >
                    ${this._localize("layout.cancel")}
                  </button>
                  <button
                    class="btn btn--primary"
                    ?disabled=${!canSubmit}
                    @click=${this._submit}
                  >
                    ${
                      this._busy
                        ? this._localize("dashboard.adopt_submit_busy")
                        : this._localize("dashboard.adopt_submit")
                    }
                  </button>
                </div>
              `
            : nothing
        }
      </esphome-base-dialog>
    `;
  }

  private _renderSource(packageImportUrl: string) {
    if (!packageImportUrl) return nothing;
    const preview = previewPackageImportUrl(packageImportUrl);
    // Render the raw shorthand verbatim — the user might recognise
    // their vendor's domain even if we can't resolve a click target
    // (e.g. a future ``bitbucket://`` scheme we don't support yet).
    // When we DO have a browse URL we wrap it in an anchor so the
    // user can pop the file open in a new tab and read the YAML
    // before clicking Take Control.
    const body = preview.browseUrl
      ? html`<a
          class="source-info-url"
          href=${preview.browseUrl}
          target="_blank"
          rel="noopener noreferrer"
          >${preview.raw}</a
        >`
      : html`<div class="source-info-url">${preview.raw}</div>`;
    return html`
      <div class="source-info">
        <div class="source-info-label">
          ${this._localize("dashboard.adopt_source_label")}
        </div>
        ${body}
      </div>
    `;
  }

  private _submit = async () => {
    if (this._busy) return; // Enter bypasses the disabled button; guard re-entry
    if (!this._device || !this._api) return;
    const name = this._name.trim();
    const friendlyName = this._friendlyName.trim();
    if (!name || validateDeviceName(name)) return;
    // Enter bypasses the disabled button; re-check the Wi-Fi gate so a
    // held Enter can't import before the secret store (or with bad creds).
    if (this._wifiBlocking) return;

    this._busy = true;
    this._error = null;
    try {
      // Persist the shared Wi-Fi secret first so the imported config's
      // ``!secret wifi_ssid`` resolves; a failure here surfaces in the same
      // catch and leaves the dialog open. ``secrets-saved`` refreshes the
      // editor's secret pickers and the kebab wording. Store the raw SSID
      // (whitespace is significant); the trim is only the non-empty gate.
      if (this._collectWifi) {
        await this._api.setWifiCredentials(this._ssid, this._password);
        window.dispatchEvent(
          new CustomEvent("secrets-saved", { detail: { source: this } })
        );
      }
      // ``encryption`` is sent only when the user opted in. Backend
      // signature is ``encryption: str | None = None``; omitting it
      // when False keeps the call site clean and avoids relying on
      // the upstream ``import_config`` branch's ``if encryption:``
      // truthiness check accepting the literal string "false".
      const args: Parameters<ESPHomeAPI["importDevice"]>[0] = {
        name,
        project_name: this._device.project_name,
        package_import_url: this._device.package_import_url,
      };
      if (friendlyName) args.friendly_name = friendlyName;
      if (this._encryption) args.encryption = "true";
      await this._api.importDevice(args);
      // Configuration filenames are ``<name>.yaml``; mirror the same
      // derivation the dashboard's ``_onAdopted`` handler uses so
      // both the welcome-banner flag (consumed on first device-editor
      // mount) and the highlight signal key off the same string.
      // Pre-rename flag survives a rename only if the user opens
      // the editor first — if they rename before opening, the rename
      // flow drops the flag (see ``clearJustCreated`` call in
      // ``_executeRename``); they've already engaged with the device
      // so the welcome banner would just be noise.
      markJustCreated(`${name}.yaml`);
      this.close();
      fireEvent(this, "adopted", { name, friendlyName });
    } catch (err) {
      this._error = formatApiError(err, this._localize, "dashboard.adopt_error_generic");
    } finally {
      /* Always clear the busy state. On success the dialog closes
         and the user never sees this — but if anything downstream
         of the await throws, the dialog stays open and the Submit
         button has to be live again so the user can retry or edit
         the inputs. Resetting only in the catch branch would leave
         the button stuck on "Taking control…" in that edge case. */
      this._busy = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-adopt-dialog": ESPHomeAdoptDialog;
  }
}
