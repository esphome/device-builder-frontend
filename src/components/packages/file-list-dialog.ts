/**
 * Read-only list of devices or files, each row opening its editor.
 * Backs "Show usage" (devices using a package) and "Show dependencies"
 * (files a device pulls in).
 */
import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import {
  dialogActionButtonStyles,
  dialogActionsRowStyles,
} from "../../styles/dialog-action-buttons.js";
import { dialogChromeStyles } from "../../styles/dialog-chrome.js";
import { espHomeStyles } from "../../styles/shared.js";
import { DialogOpenController } from "../../util/dialog-open-controller.js";
import { navigate } from "../../util/navigation.js";
import { type LinkItem, linkListStyles, renderLinkList } from "./link-list.js";

import "../base-dialog.js";

export interface FileListDialogContent {
  heading: string;
  /** Shown above the list; also the whole body when *items* is empty. */
  message: string;
  items: LinkItem[];
  /** Extra line under the list (e.g. devices that couldn't be checked). */
  note?: string;
}

@customElement("esphome-file-list-dialog")
export class ESPHomeFileListDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

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
    `,
  ];

  open(content: FileListDialogContent) {
    this._content = content;
    this._dialog.open = true;
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
