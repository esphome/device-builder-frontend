/**
 * Password text input with a reveal/hide toggle. Uses an internal
 * `_revealed` state so flipping the input type doesn't survive a
 * parent re-render — the toggle is purely UI and never travels back
 * through `value` events.
 *
 * The outer chrome (border, focus ring, invalid styling) lives in the
 * shared `inputStyles`; the toggle button is positioned over the
 * input on the right and inherits standard form-control padding.
 */

import { mdiEye, mdiEyeOff } from "@mdi/js";
import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  eye: mdiEye,
  "eye-off": mdiEyeOff,
});

// Event contract lives in a side-effect-free module so tests can
// import the builder without pulling in the webawesome
// CSSStyleSheet polyfill (which fails in Node).
import {
  PASSWORD_INPUT_VALUE_CHANGE_EVENT,
  buildPasswordValueChangeEvent,
  type PasswordInputValueChange,
} from "./password-input-event.js";
export {
  PASSWORD_INPUT_VALUE_CHANGE_EVENT,
  buildPasswordValueChangeEvent,
  type PasswordInputValueChange,
};

@customElement("esphome-password-input")
export class ESPHomePasswordInput extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  value = "";

  @property()
  placeholder = "";

  @property({ type: Boolean })
  disabled = false;

  @property({ type: Boolean })
  invalid = false;

  /** Optional client-side cap on input length. Mirrors the ``maxlength``
   *  attribute on a native ``<input>``; surfaces immediate feedback
   *  instead of round-tripping through a backend rejection for known
   *  caps (e.g. ESPHome's 64-char WPA password). Default 0 (no cap)
   *  so existing call sites stay unchanged. */
  @property({ type: Number })
  maxlength = 0;

  /** Optional accessible name forwarded to the inner ``<input>`` as
   *  ``aria-label``. Custom elements aren't labelable form controls,
   *  so an external ``<label for="...">`` won't reliably bind to
   *  the inner input — pass the label text in here when the visible
   *  label lives outside this component. Default empty (no
   *  ``aria-label`` attribute) so existing call sites are
   *  unchanged. */
  @property()
  label = "";

  @state()
  private _revealed = false;

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      :host {
        display: block;
      }

      .wrap {
        position: relative;
      }

      input {
        /* Make room for the toggle so long values don't slide
           underneath it. The toggle is 32px wide + 8px breathing
           room. */
        padding-right: 40px;
      }

      .toggle {
        position: absolute;
        top: 50%;
        right: 6px;
        transform: translateY(-50%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--wa-color-text-quiet);
        border-radius: var(--wa-border-radius-s);
        cursor: pointer;
        transition:
          background 0.12s,
          color 0.12s;
      }

      .toggle:hover {
        background: color-mix(in srgb, var(--wa-color-text-normal), transparent 92%);
        color: var(--wa-color-text-normal);
      }

      .toggle:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .toggle wa-icon {
        font-size: 16px;
      }
    `,
  ];

  protected render() {
    const label = this._localize(
      this._revealed ? "device.password_hide" : "device.password_reveal"
    );
    return html`
      <div class="wrap">
        <input
          type=${this._revealed ? "text" : "password"}
          class=${this.invalid ? "invalid" : ""}
          .value=${this.value}
          ?disabled=${this.disabled}
          placeholder=${this.placeholder}
          autocomplete="off"
          maxlength=${this.maxlength > 0 ? this.maxlength : nothing}
          aria-label=${this.label || nothing}
          @input=${this._onInput}
        />
        <button
          type="button"
          class="toggle"
          ?disabled=${this.disabled}
          aria-label=${label}
          title=${label}
          aria-pressed=${this._revealed}
          @click=${this._onToggle}
        >
          <wa-icon library="mdi" name=${this._revealed ? "eye-off" : "eye"}></wa-icon>
        </button>
      </div>
    `;
  }

  private _onInput(e: Event) {
    // Deliberately fire `password-input-change` (not `input`) so
    // the native InputEvent that bubbles out of the inner
    // `<input>` can never collide with our synthesised event on
    // a consumer's host-level listener — `@password-input-change`
    // sees only ours, `@input` sees only the native one. The
    // form already uses `value-change` for its own (different-
    // shape) event, so a distinct name keeps that channel free.
    const next = (e.target as HTMLInputElement).value;
    this.value = next;
    this.dispatchEvent(buildPasswordValueChangeEvent(next));
  }

  private _onToggle() {
    this._revealed = !this._revealed;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-password-input": ESPHomePasswordInput;
  }
}
