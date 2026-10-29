/**
 * Rename a package within its folder: a file-name input after the fixed
 * folder, plus the devices whose ``!include`` references the backend will
 * rewrite. Emits ``rename-file`` with ``{path, newPath}`` on confirm.
 */
import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { FileUsage } from "../../api/types/files.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, devicesContext, localizeContext } from "../../context/index.js";
import {
  dialogActionButtonStyles,
  dialogActionsRowStyles,
} from "../../styles/dialog-action-buttons.js";
import { dialogChromeStyles } from "../../styles/dialog-chrome.js";
import { espHomeStyles } from "../../styles/shared.js";
import { DialogOpenController } from "../../util/dialog-open-controller.js";
import { fileNameOf, folderOf, newPackagePathProblem } from "../../util/file-paths.js";
import { navigate } from "../../util/navigation.js";
import { linkListStyles } from "./link-list.js";
import { NO_USAGE, renderUsageSummary, usageSummaryStyles } from "./usage-summary.js";
import { notifyFailure } from "./usage.js";

import "../base-dialog.js";

export interface RenameFileDetail {
  path: string;
  newPath: string;
}

@customElement("esphome-rename-file-dialog")
export class ESPHomeRenameFileDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @state() private _path = "";
  @state() private _name = "";
  @state() private _usage: FileUsage = NO_USAGE;

  private readonly _dialog = new DialogOpenController(this);

  static styles = [
    espHomeStyles,
    dialogChromeStyles,
    dialogActionButtonStyles,
    dialogActionsRowStyles,
    linkListStyles,
    usageSummaryStyles,
    css`
      esphome-base-dialog {
        --width: 520px;
      }
      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }
      .name {
        display: flex;
        align-items: center;
        gap: 2px;
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: var(--wa-font-size-s);
      }
      .folder {
        color: var(--wa-color-text-quiet);
        white-space: nowrap;
      }
      input {
        flex: 1;
        min-width: 0;
        box-sizing: border-box;
        padding: 8px 10px;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: var(--wa-font-size-s);
      }
      .problem {
        margin: 6px 0 0;
        font-size: var(--wa-font-size-xs);
        color: var(--esphome-error);
      }
    `,
  ];

  /** Fetch the devices using *path*, then open; a toast instead when that fails. */
  async open(path: string): Promise<void> {
    let usage: FileUsage;
    try {
      usage = await this._api.getFileUsage(path);
    } catch (err) {
      notifyFailure(this._localize, "packages.usage_failed", err);
      return;
    }
    this._path = path;
    this._name = fileNameOf(path);
    this._usage = usage;
    this._dialog.open = true;
  }

  private get _newPath(): string {
    return `${folderOf(this._path)}/${this._name.trim()}`;
  }

  /** Translation key for what's wrong with the typed name, or null. */
  get problem(): string | null {
    if (this._name.includes("/")) return "packages.rename_name_only";
    if (this._newPath === this._path) return "packages.rename_same";
    return newPackagePathProblem(this._newPath);
  }

  protected render() {
    const problem = this._name.trim() ? this.problem : null;
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("packages.rename_title", { path: this._path })}
        .confirmOnEnter=${this._confirm}
        @request-close=${this._dialog.onRequestClose}
      >
        <div class="name">
          <span class="folder">${folderOf(this._path)}/</span>
          <input
            type="text"
            autofocus
            autocomplete="off"
            spellcheck="false"
            aria-label=${this._localize("packages.rename_label")}
            .value=${this._name}
            @input=${(e: Event) => (this._name = (e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        ${problem ? html`<p class="problem" role="alert">${this._localize(problem)}</p>` : nothing}
        ${renderUsageSummary(this._usage, {
          localize: this._localize,
          devices: this._devices,
          usedKey: "packages.rename_users",
          unusedKey: "packages.rename_no_users",
          open: (url) => {
            this._close();
            void navigate(url);
          },
        })}
        <div class="actions">
          <button class="btn btn--cancel" @click=${this._close}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${!this._name.trim() || this.problem !== null}
            @click=${this._confirm}
          >
            ${this._localize("packages.rename")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _close = () => {
    this._dialog.open = false;
  };

  private _confirm = () => {
    if (!this._name.trim() || this.problem !== null) return;
    this._close();
    this.dispatchEvent(
      new CustomEvent<RenameFileDetail>("rename-file", {
        detail: { path: this._path, newPath: this._newPath },
        bubbles: true,
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-rename-file-dialog": ESPHomeRenameFileDialog;
  }
}
