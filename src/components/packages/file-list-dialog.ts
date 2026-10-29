/**
 * Read-only list of devices or files, each row opening its editor.
 * ``showUsage`` lists the devices using a package, ``showDependencies``
 * the files a device pulls in; each fetches, then opens.
 */
import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
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
import {
  deviceItems,
  fileItems,
  type LinkItem,
  linkListStyles,
  renderLinkList,
} from "./link-list.js";
import { otherReferrers } from "./usage-summary.js";
import { notifyFailure } from "./usage.js";

import "../base-dialog.js";

export interface FileListDialogContent {
  heading: string;
  /** Shown above the list; also the whole body when *items* is empty. */
  message: string;
  items: LinkItem[];
  /** A second list under its own message (e.g. other files including a package). */
  more?: { message: string; items: LinkItem[] };
  /** Extra line under the list (e.g. devices that couldn't be checked). */
  note?: string;
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
    css`
      esphome-base-dialog {
        --width: 480px;
      }
      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }
      .message,
      .note {
        margin: 0 0 var(--wa-space-s);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }
      .note {
        margin: var(--wa-space-s) 0 0;
      }
      .more {
        margin-top: var(--wa-space-m);
      }
    `,
  ];

  open(content: FileListDialogContent) {
    this._content = content;
    this._dialog.open = true;
  }

  /** List the devices and files using *path*; a toast instead when the lookup fails. */
  async showUsage(path: string): Promise<void> {
    const localize = this._localize;
    try {
      const usage = await this._api.getFileUsage(path);
      const others = otherReferrers(usage);
      this.open({
        heading: localize("packages.usage_title", { path }),
        message:
          usage.used_by.length > 0
            ? localize("packages.usage_message", { count: usage.used_by.length })
            : usage.unknown.length === 0 && others.length === 0
              ? localize("packages.usage_none")
              : "",
        items: deviceItems(usage.used_by, this._devices),
        more:
          others.length > 0
            ? {
                message: localize("packages.usage_other_files", { count: others.length }),
                items: fileItems(others),
              }
            : undefined,
        note:
          usage.unknown.length > 0
            ? localize("packages.usage_unknown", { names: usage.unknown.join(", ") })
            : undefined,
      });
    } catch (err) {
      notifyFailure(localize, "packages.usage_failed", err);
    }
  }

  /** List the files *configuration* pulls in; a toast instead when the lookup fails. */
  async showDependencies(configuration: string): Promise<void> {
    const localize = this._localize;
    try {
      const deps = await this._api.getDeviceDependencies(configuration);
      this.open({
        heading: localize("packages.dependencies_title", { name: configuration }),
        message: localize(
          deps.files.length > 0
            ? "packages.dependencies_message"
            : "packages.dependencies_none",
          { count: deps.files.length }
        ),
        items: fileItems(deps.files),
        note: deps.complete ? undefined : localize("packages.dependencies_incomplete"),
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
        ${
          content
            ? html`<p class="message">${content.message}</p>
                ${renderLinkList(content.items, this._open)}
                ${
                  content.more
                    ? html`<p class="message more">${content.more.message}</p>
                        ${renderLinkList(content.more.items, this._open)}`
                    : nothing
                }
                ${content.note ? html`<p class="note">${content.note}</p>` : nothing}`
            : nothing
        }
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

  private _open = (url: string) => {
    this._close();
    void navigate(url);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-file-list-dialog": ESPHomeFileListDialog;
  }
}
