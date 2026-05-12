import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { AdoptableDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { validateDeviceName } from "../util/config-validation.js";
import { markJustCreated } from "../util/just-created.js";
import { previewPackageImportUrl } from "../util/package-import-url.js";
import { renderInlineError } from "../util/render-error.js";

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
  @state() private _open = false;

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      esphome-base-dialog {
        --width: 460px;
      }

      esphome-base-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      esphome-base-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      esphome-base-dialog::part(footer) {
        display: none;
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

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) 0 var(--wa-space-l);
      }

      .btn {
        padding: 8px 18px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition: background 0.12s;
      }

      .btn--cancel {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--cancel:hover {
        background: var(--wa-color-surface-border);
      }

      .btn--primary {
        background: var(--esphome-success);
        color: var(--esphome-on-primary);
      }

      .btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-success), black 10%);
      }

      .btn--primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
    this._open = true;
  }

  close = () => {
    /* Arrow function so ``@click=${this.close}`` from the cancel
       button keeps ``this`` bound to the dialog. With a plain method,
       Lit hands the listener to ``addEventListener`` which calls it
       with ``this === undefined`` (strict mode) and the property
       access below would blow up. */
    this._open = false;
  };

  private _onAfterHide = (): void => {
    // <esphome-base-dialog> re-emits after-hide for every
    // dismissal path (Esc / outside-click / X / reactive
    // ?open flip). Flip our local open flag so the next
    // render's ?open binding matches.
    this._open = false;
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
    const canSubmit = !!device && !!nameTrimmed && !nameErr && !this._busy;
    const displayName = device ? device.friendly_name || device.name : "";

    return html`
      <esphome-base-dialog
        ?open=${this._open}
        ?busy=${this._busy}
        .label=${this._localize("dashboard.adopt_title")}
        @after-hide=${this._onAfterHide}
      >
        ${device
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
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter" && canSubmit) this._submit();
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
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === "Enter" && canSubmit) this._submit();
                  }}
                />
              </div>

              <label class="checkbox-row">
                <input
                  type="checkbox"
                  ?checked=${this._encryption}
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

              ${this._error
                ? html`<div class="submit-error">${this._error}</div>`
                : nothing}

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
                  ${this._busy
                    ? this._localize("dashboard.adopt_submit_busy")
                    : this._localize("dashboard.adopt_submit")}
                </button>
              </div>
            `
          : nothing}
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
    if (!this._device || !this._api) return;
    const name = this._name.trim();
    const friendlyName = this._friendlyName.trim();
    if (!name || validateDeviceName(name)) return;

    this._busy = true;
    this._error = null;
    try {
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
      this.dispatchEvent(
        new CustomEvent("adopted", {
          detail: { name, friendlyName },
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      this._error =
        err instanceof Error
          ? err.message
          : this._localize("dashboard.adopt_error_generic");
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
