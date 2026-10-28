/**
 * Package YAMLs: every YAML in a subfolder of the config dir, grouped by
 * folder. Devices include them through ``packages:`` / ``!include``; the
 * dashboard lists them here instead of as (always offline) devices.
 */
import { consume } from "@lit/context";
import {
  mdiDeleteOutline,
  mdiDevices,
  mdiPackageVariantClosed,
  mdiPlus,
  mdiRenameOutline,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { APIError } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { FileUsage } from "../api/types/files.js";
import { ErrorCode } from "../api/types/protocol.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeConfirmDialog } from "../components/confirm-dialog.js";
import type { ESPHomeFileListDialog } from "../components/packages/file-list-dialog.js";
import { linkListStyles } from "../components/packages/link-list.js";
import type {
  ESPHomeRenameFileDialog,
  RenameFileDetail,
} from "../components/packages/rename-file-dialog.js";
import {
  NO_USAGE,
  renderUsageSummary,
  usageSummaryStyles,
} from "../components/packages/usage-summary.js";
import {
  fetchUsers,
  notifyFailure,
  renameFile,
  showUsage,
} from "../components/packages/usage.js";
import {
  apiConnectedContext,
  apiContext,
  devicesContext,
  localizeContext,
} from "../context/index.js";
import { loadMessageStyles } from "../styles/load-message.js";
import { espHomeStyles } from "../styles/shared.js";
import {
  fileEditorUrl,
  fileNameOf,
  groupByFolder,
  newPackagePathProblem,
} from "../util/file-paths.js";
import { navigate } from "../util/navigation.js";
import { notifySuccess } from "../util/notify.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { renderAsyncState } from "../util/render-async-state.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../components/confirm-dialog.js";
import "../components/packages/file-list-dialog.js";
import "../components/packages/rename-file-dialog.js";

registerMdiIcons({
  "delete-outline": mdiDeleteOutline,
  devices: mdiDevices,
  "package-variant-closed": mdiPackageVariantClosed,
  plus: mdiPlus,
  "rename-outline": mdiRenameOutline,
});

type LoadState = "loading" | "ready" | "error";

@customElement("esphome-page-packages")
export class ESPHomePagePackages extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  /** WS liveness; the false→true edge re-runs a load that failed. */
  @consume({ context: apiConnectedContext, subscribe: true })
  @state()
  private _apiConnected = false;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @state() private _state: LoadState = "loading";
  @state() private _paths: string[] = [];
  @state() private _newPath = "";
  @state() private _creating = false;
  /** The package the delete confirm is about, and the devices using it. */
  @state() private _pendingDelete: { path: string; usage: FileUsage } | null = null;

  @query("esphome-confirm-dialog")
  private _deleteDialog?: ESPHomeConfirmDialog;

  @query("esphome-file-list-dialog")
  private _usageDialog?: ESPHomeFileListDialog;

  @query("esphome-rename-file-dialog")
  private _renameDialog?: ESPHomeRenameFileDialog;

  private _wasConnected = false;

  static styles = [
    espHomeStyles,
    loadMessageStyles,
    linkListStyles,
    usageSummaryStyles,
    css`
      .page {
        max-width: 960px;
        margin: 0 auto;
        padding: var(--wa-space-l) var(--content-gutter);
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-l);
      }
      h1 {
        margin: 0 0 2px;
        font-size: var(--wa-font-size-l);
        font-weight: var(--wa-font-weight-bold);
      }
      .desc {
        margin: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }
      code,
      .path {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      }
      .create {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-s);
        align-items: center;
      }
      .create input {
        flex: 1;
        min-width: 220px;
        padding: 8px 10px;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
        font: inherit;
        font-size: var(--wa-font-size-s);
      }
      .create .problem {
        flex-basis: 100%;
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--esphome-error);
      }
      .primary,
      .row-action {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: var(--wa-border-radius-m);
        font: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        cursor: pointer;
      }
      .primary {
        padding: var(--esphome-button-padding);
        border: none;
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }
      .primary:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .folder {
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        overflow: hidden;
      }
      .folder h2 {
        margin: 0;
        padding: 10px 16px;
        font-size: var(--wa-font-size-s);
        background: var(--wa-color-surface-lowered);
      }
      .file {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: 8px 16px;
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }
      .file-name {
        flex: 1;
        border: none;
        background: none;
        padding: 0;
        text-align: left;
        font: inherit;
        font-size: var(--wa-font-size-s);
        color: var(--esphome-primary);
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      .file-name:hover {
        text-decoration: underline;
      }
      .row-action {
        padding: 4px 8px;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: transparent;
        color: var(--wa-color-text-normal);
      }
      .row-action:hover {
        background: var(--wa-color-surface-lowered);
      }
      .row-action wa-icon,
      .primary wa-icon {
        font-size: 16px;
      }
      .empty {
        padding: var(--wa-space-l);
        text-align: center;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }
      .empty wa-icon {
        font-size: 40px;
      }
      .delete-users {
        margin-top: var(--wa-space-s);
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    void this._reload();
  }

  protected updated() {
    // Socket back after a failed load: try again without a Retry click.
    if (this._apiConnected && !this._wasConnected && this._state === "error") {
      void this._reload();
    }
    this._wasConnected = this._apiConnected;
  }

  protected render() {
    const problem = this._newPath.trim() ? newPackagePathProblem(this._newPath) : null;
    return html`
      <div class="page">
        <div>
          <h1>${this._localize("packages.title")}</h1>
          <p class="desc">${this._localize("packages.desc")}</p>
        </div>
        <form class="create" @submit=${this._create}>
          <input
            type="text"
            autocomplete="off"
            spellcheck="false"
            class="path"
            aria-label=${this._localize("packages.new_label")}
            placeholder=${this._localize("packages.new_placeholder")}
            .value=${this._newPath}
            @input=${(e: Event) => (this._newPath = (e.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="submit"
            class="primary"
            ?disabled=${this._creating || !this._newPath.trim() || problem !== null}
          >
            <wa-icon library="mdi" name="plus"></wa-icon>
            ${this._localize("packages.new")}
          </button>
          ${problem ? html`<p class="problem" role="alert">${this._localize(problem)}</p>` : nothing}
        </form>
        ${renderAsyncState({
          loading: this._state === "loading",
          loadingMessage: this._localize("packages.loading"),
          loadingLead: html`<wa-spinner></wa-spinner>`,
          error: this._state === "error" ? this._localize("packages.load_failed") : null,
          errorActions: () =>
            html`<wa-button size="small" @click=${this._reload}>
              ${this._localize("command.retry")}
            </wa-button>`,
          content: () => this._renderList(),
        })}
      </div>
      <esphome-confirm-dialog
        ?destructive=${true}
        heading=${this._localize("packages.delete_title", {
          path: this._pendingDelete?.path ?? "",
        })}
        confirm-label=${this._localize("packages.delete")}
        @confirm=${this._delete}
      >
        <div slot="body">${this._renderDeleteBody()}</div>
      </esphome-confirm-dialog>
      <esphome-file-list-dialog></esphome-file-list-dialog>
      <esphome-rename-file-dialog
        @rename-file=${this._rename}
      ></esphome-rename-file-dialog>
    `;
  }

  private _renderList() {
    if (this._paths.length === 0) {
      return html`<div class="empty">
        <wa-icon library="mdi" name="package-variant-closed"></wa-icon>
        <p>${this._localize("packages.empty")}</p>
      </div>`;
    }
    return html`${[...groupByFolder(this._paths)].map(
      ([folder, paths]) =>
        html`<section class="folder" aria-label=${folder}>
          <h2 class="path">${folder}/</h2>
          ${paths.map(
            (path) =>
              html`<div class="file">
                <button
                  type="button"
                  class="file-name path"
                  @click=${() => navigate(fileEditorUrl(path))}
                >
                  ${fileNameOf(path)}
                </button>
                <button
                  type="button"
                  class="row-action"
                  @click=${() => this._showUsage(path)}
                >
                  <wa-icon library="mdi" name="devices"></wa-icon>
                  ${this._localize("packages.show_usage")}
                </button>
                <button
                  type="button"
                  class="row-action"
                  aria-label=${this._localize("packages.rename_named", { path })}
                  title=${this._localize("packages.rename")}
                  @click=${() => this._openRename(path)}
                >
                  <wa-icon library="mdi" name="rename-outline"></wa-icon>
                </button>
                <button
                  type="button"
                  class="row-action"
                  aria-label=${this._localize("packages.delete_named", { path })}
                  title=${this._localize("packages.delete")}
                  @click=${() => this._confirmDelete(path)}
                >
                  <wa-icon library="mdi" name="delete-outline"></wa-icon>
                </button>
              </div>`
          )}
        </section>`
    )}`;
  }

  private _renderDeleteBody() {
    return renderUsageSummary(this._pendingDelete?.usage ?? NO_USAGE, {
      localize: this._localize,
      devices: this._devices,
      usedKey: "packages.delete_used_message",
      unusedKey: "packages.delete_unused_message",
      open: (url) => {
        this._deleteDialog?.close();
        void navigate(url);
      },
    });
  }

  private _reload = async () => {
    this._state = "loading";
    try {
      this._paths = (await this._api.listPackages()).map((p) => p.path);
      this._state = "ready";
    } catch (err) {
      console.error("Failed to list packages:", err);
      this._state = "error";
    }
  };

  private async _openRename(path: string) {
    const usage = await fetchUsers(this._api, this._localize, path);
    if (usage !== null) this._renameDialog?.open(path, usage);
  }

  private _rename = async (e: CustomEvent<RenameFileDetail>) => {
    await renameFile(this._api, this._localize, e.detail);
    void this._reload();
  };

  private _create = async (e: Event) => {
    e.preventDefault();
    const path = this._newPath.trim();
    if (newPackagePathProblem(path) !== null) return;
    this._creating = true;
    try {
      await this._api.createFile(
        path,
        this._localize("packages.new_file_template", { path })
      );
    } catch (err) {
      const key =
        err instanceof APIError && err.errorCode === ErrorCode.ALREADY_EXISTS
          ? "packages.already_exists"
          : "packages.create_failed";
      this._fail(key, err);
      return;
    } finally {
      this._creating = false;
    }
    this._newPath = "";
    void navigate(fileEditorUrl(path));
  };

  private _showUsage(path: string) {
    void showUsage(this._api, this._localize, this._devices, this._usageDialog, path);
  }

  private async _confirmDelete(path: string) {
    const usage = await fetchUsers(this._api, this._localize, path);
    if (usage === null) return;
    this._pendingDelete = { path, usage };
    this._deleteDialog?.open();
  }

  private _delete = async () => {
    const path = this._pendingDelete?.path;
    if (!path) return;
    try {
      await this._api.deleteFile(path);
      notifySuccess(this._localize("packages.deleted", { path }));
    } catch (err) {
      this._fail("packages.delete_failed", err);
    }
    void this._reload();
  };

  private _fail(key: string, err: unknown) {
    notifyFailure(this._localize, key, err);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-packages": ESPHomePagePackages;
  }
}
