import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { ESP_SERIAL_LOGS } from "../../platforms/esp/serial-logs.js";
import type { SerialLogsPolicy } from "../../platforms/serial-logs.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { warningBannerStyles } from "../../styles/banners.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getErrorMessage } from "../../util/error-message.js";
import { isPortPickerCancel, webSerialAvailability } from "../../util/web-serial.js";
import "../dashboard/esphome-web-card.js";
import "../dashboard/esphome-web-unsupported-card.js";
import { cardActionsRowStyles } from "../dashboard/card-actions-row.js";
import { openPortForLogs } from "../logs/open-port-for-logs.js";
import type { FlashPart } from "../platforms/esp/firmware-build.js";
import { acquireBootLogs } from "./boot-logs.js";
import { flashReceiverStyles } from "./esphome-web-flash-receiver.styles.js";
import { FlashHandshake, parseFlasherParams } from "./flash-handshake.js";
import {
  DEFAULT_HANDOFF_FLASHER,
  type FirmwareMessage,
  type FlashState,
  HANDOFF_FLASHERS,
  type HandoffFlasher,
} from "./protocol.js";
import {
  RECEIVER_ENGINES,
  type ReceiverEngine,
  type ReceiverNote,
  type ReceiverRun,
} from "./receiver-engine.js";

import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../../components/ansi-log.js";
import "../logs/esphome-web-logs-dialog.js";
import { preloadEsptool } from "../../platforms/esp/index.js";

const MAX_LOG_LINES = 10000;

/**
 * The web.esphome.io postMessage flash receiver ("ew-web-flash"). Rendered by
 * the app shell when opened as a flash target (``#nonce=…`` + a ``window.opener``)
 * — the hand-off the dashboard uses when it can't flash itself (HA add-on over
 * plain http, where Web Serial is blocked). It authenticates the opener, takes
 * the firmware over postMessage, flashes it with the engine the frame names
 * (esptool by default, the RTL8720C ROM downloader; see ``receiver-engine.ts``),
 * and relays state/progress back so the dashboard mirrors it. A manual file
 * picker is the fallback if no firmware arrives; it flashes ESP images.
 */
@customElement("esphome-web-flash-receiver")
export class ESPHomeWebFlashReceiver extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;

  @state() private _state: FlashState | "idle" = "idle";
  @state() private _statusMessage = "";
  @state() private _progress: number | null = null;
  @state() private _logLines: string[] = [];
  @state() private _firmware?: FirmwareMessage;
  @state() private _deviceName?: string;
  @state() private _busy = false;
  @state() private _flashDone = false;
  @state() _logsOpen = false;
  // Live handle for the rebooted device's boot logs. Streamed (and closed)
  // by the logs dialog; kept here so the Logs button can reopen it later.
  @state() _logPort?: SerialPort;
  // What the board needs from the user mid-flash (a strap, a reset), shown
  // with the flasher's guide until the engine moves on.
  @state() private _waiting: ReceiverNote | null = null;
  // The logs policy of the flasher that last ran, for the boot logs after.
  private _logsPolicy: SerialLogsPolicy = ESP_SERIAL_LOGS;
  // The handed-over image's run, settled before the click (see _prepare).
  private _prepared: Promise<ReceiverRun | null> = Promise.resolve(null);
  // Prepares the handed-over image again, kept until it has succeeded once:
  // a chunk that failed to load must not leave the tab unable to retry.
  private _reprepare?: () => Promise<ReceiverRun | null>;

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
  _bootLogsGen = 0;
  // Batched log buffer flushed on the next animation frame (mirrors the logs
  // dialog): an esptool output flood would otherwise trigger a render per line.
  private _pendingLog: string[] = [];
  private _flushScheduled = 0;

  connectedCallback(): void {
    super.connectedCallback();
    // The page exists to flash: warm the esptool chunk while the hand-off arrives.
    preloadEsptool();
    // And its receiver engine, so the manual file path's click reaches the
    // port picker without a chunk fetch; a miss is reported by _prepare.
    void RECEIVER_ENGINES.esp().catch(() => {});
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
          // Derived from the same one-time read that drives render()'s
          // unsupported card, so the two can never disagree.
          webSerial: !this._unsupported,
          flashers: [...HANDOFF_FLASHERS],
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
    const parts = msg.parts.map((p) => ({
      data: new Uint8Array(p.data),
      address: p.address,
    }));
    this._reprepare = () =>
      this._prepare(parts, msg.erase !== false, msg.flasher ?? DEFAULT_HANDOFF_FLASHER);
    this._startPrepare();
    // The prepared run owns the bytes from here; the card only needs the names.
    this._firmware = { ...msg, parts: [] };
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
  private _setState(state: FlashState, detail: string, note?: string): void {
    this._state = state;
    this._statusMessage = detail;
    this._handshake?.postState(state, detail, note);
  }

  private _setProgress(pct: number): void {
    // An engine reports per block; the percentage moves far less often.
    if (pct === this._progress) return;
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
    if (this._busy) return;
    if (!this._firmware) {
      const file = this._fileInput?.files?.[0];
      if (!file) {
        this._setState("error", this._localize("web.flash.choose_file"));
        return;
      }
      // Held from here: the read and the check must not let a second click in.
      this._busy = true;
      let data: Uint8Array;
      try {
        data = new Uint8Array(await file.arrayBuffer());
      } catch (err) {
        // The file changed or went away after it was picked.
        console.error("[flash receiver] Could not read the picked file:", err);
        this._busy = false;
        this._setState("error", this._localize("web.flash.choose_file"));
        return;
      }
      await this._runInstall(
        this._prepare([{ data, address: 0 }], true, DEFAULT_HANDOFF_FLASHER)
      );
      return;
    }
    // Held from here, so a second click cannot start a second preparation.
    this._busy = true;
    if (!(await this._prepared)) {
      // The earlier preparation failed. Preparing again can outlast this
      // click's user activation, which the port picker needs, so show the
      // firmware as ready and take the next click for the install.
      this._startPrepare();
      const ready = await this._prepared;
      this._busy = false;
      if (ready) {
        this._setState("connecting", this._localize("web.flash.firmware_ready"));
      }
      return;
    }
    await this._runInstall(this._prepared);
  }

  private _startPrepare(): void {
    const prepare = this._reprepare;
    if (!prepare) return;
    this._prepared = prepare().then((run) => {
      // The run holds what it needs; let the handed-over bytes go.
      if (run) this._reprepare = undefined;
      return run;
    });
  }

  /**
   * Load the flasher's engine and check the image, ahead of the click: the
   * click then goes straight to the port picker, inside its user activation,
   * and a bad image is named before the user is asked for a port. Resolves
   * null once the failure is on the card.
   */
  private async _prepare(
    parts: FlashPart[],
    erase: boolean,
    flasher: HandoffFlasher
  ): Promise<ReceiverRun | null> {
    let engine: ReceiverEngine;
    try {
      engine = await RECEIVER_ENGINES[flasher]();
    } catch (err) {
      console.error("[flash receiver] Could not load the engine chunk:", err);
      this._setState("error", this._localize("firmware.engine_load_failed"));
      return null;
    }
    try {
      const plan = await engine.prepare(parts, erase, this._localize);
      if ("error" in plan) {
        this._setState("error", plan.error);
        return null;
      }
      this._logsPolicy = engine.logs;
      return plan.run;
    } catch (err) {
      // An engine broke its never-throws contract: name the image, not the network.
      console.error("[flash receiver] The engine could not check the image:", err);
      this._setState(
        "error",
        `${this._localize("web.flash.invalid_image")} (${getErrorMessage(err)})`
      );
      return null;
    }
  }

  private async _runInstall(prepared: Promise<ReceiverRun | null>): Promise<void> {
    this._busy = true;
    const run = await prepared;
    if (!run) {
      this._busy = false;
      return;
    }
    this._flashDone = false;
    this._progress = null;
    this._waiting = null;
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

    const result = await run(port, {
      onState: (state, message) => {
        this._waiting = null;
        this._setState(state, message);
      },
      onProgress: (pct) => this._setProgress(pct),
      onLog: (line) => this._enqueueLog(line),
      onWaiting: (note) => {
        this._waiting = note;
        // The dashboard shows the instruction too, on the state it mirrors.
        if (this._state !== "idle") {
          this._handshake?.postState(this._state, this._statusMessage, note.message);
        }
      },
    });

    this._busy = false;
    if (!result) return;

    this._flashDone = true;
    this._progress = null;
    this._waiting = result.note ?? null;
    this._setState(
      "done",
      this._hasOpener
        ? this._localize("web.flash.done_opener")
        : this._localize("web.flash.done"),
      result.note?.message
    );
    if (!result.rebooted) {
      // No reboot to follow: park the port so Logs opens it once the user
      // has reset the board.
      this._logPort = port;
      return;
    }
    // The engine already reset + disconnected the device; show its boot logs
    // in the shared logs dialog (reset / download / stop-start / reconnect).
    await acquireBootLogs(this, port, before);
  }

  // Reopen the boot-log dialog after the user closed it (the dialog closed
  // the port on hide; reopen it in the click gesture like the device cards).
  private async _onViewLogs(): Promise<void> {
    const port = this._logPort;
    if (!port) return;
    const gen = this._bootLogsGen;
    if (!(await openPortForLogs(port, this._localize, this._logsPolicy))) return;
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
    this._waiting = null;
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
            this._waiting
              ? html`<p class="waiting" role="status">
                  ${this._waiting.message}
                  ${
                    this._waiting.guide
                      ? html` <a
                          href=${this._waiting.guide.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          >${this._waiting.guide.label}</a
                        >`
                      : nothing
                  }
                </p>`
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
        .policy=${this._logsPolicy}
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
    flashReceiverStyles,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-flash-receiver": ESPHomeWebFlashReceiver;
  }
}
