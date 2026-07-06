/**
 * Small explanatory popover for an annotated log line.
 *
 * Rendered once inside ``ansi-log`` and re-anchored per click. Uses the
 * native Popover API so it promotes to the top layer — escaping the log
 * container's ``overflow`` clipping and any ancestor dialog's transform —
 * and gets Escape / outside-click light-dismiss for free.
 */
import { mdiOpenInNew } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "open-in-new": mdiOpenInNew });

// Gap between the anchor and the popover, and the keep-on-screen inset.
const OFFSET = 6;
const MARGIN = 8;

@customElement("esphome-log-doc-popover")
export class ESPHomeLogDocPopover extends LitElement {
  /** Popover title — the component name or a short message summary. */
  @property({ attribute: false }) heading = "";

  /** One-line explanation shown above the docs link. */
  @property({ attribute: false }) body = "";

  /** Whitelisted esphome.io URL the "View docs" link opens. */
  @property({ attribute: false }) url = "";

  /** Localized label for the docs link. */
  @property({ attribute: false }) linkLabel = "";

  // Popover API methods typed optional so environments without the API
  // degrade to a no-op instead of crashing the log viewer.
  @query(".pop") private _pop?: HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };

  static styles = css`
    .pop {
      position: fixed;
      inset: auto;
      margin: 0;
      max-width: 280px;
      padding: 12px 14px;
      background: var(--wa-color-surface-default);
      color: var(--wa-color-text-normal);
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-l);
      box-shadow: var(--wa-shadow-m);
      font-size: 13px;
      line-height: 1.5;
    }
    .heading {
      font-weight: 600;
      margin-bottom: 4px;
      word-break: break-word;
    }
    .body {
      margin: 0 0 10px;
      color: var(--wa-color-text-quiet);
    }
    .link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--wa-color-brand-fill-loud, var(--wa-color-text-link));
      text-decoration: none;
      font-weight: 500;
    }
    .link:hover {
      text-decoration: underline;
    }
  `;

  protected render() {
    return html`
      <div class="pop" popover="auto" role="dialog" aria-label=${this.heading || nothing}>
        <div class="heading">${this.heading}</div>
        ${this.body ? html`<p class="body">${this.body}</p>` : nothing}
        <a
          class="link"
          href=${this.url}
          target="_blank"
          rel="noopener noreferrer"
          @click=${this._onLinkClick}
        >
          <wa-icon library="mdi" name="open-in-new"></wa-icon>${this.linkLabel}
        </a>
      </div>
    `;
  }

  /** Open the popover anchored below (or above) *anchor*. */
  async showAt(anchor: HTMLElement) {
    // The caller assigns heading/body/url right before calling; wait out the
    // re-render so the measured size reflects the new content — measuring the
    // previous content under-clamps and the popover can run off-screen.
    await this.updateComplete;
    const pop = this._pop;
    if (!pop?.showPopover) return;
    // Re-show from a clean state: showPopover throws on an already-open
    // popover, and hidePopover throws when it's already closed.
    if (pop.matches(":popover-open")) pop.hidePopover?.();
    pop.showPopover();
    const a = anchor.getBoundingClientRect();
    const rect = pop.getBoundingClientRect();
    let top = a.bottom + OFFSET;
    if (top + rect.height > window.innerHeight - MARGIN) {
      const above = a.top - rect.height - OFFSET;
      if (above >= MARGIN) top = above;
    }
    let left = a.left;
    if (left + rect.width > window.innerWidth - MARGIN) {
      left = window.innerWidth - MARGIN - rect.width;
    }
    pop.style.top = `${Math.max(MARGIN, top)}px`;
    pop.style.left = `${Math.max(MARGIN, left)}px`;
  }

  /** Close the popover if open. */
  hide() {
    const pop = this._pop;
    // hidePopover present implies :popover-open parses; guard both together.
    if (pop?.hidePopover && pop.matches(":popover-open")) pop.hidePopover();
  }

  private _onLinkClick = () => {
    // The browser opens the link in a new tab; drop the popover so it
    // isn't left hanging over the log when the user returns.
    this.hide();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-log-doc-popover": ESPHomeLogDocPopover;
  }
}
