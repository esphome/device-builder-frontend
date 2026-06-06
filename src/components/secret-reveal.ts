/**
 * Inline masked value with a show/hide eye and a copy button — the shared
 * reveal widget for a secret/credential value. Mirrors the api-key dialog's
 * reveal styling.
 *
 * The value can be supplied directly (`value`, e.g. a just-generated credential)
 * or resolved lazily (`resolve`, e.g. fetching a `!secret` reference's stored
 * value from secrets.yaml only when the user clicks the eye), so it serves both
 * the security-notice reveal dialog and the secret picker without duplication.
 */
import { consume } from "@lit/context";
import { mdiContentCopy, mdiEye, mdiEyeOff } from "@mdi/js";
import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { copyToClipboard } from "../util/copy-to-clipboard.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "content-copy": mdiContentCopy,
  eye: mdiEye,
  "eye-off": mdiEyeOff,
});

const MASK = "••••••••••";

@customElement("esphome-secret-reveal")
export class ESPHomeSecretReveal extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** The value to show, when known up front (e.g. a just-generated credential). */
  @property() value?: string;

  /** Lazy value source — invoked once on first reveal/copy when `value` is
   *  unset (e.g. fetch a secret's value from secrets.yaml on demand). */
  @property({ attribute: false }) resolve?: () => Promise<string | null>;

  /** Re-mask and drop any cached value when this changes — the host passes the
   *  identity of what's being revealed (e.g. the selected secret key) so
   *  switching targets doesn't leak the previous value. */
  @property() resetKey = "";

  @state() private _revealed = false;
  @state() private _resolved?: string;
  @state() private _busy = false;
  /** Bumped whenever the target changes, to discard a stale in-flight resolve. */
  private _token = 0;

  protected willUpdate(changed: PropertyValues): void {
    // Re-mask and invalidate any in-flight resolve when the target changes.
    if (changed.has("value") || changed.has("resolve") || changed.has("resetKey")) {
      this._revealed = false;
      this._resolved = undefined;
      this._busy = false;
      this._token++;
    }
  }

  static styles = [
    espHomeStyles,
    css`
      .wrap {
        display: inline-flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        max-width: 100%;
      }

      .value {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-normal);
        word-break: break-all;
        user-select: all;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: var(--wa-border-radius-m);
        background: transparent;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
        transition:
          background 0.12s,
          color 0.12s;
      }

      .btn:hover:not(:disabled) {
        background: var(--wa-color-surface-border);
        color: var(--wa-color-text-normal);
      }

      .btn:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .btn wa-icon {
        font-size: 15px;
      }
    `,
  ];

  /** The resolved value, or undefined if not yet known. */
  private get _value(): string | undefined {
    return this.value ?? this._resolved;
  }

  /** Resolve the value if needed. Returns the value (possibly `""`) when it's
   *  current, or `null` to ignore — the resolver rejected (it surfaces its own
   *  error) or the target changed while the resolve was in flight. */
  private async _ensureValue(): Promise<string | null> {
    if (this._value !== undefined) return this._value;
    if (!this.resolve) return null; // no value source — nothing to reveal/copy
    const token = this._token;
    this._busy = true;
    try {
      const value = await this.resolve();
      if (token !== this._token) return null; // target changed mid-flight
      // Don't cache an absent/failed (null) resolve, so a later click retries.
      if (value === null) return null;
      this._resolved = value;
      return value;
    } catch {
      return null; // leave uncached so a retry can re-fetch
    } finally {
      if (token === this._token) this._busy = false;
    }
  }

  private _onToggle = (): void => {
    if (this._revealed) {
      this._revealed = false;
      return;
    }
    if (this._value !== undefined) {
      this._revealed = true;
      return;
    }
    void this._ensureValue().then((value) => {
      if (value !== null) this._revealed = true; // null = failed/stale → stay masked
    });
  };

  private _onCopy = async (): Promise<void> => {
    // `!== null` not truthiness, so a legitimately empty secret still copies.
    const value = await this._ensureValue();
    if (value !== null && (await copyToClipboard(value))) {
      toast.success(this._localize("device.secret_reveal_copied"), { richColors: true });
    }
  };

  protected render() {
    return html`
      <span class="wrap">
        <span class="value">${this._revealed ? (this._value ?? "") : MASK}</span>
        <button
          class="btn"
          type="button"
          ?disabled=${this._busy}
          title=${this._localize(
            this._revealed ? "device.secret_reveal_hide" : "device.secret_reveal_show"
          )}
          aria-label=${this._localize(
            this._revealed ? "device.secret_reveal_hide" : "device.secret_reveal_show"
          )}
          @click=${this._onToggle}
        >
          <wa-icon library="mdi" name=${this._revealed ? "eye-off" : "eye"}></wa-icon>
        </button>
        <button
          class="btn"
          type="button"
          ?disabled=${this._busy}
          title=${this._localize("device.secret_reveal_copy")}
          aria-label=${this._localize("device.secret_reveal_copy")}
          @click=${this._onCopy}
        >
          <wa-icon library="mdi" name="content-copy"></wa-icon>
        </button>
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-secret-reveal": ESPHomeSecretReveal;
  }
}
