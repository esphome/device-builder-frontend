/**
 * Delete a package: fetches the devices using it, confirms (listing them),
 * deletes and emits ``file-deleted`` with ``{path}``. Failures toast.
 */
import { consume } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { ConfiguredDevice } from "../../api/types/devices.js";
import type { FileUsage } from "../../api/types/files.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, devicesContext, localizeContext } from "../../context/index.js";
import { navigate } from "../../util/navigation.js";
import { notifySuccess } from "../../util/notify.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import { linkListStyles } from "./link-list.js";
import { NO_USAGE, renderUsageSummary, usageSummaryStyles } from "./usage-summary.js";
import { notifyFailure } from "./usage.js";

import "../confirm-dialog.js";

@customElement("esphome-delete-file-dialog")
export class ESPHomeDeleteFileDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @state() private _path = "";
  @state() private _usage: FileUsage = NO_USAGE;

  @query("esphome-confirm-dialog") private _confirm?: ESPHomeConfirmDialog;

  static styles = [
    linkListStyles,
    usageSummaryStyles,
    css`
      :host {
        display: contents;
      }
    `,
  ];

  /** Bumped per ``open``, so only the latest lookup opens the prompt. */
  private _opening = 0;

  /** Fetch the devices using *path*, then ask; a toast instead when that fails. */
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
    this._usage = usage;
    this._path = path;
    await this.updateComplete;
    if (opening === this._opening) this._confirm?.open();
  }

  protected render() {
    return html`
      <esphome-confirm-dialog
        ?destructive=${true}
        heading=${this._localize("packages.delete_title", { path: this._path })}
        confirm-label=${this._localize("packages.delete")}
        @confirm=${this._delete}
      >
        <div slot="body">
          ${renderUsageSummary(this._usage, {
            localize: this._localize,
            devices: this._devices,
            usedKey: "packages.delete_used_message",
            unusedKey: "packages.delete_unused_message",
            open: (url) => {
              this._confirm?.close();
              void navigate(url);
            },
          })}
        </div>
      </esphome-confirm-dialog>
    `;
  }

  private _delete = async () => {
    const path = this._path;
    try {
      await this._api.deleteFile(path);
    } catch (err) {
      notifyFailure(this._localize, "packages.delete_failed", err);
      return;
    }
    notifySuccess(this._localize("packages.deleted", { path }));
    this.dispatchEvent(
      new CustomEvent<{ path: string }>("file-deleted", {
        detail: { path },
        bubbles: true,
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-delete-file-dialog": ESPHomeDeleteFileDialog;
  }
}
