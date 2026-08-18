import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";

import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { warningBannerStyles } from "../../styles/banners.js";
import { espHomeStyles } from "../../styles/shared.js";
import { isPortPickerCancel, webSerialAvailability } from "../../util/web-serial.js";
import { cardActionsRowStyles } from "../dashboard/card-actions-row.js";
import "../dashboard/esphome-web-card.js";
import "../dashboard/esphome-web-unsupported-card.js";
import { runFlash } from "../install/run-flash.js";
import { openPortForLogs } from "../logs/esphome-web-logs-dialog.js";
import type { FlashPart } from "../util/esphome-web-firmware.js";
import { FlashHandshake, parseFlasherParams } from "./flash-handshake.js";
import { validateEspImage } from "./image-magic.js";
import { openLiveLogPort } from "./live-log-port.js";
import type { FirmwareMessage, FlashState } from "./protocol.js";

import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../../components/ansi-log.js";
import "../logs/esphome-web-logs-dialog.js";

const MAX_LOG_LINES = 10000;
const LOG_BAUD_RATE = 115200;
// Native-USB chips re-enumerate on reset; wait this long for the running
// firmware's port to reappear before giving up on logs.
const LOG_REOPEN_TIMEOUT_MS = 8000;

/**
 * The web.esphome.io postMessage flash receiver ("ew-web-flash"). Rendered by
 * the app shell when opened as a flash target (``#nonce=…`` + a ``window.opener``)
 * — the hand-off the dashboard uses when it can't flash itself (HA add-on over
 * plain http, where Web Serial is blocked). It authenticates the opener, takes
 * the firmware over postMessage, flashes it via the shared ``runFlash`` engine,
 * and relays state/progress back so the dashboard mirrors it. A manual file
 * picker is the fallback if no firmware arrives.
 */
@customElement("esphome-web-flash-receiver")
export class ESPHomeWebFlashReceiver extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _state: FlashState | "idle" = "idle";
  @state() private _statusMessage = "";
  @state() private _progress: number | null = null;
  @state() private _logLines: string[] = [];
  @state() private _firmware?: FirmwareMessage;
  @state() private _deviceName?: string;
  @state() private _busy = false;
  @state() private _flashDone = false;
  @state() private _logsOpen = false;
  // Live handle for the rebooted device's boot logs. Streamed (and closed)
  // by the logs dialog; kept here so the Logs button can reopen it later.
  @state() private _logPort?: SerialPort;

  @query("input[type=file]") private _fileInput?: HTMLInputElement;
  @state() private _hasFile = false;

  private _handshake?: FlashHandshake;
  private _hasOpener = false;
  // Computed once: Web Serial support doesn't change over the page's life.
  // The dashboard always hands off through this component (opener + nonce),
  // so unlike <esphome-web-dashboard> this is the only place that ever tells
  // a Safari (or insecure-context) user their browser can't do this at all.
  private readonly _serialAvailability = webSerialAvailability();
  private readonly _unsupported = this._serialAvailability !== "available";
  // Supersedes a pending boot-log acquisition (a second manual flash during
  // the re-enumeration wait, or an unmount mid-await).
  private _bootLogsGen = 0;
  // Batched log buffer flushed on the next animation frame (mirrors the logs
  // dialog): an esptool output flood would otherwise trigger a render per line.
  private _pendingLog: string[] = [];
  private _flushScheduled = 0;

  connectedCallback(): void {
    super.connectedCallback();
    const params = parseFlasherParams(window.location.hash);
    this._hasOpener = window.opener != null;
    if (params && window.opener) {
      this._handshake = new FlashHandshake(
        {
          opener: window.opener,
          params,
          messageTarget: window,
          // Advertised on the ready frame so the dashboard can decline the
          // hand-off up front (e.g. Safari: this https origin CAN feature-
          // detect Web Serial, unlike the dashboard's plain-http origin).
          webSerial: webSerialAvailability() === "available",
        },
        {
          onFirmware: (msg) => this._onFirmware(msg),
          onMalformed: () =>
            this._setState("error", this._localize("web.flash.malformed")),
          onTimeout: () =>
            this._setState("error", this._localize("web.flash.handoff_timeout")),
        }
      );
      this._handshake.start();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._handshake?.stop();
    this._bootLogsGen++;
    // A parked (or handed-over-but-not-yet-streamed) handle has no dialog
    // left to release it; a closed or dialog-owned one rejects harmlessly.
    void this._logPort?.close().catch(() => {});
    if (this._flushScheduled) cancelAnimationFrame(this._flushScheduled);
  }

  private _onFirmware(msg: FirmwareMessage): void {
    if (this._unsupported) {
      // The tab already shows <esphome-web-unsupported-card> (see render());
      // relay it as an error too so the dashboard — now handed off — doesn't
      // just sit waiting up to its own timeout for a tab that can never flash.
      // Bail before retaining the firmware or retitling the tab "Flashing …":
      // nothing below applies to a page that can't flash.
      this._setState(
        "error",
        this._serialAvailability === "insecure-context"
          ? this._localize("web.unsupported.insecure")
          : this._localize("web.unsupported.browser")
      );
      return;
    }
    this._firmware = msg;
    // Name the tab + card after the device so several concurrent flash tabs are
    // distinguishable (legacy did the same with the transmitted device name).
    if (msg.deviceName) {
      this._deviceName = msg.deviceName;
      document.title = this._localize("web.flash.tab_title", {
        name: msg.deviceName,
      });
    }
    this._setState(
      "connecting",
      msg.name
        ? this._localize("web.flash.firmware_ready_named", { name: msg.name })
        : this._localize("web.flash.firmware_ready")
    );
  }

  // Update local state AND relay it to the opener so the dashboard mirrors it.
  private _setState(state: FlashState, detail: string): void {
    this._state = state;
    this._statusMessage = detail;
    this._handshake?.postState(state, detail);
  }

  private _setProgress(pct: number): void {
    this._progress = pct;
    this._handshake?.postProgress(pct);
  }

  // Buffer a log line; flush on the next animation frame so a flood renders
  // once per frame instead of per line.
  private _enqueueLog(line: string): void {
    this._pendingLog.push(line);
    if (this._pendingLog.length > 2 * MAX_LOG_LINES) {
      this._pendingLog = this._pendingLog.slice(-MAX_LOG_LINES);
    }
    if (this._flushScheduled) return;
    this._flushScheduled = requestAnimationFrame(() => {
      this._flushScheduled = 0;
      this._flushLog();
    });
  }

  private _flushLog(): void {
    if (this._pendingLog.length === 0) return;
    const merged = [...this._logLines, ...this._pendingLog];
    this._logLines =
      merged.length > MAX_LOG_LINES ? merged.slice(-MAX_LOG_LINES) : merged;
    this._pendingLog = [];
  }

  private _resetLog(): void {
    this._pendingLog = [];
    if (this._flushScheduled) {
      cancelAnimationFrame(this._flushScheduled);
      this._flushScheduled = 0;
    }
    this._logLines = [];
  }

  private _onFileChange(): void {
    this._hasFile = (this._fileInput?.files?.length ?? 0) > 0;
    // In no-opener (manual) mode the primary button is disabled once a flash is
    // done. Picking another file starts a fresh attempt, so clear the done state
    // — otherwise a second manual flash would need a full page reload.
    if (this._flashDone) {
      this._flashDone = false;
      this._resetForRetry();
    }
  }

  private async _onPrimary(): Promise<void> {
    if (this._flashDone) {
      window.close();
      return;
    }
    if (this._firmware) {
      const parts = this._firmware.parts.map((p) => ({
        data: new Uint8Array(p.data),
        address: p.address,
      }));
      await this._runInstall(parts, this._firmware.erase !== false);
      return;
    }
    const file = this._fileInput?.files?.[0];
    if (!file) {
      this._setState("error", this._localize("web.flash.choose_file"));
      return;
    }
    const data = new Uint8Array(await file.arrayBuffer());
    await this._runInstall([{ data, address: 0 }], true);
  }

  private async _runInstall(parts: FlashPart[], erase: boolean): Promise<void> {
    if (this._busy) return;
    if (!validateEspImage(parts)) {
      this._setState("error", this._localize("web.flash.invalid_image"));
      return;
    }
    this._busy = true;
    this._flashDone = false;
    this._progress = null;
    // End any prior flash's log session outright: the generation bump only
    // supersedes a still-pending acquisition; closing the dialog releases a
    // streaming one (after-hide → _stop), and the stale handle must not
    // back the Logs button across installs.
    this._bootLogsGen++;
    this._logsOpen = false;
    this._logPort = undefined;
    this._resetLog();

    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch (err) {
      if (!isPortPickerCancel(err)) {
        this._setState("error", this._localize("web.flash.no_port"));
      } else {
        this._resetForRetry();
      }
      this._busy = false;
      return;
    }

    // Snapshot authorized ports before the flash/reset so the live-log
    // re-acquire can tell the re-enumerated handle from an existing board.
    let before: SerialPort[] = [];
    try {
      before = await navigator.serial.getPorts();
    } catch {
      // tolerate; openLiveLogPort falls back to VID/PID matching
    }

    const ok = await runFlash(
      port,
      {
        erase,
        filesCallback: async () => parts,
        messages: {
          connectFailed: this._localize("web.install.connect_failed_hint"),
          noFirmware: this._localize("web.install.no_firmware"),
        },
      },
      {
        onStep: (step) => {
          if (step === "connecting") {
            this._setState("connecting", this._localize("firmware.status_connecting"));
          } else if (step === "erasing") {
            this._setState("installing", this._localize("web.flash.erasing"));
          } else if (step === "flashing") {
            this._setState("installing", this._localize("dashboard.status_installing"));
          }
        },
        onProgress: (pct) => this._setProgress(pct),
        onLog: (line) => this._enqueueLog(line),
        onError: (message) => this._setState("error", message),
      }
    );

    this._busy = false;
    if (!ok) return;

    this._flashDone = true;
    this._progress = null;
    this._setState(
      "done",
      this._hasOpener
        ? this._localize("web.flash.done_opener")
        : this._localize("web.flash.done")
    );
    // runFlash already reset + disconnected the device; show its boot logs in
    // the shared logs dialog (reset / download / stop-start / reconnect).
    await this._openBootLogs(port, before);
  }

  /**
   * Open the logs dialog on the rebooted device. The dialog opens immediately
   * (its "Waiting…" placeholder covers the re-enumeration window) while
   * ``openLiveLogPort`` acquires and opens the live handle — its 8k buffer
   * holds the earliest boot bytes until the dialog's reader attaches, so
   * nothing is lost and the port is never reopened. Closing the dialog
   * mid-wait does NOT abort the acquisition — the handle still lands in
   * ``_logPort`` for the Logs button, so an early Escape and a late one
   * end the same way. Only a newer install or an unmount supersedes it,
   * via the generation counter.
   */
  private async _openBootLogs(oldPort: SerialPort, before: SerialPort[]): Promise<void> {
    const gen = ++this._bootLogsGen;
    this._logsOpen = true;
    const { port, error } = await openLiveLogPort(
      oldPort,
      before,
      LOG_BAUD_RATE,
      LOG_REOPEN_TIMEOUT_MS,
      () => gen !== this._bootLogsGen
    );
    if (!port) {
      if (gen === this._bootLogsGen) {
        // Announced even after the user closed the dialog: the alternative
        // is a silent dead end with no Logs button and no explanation.
        this._logsOpen = false;
        toast.error(
          this._localize("web.flash.logs_unavailable", {
            error: error ?? this._localize("web.flash.no_reenumerate"),
          })
        );
      }
      return;
    }
    // Clear DTR/RTS so holding the port open doesn't reset the chip.
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch {
      // tolerate; the chip may already be fine
    }
    // The stream can die during the await above (device yanked mid-hand-off);
    // a dead handle behind the dialog's "Waiting…" would never resolve.
    // Same contract as the !port branch: announced and parked regardless of
    // the dialog being open — openPortForLogs can often reopen a UA-closed
    // handle, so the Logs button stays a one-click recovery.
    if (!port.readable) {
      try {
        await port.close();
      } catch {
        // already closed
      }
      if (gen === this._bootLogsGen) {
        this._logsOpen = false;
        toast.error(
          this._localize("web.flash.logs_unavailable", {
            error: this._localize("web.logs.terminal_disconnected"),
          })
        );
        this._logPort = port;
      }
      return;
    }
    // Close the handle unless the open dialog is about to stream it (a
    // dialog closed mid-hand-off gets it back closed, so an accidental
    // Escape is a one-click recovery via the Logs button); park it unless
    // a newer install or an unmount superseded this acquisition.
    if (gen !== this._bootLogsGen || !this._logsOpen) {
      try {
        await port.close();
      } catch {
        // already closed
      }
    }
    if (gen === this._bootLogsGen) this._logPort = port;
  }

  // Reopen the boot-log dialog after the user closed it (the dialog closed
  // the port on hide; reopen it in the click gesture like the device cards).
  private async _onViewLogs(): Promise<void> {
    const port = this._logPort;
    if (!port) return;
    const gen = this._bootLogsGen;
    if (!(await openPortForLogs(port, this._localize))) return;
    // A flash started (or the receiver unmounted) during the reopen: the
    // dialog must not cover the new install, and the handle just opened
    // would otherwise be orphaned open for the tab's lifetime.
    if (gen !== this._bootLogsGen || this._logPort !== port) {
      // A failure here is a genuine leak — the freshly-opened handle has no
      // other owner left to release it.
      void port.close().catch((err) => {
        console.error("[Web Serial] Failed to release the superseded reopen:", err);
      });
      return;
    }
    this._logsOpen = true;
  }

  // Clear a stale bar/state so a fresh attempt starts clean (cancel path).
  private _resetForRetry(): void {
    this._state = this._firmware ? "connecting" : "idle";
    this._statusMessage = this._firmware
      ? this._localize("web.flash.firmware_ready")
      : "";
    this._progress = null;
  }

  private get _primaryLabel(): string {
    if (this._flashDone) {
      return this._hasOpener
        ? this._localize("web.flash.close_tab")
        : this._localize("command.done");
    }
    return this._localize("web.flash.connect_install");
  }

  private get _primaryDisabled(): boolean {
    if (this._flashDone) return !this._hasOpener;
    if (this._busy) return true;
    return !this._firmware && !this._hasFile;
  }

  private get _hint(): string {
    return this._hasOpener
      ? this._localize("web.flash.hint_opener")
      : this._localize("web.flash.hint_direct");
  }

  protected render() {
    if (this._unsupported) {
      return html`<div class="wrap">
        <esphome-web-unsupported-card></esphome-web-unsupported-card>
      </div>`;
    }
    return html`
      <div class="wrap">
        <esphome-web-card status=${this._localize("web.flash.status")} variant="neutral">
          <span slot="header"
            >${this._deviceName ?? this._localize("web.flash.title")}</span
          >
          <p class="hint">${this._hint}</p>
          ${
            this._state !== "idle"
              ? html`<div class="status status--${this._state}">
                  ${this._busy ? html`<wa-spinner></wa-spinner>` : nothing}
                  <span>${this._statusMessage}</span>
                </div>`
              : nothing
          }
          ${
            this._busy
              ? html`<p class="warning-banner">
                  ${this._localize("firmware.flashing_keep_visible")}
                </p>`
              : nothing
          }
          ${
            this._progress !== null
              ? html`<div class="progress">
                  <div class="progress-fill" style="width:${this._progress}%"></div>
                </div>`
              : nothing
          }
          <esphome-ansi-log
            .lines=${this._logLines}
            placeholder=${this._localize("web.flash.log_placeholder")}
          ></esphome-ansi-log>
          ${
            this._firmware
              ? nothing
              : html`<label class="manual">
                  <span>${this._localize("web.flash.manual")}</span>
                  <input type="file" accept=".bin" @change=${this._onFileChange} />
                </label>`
          }
          <div class="card-actions-row" slot="actions">
            ${
              // Recovery affordance only: hidden while the dialog itself
              // holds (and streams) the port. _logPort implies a completed
              // flash — _runInstall clears it on every fresh attempt.
              this._logPort && !this._logsOpen
                ? html`<button
                    class="action-btn action-btn--ghost"
                    @click=${this._onViewLogs}
                  >
                    ${this._localize("dashboard.logs")}
                  </button>`
                : nothing
            }
            <button
              class="action-btn action-btn--primary"
              ?disabled=${this._primaryDisabled}
              @click=${this._onPrimary}
            >
              ${this._primaryLabel}
            </button>
          </div>
        </esphome-web-card>
      </div>
      <esphome-web-logs-dialog
        .port=${this._logPort}
        ?open=${this._logsOpen}
        .deviceLabel=${this._deviceName ?? this._localize("web.flash.title")}
        @port-replaced=${(e: CustomEvent<SerialPort>) => {
          this._logPort = e.detail;
        }}
        @after-hide=${() => {
          this._logsOpen = false;
        }}
      ></esphome-web-logs-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    actionBtnStyles,
    cardActionsRowStyles,
    warningBannerStyles,
    css`
      .wrap {
        width: 90%;
        max-width: 34rem;
        margin: var(--wa-space-2xl) auto;
      }
      .hint {
        margin: 0 0 var(--wa-space-s);
        color: var(--wa-color-text-quiet);
      }
      .warning-banner {
        margin: 0 0 var(--wa-space-s);
      }
      .status {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        margin-bottom: var(--wa-space-s);
        font-weight: var(--wa-font-weight-semibold);
      }
      .status wa-spinner {
        font-size: 1rem;
      }
      .status--error {
        color: var(--esphome-error);
      }
      .status--done {
        color: var(--esphome-success);
      }
      .progress {
        height: 6px;
        border-radius: 999px;
        background: var(--wa-color-surface-lowered);
        overflow: hidden;
        margin-bottom: var(--wa-space-s);
      }
      .progress-fill {
        height: 100%;
        background: var(--esphome-primary);
        transition: width 0.2s;
      }
      esphome-ansi-log {
        display: block;
        height: min(45vh, 22rem);
        border-radius: var(--wa-border-radius-m);
        overflow: hidden;
      }
      .manual {
        display: block;
        margin-top: var(--wa-space-m);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }
      .manual input {
        display: block;
        margin-top: var(--wa-space-2xs);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-flash-receiver": ESPHomeWebFlashReceiver;
  }
}
