/**
 * Editor for a non-device YAML (a package in a subfolder, or any include
 * a device pulls in). Plain YAML editing: device lint needs a device
 * config, so the editor runs without one. Saves are guarded with
 * ``expected`` so an edit made outside the dashboard isn't overwritten.
 */
import { consume } from "@lit/context";
import {
  mdiContentSave,
  mdiDeleteOutline,
  mdiDevices,
  mdiMenu,
  mdiRenameOutline,
} from "@mdi/js";
import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { APIError } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/index.js";
import { ErrorCode } from "../api/types/protocol.js";
import type { PairingSummary } from "../api/types/remote-build.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeDeleteFileDialog } from "../components/packages/delete-file-dialog.js";
import type { ESPHomeFileListDialog } from "../components/packages/file-list-dialog.js";
import type {
  ESPHomeRenameFileDialog,
  RenameFileDetail,
} from "../components/packages/rename-file-dialog.js";
import { notifyFailure, renameFile } from "../components/packages/usage.js";
import type { ESPHomeUnsavedChangesDialog } from "../components/unsaved-changes-dialog.js";
import type { HighlightRange } from "../components/yaml-editor.js";
import {
  apiConnectedContext,
  apiContext,
  buildOffloadPairingsContext,
  localizeContext,
  versionContext,
} from "../context/index.js";
import { loadMessageStyles } from "../styles/load-message.js";
import { espHomeStyles } from "../styles/shared.js";
import { runBulkUpdate } from "../util/bulk-update.js";
import { ConfigLoadController } from "../util/config-load-controller.js";
import { fileEditorUrl, fileNameOf, folderOf } from "../util/file-paths.js";
import { navigate, PopLeaveGuardController } from "../util/navigation.js";
import { LONG_TOAST_DURATION_MS, notifyError, notifySuccess } from "../util/notify.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { renderAsyncState } from "../util/render-async-state.js";
import { SaveShortcutController } from "../util/save-shortcut-controller.js";
import { UnsavedGuard } from "../util/unsaved-guard.js";
import { secretsStyles } from "./secrets.styles.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../components/device/device-navigator.js";
import "../components/packages/delete-file-dialog.js";
import "../components/packages/file-list-dialog.js";
import "../components/packages/rename-file-dialog.js";
import "../components/unsaved-changes-dialog.js";
import "../components/yaml-editor.js";

registerMdiIcons({
  "content-save": mdiContentSave,
  "delete-outline": mdiDeleteOutline,
  devices: mdiDevices,
  menu: mdiMenu,
  "rename-outline": mdiRenameOutline,
});

@customElement("esphome-page-file")
export class ESPHomePageFile extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @consume({ context: apiConnectedContext, subscribe: true })
  @state()
  private _apiConnected = false;

  @consume({ context: versionContext, subscribe: true })
  @state()
  private _appVersion = "";

  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  private _pairings: Map<string, PairingSummary> | null = null;

  /** Config-relative POSIX path, from the ``/file/*`` route. */
  @property() path = "";

  @state() private _yaml = "";
  @state() private _savedYaml = "";
  @state() private _saving = false;
  /** Navigator selection and the YAML range it highlights. */
  @state() private _selectedSection: string | null = null;
  @state() private _selectedFromLine?: number;
  @state() private _highlight: HighlightRange | null = null;
  @state() private _scrollToHighlight = false;
  @state() private _navCollapsed = false;
  /** Navigator accordion: one section open at a time, Components first. */
  @state() private _openSections = new Set<number>([1]);

  protected readonly _load = new ConfigLoadController(this, {
    api: () => this._api,
    connected: () => this._apiConnected,
    configuration: () => this.path,
    attempts: 4,
    commit: (yaml) => {
      this._yaml = yaml;
      this._savedYaml = yaml;
    },
    onApiError: (err) => (err.errorCode === ErrorCode.NOT_FOUND ? "missing" : undefined),
    onRefreshFailed: () => notifyError(this._localize("file.reload_failed")),
  });

  @query("esphome-unsaved-changes-dialog")
  private _unsavedDialog?: ESPHomeUnsavedChangesDialog;

  @query("esphome-delete-file-dialog")
  private _deleteDialog?: ESPHomeDeleteFileDialog;

  @query("esphome-file-list-dialog")
  private _usageDialog?: ESPHomeFileListDialog;

  @query("esphome-rename-file-dialog")
  private _renameDialog?: ESPHomeRenameFileDialog;

  private _unsavedGuard = new UnsavedGuard();

  protected readonly _saveShortcut = new SaveShortcutController(this, () => {
    if (this._isDirty && !this._saving && this._yaml.trim() !== "") void this._save();
  });

  protected readonly _leaveGuard = new PopLeaveGuardController(this, {
    confirmLeave: () =>
      this._unsavedGuard.run({
        dirty: this._isDirty,
        open: () => this._unsavedDialog?.open(),
        save: () => this._save(),
      }),
    isDirty: () => this._isDirty,
    url: () => fileEditorUrl(this.path),
  });

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("beforeunload", this._onBeforeUnload);
  }

  disconnectedCallback() {
    window.removeEventListener("beforeunload", this._onBeforeUnload);
    this._unsavedGuard.cancelPending();
    super.disconnectedCallback();
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("path") && this.path) {
      // A discarded buffer of the previous file must not be saved into this one.
      this._yaml = this._savedYaml = "";
      void this._load.start();
    }
  }

  private get _isDirty(): boolean {
    return this._yaml !== this._savedYaml;
  }

  /** Only packages (subfolder YAMLs) are deletable here; a top-level file is a device. */
  private get _isPackage(): boolean {
    return folderOf(this.path) !== "";
  }

  private _onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this._isDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  };

  static styles = [
    espHomeStyles,
    loadMessageStyles,
    secretsStyles,
    css`
      .page-title p {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      }
      .header-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        background: transparent;
        color: var(--wa-color-text-normal);
        font: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        cursor: pointer;
      }
      .header-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .header-button:hover:not(:disabled) {
        background: var(--wa-color-surface-lowered);
      }
      .header-button wa-icon {
        font-size: 16px;
      }
      .delete-users {
        margin-top: var(--wa-space-s);
      }
      .body {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(230px, 1fr) minmax(0, 4fr);
        gap: var(--wa-space-m);
      }
      .body.nav-collapsed {
        grid-template-columns: minmax(0, 1fr);
      }
      @media (max-width: 900px) {
        .body {
          grid-template-columns: minmax(0, 1fr);
        }
        esphome-device-navigator {
          display: none;
        }
      }
    `,
  ];

  protected render() {
    return html`
      <div class="page">
        <div class="page-header">
          <div class="page-title">
            <h1>${fileNameOf(this.path)}</h1>
            <p>${this.path}</p>
          </div>
          ${
            this._navCollapsed
              ? html`<button
                  type="button"
                  class="header-button"
                  @click=${() => (this._navCollapsed = false)}
                >
                  <wa-icon library="mdi" name="menu"></wa-icon>
                  ${this._localize("device.show_navigator")}
                </button>`
              : null
          }
          <button type="button" class="header-button" @click=${this._showUsage}>
            <wa-icon library="mdi" name="devices"></wa-icon>
            ${this._localize("packages.show_usage")}
          </button>
          ${
            this._isPackage
              ? html`<button
                    type="button"
                    class="header-button"
                    ?disabled=${this._isDirty}
                    title=${this._isDirty ? this._localize("packages.rename_save_first") : ""}
                    @click=${this._openRename}
                  >
                    <wa-icon library="mdi" name="rename-outline"></wa-icon>
                    ${this._localize("packages.rename")}
                  </button>
                  <button
                    type="button"
                    class="header-button"
                    @click=${this._confirmDelete}
                  >
                    <wa-icon library="mdi" name="delete-outline"></wa-icon>
                    ${this._localize("packages.delete")}
                  </button>`
              : null
          }
        </div>
        <div class="body ${this._navCollapsed ? "nav-collapsed" : ""}">
          ${
            this._load.state === "ready" && !this._navCollapsed
              ? html`<esphome-device-navigator
                  readonly
                  platformReady
                  .yaml=${this._yaml}
                  .configuration=${this.path}
                  .selectedKey=${this._selectedSection}
                  .selectedFromLine=${this._selectedFromLine}
                  .openSections=${this._openSections}
                  @section-toggle=${(e: CustomEvent<{ index: number }>) =>
                    (this._openSections = this._openSections.has(e.detail.index)
                      ? new Set()
                      : new Set([e.detail.index]))}
                  @section-reveal=${(e: CustomEvent<{ index: number }>) =>
                    (this._openSections = new Set([e.detail.index]))}
                  @section-select=${this._onSectionSelect}
                  @yaml-highlight=${this._onYamlHighlight}
                  @nav-collapse=${() => (this._navCollapsed = true)}
                ></esphome-device-navigator>`
              : null
          }
          <div class="editor-card">
            ${renderAsyncState({
              loading: this._load.state === "loading",
              loadingMessage: this._localize("file.loading"),
              loadingLead: html`<wa-spinner></wa-spinner>`,
              error:
                this._load.state === "error"
                  ? this._localize("file.load_failed")
                  : this._load.state === "missing"
                    ? this._localize("file.not_found", { path: this.path })
                    : null,
              errorActions: () =>
                this._load.state === "error"
                  ? html`<wa-button size="small" @click=${this._load.retry}>
                      ${this._localize("command.retry")}
                    </wa-button>`
                  : html`<wa-button size="small" @click=${() => navigate("/packages")}>
                      ${this._localize("packages.title")}
                    </wa-button>`,
              content: () => html`
                <button
                  type="button"
                  class="save-button"
                  ?disabled=${this._saving || !this._isDirty}
                  @click=${this._save}
                >
                  <wa-icon library="mdi" name="content-save"></wa-icon>
                  ${this._localize(this._saving ? "file.saving" : "file.save")}
                </button>
                <div class="editor-pane">
                  <esphome-yaml-editor
                    completion
                    .filePath=${this.path}
                    .value=${this._yaml}
                    .highlightRange=${this._highlight}
                    .scrollToHighlight=${this._scrollToHighlight}
                    @yaml-change=${this._onYamlChange}
                  ></esphome-yaml-editor>
                </div>
              `,
            })}
          </div>
        </div>
      </div>
      <esphome-unsaved-changes-dialog
        heading=${this._localize("file.unsaved_title")}
        message=${this._localize("file.unsaved_message")}
        @discard=${() => this._unsavedGuard.onDiscard()}
        @save=${() => this._unsavedGuard.onSave()}
        @cancel=${() => this._unsavedGuard.onCancel()}
      ></esphome-unsaved-changes-dialog>
      <esphome-delete-file-dialog
        @file-deleted=${this._onDeleted}
      ></esphome-delete-file-dialog>
      <esphome-file-list-dialog></esphome-file-list-dialog>
      <esphome-rename-file-dialog
        @rename-file=${this._rename}
      ></esphome-rename-file-dialog>
    `;
  }

  private _onYamlChange = (e: CustomEvent<{ value: string }>) => {
    this._yaml = e.detail.value;
    // A hand edit shifts lines under the navigator's highlight.
    this._highlight = null;
  };

  private _onSectionSelect = (
    e: CustomEvent<{ sectionKey: string | null; fromLine?: number }>
  ) => {
    this._selectedSection = e.detail.sectionKey;
    this._selectedFromLine = e.detail.fromLine;
  };

  private _onYamlHighlight = (
    e: CustomEvent<{ range: HighlightRange | null; scroll: boolean }>
  ) => {
    this._highlight = e.detail.range;
    this._scrollToHighlight = e.detail.scroll;
  };

  private _pendingSave: { path: string; result: Promise<boolean> } | null = null;

  // Returns whether the buffer is clean afterwards, so the leave guard knows whether to go.
  private _save = (): Promise<boolean> => {
    const pending = this._pendingSave;
    // A second Save of the same file (button, shortcut, leave dialog) joins the write in
    // flight; while another file's write is pending, this one is not saved.
    if (pending)
      return pending.path === this.path ? pending.result : Promise.resolve(false);
    const result = this._write().finally(() => (this._pendingSave = null));
    this._pendingSave = { path: this.path, result };
    return result;
  };

  private _write = async (): Promise<boolean> => {
    // The page is reused across files: late results only apply to the file they belong to.
    const path = this.path;
    const content = this._yaml;
    this._saving = true;
    try {
      await this._api.updateConfig(path, content, { expected: this._savedYaml });
    } catch (err) {
      if (err instanceof APIError && err.errorCode === ErrorCode.PRECONDITION_FAILED) {
        notifyError(this._localize("file.changed_on_disk"), {
          duration: LONG_TOAST_DURATION_MS,
          action: {
            label: this._localize("file.reload"),
            onClick: () => {
              if (this.path === path) void this._load.start();
            },
          },
        });
      } else {
        notifyFailure(this._localize, "file.save_error", err);
      }
      return false;
    } finally {
      this._saving = false;
    }
    if (this.path !== path) return true;
    this._savedYaml = content;
    void this._announceSaved(path);
    // Typed while saving: not clean, so "Save and leave" stays.
    return this._yaml === content;
  };

  /** Success toast; when devices use the file, it offers to install them. */
  private async _announceSaved(path: string) {
    let users: string[] = [];
    try {
      users = (await this._api.getFileUsage(path)).used_by;
    } catch {
      // Usage is a convenience on top of a save that already landed.
    }
    if (users.length === 0) {
      notifySuccess(this._localize("file.saved"));
      return;
    }
    notifySuccess(this._localize("file.saved"), {
      description: this._localize("file.saved_used_by", { count: users.length }),
      duration: LONG_TOAST_DURATION_MS,
      action: {
        label: this._localize("file.install_users"),
        onClick: () =>
          void runBulkUpdate(users, {
            api: this._api,
            localize: this._localize,
            appVersion: this._appVersion,
            pairings: this._pairings?.values() ?? [],
          }),
      },
    });
  }

  private _showUsage = () => void this._usageDialog?.showUsage(this.path);

  private _openRename = () => void this._renameDialog?.open(this.path);

  private _rename = async (e: CustomEvent<RenameFileDetail>) => {
    const newPath = await renameFile(this._api, this._localize, e.detail);
    // The user may have moved on while the rename ran.
    if (newPath !== null && this.isConnected && this.path === e.detail.path) {
      void navigate(fileEditorUrl(newPath));
    }
  };

  private _confirmDelete = () => void this._deleteDialog?.open(this.path);

  private _onDeleted = (e: CustomEvent<{ path: string }>) => {
    if (e.detail.path !== this.path) return;
    // The file is gone; leaving must not prompt to save it back.
    this._savedYaml = this._yaml;
    void navigate("/packages");
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-file": ESPHomePageFile;
  }
}
