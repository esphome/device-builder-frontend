import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { property, query, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import { localizeContext } from "../../context/index.js";
import type {
  LibreTinyFlashHooks,
  LibreTinyFlashResult,
} from "../../platforms/libretiny-flash.js";
import type { LibreTinyImage } from "../../platforms/libretiny-uf2.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getErrorMessage } from "../../util/error-message.js";
import {
  connectFailureDetail,
  openFailureMessage,
} from "../../util/serial-open-error.js";
import { requestSerialPort } from "../../util/web-serial.js";

import {
  type FilePickerError,
  filePickerStyles,
  renderFilePicker,
} from "./file-picker.js";
import {
  installActionsStyles,
  installTerminalState,
  renderCloseButton,
  renderProgressCard,
  renderRetryButton,
} from "./install-progress.js";

import { parseFailureCopy, Preparation, type Prepared } from "./preparation.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

/**
 * A chip family whose LibreTiny UF2 is flashed over its serial adapter: how
 * its file is parsed and written, and the copy of each step.
 */
export interface LibreTinyInstall {
  readonly copy: {
    readonly title: string;
    readonly intro: string;
    readonly connecting: string;
    readonly connectDetail: string;
    readonly waiting: string;
    readonly waitDetail: string;
    readonly guideLink: string;
    readonly done: string;
    /** The flash went through and the board has to be reset by hand; the dialog has a line for a family without its own. */
    readonly doneByHand?: string;
    /**
     * The board logs on another port than the one it is flashed over, and
     * this says which; the flash receiver opens no logs then.
     */
    readonly logsElsewhere?: string;
    readonly failed: string;
    readonly badFile: string;
  };
  /** Where to read on when the chip does not get into its downloader. */
  readonly guideUrl: string;
  /** Fetches the chunk ``run`` writes with, for one who wants it ahead of the run. */
  loadEngine(): Promise<unknown>;
  /** Never throws: a failure names its copy. */
  load(
    bytes: Uint8Array
  ): Promise<{ image: LibreTinyImage } | { key: string; detail: string }>;
  /** Never throws. */
  run(
    port: SerialPort,
    image: LibreTinyImage,
    hooks: LibreTinyFlashHooks
  ): Promise<LibreTinyFlashResult>;
}

type InstallState = "idle" | "connecting" | "waiting" | "flashing" | "success" | "error";

/**
 * Install over a board's USB serial adapter: a LibreTiny UF2 the user
 * supplies (there is no ready-made ESPHome Web firmware for these chips
 * yet), flashed through the chip's downloader. The engine gets the chip
 * into it where it can; else the dialog shows the guide while the engine
 * keeps polling. A family's element extends this with its ``install``.
 */
export abstract class LibreTinyInstallDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  protected abstract readonly install: LibreTinyInstall;

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
      title: this._localize(this.install.copy.badFile),
      detail: getErrorMessage(err),
    })
  );

  private async _parse(file: File): Promise<Prepared<LibreTinyImage, FilePickerError>> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await this.install.load(bytes);
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
  // the board or waits for the user, closing aborts it and releases the port.
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
        this._fail(openFailureMessage(err, this._localize, "web.connect.failed"));
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
    const result = await this.install.run(port, image, {
      signal: abort.signal,
      onLog: (line) => {
        if (live()) this._log(line);
      },
      onWaiting: () => {
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
      this._fail(
        this._localize(result.key ?? this.install.copy.failed),
        connectFailureDetail(result.error, this._localize, () => result.detail)
      );
      return;
    }
    this._manualReset = !result.rebooted;
    this._state = "success";
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  private _statusMessage(): string {
    const { copy } = this.install;
    switch (this._state) {
      case "connecting":
        return this._localize(copy.connecting);
      case "waiting":
        return this._localize(copy.waiting);
      case "flashing":
        return this._localize("firmware.status_flashing");
      case "success": {
        const done = this._localize(
          this._manualReset
            ? (copy.doneByHand ?? "web.install.done_reset_by_hand")
            : copy.done
        );
        // Where the logs are follows, as the receiver's note has it.
        return copy.logsElsewhere
          ? `${done} ${this._localize(copy.logsElsewhere)}`
          : done;
      }
      default:
        return this._errorTitle;
    }
  }

  private _statusDetail(): string {
    switch (this._state) {
      case "connecting":
        return this._localize(this.install.copy.connectDetail);
      case "waiting":
        return this._localize(this.install.copy.waitDetail);
      case "error":
        return this._errorMessage;
      default:
        return "";
    }
  }

  private _renderSetup() {
    const { copy } = this.install;
    return html`
      <p>${this._localize(copy.intro)}</p>
      ${renderFilePicker({
        label: this._localize("web.install.uf2_file_label"),
        accept: ".uf2",
        file: this._file,
        placeholder: this._localize("web.install.uf2_file_placeholder"),
        onChange: this._onFileChange,
        preparing:
          this._image.state.kind === "pending"
            ? this._localize("web.install.preparing")
            : undefined,
        error: this._fileError,
      })}
      <p>${this._localize("web.install.uf2_howto_title")}</p>
      <ol>
        <li>${this._localize("web.install.upload_howto_1")}</li>
        <li>${this._localize("web.install.upload_howto_2")}</li>
        <li>${this._localize("web.install.uf2_howto_3")}</li>
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
              <a href=${this.install.guideUrl} target="_blank" rel="noopener noreferrer"
                >${this._localize(this.install.copy.guideLink)}</a
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
        .label=${this._localize(this.install.copy.title)}
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
