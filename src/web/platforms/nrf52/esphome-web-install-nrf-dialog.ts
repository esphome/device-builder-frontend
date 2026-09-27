import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../../common/localize.js";
import "../../../components/base-dialog.js";
import { localizeContext } from "../../../context/index.js";
import {
  type DfuPackage,
  loadDfuEngine,
  withManualBootloaderHint,
} from "../../../platforms/nrf52/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { getErrorMessage } from "../../../util/error-message.js";
import {
  BootloaderTouchError,
  touchIntoBootloader,
} from "../../../util/serial-bootloader-touch.js";
import { requestSerialPort } from "../../../util/web-serial.js";

import { filePickerStyles, renderFilePicker } from "../../install/file-picker.js";
import {
  FilePreparation,
  type PreparationFailure,
} from "../../install/file-preparation.js";
import {
  installActionsStyles,
  installTerminalState,
  renderCloseButton,
  renderProgressCard,
  renderRetryButton,
} from "../../install/install-progress.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

type InstallState = "idle" | "resetting" | "waiting" | "flashing" | "success" | "error";

/**
 * Two-step nRF52 DFU install: 1200-baud reset, then flash over the
 * re-enumerated DFU port. Each requestPort() runs from its own button click
 * (user-gesture requirement).
 */
@customElement("esphome-web-install-nrf-dialog")
export class ESPHomeWebInstallNrfDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _state: InstallState = "idle";
  // Rounded so per-packet callbacks re-render only on a visible change.
  @state() private _progress = 0;
  @state() private _errorMessage = "";
  // Blocks a second click while a step's port picker is open.
  @state() private _pending = false;
  @state() private _reconnecting = false;
  @state() private _logLines: string[] = [];

  // The package is read and parsed when it is picked, so the click that
  // starts the install goes straight to the port picker.
  private _package = new FilePreparation<DfuPackage>(
    this,
    (file) => this._parse(file),
    (failure) => this._fail(failure.title)
  );

  private async _parse(file: File): Promise<{ value: DfuPackage } | PreparationFailure> {
    let engine: Awaited<ReturnType<typeof loadDfuEngine>>;
    try {
      engine = await loadDfuEngine();
    } catch (err) {
      // A stale chunk after a deploy, or the network: not the file's fault.
      return {
        title: this._localize("firmware.engine_load_failed"),
        detail: getErrorMessage(err),
        retryable: true,
      };
    }
    try {
      return { value: engine.parseDfuPackage(new Uint8Array(await file.arrayBuffer())) };
    } catch (err) {
      // A revoked file handle rejects here too.
      return {
        title: this._localize("web.nrf.install_error_bad_package", {
          error: getErrorMessage(err),
        }),
        detail: "",
      };
    }
  }

  private _log = (line: string) => {
    this._logLines = [...this._logLines, line];
  };

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && !this.open) {
      this._reset();
    }
  }

  // Also while a step's file read, engine load or picker is pending: a close
  // then would reset the dialog under a step that keeps running.
  private get _busy(): boolean {
    return this._pending || this._state === "resetting" || this._state === "flashing";
  }

  private _reset(): void {
    this._state = "idle";
    this._package.clear();
    this._progress = 0;
    this._errorMessage = "";
    this._pending = false;
    this._reconnecting = false;
    this._logLines = [];
  }

  private _fail(message: string): void {
    this._errorMessage = message;
    this._state = "error";
  }

  private _onFileChange = (e: Event): void => {
    this._package.start((e.target as HTMLInputElement).files?.[0] ?? null);
  };

  // Back to the setup step, with the file checked again or another to pick.
  private _retry = (): void => {
    this._state = "idle";
    this._package.recover();
  };

  private async _startInstall(): Promise<void> {
    if (this._package.state.kind !== "ready" || this._pending) return;
    this._pending = true;
    this._logLines = [];
    this._state = "resetting";
    try {
      // Nothing is awaited before the touch's port picker: it needs the
      // click's activation.
      if (!(await touchIntoBootloader({ onLog: this._log }))) {
        this._state = "idle";
        return;
      }
      this._state = "waiting";
    } catch (err) {
      // A failed pick has nothing to do with the board; only the touch earns
      // the manual-bootloader hint.
      this._fail(
        this._localize("web.connect.failed", {
          error:
            err instanceof BootloaderTouchError
              ? withManualBootloaderHint(err, this._localize)
              : getErrorMessage(err),
        })
      );
    } finally {
      this._pending = false;
    }
  }

  private async _continueFlash(): Promise<void> {
    const prepared = this._package.state;
    if (prepared.kind !== "ready" || this._pending) return;
    const pkg = prepared.value;

    let port: SerialPort | null;
    this._pending = true;
    try {
      port = await requestSerialPort();
    } catch (err) {
      this._fail(this._localize("web.connect.failed", { error: getErrorMessage(err) }));
      return;
    } finally {
      this._pending = false;
    }
    if (!port) return;

    this._state = "flashing";
    this._progress = 0;
    this._reconnecting = false;
    try {
      // A cache hit: the engine loaded when the package was parsed.
      const { flashDfuPackageWithReconnect } = await loadDfuEngine();
      await flashDfuPackageWithReconnect(port, pkg, {
        onProgress: (percent) => {
          this._progress = Math.round(percent);
        },
        onReconnecting: () => (this._reconnecting = true),
        onLog: this._log,
      });
      this._state = "success";
    } catch (err) {
      this._fail(
        this._localize("web.nrf.install_error_flash", {
          error: withManualBootloaderHint(err, this._localize),
        })
      );
    }
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  private _renderSetup() {
    return html`
      ${renderFilePicker({
        label: this._localize("web.nrf.install_file_label"),
        accept: ".zip",
        file: this._package.file,
        placeholder: this._localize("web.nrf.install_file_placeholder"),
        onChange: this._onFileChange,
      })}
      ${
        this._package.state.kind === "pending"
          ? html`<p class="preparing" role="status">
              ${this._localize("web.install.preparing")}
            </p>`
          : nothing
      }
    `;
  }

  private _statusMessage(): string {
    switch (this._state) {
      case "resetting":
        return this._localize("web.nrf.install_resetting");
      case "waiting":
        return this._localize("web.nrf.install_waiting_hint");
      case "flashing":
        return this._localize(
          this._reconnecting ? "web.nrf.install_reconnecting" : "web.nrf.install_flashing"
        );
      case "success":
        return this._localize("web.nrf.install_done");
      default:
        return this._localize("firmware.status_failed");
    }
  }

  private _renderProgress() {
    const errored = this._state === "error";
    const done = this._state === "success";
    return renderProgressCard(
      {
        state: installTerminalState(this._state),
        message: this._statusMessage(),
        detail: errored
          ? this._errorMessage
          : done
            ? this._localize("web.nrf.install_done_hint")
            : "",
        progress: this._state === "flashing" ? this._progress : null,
        log: this._logLines,
      },
      this._localize
    );
  }

  private _renderAction() {
    switch (this._state) {
      case "idle":
        return html`
          <wa-button
            variant="brand"
            ?disabled=${this._package.state.kind !== "ready" || this._pending}
            @click=${this._startInstall}
          >
            ${this._localize("dashboard.install")}
          </wa-button>
        `;
      case "waiting":
        return html`
          <wa-button
            variant="brand"
            ?disabled=${this._pending}
            @click=${this._continueFlash}
          >
            ${this._localize("onboarding.wizard.continue")}
          </wa-button>
        `;
      case "error":
        return renderRetryButton(this._localize, this._retry);
      case "success":
        return renderCloseButton(this._localize, this._onAfterHide);
      default:
        return nothing;
    }
  }

  protected render() {
    return html`
      <esphome-base-dialog
        .label=${this._localize("web.nrf.install_title")}
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
      .preparing {
        margin: var(--wa-space-s) 0 0;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-nrf-dialog": ESPHomeWebInstallNrfDialog;
  }
}
