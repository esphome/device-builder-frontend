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
import { LineBatcher } from "../../util/line-batcher.js";
import { webSerialAvailability } from "../../util/web-serial.js";
import "../dashboard/esphome-web-card.js";
import "../dashboard/esphome-web-unsupported-card.js";
import { cardActionsRowStyles } from "../dashboard/card-actions-row.js";
import { Preparation } from "../install/preparation.js";
import { openPortForLogs } from "../logs/open-port-for-logs.js";
import { acquireBootLogs } from "./boot-logs.js";
import { flashReceiverStyles } from "./esphome-web-flash-receiver.styles.js";
import { FlashHandshake, parseFlasherParams } from "./flash-handshake.js";
import {
  DEFAULT_HANDOFF_FLASHER,
  type FirmwareMessage,
  type FlashState,
  HANDOFF_FLASHERS,
  handoffLogsOf,
} from "./protocol.js";
import {
  RECEIVER_ENGINES,
  type ReceiverNote,
  type ReceiverRun,
  type ReceiverRunHooks,
} from "./receiver-engine.js";
import {
  prepareForReceiver,
  type ReceiverInput,
  type ReceiverPrepared,
} from "./receiver-preparation.js";

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
 * (esptool by default, the RTL8720C ROM downloader, PICOBOOT for a Pico; see
 * ``receiver-engine.ts``),
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
  // The image is checked and its engine loaded before the click; see the class.
  private _preparation = new Preparation<
    ReceiverInput | Promise<ReceiverInput>,
    ReceiverPrepared,
    string
  >(
    this,
    (input) => prepareForReceiver(input, this._localize),
    (error) => this._onPrepared(error),
    getErrorMessage
  );
  // The logs policy of the flasher that was last prepared. It outlives the
  // preparation, for the logs of a flash that is already done.
  private _logsPolicy: SerialLogsPolicy = ESP_SERIAL_LOGS;

  @query("input[type=file]") private _fileInput?: HTMLInputElement;

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
  // An esptool output flood would otherwise trigger a render per line.
  private _log = new LineBatcher(
    (batch) => {
      const merged = [...this._logLines, ...batch];
      this._logLines =
        merged.length > MAX_LOG_LINES ? merged.slice(-MAX_LOG_LINES) : merged;
    },
    { maxLines: MAX_LOG_LINES }
  );

  connectedCallback(): void {
    super.connectedCallback();
    // The page exists to flash: warm the esptool chunk while the hand-off arrives.
    preloadEsptool();
    // And its receiver engine, a chunk of its own, so an ESP hand-off is
    // ready as soon as it arrives; a miss is named by the preparation.
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
    this._log.reset();
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
    // The preparation owns the bytes from here; the card only needs the names.
    this._firmware = { ...msg, parts: [] };
    // Name the tab + card after the device so several concurrent flash tabs are
    // distinguishable (legacy did the same with the transmitted device name).
    if (msg.deviceName) {
      this._deviceName = msg.deviceName;
      document.title = this._localize("web.flash.tab_title", {
        name: msg.deviceName,
      });
    }
    this._setState("connecting", this._localize("web.install.preparing"));
    this._preparation.start({
      parts,
      erase: msg.erase !== false,
      flasher: msg.flasher ?? DEFAULT_HANDOFF_FLASHER,
      logs: handoffLogsOf(msg.logs),
    });
  }

  // A preparation ended: name why it failed, or show the firmware as ready.
  private _onPrepared(error: string | null): void {
    // A file that was dropped is unpicked too: the input fires no change for
    // the same file again, so it could not be picked a second time.
    if (this._fileInput && this._preparation.state.kind === "idle") {
      this._fileInput.value = "";
    }
    if (this._plan) this._logsPolicy = this._plan.logs;
    if (error !== null) this._setState("error", error);
    else if (this._firmware) this._setState("connecting", this._readyMessage());
    else this._resetForRetry();
  }

  private _readyMessage(): string {
    const name = this._firmware?.name;
    return name
      ? this._localize("web.flash.firmware_ready_named", { name })
      : this._localize("web.flash.firmware_ready");
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

  private _resetLog(): void {
    this._log.reset();
    this._logLines = [];
  }

  // Manual mode: the picked file is read and prepared here, not on the click.
  private _onFileChange(): void {
    const file = this._fileInput?.files?.[0];
    // The primary button is disabled once a flash is done. Picking another
    // file starts a fresh attempt, so clear the done state — otherwise a
    // second manual flash would need a full page reload.
    this._flashDone = false;
    this._resetForRetry();
    this._preparation.clear();
    if (!file) return;
    this._setState("connecting", this._localize("web.install.preparing"));
    // The read is part of the preparation, which a newer pick supersedes.
    this._preparation.start(
      file.arrayBuffer().then(
        (bytes) => ({
          parts: [{ data: new Uint8Array(bytes), address: 0 }],
          erase: true,
          flasher: DEFAULT_HANDOFF_FLASHER,
        }),
        (err: unknown) => {
          // The file changed or went away after it was picked.
          console.error("[flash receiver] Could not read the picked file:", err);
          throw new Error(this._localize("web.flash.choose_file"));
        }
      )
    );
  }

  private async _onPrimary(): Promise<void> {
    if (this._flashDone) {
      window.close();
      return;
    }
    if (this._working) return;
    const plan = this._plan;
    if (plan) {
      await this._runInstall(plan.run);
      return;
    }
    if (this._preparation.state.kind !== "retryable") return;
    // A chunk did not load earlier; load it again. The install is offered
    // once that is done, on a click of its own.
    this._setState("connecting", this._localize("web.install.preparing"));
    this._preparation.retry();
  }

  /** The ready plan, which the install and the engine's own copy come from. */
  private get _plan(): ReceiverPrepared | undefined {
    const preparation = this._preparation.state;
    return preparation.kind === "ready" ? preparation.value : undefined;
  }

  /**
   * Runs an engine's step from the click: nothing is awaited before it, as
   * it opens the chooser. Null when it failed or the chooser was dismissed.
   */
  private async _engine<T>(
    step: (hooks: ReceiverRunHooks) => Promise<T | "dismissed" | null>
  ): Promise<T | null> {
    this._busy = true;
    this._waiting = null;
    let outcome: T | "dismissed" | null;
    try {
      outcome = await step({
        onState: (state, message) => {
          this._waiting = null;
          this._setState(state, message);
        },
        onProgress: (pct) => this._setProgress(pct),
        onLog: (line) => this._log.enqueue(line),
        onWaiting: (note) => {
          this._waiting = note;
          // The dashboard shows the instruction too, on the state it mirrors.
          if (this._state !== "idle") {
            this._handshake?.postState(this._state, this._statusMessage, note.message);
          }
        },
      });
    } catch (err) {
      // An engine broke its never-throws contract; the card must not stay busy.
      console.error("[flash receiver] The engine threw:", err);
      this._waiting = null;
      this._setState("error", getErrorMessage(err));
      return null;
    } finally {
      this._busy = false;
      // The last lines are not left to a frame that may never come.
      this._log.flush();
    }
    if (outcome !== "dismissed") return outcome;
    this._resetForRetry();
    // The opener saw what the engine said ahead of its chooser; take it back.
    if (this._state !== "idle") {
      this._handshake?.postState(this._state, this._statusMessage);
    }
    return null;
  }

  private async _onBefore(): Promise<void> {
    const before = this._plan?.before;
    if (!before || this._working || this._flashDone) return;
    await this._engine(before.run);
  }

  private async _runInstall(run: ReceiverRun): Promise<void> {
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

    const result = await this._engine(run);
    if (!result) return;

    this._flashDone = true;
    this._progress = null;
    this._waiting = result.note ?? null;
    this._setState(
      "done",
      result.message ??
        this._localize(this._hasOpener ? "web.flash.done_opener" : "web.flash.done"),
      result.note?.message
    );
    const { logs } = result;
    if (!logs) return;
    if (!logs.rebooted) {
      // No reboot to follow: park the port so Logs opens it once the user
      // has reset the board.
      this._logPort = logs.port;
      return;
    }
    // The engine already reset + disconnected the device; show its boot logs
    // in the shared logs dialog (reset / download / stop-start / reconnect).
    await acquireBootLogs(this, logs.port, logs.knownPorts);
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
    this._statusMessage = this._firmware ? this._readyMessage() : "";
    this._progress = null;
  }

  private get _primaryLabel(): string {
    if (this._flashDone) {
      return this._hasOpener
        ? this._localize("web.flash.close_tab")
        : this._localize("command.done");
    }
    // A click then loads the chunk that did not load, and installs nothing.
    if (this._preparation.state.kind === "retryable") {
      return this._localize("command.retry");
    }
    return this._plan?.primaryLabel ?? this._localize("web.flash.connect_install");
  }

  // Flashing, or getting the firmware ready to.
  private get _working(): boolean {
    return this._busy || this._preparation.state.kind === "pending";
  }

  private get _primaryDisabled(): boolean {
    if (this._flashDone) return !this._hasOpener;
    return this._working || this._preparation.state.kind === "idle";
  }

  private get _hint(): string {
    if (this._plan?.hint) return this._plan.hint;
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
                  ${this._working ? html`<wa-spinner></wa-spinner>` : nothing}
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
                  <input
                    type="file"
                    accept=".bin"
                    ?disabled=${this._busy}
                    @change=${this._onFileChange}
                  />
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
            ${
              this._plan?.before && !this._flashDone
                ? html`<button
                    id="btn-before"
                    class="action-btn action-btn--ghost"
                    ?disabled=${this._working}
                    @click=${this._onBefore}
                  >
                    ${this._plan.before.label}
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
