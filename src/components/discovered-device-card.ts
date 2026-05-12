import { consume } from "@lit/context";
import {
  mdiDownload,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiOpenInNew,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AdoptableDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { safeWebUiUrl } from "../util/web-ui-url.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  download: mdiDownload,
  "eye-off-outline": mdiEyeOffOutline,
  "eye-outline": mdiEyeOutline,
  "open-in-new": mdiOpenInNew,
});

@customElement("esphome-discovered-device-card")
export class ESPHomeDiscoveredDeviceCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  device!: AdoptableDevice;

  // When set, the card renders as a single horizontal row instead of
  // the default vertical card layout — used inside the dashboard's
  // discovered-section banner where the cards must fit a compact pill.
  @property({ type: Boolean, reflect: true })
  compact = false;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
        /* Grid stretches each row's items to the row height; without
           a 100% chain through the host and card, a card with a
           shorter title sits at its intrinsic height while a sibling
           with a wrapping title is taller, leaving the action row
           floating mid-card. Stretch the chain so the action row
           always lands at the bottom of every card in the row. */
        height: 100%;
      }

      .card {
        position: relative;
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-raised);
        display: flex;
        flex-direction: column;
        height: 100%;
        transition: box-shadow 0.15s;
      }

      .card:hover {
        box-shadow: var(--wa-shadow-m);
      }

      .card[data-ignored] {
        opacity: 0.6;
      }

      /* Status ribbon — green for fresh discoveries, neutral for
         ignored ones. Mirrors the legacy dashboard's "DISCOVERED" /
         "IGNORED DISCOVERY" pill so users get a consistent reading
         of the device's state at a glance. */
      .status {
        position: absolute;
        top: -8px;
        left: var(--wa-space-m);
        padding: 2px 8px;
        border-radius: 999px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: var(--esphome-success);
        color: var(--esphome-on-primary);
      }
      .card[data-ignored] .status {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
      }

      .header {
        padding: var(--wa-space-m) var(--wa-space-m) var(--wa-space-s);
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        /* Take all the spare height so the action row pins to the
           bottom of every card and siblings in the same grid row line
           up regardless of how many lines the title / subtitle wrap
           into. */
        flex: 1;
      }

      .title {
        margin: 0 0 var(--wa-space-2xs);
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .subtitle {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      .hostname {
        font-family:
          "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier,
          monospace;
        font-size: var(--wa-font-size-2xs);
        background: var(--wa-color-surface-lowered);
        border-radius: var(--wa-border-radius-s);
        padding: 1px 6px;
      }

      .actions {
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        padding: var(--wa-space-s) var(--wa-space-m);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 12px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: var(--wa-border-width-s) solid transparent;
        /* Reset anchor presentation so the Visit-web-UI link (rendered
           as <a> for rel=noopener security) matches the surrounding
           <button> controls — no underline, no visited tint. */
        text-decoration: none;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .btn--primary {
        background: var(--esphome-success);
        color: var(--esphome-on-primary);
      }

      .btn--primary:hover {
        background: color-mix(in srgb, var(--esphome-success), black 10%);
      }

      .btn--ghost {
        background: transparent;
        color: var(--wa-color-text-normal);
        border-color: var(--wa-color-surface-border);
      }

      .btn--ghost:hover {
        background: var(--wa-color-surface-lowered);
      }

      /* The last ghost button on the row pushes everything left of
         it; the visit-web link sits flush next to the take-control
         button without leaving a gap. */
      .actions .btn--ghost:last-child {
        margin-left: auto;
      }

      /* Compact icon-only variant for the Visit-web-UI link — same
         visual weight as the kebab/Ignore button but no text label
         since the open-in-new icon is self-explanatory. */
      .btn--icon {
        padding: 5px 7px;
      }

      .btn wa-icon {
        font-size: 15px;
      }

      /* ── Compact / single-line mode ──────────────────────────
         Used inside the dashboard's discovered-section banner.
         Collapses the card to one horizontal row so multiple
         discoveries can stack as a list. */
      :host([compact]) .card {
        flex-direction: row;
        align-items: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-s) var(--wa-space-m);
        background: transparent;
        border: none;
        border-radius: 0;
        box-shadow: none;
      }

      :host([compact]) .card:hover {
        box-shadow: none;
      }

      /* "DISCOVERED" / "IGNORED" pill — hidden in compact mode to
         save horizontal space; the container itself already conveys
         that these are discoveries. */
      :host([compact]) .status {
        display: none;
      }

      :host([compact]) .header {
        flex: 1;
        min-width: 0;
        padding: 0;
        border-bottom: none;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      :host([compact]) .title {
        margin: 0;
        font-size: var(--wa-font-size-m);
      }

      :host([compact]) .subtitle {
        font-size: var(--wa-font-size-xs);
      }

      :host([compact]) .actions {
        padding: 0;
        flex-shrink: 0;
      }

      /* Rows divider between stacked compact cards. */
      :host([compact]) {
        border-bottom: var(--wa-border-width-s) solid
          color-mix(in srgb, var(--esphome-primary), transparent 80%);
      }

      :host([compact]:last-child) {
        border-bottom: none;
      }
    `,
  ];

  protected render() {
    const title = this.device.friendly_name || this.device.name;
    const showHostname = !!this.device.friendly_name;
    /* ``web_url`` is built backend-side from mDNS service info, so
       in normal use it's always ``http://``. Run it through the
       shared guard anyway — a discovered device could advertise a
       service whose resolved URL parses as ``javascript:``, and
       feeding that into ``href`` lets a click execute the script. */
    const safeWebUrl = safeWebUiUrl(this.device.web_url);
    return html`
      <div class="card" ?data-ignored=${this.device.ignored}>
        <span class="status">
          ${this.device.ignored
            ? this._localize("dashboard.discovered_ignored")
            : this._localize("dashboard.discovered_status")}
        </span>
        <div class="header">
          <h3 class="title">${title}</h3>
          <div class="subtitle">
            ${showHostname
              ? html`<span class="hostname">${this.device.name}</span> · `
              : nothing}
            ${this.device.project_name}${this.device.project_version
              ? html` <span>${this.device.project_version}</span>`
              : nothing}
          </div>
        </div>
        <div class="actions">
          ${this.device.ignored
            ? nothing
            : html`
                <button
                  class="btn btn--primary"
                  @click=${() => this._emit("adopt")}
                >
                  <wa-icon library="mdi" name="download"></wa-icon>
                  ${this._localize("dashboard.action_take_control")}
                </button>
              `}
          ${safeWebUrl && !this.compact
            ? html`<a
                class="btn btn--ghost btn--icon"
                href=${safeWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                title=${this._localize("dashboard.action_visit_web_ui")}
                aria-label=${this._localize("dashboard.action_visit_web_ui")}
                @click=${(e: Event) => e.stopPropagation()}
              >
                <wa-icon library="mdi" name="open-in-new"></wa-icon>
              </a>`
            : nothing}
          <button
            class="btn btn--ghost"
            title=${this._localize(
              this.device.ignored
                ? "dashboard.action_unignore"
                : "dashboard.action_ignore",
            )}
            @click=${() => this._emit("toggle-ignore")}
          >
            <wa-icon
              library="mdi"
              name=${this.device.ignored ? "eye-outline" : "eye-off-outline"}
            ></wa-icon>
            ${this._localize(
              this.device.ignored
                ? "dashboard.action_unignore"
                : "dashboard.action_ignore",
            )}
          </button>
        </div>
      </div>
    `;
  }

  private _emit(name: string) {
    this.dispatchEvent(
      new CustomEvent(name, {
        detail: this.device,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-discovered-device-card": ESPHomeDiscoveredDeviceCard;
  }
}
