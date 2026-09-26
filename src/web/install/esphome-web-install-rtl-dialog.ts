import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { LIBRETINY_AMBZ2_GUIDE_URL } from "../../common/docs.js";
import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import type { ProcessTerminalState } from "../../components/process-terminal/process-terminal.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getErrorMessage } from "../../util/error-message.js";
import {
  type LibreTinyImage,
  parseLibreTinyImage,
  UF2_FAMILY_AMBZ2,
} from "../../util/libretiny-uf2.js";
import { Uf2FamilyError } from "../../util/uf2.js";
import { requestSerialPort } from "../../util/web-serial.js";

import { renderProgressCard } from "./install-progress.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

type InstallState = "idle" | "connecting" | "waiting" | "flashing" | "success" | "error";

// Loaded on demand so ESP / Pico / nRF visitors never download the engine.
const loadEngine = () => import("../../util/ambz2-flasher.js");

/**
 * RTL8720C (AmebaZ2) install: a LibreTiny UF2 the user supplies (there is no
 * ready-made ESPHome Web firmware for it yet), flashed through the ROM
 * downloader over the board's USB serial adapter. The engine resets the
 * board into download mode over DTR/RTS where the adapter wires them; else
 * the dialog shows the strap guide while the engine keeps polling the ROM.
 */
@customElement("esphome-web-install-rtl-dialog")
export class ESPHomeWebInstallRtlDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _state: InstallState = "idle";
  @state() private _file: File | null = null;
  @state() private _progress = 0;
  @state() private _errorTitle = "";
  @state() private _errorMessage = "";
  @state() private _logLines: string[] = [];
  // The adapter had no control lines: the user resets the board by hand.
  @state() private _manualReset = false;
  // Blocks a second click while the file read, the engine load or the port
  // picker is in flight.
  @state() private _pending = false;

  private _abort: AbortController | null = null;

  private _log = (line: string) => {
    this._logLines = [...this._logLines, line];
  };

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && !this.open) this._reset();
  }

  private get _busy(): boolean {
    return (
      this._pending ||
      this._state === "connecting" ||
      this._state === "waiting" ||
      this._state === "flashing"
    );
  }

  private _reset(): void {
    // A close mid-flash stops the engine; it releases the port itself.
    this._abort?.abort();
    this._abort = null;
    this._state = "idle";
    this._file = null;
    this._progress = 0;
    this._errorTitle = "";
    this._errorMessage = "";
    this._logLines = [];
    this._manualReset = false;
    this._pending = false;
  }

  private _fail(title: string, detail = ""): void {
    this._errorTitle = title;
    this._errorMessage = detail;
    this._state = "error";
  }

  private _onFileChange(e: Event): void {
    this._file = (e.target as HTMLInputElement).files?.[0] ?? null;
  }

  private async _flash(): Promise<void> {
    const file = this._file;
    if (!file || this._pending) return;
    this._pending = true;
    this._logLines = [];
    let image: LibreTinyImage;
    let port: SerialPort | null;
    try {
      try {
        image = parseLibreTinyImage(new Uint8Array(await file.arrayBuffer()), [
          UF2_FAMILY_AMBZ2,
        ]);
      } catch (err) {
        // Another Realtek family (AmebaZ) is a real build for a chip this
        // engine cannot flash; anything else is a bad file.
        this._fail(
          this._localize(
            err instanceof Uf2FamilyError
              ? "firmware.rtl_wrong_family"
              : "firmware.rtl_bad_uf2"
          ),
          getErrorMessage(err)
        );
        return;
      }
      try {
        port = await requestSerialPort();
      } catch (err) {
        this._fail(this._localize("web.connect.failed", { error: getErrorMessage(err) }));
        return;
      }
      if (!port) return;
    } finally {
      this._pending = false;
    }

    this._state = "connecting";
    this._progress = 0;
    const abort = new AbortController();
    this._abort = abort;
    let rebooted: boolean;
    try {
      const { flashAmbz2 } = await loadEngine();
      rebooted = await flashAmbz2(port, image, {
        signal: abort.signal,
        onLog: this._log,
        onWaitingForStrap: () => {
          if (this._abort === abort) this._state = "waiting";
        },
        onLinked: () => {
          if (this._abort === abort) this._state = "flashing";
        },
        onProgress: (percent) => {
          if (this._abort === abort) this._progress = percent;
        },
      });
    } catch (err) {
      // The dialog closed and stopped the engine: nothing left to report to.
      if (abort.signal.aborted) return;
      this._fail(this._localize("firmware.rtl_flash_failed"), getErrorMessage(err));
      return;
    } finally {
      if (this._abort === abort) this._abort = null;
    }
    this._manualReset = !rebooted;
    this._state = "success";
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  private _terminalState(): ProcessTerminalState {
    switch (this._state) {
      case "success":
        return "success";
      case "error":
        return "error";
      case "waiting":
        return null;
      default:
        return "running";
    }
  }

  private _statusMessage(): string {
    switch (this._state) {
      case "connecting":
        return this._localize("firmware.rtl_connecting");
      case "waiting":
        return this._localize("firmware.rtl_wait_title");
      case "flashing":
        return this._localize("firmware.status_flashing");
      case "success":
        return this._localize(
          this._manualReset ? "firmware.rtl_done_manual_reset" : "web.rtl.install_done"
        );
      default:
        return this._errorTitle;
    }
  }

  private _statusDetail(): string {
    switch (this._state) {
      case "connecting":
        return this._localize("firmware.rtl_connect_desc");
      case "waiting":
        return this._localize("firmware.rtl_wait_desc");
      case "error":
        return this._errorMessage;
      default:
        return "";
    }
  }

  private _renderSetup() {
    return html`
      <p>${this._localize("web.rtl.install_intro")}</p>
      <div class="file-row">
        <label class="file-label">
          <span>${this._localize("web.rtl.install_file_label")}</span>
          <input type="file" accept=".uf2" @change=${this._onFileChange} />
        </label>
        <span class="file-name">
          ${this._file ? this._file.name : this._localize("web.rtl.install_file_placeholder")}
        </span>
      </div>
      <p>${this._localize("web.rtl.install_howto_title")}</p>
      <ol>
        <li>${this._localize("web.install.upload_howto_1")}</li>
        <li>${this._localize("web.install.upload_howto_2")}</li>
        <li>${this._localize("web.rtl.install_howto_3")}</li>
      </ol>
    `;
  }

  private _renderProgress() {
    return html`
      ${renderProgressCard({
        state: this._terminalState(),
        message: this._statusMessage(),
        detail: this._statusDetail(),
        progress: this._state === "flashing" ? this._progress : null,
        log: this._logLines,
      })}
      ${
        this._state === "waiting"
          ? html`<p class="guide">
              <a
                href=${LIBRETINY_AMBZ2_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                >${this._localize("firmware.rtl_guide_link")}</a
              >
            </p>`
          : nothing
      }
    `;
  }

  private _renderAction() {
    switch (this._state) {
      case "idle":
        return html`
          <wa-button
            variant="brand"
            ?disabled=${!this._file || this._pending}
            @click=${this._flash}
          >
            ${this._localize("firmware.browser_flash_action")}
          </wa-button>
        `;
      case "error":
        return html`
          <wa-button variant="neutral" @click=${() => (this._state = "idle")}>
            ${this._localize("command.retry")}
          </wa-button>
        `;
      case "success":
        return html`
          <wa-button variant="brand" @click=${this._onAfterHide}>
            ${this._localize("command.close")}
          </wa-button>
        `;
      default:
        return nothing;
    }
  }

  protected render() {
    return html`
      <esphome-base-dialog
        .label=${this._localize("web.rtl.install_title")}
        ?open=${this.open}
        ?busy=${this._busy}
        @after-hide=${this._onAfterHide}
      >
        ${this._state === "idle" ? this._renderSetup() : this._renderProgress()}
        <div class="actions">${this._renderAction()}</div>
      </esphome-base-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      .file-row {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
      }
      .file-label {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }
      .file-label input[type="file"] {
        font-size: var(--wa-font-size-s);
        font-family: inherit;
      }
      .file-name {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      ol {
        padding-left: 1.5em;
        color: var(--wa-color-text-quiet);
      }
      .guide {
        margin: var(--wa-space-s) 0 0;
        font-size: var(--wa-font-size-s);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--wa-space-m);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-rtl-dialog": ESPHomeWebInstallRtlDialog;
  }
}
