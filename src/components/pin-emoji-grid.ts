import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { pinSha256ToEmojis } from "../util/pin-emoji.js";

/**
 * Render a SHA-256 pin as a row of evenly-spaced emojis; the
 * visualisation each side of an OOB verification compares. The
 * emoji glyph is the canonical signal, so the names show only as
 * per-emoji ``title`` tooltips and the grid's combined
 * ``aria-label`` (screen readers), not as visible labels.
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

    /* Emoji-only row, evenly distributed across the card width. Wraps rather
       than overflowing in a narrow host; space-evenly (not space-between) keeps
       inter-glyph spacing consistent if it wraps, so the fingerprint reads as
       one cohesive strip instead of a ragged last row. With no name labels the
       seven glyphs fit one line wherever there's room (the pair-confirm card). */
    .grid {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-evenly;
      align-items: center;
      gap: var(--wa-space-xs);
    }

    /* Lean on the platform emoji font; overriding font-family
       here would force Web-safe fallbacks on systems whose
       monospace font has poorer emoji glyphs than the OS
       default. */
    .emoji {
      font-size: 1.5rem;
      line-height: 1;
    }
  `;

  protected render() {
    const slots = pinSha256ToEmojis(this.pin);
    if (slots.length === 0) return null;
    // ``lang="en"`` because the emoji names are English; screen readers in
    // non-English locales use it to pick the right pronunciation for the
    // combined aria-label. Each emoji is ``aria-hidden`` so the fingerprint
    // is announced once via the grid's aria-label, not per-glyph; the
    // ``title`` gives sighted users the name on hover.
    return html`
      <div class="grid" role="img" lang="en" aria-label=${this._ariaLabel(slots)}>
        ${slots.map(
          (slot) => html`
            <span class="emoji" title=${slot.name} aria-hidden="true">${slot.emoji}</span>
          `
        )}
      </div>
    `;
  }

  private _ariaLabel(slots: ReadonlyArray<{ name: string }>): string {
    // Single combined label so screen readers announce the
    // sequence as one fingerprint instead of N separate images.
    return slots.map((s) => s.name).join(", ");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-pin-emoji-grid": ESPHomePinEmojiGrid;
  }
}
