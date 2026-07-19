/**
 * Structured (form) side of the split secrets editor. The ``value`` YAML
 * is the source of truth; each edit splices one line via
 * ``util/secrets-entries`` and emits ``yaml-change`` like the YAML editor.
 */
import { consume } from "@lit/context";
import { mdiAlertCircleOutline, mdiClose, mdiPlus } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { devicesContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { modalDialogStyles } from "../../styles/modal-dialog.js";
import { espHomeStyles } from "../../styles/shared.js";
import { withBase } from "../../util/base-path.js";
import { fireEvent } from "../../util/fire-event.js";
import { navigate } from "../../util/navigation.js";
import { notifyError } from "../../util/notify.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { secretHostSlug } from "../../util/secret-eligibility.js";
import {
  addSecret,
  groupSecretsByDevice,
  isValidSecretKey,
  parseSecretsEntries,
  removeSecret,
  renameSecretKey,
  setSecretValue,
  type SecretEntry,
  type SecretGroup,
} from "../../util/secrets-entries.js";
import type { PasswordInputValueChange } from "../device/password-input-event.js";
import { secretsStructuredEditorStyles } from "./secrets-structured-editor.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "../base-dialog.js";
import "../device/password-input.js";

registerMdiIcons({
  "alert-circle-outline": mdiAlertCircleOutline,
  close: mdiClose,
  plus: mdiPlus,
});

@customElement("esphome-secrets-structured-editor")
export class ESPHomeSecretsStructuredEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  /** The secrets.yaml text — the single source of truth. */
  @property()
  value = "";

  /** Show real values; otherwise value inputs render as password dots. */
  @property({ type: Boolean })
  revealSensitive = false;

  /** Inline "invalid / duplicate key" message for the row being renamed. */
  @state()
  private _keyError: { line: number; message: string } | null = null;

  /** Add-secret dialog fields. ``target`` is "" for shared or a device name. */
  @state()
  private _addOpen = false;

  @state()
  private _addTarget = "";

  @state()
  private _addName = "";

  @state()
  private _addValue = "";

  @state()
  private _addError: string | null = null;

  static styles = [
    espHomeStyles,
    inputStyles,
    modalDialogStyles,
    secretsStructuredEditorStyles,
  ];

  protected render() {
    const entries = parseSecretsEntries(this.value);
    const groups = groupSecretsByDevice(entries);
    // Headers only earn their keep once a ``<device>__`` prefix appears;
    // a flat shared file stays a plain list.
    const grouped = groups.some((group) => group.device !== null);
    return html`
      ${
        entries.length === 0
          ? html`<div class="empty" role="status">
              ${this._localize("secrets.empty")}
            </div>`
          : grouped
            ? html`<div class="groups">
                ${groups.map((group) => this._renderGroup(group, entries))}
              </div>`
            : html`<div class="rows">
                ${entries.map((entry) => this._renderRow(entry, entries))}
              </div>`
      }
      <div class="add-row">
        <button type="button" class="btn btn--add" @click=${this._openAdd}>
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("secrets.add_secret")}
        </button>
      </div>
      ${this._renderAddDialog()}
    `;
  }

  private _renderGroup(group: SecretGroup, entries: SecretEntry[]) {
    return html`<div class="group">
      ${this._renderGroupHeader(group.device)}
      <div class="rows">
        ${group.entries.map((entry) => this._renderRow(entry, entries))}
      </div>
    </div>`;
  }

  private _renderGroupHeader(device: string | null) {
    if (device === null) {
      return html`<h2 class="group-header">
        ${this._localize("secrets.group_shared")}
      </h2>`;
    }
    // A device's secret prefix may keep its name verbatim (``pintest-direction``)
    // or swap hyphens for underscores (``apollo_r_pro``); normalize both sides
    // before matching so either spelling links.
    const norm = (s: string) => s.replace(/-/g, "_");
    const match = this._devices.find((d) => norm(d.name) === norm(device));
    if (!match) {
      return html`<h2 class="group-header">${device}</h2>`;
    }
    // The anchor href carries the deployment base path (HA ingress / reverse
    // proxy) so modifier-click / copy-link resolve correctly; ``navigate``
    // gets the un-based path and applies the base itself.
    const path = `/device/${encodeURIComponent(match.configuration)}`;
    const href = withBase(path);
    return html`<h2 class="group-header">
      <a
        href=${href}
        class="group-link"
        title=${this._localize("secrets.open_device")}
        @click=${(e: MouseEvent) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          // Fall back to a full navigation if the SPA router rejects, so the
          // click is never a silent no-op.
          navigate(path).catch(() => window.location.assign(href));
        }}
        >${device}</a
      >
    </h2>`;
  }

  private _renderAddDialog() {
    return html`<esphome-base-dialog
      ?open=${this._addOpen}
      .label=${this._localize("secrets.add_dialog_title")}
      .confirmOnEnter=${this._confirmAdd}
      @request-close=${this._closeAdd}
      @after-hide=${this._closeAdd}
    >
      <div class="body add-body">
        <div class="add-field">
          <span class="add-field-label" id="secret-target-label"
            >${this._localize("secrets.add_dialog_target")}</span
          >
          <wa-select
            class="add-select"
            aria-labelledby="secret-target-label"
            value=${this._addTarget}
            @change=${(e: Event) => {
              this._addTarget = (e.target as HTMLSelectElement).value;
              // A new target can resolve (or re-introduce) a duplicate via the
              // ``<device>__`` prefix, but can't fix an invalid name; recompute
              // only when an error is already shown so it isn't blanket-cleared.
              if (this._addError) this._addError = this._addKeyError();
            }}
          >
            <wa-option value="">${this._localize("secrets.group_shared")}</wa-option>
            ${this._devices.map(
              (d) =>
                html`<wa-option value=${d.name}>${d.friendly_name || d.name}</wa-option>`
            )}
          </wa-select>
        </div>
        <label class="add-field">
          <span class="add-field-label"
            >${this._localize("secrets.key_placeholder")}</span
          >
          <input
            class="add-name ${this._addError ? "invalid" : ""}"
            type="text"
            autocomplete="off"
            spellcheck="false"
            .value=${live(this._addName)}
            aria-invalid=${this._addError ? "true" : "false"}
            @input=${(e: Event) => {
              this._addName = (e.target as HTMLInputElement).value;
              this._addError = null;
            }}
          />
        </label>
        <label class="add-field">
          <span class="add-field-label"
            >${this._localize("secrets.value_placeholder")}</span
          >
          <esphome-password-input
            .value=${this._addValue}
            .revealed=${this.revealSensitive}
            label=${this._localize("secrets.value_placeholder")}
            placeholder=${this._localize("secrets.value_placeholder")}
            @password-input-change=${(e: CustomEvent<PasswordInputValueChange>) =>
              (this._addValue = e.detail.value)}
          ></esphome-password-input>
        </label>
        ${
          this._addError
            ? html`<div class="key-error" role="alert">${this._addError}</div>`
            : nothing
        }
      </div>
      <div class="actions">
        <button class="btn btn--cancel" @click=${this._closeAdd}>
          ${this._localize("layout.cancel")}
        </button>
        <button class="btn btn--add" @click=${this._confirmAdd}>
          ${this._localize("secrets.add_secret")}
        </button>
      </div>
    </esphome-base-dialog>`;
  }

  private _renderRow(entry: SecretEntry, entries: SecretEntry[]) {
    const keyInvalid = this._keyError?.line === entry.line;
    if (!entry.editable) {
      return html`<div class="row row--advanced">
        <input
          type="text"
          .value=${entry.key}
          readonly
          aria-label=${this._localize("secrets.key_placeholder")}
        />
        <span class="advanced-badge">
          <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
          ${this._localize("secrets.advanced_badge")}
        </span>
        <span></span>
      </div>`;
    }
    return html`<div class="row">
        <input
          type="text"
          class=${keyInvalid ? "invalid" : ""}
          .value=${live(entry.key)}
          autocomplete="off"
          spellcheck="false"
          placeholder=${this._localize("secrets.key_placeholder")}
          aria-label=${this._localize("secrets.key_placeholder")}
          aria-invalid=${keyInvalid ? "true" : "false"}
          @change=${(e: Event) =>
            this._onKeyChange(entry, entries, e.currentTarget as HTMLInputElement)}
        />
        <esphome-password-input
          class="value-input"
          .value=${entry.value}
          .revealed=${this.revealSensitive}
          label=${this._localize("secrets.value_placeholder")}
          placeholder=${this._localize("secrets.value_placeholder")}
          @password-input-change=${(e: CustomEvent<PasswordInputValueChange>) =>
            this._emit(setSecretValue(this.value, entry.line, e.detail.value))}
        ></esphome-password-input>
        <button
          type="button"
          class="icon-btn"
          title=${this._localize("secrets.remove_secret")}
          aria-label=${this._localize("secrets.remove_secret")}
          @click=${() => this._emit(removeSecret(this.value, entry.line))}
        >
          <wa-icon library="mdi" name="close"></wa-icon>
        </button>
      </div>
      ${
        keyInvalid
          ? html`<div class="key-error">${this._keyError?.message}</div>`
          : nothing
      }`;
  }

  private _onKeyChange(
    entry: SecretEntry,
    entries: SecretEntry[],
    input: HTMLInputElement
  ) {
    const newKey = input.value.trim();
    if (newKey === entry.key) {
      this._keyError = null;
      return;
    }
    if (!isValidSecretKey(newKey)) {
      this._keyError = {
        line: entry.line,
        message: this._localize("secrets.invalid_key"),
      };
      input.value = entry.key;
      return;
    }
    if (entries.some((other) => other.line !== entry.line && other.key === newKey)) {
      this._keyError = {
        line: entry.line,
        message: this._localize("secrets.duplicate_key"),
      };
      input.value = entry.key;
      return;
    }
    this._keyError = null;
    this._emit(renameSecretKey(this.value, entry.line, newKey));
  }

  private _openAdd = () => {
    this._addTarget = "";
    this._addName = "";
    this._addValue = "";
    this._addError = null;
    this._addOpen = true;
  };

  private _closeAdd = () => {
    this._addOpen = false;
  };

  private _addKey(): string {
    // Slug the device prefix so a hyphenated name (`temp-sensor`) lands under
    // the same `temp_sensor__` namespace the field picker uses, instead of a
    // second hyphenated group.
    const host = this._addTarget ? secretHostSlug(this._addTarget) : "";
    const name = this._addName.trim();
    return host ? `${host}__${name}` : name;
  }

  // Validate the dialog's name against the chosen target; null when valid.
  // The duplicate check depends on the ``<device>__`` prefix, so it can flip
  // when the target changes — an invalid identifier never can.
  private _addKeyError(): string | null {
    if (!isValidSecretKey(this._addName.trim())) {
      return this._localize("secrets.invalid_key");
    }
    if (parseSecretsEntries(this.value).some((entry) => entry.key === this._addKey())) {
      return this._localize("secrets.duplicate_key");
    }
    return null;
  }

  // Create the secret in one shot from the dialog fields, prefixing the key
  // with ``<device>__`` when a device was chosen so it lands in that group.
  private _confirmAdd = () => {
    // One-shot: honor confirmOnEnter's "self-guard against repeat" contract.
    // On success _addOpen flips false, so a synchronous second dispatch bails
    // here before it can double-add against the still-stale this.value. The
    // error path leaves _addOpen true so the user can resubmit after fixing.
    if (!this._addOpen) return;
    const error = this._addKeyError();
    if (error) {
      this._addError = error;
      return;
    }
    this._addOpen = false;
    this._emit(addSecret(this.value, this._addKey(), this._addValue));
  };

  // A splice helper returns null when its target line no longer matches
  // (a stale index from a concurrent edit). Re-render so the optimistic
  // input snaps back to the unchanged buffer, and toast so the dropped
  // edit is visible rather than a silent no-op.
  private _emit(value: string | null) {
    if (value === null) {
      notifyError(this._localize("secrets.edit_out_of_sync"));
      this.requestUpdate();
      return;
    }
    // A structural edit shifts line indices, so a stale rename error would
    // misattribute to whatever row now sits at that line; clear it.
    this._keyError = null;
    this.value = value;
    fireEvent(this, "yaml-change", { value });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-secrets-structured-editor": ESPHomeSecretsStructuredEditor;
  }
}
