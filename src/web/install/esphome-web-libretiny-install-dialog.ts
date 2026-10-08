import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import { localizeContext } from "../../context/index.js";
import type {
  LibreTinyFlashHooks,
  LibreTinyFlashResult,
  LinkedImageSource,
} from "../../platforms/libretiny-flash.js";
import type { LibreTinyImage } from "../../platforms/libretiny-uf2.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  connectFailureDetail,
  openFailureMessage,
} from "../../util/serial-open-error.js";
import { requestSerialPort } from "../../util/web-serial.js";
import { LinkedImageError } from "../platforms/libretiny-image.js";
import { PublishedImageUnavailableError } from "../util/esphome-web-firmware.js";

import { filePickerStyles } from "./file-picker.js";
import {
  installActionsStyles,
  installTerminalState,
  renderCloseButton,
  renderProgressCard,
  renderRetryButton,
} from "./install-progress.js";
import { renderSetup, setupStyles, unpublishedChipLine } from "./libretiny-setup-view.js";
import { LibreTinySetup } from "./libretiny-setup.js";
import { parseFailureCopy } from "./preparation.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

/**
 * A chip family whose LibreTiny UF2 is flashed over its serial adapter: how
 * its file is parsed and written, and the copy of each step. ``Image`` is
 * what its parser hands its engine.
 */
export interface LibreTinyInstall<Image = LibreTinyImage> {
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
    /** The board waits for a reset by hand, but the receiver opens its logs at once, headed by this. */
    readonly logsNotice?: string;
    readonly failed: string;
    readonly badFile: string;
  };
  /** Where to read on when the chip does not get into its downloader. */
  readonly guideUrl: string;
  /** Fetches the chunk ``run`` writes with, for one who wants it ahead of the run. */
  loadEngine(): Promise<unknown>;
  /** Never throws: a failure names its copy. */
  load(bytes: Uint8Array): Promise<{ image: Image } | { key: string; detail: string }>;
  /** Never throws. */
  run(
    port: SerialPort,
    image: Image,
    hooks: LibreTinyFlashHooks
  ): Promise<LibreTinyFlashResult>;
  /** For a family of several chips: the parsed file's chip copy, guide and engine. */
  forImage?(image: Image): LibreTinyChip;
  /** The ESPHome Web firmware it also installs, where the manifest publishes it. */
  readonly prebuilt?: LibreTinyPrebuilt<Image>;
}

/**
 * The ESPHome Web firmware a family installs besides a UF2 the user picks:
 * one image per LibreTiny family the manifest publishes.
 */
export interface LibreTinyPrebuilt<Image> {
  /** The families the manifest may list, in the order the chip picker offers them. */
  readonly families: readonly string[];
  /**
   * For chips told apart only once linked: flashes the image ``imageFor``
   * gives for the chip that answered. Without it the family is known, or
   * picked, before the install. Never throws.
   */
  runLinked?(
    port: SerialPort,
    imageFor: LinkedImageSource<Image>,
    hooks: LibreTinyFlashHooks
  ): Promise<LibreTinyFlashResult>;
}

/** What follows a parsed file's chip in a family of several. */
export type LibreTinyChip = Pick<
  LibreTinyInstall<unknown>,
  "copy" | "guideUrl" | "loadEngine"
>;

type InstallState = "idle" | "connecting" | "waiting" | "flashing" | "success" | "error";

/**
 * Install over a board's USB serial adapter: the ESPHome Web firmware where
 * the manifest publishes one for the family, or a LibreTiny UF2 the user
 * supplies, flashed through the chip's downloader. The engine gets the chip
 * into it where it can; else the dialog shows the guide while the engine
 * keeps polling. The family is the ``install`` it is given.
 */
@customElement("esphome-web-libretiny-install-dialog")
export class LibreTinyInstallDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  /** The family whose UF2 this installs. */
  @property({ attribute: false }) install!: LibreTinyInstall<unknown>;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _state: InstallState = "idle";
  @state() private _progress = 0;
  @state() private _errorTitle = "";
  @state() private _errorMessage = "";
  @state() private _logLines: string[] = [];
  // The adapter had no control lines: the user resets the board by hand.
  @state() private _manualReset = false;
  // Blocks a second click while the port picker is open.
  @state() private _pending = false;

  @query("input[type=file]") private _fileInput?: HTMLInputElement;

  private _abort: AbortController | null = null;

  private _setup = new LibreTinySetup(
    this,
    () => this.install,
    () => this._localize,
    () => this._fileInput
  );

  private get _active() {
    return this._setup.active;
  }

  private _log = (line: string) => {
    this._logLines = [...this._logLines, line];
  };

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has("open")) return;
    if (this.open) this._setup.open();
    else this._reset();
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
    this._setup.reset();
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

  private async _flash(): Promise<void> {
    const run = this._setup.run;
    if (!run || this._pending) return;
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
    const result = await run(port, {
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
      if (result.error instanceof PublishedImageUnavailableError) {
        this._fail(unpublishedChipLine(this._localize, result.error.label));
      } else if (result.error instanceof LinkedImageError) {
        // Named as the image would have been had it been fetched before the link.
        const { key } = parseFailureCopy(result.error.key);
        this._fail(this._localize(key), result.detail);
      } else {
        this._fail(
          this._localize(result.key ?? this._active.copy.failed),
          connectFailureDetail(result.error, this._localize, () => result.detail)
        );
      }
      return;
    }
    this._manualReset = !result.rebooted;
    this._state = "success";
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  private _statusMessage(): string {
    const { copy } = this._active;
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
        return this._localize(this._active.copy.connectDetail);
      case "waiting":
        return this._localize(this._active.copy.waitDetail);
      case "error":
        return this._errorMessage;
      default:
        return "";
    }
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
              <a href=${this._active.guideUrl} target="_blank" rel="noopener noreferrer"
                >${this._localize(this._active.copy.guideLink)}</a
              >
            </p>`
          : nothing
      }
    `;
  }

  private _renderAction() {
    switch (this._state) {
      case "idle":
        if (this._setup.image.state.kind === "retryable") {
          return renderRetryButton(this._localize, this._setup.retry);
        }
        return html`
          <wa-button
            variant="brand"
            ?disabled=${!this._setup.run || this._pending}
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
        ${
          this._state === "idle"
            ? renderSetup(this._setup, this._localize, this.install.copy.intro)
            : this._renderProgress()
        }
        <div class="actions">${this._renderAction()}</div>
      </esphome-base-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    filePickerStyles,
    installActionsStyles,
    setupStyles,
    css`
      .guide {
        margin: var(--wa-space-s) 0 0;
        font-size: var(--wa-font-size-s);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-libretiny-install-dialog": LibreTinyInstallDialog;
  }
}
