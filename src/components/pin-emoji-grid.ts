import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { pinSha256ToEmojis } from "../util/pin-emoji.js";

/**
 * Render a SHA-256 pin as a row of large emojis with their
 * names underneath; the visualisation each side of an OOB
 * verification compares.
 *
 * The mapping itself lives in `util/pin-emoji.ts`; this
 * component is just the visual frame, kept as a Lit element
 * rather than a render helper so the shadow-DOM boundary
 * isolates the emoji typography from whatever spacing /
 * font scaling the host context uses (the receiver's Build
 * server card, the sender's pair-confirm step, and the
 * receiver's accept-peer dialog all live in different modal
 * shells with different inherited type sizes; without
 * encapsulation the emoji row jitters between them, which
 * defeats the "match the picture" UX).
 *
 * Renders nothing for an empty `pin` so a loading-state
 * caller can drop the element into the layout unconditionally
 * and have it disappear until the pin lands.
 */
@customElement("esphome-pin-emoji-grid")
export class ESPHomePinEmojiGrid extends LitElement {
  @property()
  pin = "";

  static styles = css`
    :host {
      display: block;
    }

    .grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    /* Cells are sized to fit a 4+3 layout inside a ~280px host
       (the typical width once the surrounding dialog padding +
       icon column eats into 420px); cell background is
       intentionally transparent so the row reads as a single
       fingerprint rather than a strip of buttons that invite
       clicking. */
    .cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
      min-width: 48px;
      padding: 2px 4px;
    }

    /* Lean on the platform emoji font; overriding font-family
       here would force Web-safe fallbacks on systems whose
       monospace font has poorer emoji glyphs than the OS
       default. */
    .emoji {
      font-size: 1.5rem;
      line-height: 1;
    }

    .name {
      font-size: var(--wa-font-size-xs, 11px);
      color: var(--wa-color-text-quiet);
      text-transform: lowercase;
      letter-spacing: 0.02em;
    }
  `;

  protected render() {
    const slots = pinSha256ToEmojis(this.pin);
    if (slots.length === 0) return null;
    // ``lang="en"`` because the emoji names are English; screen
    // readers in non-English locales use it to pick the right
    // pronunciation while the visible text serves sighted users
    // identically across locales. Per-cell name spans are
    // ``aria-hidden`` so screen readers announce the
    // fingerprint once via the grid's aria-label rather than
    // repeating each name twice (container label + cell text).
    return html`
      <div
        class="grid"
        role="img"
        lang="en"
        aria-label=${this._ariaLabel(slots)}
      >
        ${slots.map(
          (slot) => html`
            <div class="cell">
              <span class="emoji" aria-hidden="true">${slot.emoji}</span>
              <span class="name" aria-hidden="true">${slot.name}</span>
            </div>
          `,
        )}
      </div>
    `;
  }

  private _ariaLabel(slots: ReadonlyArray<{ name: string }>): string {
    // Single combined label so screen readers announce the
    // sequence as one fingerprint instead of N separate
    // images; the per-cell .name text remains the visual
    // identifier for sighted users (with aria-hidden so it
    // doesn't get double-announced via the container label).
    return slots.map((s) => s.name).join(", ");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-pin-emoji-grid": ESPHomePinEmojiGrid;
  }
}
