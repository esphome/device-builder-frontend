import { consume } from "@lit/context";
import { mdiTextBoxOutline, mdiUpload } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import type { LibreTinyInstall } from "../install/esphome-web-libretiny-install-dialog.js";
import "../install/esphome-web-libretiny-install-dialog.js";
import "../logs/esphome-web-logs-dialog.js";
import { pickPortForLogs } from "../util/pick-port-for-logs.js";
import { cardActionsRowStyles } from "./card-actions-row.js";
import "./esphome-web-card.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

registerMdiIcons({ upload: mdiUpload, "text-box-outline": mdiTextBoxOutline });

/** A family's card: its copy, its logs and its install. */
export interface LibreTinyCard {
  readonly copy: {
    readonly title: string;
    readonly hint: string;
    readonly logs: string;
  };
  readonly logs: SerialLogsPolicy;
  /** Any family's install fits: its methods take the image, so TypeScript checks them bivariantly. */
  readonly install: LibreTinyInstall<unknown>;
}

/**
 * The card of a chip that sits behind a serial adapter: no connected state;
 * each install picks its own port and flashes through the chip's downloader,
 * and each logs session picks its own port. The family is the ``card`` it is
 * given.
 */
@customElement("esphome-web-libretiny-card")
export class LibreTinyCardElement extends LitElement {
  /** The family this card is for. */
  @property({ attribute: false }) card!: LibreTinyCard;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _installOpen = false;
  // Install was clicked while the dialog was on its way out.
  private _installAgain = false;
  @state() private _logsPort?: SerialPort;
  // A picker is up; a second click must not open another beside it.
  private _picking = false;

  private async _showLogs(): Promise<void> {
    if (this._picking || this._logsPort) return;
    this._picking = true;
    try {
      const port = await pickPortForLogs(this, this._localize, this.card.logs);
      if (port) this._logsPort = port;
    } finally {
      this._picking = false;
    }
  }

  private _openInstall(): void {
    // Open, the dialog covers this button, so a click that finds it set
    // came while it was hiding: its after-hide is yet to come and would
    // close what the click asked for.
    if (this._installOpen) this._installAgain = true;
    this._installOpen = true;
  }

  private async _onInstallHidden(): Promise<void> {
    this._installOpen = false;
    if (!this._installAgain) return;
    this._installAgain = false;
    // The dialog is told that it closed before it opens anew.
    await this.updateComplete;
    this._installOpen = true;
  }

  private _onLogsHidden(): void {
    this._logsPort = undefined;
  }

  protected render() {
    const { copy, logs, install } = this.card;
    return html`
      <esphome-web-card
        status=${this._localize("web.status.not_connected")}
        variant="neutral"
      >
        <span slot="header">${this._localize(copy.title)}</span>
        ${this._localize(copy.hint)}
        <div class="card-actions-row" slot="actions">
          <button class="action-btn action-btn--primary" @click=${this._openInstall}>
            <wa-icon library="mdi" name="upload"></wa-icon>
            ${this._localize("dashboard.install")}
          </button>
          <button
            id="btn-logs"
            class="action-btn action-btn--ghost action-btn--tile"
            aria-label=${this._localize(copy.logs)}
            @click=${this._showLogs}
          >
            <wa-icon library="mdi" name="text-box-outline"></wa-icon>
          </button>
          <wa-tooltip for="btn-logs">${this._localize(copy.logs)}</wa-tooltip>
        </div>
      </esphome-web-card>
      <esphome-web-libretiny-install-dialog
        .install=${install}
        ?open=${this._installOpen}
        @after-hide=${this._onInstallHidden}
      ></esphome-web-libretiny-install-dialog>
      <esphome-web-logs-dialog
        .port=${this._logsPort}
        ?open=${this._logsPort !== undefined}
        .deviceLabel=${this._localize(copy.title)}
        .policy=${logs}
        @after-hide=${this._onLogsHidden}
      ></esphome-web-logs-dialog>
    `;
  }

  static styles = [espHomeStyles, actionBtnStyles, cardActionsRowStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-libretiny-card": LibreTinyCardElement;
  }
}
