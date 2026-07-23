import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { dialogFieldStyles } from "../../styles/dialog-fields.js";
import { disclosureStyles } from "../../styles/disclosure.js";
import { inputStyles } from "../../styles/inputs.js";
import { slugifyHostname } from "../../util/slugify-hostname.js";
import {
  deviceNameValidity,
  renderDeviceNameField,
  type DeviceNameValidity,
} from "./device-name-field.js";
import { renderDisclosure } from "./disclosure.js";

/**
 * The shared friendly-name-first naming pair: a friendly-name input that
 * live-derives the hostname via ``slugifyHostname``, with the derived
 * hostname behind a chevron disclosure for overrides.
 *
 * Typing in the friendly field keeps the hostname in sync until the user
 * edits the hostname directly; clearing the hostname re-enables derivation.
 * A hard validation error force-opens the disclosure so the reason for a
 * disabled submit is never hidden. Hosts read ``friendlyName`` /
 * ``hostname`` / ``canSubmit`` off the element and re-render their submit
 * gating on the composed ``device-name-changed`` event; ``reset()``
 * reinitialises for a fresh open (optionally seeding the friendly name).
 */
@customElement("esphome-device-name-inputs")
export class ESPHomeDeviceNameInputs extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  friendlyLabelKey = "";

  @property({ attribute: false })
  friendlyPlaceholderKey = "";

  /** Optional helper line under the friendly-name input. */
  @property({ attribute: false })
  friendlyHelperKey = "";

  @property({ attribute: false })
  hostnamePlaceholder = "";

  /** Hostname rejected with `forbiddenErrorKey` (clone's same-as-source). */
  @property({ attribute: false })
  forbiddenHostname = "";

  @property({ attribute: false })
  forbiddenErrorKey = "";

  /** Focus the friendly-name input on connect (default true). */
  @property({ attribute: false })
  autofocusFriendly = true;

  @state()
  private _friendly = "";

  @state()
  private _hostname = "";

  // Latched once the user types in the hostname field directly; stops the
  // friendly-name input from clobbering their edit. Clearing the hostname
  // unlatches, so a bad manual edit is recoverable by emptying the field.
  @state()
  private _hostnameEdited = false;

  @state()
  private _open = false;

  static styles = [
    inputStyles,
    dialogFieldStyles,
    disclosureStyles,
    css`
      .disclosure-toggle {
        margin-top: var(--wa-space-2xs);
      }
    `,
  ];

  get friendlyName(): string {
    return this._friendly.trim();
  }

  get hostname(): string {
    return this._hostname.trim();
  }

  get validity(): DeviceNameValidity {
    const hostname = this.hostname;
    const showsValidation = hostname.length > 0;
    if (
      showsValidation &&
      this.forbiddenHostname &&
      hostname === this.forbiddenHostname
    ) {
      return { err: { code: this.forbiddenErrorKey }, warning: null };
    }
    return deviceNameValidity(hostname, showsValidation);
  }

  get canSubmit(): boolean {
    return this.hostname.length > 0 && !this.validity.err;
  }

  reset(prefillFriendly = "") {
    this._friendly = prefillFriendly;
    this._hostname = slugifyHostname(prefillFriendly);
    this._hostnameEdited = false;
    this._open = false;
  }

  protected render() {
    const validity = this.validity;
    // An error holds the panel open; collapsing would hide the one thing
    // blocking submit.
    const open = this._open || validity.err !== null;
    return html`
      <div class="field">
        <label for="device-friendly-name">${this._localize(this.friendlyLabelKey)}</label>
        <input
          id="device-friendly-name"
          type="text"
          autocomplete="off"
          ?autofocus=${this.autofocusFriendly}
          .value=${this._friendly}
          placeholder=${this._localize(this.friendlyPlaceholderKey)}
          @input=${this._onFriendlyInput}
        />
        ${
          this.friendlyHelperKey
            ? html`<span class="helper">${this._localize(this.friendlyHelperKey)}</span>`
            : nothing
        }
      </div>
      ${renderDisclosure({
        open,
        onToggle: () => {
          this._open = !open;
        },
        localize: this._localize,
        labelKey: "naming.hostname_disclosure",
        labelParams: { hostname: this.hostname || "…" },
        variant: "quiet",
        panelId: "hostname-panel",
        body: () => html`
          ${renderDeviceNameField({
            localize: this._localize,
            labelKey: "naming.hostname_label",
            value: this._hostname,
            validity,
            onInput: (value) => {
              this._hostname = value;
              this._hostnameEdited = value.trim().length > 0;
              this._notify();
            },
            id: "device-hostname",
            placeholder: this.hostnamePlaceholder,
            autofocus: false,
          })}
          <span class="helper">${this._localize("naming.hostname_helper")}</span>
        `,
      })}
    `;
  }

  private _onFriendlyInput = (e: Event) => {
    this._friendly = (e.target as HTMLInputElement).value;
    if (!this._hostnameEdited) {
      this._hostname = slugifyHostname(this._friendly);
    }
    this._notify();
  };

  private _notify() {
    this.dispatchEvent(
      new CustomEvent("device-name-changed", { bubbles: true, composed: true })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-name-inputs": ESPHomeDeviceNameInputs;
  }
}
