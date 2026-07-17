import { mdiAlertCircle, mdiCheckCircle } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";

import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import type { ESPHomeAnsiLog } from "../ansi-log.js";
import {
  processTerminalStyles,
  termButtonStyles,
  termTokens,
} from "./process-terminal.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../ansi-log.js";

registerMdiIcons({
  "check-circle": mdiCheckCircle,
  "alert-circle": mdiAlertCircle,
});

/** Terminal status. ``null`` = no banner / no card icon (in-flight stream, or
 *  a card step like "choose binary" that has no status icon). */
export type ProcessTerminalState = "running" | "success" | "error" | null;

/**
 * Shared presentational surface for the compile / install / logs dialogs
 * (#346). Owns the log output, the success/error status banner (stream) or
 * status card (card variant), the progress bar, the streaming dot, and the
 * toolbar layout. Holds **no** business state and no API handle — drivers
 * (command-dialog, logs-dialog, firmware-install-dialog) feed it props and
 * project their variable controls through the named slots:
 *
 * - ``sub-line``     — "Building on <receiver>" row (command), above the log
 * - ``overlay``      — queued overlay (command), covers only the log area
 * - ``suggestion``   — reset / validation failure hint (command, install)
 * - ``status-extra`` — binary picker / download instructions / collapsible
 *                      logs (install card variant)
 * - ``toolbar-left`` — leading toolbar controls (logs: back-to-install)
 * - ``toolbar-right``— action buttons (stop / retry / close / toggles)
 *
 * ``variant="stream"`` (default) is the full-height dark terminal used by
 * command-dialog + logs-dialog; ``variant="card"`` is the compact centered
 * surface used by the firmware-install dialog (no built-in log — the install
 * dialog slots its own collapsible log into ``status-extra``).
 */
@customElement("esphome-process-terminal")
export class ESPHomeProcessTerminal extends LitElement {
  /** Log lines for the built-in ansi-log (stream variant only). */
  @property({ attribute: false }) lines: readonly string[] = [];

  @property() placeholder = "";

  /** Mirror of ``!darkMode``; drives the ``--term-*`` light palette + ansi-log. */
  @property({ type: Boolean, reflect: true }) light = false;

  /** Renders the pulsing streaming dot in the toolbar. */
  @property({ type: Boolean }) streaming = false;

  @property() state: ProcessTerminalState = null;
  @property() statusMessage = "";
  @property() statusDetail = "";

  /** 0–100 to show the card progress bar; ``null`` hides it. */
  @property({ type: Number }) progress: number | null = null;

  @property() variant: "stream" | "card" = "stream";

  @query("esphome-ansi-log")
  private _ansiLog?: ESPHomeAnsiLog;

  static styles = [espHomeStyles, termTokens, termButtonStyles, processTerminalStyles];

  /** Clear the ansi-log's user-scrolled latch and re-pin to the bottom.
   *  Drivers call this after a state transition shrinks the log container
   *  (banner appears) so trailing lines stay visible. Stream variant only —
   *  the card variant's log is driver-owned. */
  public scrollToBottom(): void {
    this._ansiLog?.scrollToBottom();
  }

  private _renderBanner() {
    if (this.state !== "success" && this.state !== "error") return nothing;
    const isSuccess = this.state === "success";
    return html`
      <div class="status-banner status-banner--${isSuccess ? "success" : "error"}">
        <wa-icon
          library="mdi"
          name=${isSuccess ? "check-circle" : "alert-circle"}
        ></wa-icon>
        <span>${this.statusMessage}</span>
      </div>
    `;
  }

  private _renderStream() {
    return html`
      <div class="content">
        <slot name="sub-line"></slot>
        <div class="log-area">
          <esphome-ansi-log
            .lines=${this.lines}
            placeholder=${this.placeholder}
            ?light=${this.light}
          ></esphome-ansi-log>
          <slot name="overlay"></slot>
        </div>
        ${this._renderBanner()}
        <slot name="suggestion"></slot>
        <div class="terminal-toolbar">
          ${
            this.streaming
              ? html`<span class="streaming-dot" aria-hidden="true"></span>`
              : nothing
          }
          <slot name="toolbar-left"></slot>
          <span class="spacer"></span>
          <slot name="toolbar-right"></slot>
        </div>
      </div>
    `;
  }

  private _renderStatusIcon() {
    if (this.state === "running") return html`<wa-spinner></wa-spinner>`;
    if (this.state === "success") {
      return html`<wa-icon
        class="status-icon status-icon--success"
        library="mdi"
        name="check-circle"
      ></wa-icon>`;
    }
    if (this.state === "error") {
      return html`<wa-icon
        class="status-icon status-icon--error"
        library="mdi"
        name="alert-circle"
      ></wa-icon>`;
    }
    return nothing;
  }

  private _renderCard() {
    return html`
      <div class="card">
        <div class="status">
          ${this._renderStatusIcon()}
          ${
            this.statusMessage
              ? html`<span class="status-text">${this.statusMessage}</span>`
              : nothing
          }
          ${
            this.statusDetail
              ? html`<span class="status-detail">${this.statusDetail}</span>`
              : nothing
          }
        </div>
        ${
          this.progress !== null
            ? html`<div class="progress-bar">
                <div class="progress-bar-fill" style="width:${this.progress}%"></div>
              </div>`
            : nothing
        }
        <slot name="suggestion"></slot>
        <slot name="status-extra"></slot>
        <slot name="toolbar-right"></slot>
      </div>
    `;
  }

  protected render() {
    return this.variant === "card" ? this._renderCard() : this._renderStream();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-process-terminal": ESPHomeProcessTerminal;
  }
}
