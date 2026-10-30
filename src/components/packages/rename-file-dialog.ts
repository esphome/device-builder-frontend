/**
 * Rename a package within its folder: a file-name input after the fixed
 * folder, plus the files whose ``!include`` references the backend will
 * rewrite, each ticked; unticked ones keep the old name. Emits
 * ``rename-file`` with ``{path, newPath, skip}`` on confirm.
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
import {
  fileNameOf,
  folderOf,
  isArchivedPath,
  newPackagePathProblem,
} from "../../util/file-paths.js";
import {
  deviceItems,
  type LinkItem,
  linkListStyles,
  renderLinkList,
} from "./link-list.js";
import { NO_USAGE, usageSummaryStyles } from "./usage-summary.js";
import { notifyFailure } from "./usage.js";

import "@home-assistant/webawesome/dist/components/checkbox/checkbox.js";
import "../base-dialog.js";

export interface RenameFileDetail {
  path: string;
  newPath: string;
  /** Files that keep referencing the old name. */
  skip: string[];
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
  @state() private _skip: ReadonlySet<string> = new Set();

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
      .name input {
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
      .check-row {
        align-items: center;
      }
      .check-row wa-checkbox {
        flex: 1;
        min-width: 0;
      }
    `,
  ];

  /** Bumped per ``open``, so only the latest lookup opens the dialog. */
  private _opening = 0;

  /** Fetch the files including *path*, then open; a toast instead when that fails. */
  async open(path: string): Promise<void> {
    const opening = ++this._opening;
    let usage: FileUsage;
    try {
      usage = await this._api.getFileUsage(path);
    } catch (err) {
      if (opening === this._opening) {
        notifyFailure(this._localize, "packages.usage_failed", err);
      }
      return;
    }
    if (opening !== this._opening) return;
    this._path = path;
    this._name = fileNameOf(path);
    this._usage = usage;
    this._skip = new Set();
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
        ${this._renderReferrers()}
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

  /** The files to rewrite, each with a checkbox, those to fix by hand, and the
   *  unchecked-devices note. */
  private _renderReferrers() {
    const { referenced_by, rewritable: referrers, unknown } = this._usage;
    const manual = referenced_by.filter((path) => !referrers.includes(path));
    return html`<p class="usage-message">
        ${
          referrers.length > 0
            ? this._localize("packages.rename_referrers", { count: referrers.length })
            : this._localize("packages.rename_no_referrers")
        }
      </p>
      ${
        referrers.length > 0
          ? html`<ul class="link-list">
              ${referrers.map((path) => {
                const item = this._referrerItem(path);
                return html`<li class="link-row check-row">
                  <wa-checkbox
                    .checked=${!this._skip.has(path)}
                    @change=${(e: Event) =>
                      this._toggle(path, (e.target as HTMLInputElement).checked)}
                    ><span class="link-label">${item.label}</span></wa-checkbox
                  >
                  ${item.detail ? html`<span class="link-detail">${item.detail}</span>` : nothing}
                </li>`;
              })}
            </ul>`
          : nothing
      }
      ${
        manual.length > 0
          ? html`<p class="usage-message">
                ${this._localize("packages.rename_manual", { count: manual.length })}
              </p>
              ${renderLinkList(
                manual.map((path) => ({ ...this._referrerItem(path), url: null })),
                () => undefined
              )}`
          : nothing
      }
      ${
        unknown.length > 0
          ? html`<p class="usage-note">
              ${this._localize("packages.usage_unknown", { names: unknown.join(", ") })}
            </p>`
          : nothing
      }`;
  }

  /** Devices by friendly name, other files by path, archived ones marked. */
  private _referrerItem(path: string): Pick<LinkItem, "label" | "detail"> {
    if (isArchivedPath(path)) {
      return { label: path, detail: this._localize("packages.rename_archived") };
    }
    return folderOf(path) === ""
      ? deviceItems([path], this._devices)[0]
      : { label: path };
  }

  private _toggle(path: string, checked: boolean) {
    const skip = new Set(this._skip);
    if (checked) skip.delete(path);
    else skip.add(path);
    this._skip = skip;
  }

  private _close = () => {
    this._dialog.open = false;
  };

  private _confirm = () => {
    // The button stays clickable while the dialog animates out.
    if (!this._dialog.open || !this._name.trim() || this.problem !== null) return;
    this._close();
    this.dispatchEvent(
      new CustomEvent<RenameFileDetail>("rename-file", {
        detail: { path: this._path, newPath: this._newPath, skip: [...this._skip] },
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
