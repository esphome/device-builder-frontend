import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { InstallFlowController } from "./install-flow-controller.js";
import { renderInstallProgress } from "./install-progress.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

/**
 * Install an existing ESPHome project by uploading its factory ``.bin`` and
 * flashing it over Web Serial. Two phases in one dialog: pick the file, then
 * watch the flash progress. Erases first (the uploaded image is a full
 * factory build at offset 0).
 */
@customElement("esphome-web-install-upload-dialog")
export class ESPHomeWebInstallUploadDialog extends LitElement {
  @property({ attribute: false }) port!: SerialPort;
  @property({ type: Boolean }) open = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  // Hold the picked file in state rather than reading it from the <input> via
  // @query: the input is unrendered during the flashing phase, so a query would
  // resolve to null and a retry after a failed flash would throw.
  @state() private _file?: File;

  private _flow = new InstallFlowController(this);

  private _onFileChange(e: Event): void {
    this._file = (e.currentTarget as HTMLInputElement).files?.[0];
  }

  private async _install(): Promise<void> {
    const file = this._file;
    if (!file) return;
    const data = new Uint8Array(await file.arrayBuffer());
    await this._flow.start(this.port, {
      erase: true,
      filesCallback: async () => [{ data, address: 0 }],
      messages: {
        connectFailed: this._localize("web.install.connect_failed_hint"),
        noFirmware: this._localize("web.install.no_firmware"),
      },
    });
  }

  private _onAfterHide(): void {
    this._flow.reset();
    this._file = undefined;
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  private _renderSetup() {
    return html`
      <p>${this._localize("web.install.upload_intro")}</p>
      <input
        type="file"
        accept=".bin"
        aria-label=${this._localize("web.install.upload_intro")}
        @change=${this._onFileChange}
      />
      <p>${this._localize("web.install.upload_howto_title")}</p>
      <ol>
        <li>${this._localize("web.install.upload_howto_1")}</li>
        <li>${this._localize("web.install.upload_howto_2")}</li>
        <li>${this._localize("web.install.upload_howto_3")}</li>
      </ol>
    `;
  }

  protected render() {
    const inProgress = this._flow.step !== "idle";
    return html`
      <esphome-base-dialog
        .label=${this._localize("web.install.upload_title")}
        ?open=${this.open}
        ?busy=${this._flow.busy}
        @after-hide=${this._onAfterHide}
      >
        ${
          inProgress
            ? renderInstallProgress(this._flow, this._localize)
            : this._renderSetup()
        }
        <div class="actions">
          ${
            this._flow.done
              ? nothing
              : html`<wa-button
                  variant="brand"
                  ?disabled=${this._flow.busy || (!inProgress && !this._file)}
                  @click=${this._install}
                >
                  ${this._localize("dashboard.install")}
                </wa-button>`
          }
        </div>
      </esphome-base-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      input[type="file"] {
        display: block;
        width: 100%;
        padding: var(--wa-space-s);
        box-sizing: border-box;
        background-color: var(--wa-color-surface-lowered);
        border-radius: var(--wa-border-radius-m);
      }
      ol {
        padding-left: 1.5em;
        color: var(--wa-color-text-quiet);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-m);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-upload-dialog": ESPHomeWebInstallUploadDialog;
  }
}
