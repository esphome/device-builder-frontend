/**
 * Read-only list of devices or files, each row opening its editor.
 * ``showUsage`` lists the devices using a package, ``showDependencies``
 * the files a device pulls in; each fetches, then opens.
 */
import { consume } from "@lit/context";
import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, devicesContext, localizeContext } from "../../context/index.js";
import {
  dialogActionButtonStyles,
  dialogActionsRowStyles,
} from "../../styles/dialog-action-buttons.js";
import { dialogChromeStyles } from "../../styles/dialog-chrome.js";
import { espHomeStyles } from "../../styles/shared.js";
import { DialogOpenController } from "../../util/dialog-open-controller.js";
import { navigate } from "../../util/navigation.js";
import { fileItems, linkListStyles, renderLinkList } from "./link-list.js";
import { renderUsageSummary, usageSummaryStyles } from "./usage-summary.js";
import { notifyFailure } from "./usage.js";

import "../base-dialog.js";

interface FileListDialogContent {
  heading: string;
  /** Rendered on every update, so device names follow the devices context. */
  body: () => TemplateResult;
}

@customElement("esphome-file-list-dialog")
export class ESPHomeFileListDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  /** Friendly names for the device rows. */
  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @state()
  private _content: FileListDialogContent | null = null;

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
        --width: 480px;
      }
      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }
    `,
  ];

  /** List the devices and files using *path*; a toast instead when the lookup fails. */
  async showUsage(path: string): Promise<void> {
    const localize = this._localize;
    try {
      const usage = await this._api.getFileUsage(path);
      this._open({
        heading: localize("packages.usage_title", { path }),
        body: () =>
          renderUsageSummary(usage, {
            localize: this._localize,
            devices: this._devices,
            usedKey: "packages.usage_message",
            unusedKey: "packages.usage_none",
            open: this._navigate,
          }),
      });
    } catch (err) {
      notifyFailure(localize, "packages.usage_failed", err);
    }
  }

  /** List the files *configuration* pulls in; a toast instead when the lookup fails. */
  async showDependencies(configuration: string): Promise<void> {
    const localize = this._localize;
    try {
      const { files, complete } = await this._api.getDeviceDependencies(configuration);
      this._open({
        heading: localize("packages.dependencies_title", { name: configuration }),
        body: () =>
          html`<p class="usage-message">
              ${this._localize(
                files.length > 0
                  ? "packages.dependencies_message"
                  : "packages.dependencies_none",
                { count: files.length }
              )}
            </p>
            ${renderLinkList(fileItems(files), this._navigate)}
            ${
              complete
                ? nothing
                : html`<p class="usage-note">
                    ${this._localize("packages.dependencies_incomplete")}
                  </p>`
            }`,
      });
    } catch (err) {
      notifyFailure(localize, "packages.dependencies_failed", err);
    }
  }

  protected render() {
    const content = this._content;
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${content?.heading ?? ""}
        @request-close=${this._dialog.onRequestClose}
      >
        ${content ? content.body() : nothing}
        <div class="actions">
          <button class="btn btn--cancel" @click=${this._close}>
            ${this._localize("layout.close")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _close = () => {
    this._dialog.open = false;
  };

  private _open(content: FileListDialogContent) {
    this._content = content;
    this._dialog.open = true;
  }

  private _navigate = (url: string) => {
    this._close();
    void navigate(url);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-file-list-dialog": ESPHomeFileListDialog;
  }
}
