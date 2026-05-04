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
import { css, html, LitElement } from "lit";
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
        background: color-mix(
          in srgb,
          var(--wa-color-text-normal),
          transparent 92%
        );
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
      this._revealed ? "device.password_hide" : "device.password_reveal",
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
          <wa-icon
            library="mdi"
            name=${this._revealed ? "eye-off" : "eye"}
          ></wa-icon>
        </button>
      </div>
    `;
  }

  private _onInput(e: Event) {
    // Stop the native input event from continuing to bubble. We
    // re-fire the same event name as a `CustomEvent` with a
    // `{value}` detail so consumers can use the shorter property
    // access; if the native event were also allowed through, the
    // host's `@input` listener would run twice — once with our
    // detail, once with the native event whose `detail` is the
    // numeric default `0` — and the second run would overwrite
    // the just-typed value with `undefined`.
    e.stopPropagation();
    const next = (e.target as HTMLInputElement).value;
    this.value = next;
    this.dispatchEvent(
      new CustomEvent("input", {
        detail: { value: next },
        bubbles: true,
        composed: true,
      }),
    );
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
