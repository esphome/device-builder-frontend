import { consume } from "@lit/context";
import { mdiHelpCircleOutline } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { dialogFieldStyles } from "../../styles/dialog-fields.js";
import { disclosureStyles } from "../../styles/disclosure.js";
import { inputStyles } from "../../styles/inputs.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { HOSTNAME_MAX_LEN, slugifyHostname } from "../../util/slugify-hostname.js";
import {
  deviceNameValidity,
  renderDeviceNameField,
  type DeviceNameValidity,
} from "./device-name-field.js";
import { renderDisclosure } from "./disclosure.js";

registerMdiIcons({ "help-circle-outline": mdiHelpCircleOutline });

/**
 * The shared friendly-name-first naming pair: a friendly-name input that
 * live-derives the hostname via ``slugifyHostname``, with the derived
 * hostname behind a chevron disclosure for overrides.
 *
 * Typing in the friendly field keeps the hostname in sync until the user
 * edits the hostname directly; clearing the hostname re-enables derivation
 * from the next friendly-name edit.
 * A hard validation error force-opens the disclosure so the reason for a
 * disabled submit is never hidden. Hosts read ``friendlyName`` /
 * ``hostname`` / ``canSubmit`` off the element and re-render their submit
 * gating on the composed ``device-name-changed`` event; ``reset()``
 * reinitialises for a fresh open (optionally seeding the friendly name).
 */
@customElement("esphome-device-name-inputs")
export class ESPHomeDeviceNameInputs extends LitElement {
  // base-dialog autofocuses via a light-DOM [autofocus] lookup that can't
  // pierce this shadow root; hosts mark the element itself and focus
  // delegates inward.
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  friendlyLabelKey = "";

  @property({ attribute: false })
  friendlyPlaceholderKey = "";

  /** Literal placeholder (already localized); wins over the key when set. */
  @property({ attribute: false })
  friendlyPlaceholder = "";

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

  /** Hostnames already in use; a collision blocks submit. */
  @property({ attribute: false })
  takenHostnames: ReadonlySet<string> = new Set();

  @state()
  private _friendly = "";

  @state()
  private _hostname = "";

  // Latched once the user types in the hostname field directly; stops the
  // friendly-name input from clobbering their edit. Clearing the hostname
  // unlatches; derivation resumes on the next friendly-name edit.
  @state()
  private _hostnameEdited = false;

  @state()
  private _open = false;

  static styles = [
    inputStyles,
    dialogFieldStyles,
    disclosureStyles,
    css`
      :host {
        display: block;
      }

      .hostname-row {
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        flex-wrap: wrap;
        margin-top: var(--wa-space-2xs);
      }

      /* DOM order is toggle, panel, help (the panel is welded to the toggle
         by renderDisclosure); visual order puts the help chip on the toggle
         row and the panel below both. */
      .hostname-row .help {
        order: 1;
      }

      .hostname-row .disclosure-panel {
        order: 2;
        flex-basis: 100%;
        margin-top: var(--wa-space-xs);
      }

      .help {
        display: inline-flex;
        padding: 0;
        background: none;
        border: none;
        cursor: help;
        color: var(--wa-color-text-quiet);
        font-size: 15px;
      }

      .help:hover {
        color: var(--wa-color-text-normal);
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
    if (!hostname && this.friendlyName) {
      // A name that slugs to nothing (all emoji / punctuation) would
      // otherwise disable submit with no visible reason.
      return { err: { code: "naming.hostname_required" }, warning: null };
    }
    if (hostname.length > HOSTNAME_MAX_LEN) {
      // The shared 63-char device-name validation is too loose here: the
      // backend enforces esphome's 31-char hostname cap.
      return {
        err: { code: "validation.max_length", params: { max: HOSTNAME_MAX_LEN } },
        warning: null,
      };
    }
    if (hostname.startsWith("-") || hostname.endsWith("-")) {
      // A warning elsewhere (rename keeps existing names working), but a hard
      // error for new names: the backend refuses them, and an RFC 1123 label
      // can't start or end with a hyphen. Derived slugs never produce one.
      return { err: { code: "validation.device_name_edge_hyphen" }, warning: null };
    }
    if (
      showsValidation &&
      this.forbiddenHostname &&
      this.forbiddenErrorKey &&
      hostname === this.forbiddenHostname
    ) {
      return { err: { code: this.forbiddenErrorKey }, warning: null };
    }
    const base = deviceNameValidity(hostname, showsValidation);
    if (showsValidation && !base.err && this.takenHostnames.has(hostname)) {
      // Hostnames must be unique on the network; surface a collision with a
      // configured device before submit instead of at the server round-trip.
      return {
        err: { code: "naming.hostname_taken", params: { hostname } },
        warning: null,
      };
    }
    return base;
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

  override focus(): void {
    const input = this.shadowRoot?.querySelector<HTMLInputElement>(
      "#device-friendly-name"
    );
    input?.focus();
    // Select-all so typing replaces a prefilled value (base-dialog does this
    // for bare inputs; the host indirection would otherwise lose it).
    input?.select();
  }

  protected render() {
    const validity = this.validity;
    // An error holds the panel open (it is the only place the blocking
    // reason renders). Warnings auto-open via the input handlers instead,
    // so the toggle stays functional — submit is enabled, and the user may
    // legitimately collapse an advisory.
    const open = this._open || validity.err !== null;
    return html`
      <div class="field">
        <label for="device-friendly-name">${this._localize(this.friendlyLabelKey)}</label>
        <input
          id="device-friendly-name"
          type="text"
          autocomplete="off"
          autofocus
          .value=${this._friendly}
          placeholder=${this.friendlyPlaceholder || this._localize(this.friendlyPlaceholderKey)}
          @input=${this._onFriendlyInput}
        />
        ${
          this.friendlyHelperKey
            ? html`<span class="helper">${this._localize(this.friendlyHelperKey)}</span>`
            : nothing
        }
      </div>
      <div class="hostname-row">
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
        <button
          type="button"
          class="help"
          id="hostname-help"
          aria-label=${this._localize("naming.hostname_help_label")}
        >
          <wa-icon library="mdi" name="help-circle-outline" aria-hidden="true"></wa-icon>
        </button>
        <wa-tooltip for="hostname-help">
          ${this._localize("naming.hostname_help")}
        </wa-tooltip>
      </div>
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
    if (this.validity.warning) {
      this._open = true;
    }
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
