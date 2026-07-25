import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";

import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { warningBannerStyles } from "../../styles/banners.js";
import { espHomeStyles } from "../../styles/shared.js";
import { isPortPickerCancel } from "../../util/web-serial.js";
import { cardActionsRowStyles } from "../dashboard/card-actions-row.js";
import "../dashboard/esphome-web-card.js";
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
        { opener: window.opener, params, messageTarget: window },
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
    if (this._flushScheduled) cancelAnimationFrame(this._flushScheduled);
  }

  private _onFirmware(msg: FirmwareMessage): void {
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
    this._bootLogsGen++; // abandon any prior flash's pending acquisition
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
   * mid-wait aborts the acquisition; a newer install or an unmount
   * supersedes it via the generation counter.
   */
  private async _openBootLogs(oldPort: SerialPort, before: SerialPort[]): Promise<void> {
    const gen = ++this._bootLogsGen;
    this._logPort = undefined;
    this._logsOpen = true;
    const { port, error } = await openLiveLogPort(
      oldPort,
      before,
      LOG_BAUD_RATE,
      LOG_REOPEN_TIMEOUT_MS,
      () => gen !== this._bootLogsGen || !this._logsOpen
    );
    if (!port) {
      if (gen === this._bootLogsGen && this._logsOpen) {
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
    // Superseded by a newer install or an unmount during the awaits above —
    // reclaim the handle; nothing will ever stream it.
    if (gen !== this._bootLogsGen) {
      try {
        await port.close();
      } catch {
        // already closed
      }
      return;
    }
    // The user closed the dialog mid-hand-off: release the handle but keep
    // it for the Logs button, so an accidental Escape is a one-click recovery.
    if (!this._logsOpen) {
      try {
        await port.close();
      } catch {
        // already closed
      }
      this._logPort = port;
      return;
    }
    this._logPort = port; // the open dialog picks it up and streams
  }

  // Reopen the boot-log dialog after the user closed it (the dialog closed
  // the port on hide; reopen it in the click gesture like the device cards).
  private async _onViewLogs(): Promise<void> {
    const port = this._logPort;
    if (!port) return;
    if (!(await openPortForLogs(port, this._localize))) return;
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
              // holds (and streams) the port.
              this._flashDone && this._logPort && !this._logsOpen
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
