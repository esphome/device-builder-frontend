import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import { LIBRETINY_AMBZ2_GUIDE_URL } from "../../../common/docs.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import "../../../components/base-dialog.js";
import { localizeContext } from "../../../context/index.js";
import {
  type LibreTinyImage,
  loadAmbz2Image,
  runAmbz2,
} from "../../../platforms/rtl87xx/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { requestSerialPort } from "../../../util/web-serial.js";

import {
  type FilePickerError,
  filePickerStyles,
  renderFilePicker,
} from "../../install/file-picker.js";
import {
  installActionsStyles,
  installTerminalState,
  renderCloseButton,
  renderProgressCard,
  renderRetryButton,
} from "../../install/install-progress.js";

import {
  parseFailureCopy,
  Preparation,
  type Prepared,
} from "../../install/preparation.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

type InstallState = "idle" | "connecting" | "waiting" | "flashing" | "success" | "error";

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
  // Blocks a second click while the port picker is open.
  @state() private _pending = false;
  // Why the picked file cannot be installed, shown under the picker.
  @state() private _fileError: FilePickerError | null = null;

  @query("input[type=file]") private _fileInput?: HTMLInputElement;

  private _abort: AbortController | null = null;

  // The UF2 is read and parsed when it is picked, so the click that installs
  // it goes straight to the port picker.
  private _image = new Preparation<File, LibreTinyImage, FilePickerError>(
    this,
    (file) => this._parse(file),
    (failure) => this._onPrepared(failure),
    // A revoked file handle rejects the read.
    (err) => ({
      title: this._localize("firmware.rtl_bad_uf2"),
      detail: getErrorMessage(err),
    })
  );

  private async _parse(file: File): Promise<Prepared<LibreTinyImage, FilePickerError>> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await loadAmbz2Image(bytes);
    if ("image" in parsed) return { value: parsed.image };
    const { key, retryable } = parseFailureCopy(parsed.key);
    return { failure: { title: this._localize(key), detail: parsed.detail }, retryable };
  }

  private _onPrepared(failure: FilePickerError | null): void {
    this._fileError = failure;
    if (this._image.state.kind === "idle") this._unpick();
  }

  // The input is emptied with the file: it fires no change for the file it
  // still holds, so that file could not be picked a second time.
  private _unpick(): void {
    this._file = null;
    if (this._fileInput) this._fileInput.value = "";
  }

  private _log = (line: string) => {
    this._logLines = [...this._logLines, line];
  };

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && !this.open) this._reset();
  }

  // Only a write in progress holds the dialog open. While the engine resets
  // the board or waits for the strap, closing aborts it and releases the port.
  private get _busy(): boolean {
    return this._pending || this._state === "flashing";
  }

  private _reset(): void {
    // A close mid-flash stops the engine; it releases the port itself.
    this._abort?.abort();
    this._abort = null;
    this._state = "idle";
    this._unpick();
    this._fileError = null;
    this._image.clear();
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

  private _onFileChange = (e: Event): void => {
    this._file = (e.target as HTMLInputElement).files?.[0] ?? null;
    this._fileError = null;
    if (this._file) this._image.start(this._file);
    else this._image.clear();
  };

  // The parser did not load for the picked file: load it again.
  private _retryFile = (): void => {
    this._fileError = null;
    this._image.retry();
  };

  private async _flash(): Promise<void> {
    const prepared = this._image.state;
    if (prepared.kind !== "ready" || this._pending) return;
    const image = prepared.value;
    this._pending = true;
    this._logLines = [];
    let port: SerialPort | null;
    try {
      // Nothing is awaited before the picker: it needs the click's activation.
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
    // Closing the dialog aborts the run; its late hooks must not repaint it.
    const live = () => !abort.signal.aborted;
    const result = await runAmbz2(port, image, {
      signal: abort.signal,
      onLog: (line) => {
        if (live()) this._log(line);
      },
      onWaitingForStrap: () => {
        if (live()) this._state = "waiting";
      },
      onLinked: () => {
        if (live()) this._state = "flashing";
      },
      onProgress: (percent) => {
        if (live()) this._progress = percent;
      },
    });
    if (this._abort === abort) this._abort = null;
    // The dialog closed and stopped the engine: nothing left to report to.
    if (!live()) return;
    if ("detail" in result) {
      this._fail(this._localize("firmware.rtl_flash_failed"), result.detail);
      return;
    }
    this._manualReset = !result.rebooted;
    this._state = "success";
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
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
      ${renderFilePicker({
        label: this._localize("web.rtl.install_file_label"),
        accept: ".uf2",
        file: this._file,
        placeholder: this._localize("web.rtl.install_file_placeholder"),
        onChange: this._onFileChange,
        preparing:
          this._image.state.kind === "pending"
            ? this._localize("web.install.preparing")
            : undefined,
        error: this._fileError,
      })}
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
      ${renderProgressCard(
        {
          state: installTerminalState(this._state),
          message: this._statusMessage(),
          detail: this._statusDetail(),
          progress: this._state === "flashing" ? this._progress : null,
          log: this._logLines,
        },
        this._localize
      )}
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
        if (this._image.state.kind === "retryable") {
          return renderRetryButton(this._localize, this._retryFile);
        }
        return html`
          <wa-button
            variant="brand"
            ?disabled=${this._image.state.kind !== "ready" || this._pending}
            @click=${this._flash}
          >
            ${this._localize("firmware.browser_flash_action")}
          </wa-button>
        `;
      case "error":
        return renderRetryButton(this._localize, () => (this._state = "idle"));
      case "success":
        return renderCloseButton(this._localize, this._onAfterHide);
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
    filePickerStyles,
    installActionsStyles,
    css`
      ol {
        padding-left: 1.5em;
        color: var(--wa-color-text-quiet);
      }
      .guide {
        margin: var(--wa-space-s) 0 0;
        font-size: var(--wa-font-size-s);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-rtl-dialog": ESPHomeWebInstallRtlDialog;
  }
}
