import { consume } from "@lit/context";
import { mdiArrowLeft, mdiClose } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, apiContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./wizard-step-board.js";
import "./wizard-step-empty-config.js";
import "./wizard-step-method.js";
import "./wizard-step-setup.js";

registerMdiIcons({ close: mdiClose, "arrow-left": mdiArrowLeft });

type WizardStep = "method" | "board" | "setup" | "empty-config";
type WizardStepDetail = WizardStep | { step: WizardStep; board?: BoardCatalogEntry | null };

@customElement("esphome-create-config-dialog")
export class ESPHomeCreateConfigDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _step: WizardStep = "method";

  @state()
  private _selectedBoard: BoardCatalogEntry | null = null;

  @state()
  private _submitting = false;

  @state()
  private _importError = "";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 520px;
      }

      wa-dialog.wide {
        --width: 680px;
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .dialog-label {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .back-button {
        display: inline-flex;
        align-items: center;
        border: none;
        background: none;
        padding: 2px;
        margin-right: var(--wa-space-2xs);
        color: var(--esphome-on-primary);
        cursor: pointer;
        border-radius: 4px;
        opacity: 0.85;
      }

      .back-button:hover {
        opacity: 1;
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        min-width: unset;
        min-height: unset;
        color: var(--esphome-on-primary);
        cursor: pointer;
      }

      wa-dialog::part(body) {
        padding: var(--wa-space-l) var(--wa-space-xl);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-s);
        margin-top: var(--wa-space-s);
      }
    `,
  ];

  public open() {
    this._step = "method";
    this._submitting = false;
    this._importError = "";
    this._dialog.open = true;
  }

  public close() {
    this._dialog.open = false;
  }

  private get _title(): string {
    switch (this._step) {
      case "method":
        return this._localize("wizard.title_create");
      case "board":
        return this._localize("wizard.title_board");
      case "setup":
        return this._localize("wizard.title_setup");
      case "empty-config":
        return this._localize("wizard.title_empty_config");
    }
  }

  protected render() {
    return html`
      <wa-dialog
        class=${this._step === "board" ? "wide" : ""}
        light-dismiss
        @next-step=${this._onNextStep}
        @finish-setup=${this._onFinishSetup}
        @create-empty-config=${this._onCreateEmptyConfig}
        @import-config=${this._onImportConfig}
      >
        <span slot="label" class="dialog-label">
          ${this._step !== "method"
            ? html`<button class="back-button" @click=${this._onBack}>
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
              </button>`
            : nothing}
          ${this._title}
        </span>
        ${this._renderStep()}
        ${this._importError
          ? html`<p class="error">${this._importError}</p>`
          : nothing}
      </wa-dialog>
    `;
  }

  private _renderStep() {
    switch (this._step) {
      case "method":
        return html`<esphome-wizard-step-method></esphome-wizard-step-method>`;
      case "board":
        return html`<esphome-wizard-step-board></esphome-wizard-step-board>`;
      case "setup":
        return html`<esphome-wizard-step-setup .board=${this._selectedBoard}></esphome-wizard-step-setup>`;
      case "empty-config":
        return html`<esphome-wizard-step-empty-config></esphome-wizard-step-empty-config>`;
    }
  }

  private _onNextStep(e: CustomEvent<WizardStepDetail>) {
    const detail = e.detail;
    if (typeof detail === "string") {
      this._step = detail;
      return;
    }

    this._step = detail.step;
    if (detail.board !== undefined) {
      this._selectedBoard = detail.board;
    }
  }

  private _onBack() {
    switch (this._step) {
      case "board":
        this._step = "method";
        break;
      case "setup":
        this._step = "board";
        break;
      case "empty-config":
        this._step = "method";
        break;
    }
  }

  private async _onCreateEmptyConfig(e: CustomEvent<{ name: string }>) {
    if (this._submitting) return;
    const { name } = e.detail;
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    this._submitting = true;
    try {
      const { configuration } = await this._api.createDevice({
        name: slug,
        config_type: "empty",
      });
      this.close();
      window.history.pushState({}, "", `/device/${configuration}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      console.error("Failed to create empty config:", err);
    } finally {
      this._submitting = false;
    }
  }

  private async _onImportConfig(e: CustomEvent<{ file: File }>) {
    if (this._submitting) return;
    const { file } = e.detail;
    const name = file.name.replace(/\.(yaml|yml)$/i, "");
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

    this._importError = "";

    let fileContent: string;
    try {
      fileContent = await file.text();
    } catch {
      this._importError = "Failed to read the file.";
      return;
    }

    this._submitting = true;
    try {
      const { configuration } = await this._api.createDevice({
        name: slug,
        config_type: "upload",
        file_content: fileContent,
      });
      this.close();
      window.history.pushState({}, "", `/device/${configuration}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._importError = msg.includes("409")
        ? `A device named "${slug}" already exists.`
        : "Failed to import the config file. Please try again.";
    } finally {
      this._submitting = false;
    }
  }

  private async _onFinishSetup(
    e: CustomEvent<{
      board: BoardCatalogEntry | null;
      name: string;
      wifiSsid: string;
      wifiPassword: string;
    }>
  ) {
    if (this._submitting) return;
    const { board, name, wifiSsid, wifiPassword } = e.detail;
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    this._submitting = true;
    try {
      const { configuration } = await this._api.createDevice({
        name: slug,
        config_type: "basic",
        platform: board?.esphome.platform ?? "",
        board: board?.esphome.board ?? "",
        ssid: wifiSsid,
        psk: wifiPassword,
        board_id: board?.id,
      });
      this.close();
      window.history.pushState({}, "", `/device/${configuration}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      console.error("Failed to create device:", err);
    } finally {
      this._submitting = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-create-config-dialog": ESPHomeCreateConfigDialog;
  }
}
