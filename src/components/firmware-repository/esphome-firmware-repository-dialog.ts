import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import { consume } from "@lit/context";
import {
  mdiCheckCircleOutline,
  mdiContentCopy,
  mdiDelete,
  mdiDotsVertical,
  mdiDownload,
} from "@mdi/js";
import { html, nothing, type TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { apiErrorDetails, ClientValidationError } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type {
  FirmwareRepositoryArtifactType,
  FirmwareRepositoryFile,
} from "../../api/types/firmware-repository.js";
import type { FirmwareRepositoryRecord } from "../../api/types/firmware-repository.js";
import type { FirmwareRepositorySaveMetadata } from "../../api/types/firmware-repository.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { primaryDialogHeaderStyles } from "../../styles/dialog-header.js";
import { dropdownMenuStyles } from "../../styles/dropdown-menu.js";
import { espHomeStyles } from "../../styles/shared.js";
import { textStyles } from "../../styles/text.js";
import { copyToClipboard } from "../../util/copy-to-clipboard.js";
import { DialogOpenController } from "../../util/dialog-open-controller.js";
import { configurationStem } from "../../util/download-text.js";
import { downloadBlob } from "../../util/download-text.js";
import { notifyError, notifySuccess } from "../../util/notify.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { basename } from "../../util/yaml-validation-summary.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import { OverflowMenuElement } from "../overflow-menu-element.js";
import { firmwareRepositoryDialogStyles } from "./styles.js";

import "../base-dialog.js";
import "../confirm-dialog.js";
import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/button-group/button-group.js";
import "@home-assistant/webawesome/dist/components/dropdown/dropdown.js";
import "@home-assistant/webawesome/dist/components/dropdown-item/dropdown-item.js";

const VERSION_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const VERSION_MENU_OFFSET = 4;
const VERSION_MENU_MARGIN = 8;

function compareFirmwareRecordsLatestFirst(
  a: FirmwareRepositoryRecord,
  b: FirmwareRepositoryRecord
): number {
  const aCompiledAt = Date.parse(a.compiled_at ?? "");
  const bCompiledAt = Date.parse(b.compiled_at ?? "");
  const aHasCompileDate = Number.isFinite(aCompiledAt);
  const bHasCompileDate = Number.isFinite(bCompiledAt);

  if (aHasCompileDate && bHasCompileDate && aCompiledAt !== bCompiledAt) {
    return bCompiledAt - aCompiledAt;
  }
  if (aHasCompileDate !== bHasCompileDate) return aHasCompileDate ? -1 : 1;
  return VERSION_COLLATOR.compare(b.version, a.version);
}

function firmwareDisplayName(record: FirmwareRepositoryRecord, fallback = ""): string {
  return record.friendly_name || record.esphome_name || fallback || record.device;
}

registerMdiIcons({
  "check-circle-outline": mdiCheckCircleOutline,
  "content-copy": mdiContentCopy,
  delete: mdiDelete,
  "dots-vertical": mdiDotsVertical,
  download: mdiDownload,
});

@customElement("esphome-firmware-repository-dialog")
export class ESPHomeFirmwareRepositoryDialog extends OverflowMenuElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _records: FirmwareRepositoryRecord[] = [];

  @state()
  private _device = "";

  @state()
  private _displayNameFallback = "";

  @state()
  private _saveMode = false;

  @state()
  private _saveConfiguration = "";

  @state()
  private _summary = "";

  @state()
  private _releaseUrl = "";

  @state()
  private _loading = false;

  @state()
  private _busy = false;

  @state()
  private _error = "";

  @state()
  private _pendingDelete: FirmwareRepositoryRecord | null = null;

  @query("#delete-confirm")
  private _deleteConfirm!: ESPHomeConfirmDialog;

  private _menuAnchor: HTMLElement | null = null;

  private readonly _dialog = new DialogOpenController(this);

  static styles = [
    espHomeStyles,
    dropdownMenuStyles,
    primaryDialogHeaderStyles,
    textStyles,
    firmwareRepositoryDialogStyles,
  ];

  open(configuration: string, displayName?: string): void {
    this._saveMode = false;
    this._device = configurationStem(basename(configuration), configuration);
    this._displayNameFallback = displayName || this._device;
    this._records = [];
    this._error = "";
    this._dialog.open = true;
    void this._load();
  }

  openSave(configuration: string, displayName?: string): void {
    this._saveMode = true;
    this._saveConfiguration = configuration;
    this._device = configurationStem(basename(configuration), configuration);
    this._displayNameFallback = displayName || this._device;
    this._summary = "";
    this._releaseUrl = "";
    this._records = [];
    this._error = "";
    this._openMenuFor = null;
    this._close();
    this._dialog.open = true;
  }

  protected render() {
    const currentRecord = this._records.find((record) => record.device === this._device);
    const displayName = currentRecord
      ? firmwareDisplayName(currentRecord, this._displayNameFallback)
      : this._displayNameFallback || this._device;
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        ?busy=${this._busy}
        .label=${
          this._saveMode
            ? this._localize("firmware_repository.save_dialog_title")
            : this._localize("firmware_repository.dialog_title", {
                device: displayName,
              })
        }
        @request-close=${this._dialog.onRequestClose}
        @after-hide=${this._dialog.onAfterHide}
      >
        <div class="repository-content">${this._renderBody()}</div>
      </esphome-base-dialog>
      <esphome-confirm-dialog
        id="delete-confirm"
        .heading=${this._localize("firmware_repository.delete_confirm_title", {
          device: this._pendingDelete
            ? firmwareDisplayName(this._pendingDelete, this._displayNameFallback)
            : "",
          version: this._pendingDelete?.version ?? "",
        })}
        .message=${this._localize("firmware_repository.delete_confirm_message")}
        .confirmLabel=${this._localize("firmware_repository.delete_confirm_action")}
        ?destructive=${true}
        @confirm=${this._onDeleteConfirmed}
      ></esphome-confirm-dialog>
    `;
  }

  private _renderBody() {
    if (this._saveMode) return this._renderSaveForm();
    if (this._loading) {
      return html`<div class="state" role="status">
        <wa-spinner></wa-spinner>${this._localize("firmware_repository.loading")}
      </div>`;
    }
    if (this._error) {
      return html`<div class="state state--error" role="alert">
        ${this._error}
        <button class="refresh-btn" @click=${this._load}>
          ${this._localize("firmware_repository.retry")}
        </button>
      </div>`;
    }
    if (this._records.length === 0) {
      return html`<div class="state" role="status">
        ${this._localize("firmware_repository.empty_device", {
          device: this._displayNameFallback || this._device,
        })}
      </div>`;
    }
    return html`<div
      class="record-list ${this._records.length === 1 ? "record-list--single" : ""}"
      role="list"
    >
      ${this._records.map((record) => this._renderRecord(record))}
    </div>`;
  }

  private _renderSaveForm() {
    return html`<form class="save-form" @submit=${this._onSaveSubmit}>
      <label class="save-field" for="repository-summary">
        <span>${this._localize("firmware_repository.summary_label")}</span>
        <textarea
          id="repository-summary"
          rows="3"
          required
          .value=${this._summary}
          ?disabled=${this._busy}
          @input=${this._onSummaryInput}
        ></textarea>
      </label>
      <label class="save-field" for="repository-release-url">
        <span>${this._localize("firmware_repository.release_url_label")}</span>
        <input
          id="repository-release-url"
          type="url"
          .value=${this._releaseUrl}
          ?disabled=${this._busy}
          @input=${this._onReleaseUrlInput}
        />
      </label>
      ${
        this._error
          ? html`<div class="state state--error" role="alert">${this._error}</div>`
          : nothing
      }
      <div class="save-form-actions">
        <button
          type="button"
          class="action-btn"
          ?disabled=${this._busy}
          @click=${this._cancelSave}
        >
          ${this._localize("layout.cancel")}
        </button>
        <button type="submit" class="action-btn save-submit-btn" ?disabled=${this._busy}>
          ${this._localize("firmware_repository.save_submit")}
        </button>
      </div>
    </form>`;
  }

  private _onSummaryInput = (event: Event): void => {
    this._summary = (event.currentTarget as HTMLTextAreaElement).value;
  };

  private _onReleaseUrlInput = (event: Event): void => {
    this._releaseUrl = (event.currentTarget as HTMLInputElement).value;
  };

  private _onSaveSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    void this._saveFirmware();
  };

  private _cancelSave = (): void => {
    this._dialog.requestClose();
  };

  private _saveFirmware = async (): Promise<void> => {
    if (this._busy) return;
    this._error = "";

    const summary = this._summary.trim();
    if (!summary) {
      this._error = this._localize("firmware_repository.summary_required");
      return;
    }

    const releaseUrl = this._releaseUrl.trim();
    const metadata: FirmwareRepositorySaveMetadata = { summary };
    if (releaseUrl) metadata.release_url = releaseUrl;

    this._busy = true;
    try {
      const record = await this._api.firmwareRepositorySave(
        this._saveConfiguration,
        metadata
      );
      const displayName = firmwareDisplayName(record, this._displayNameFallback);
      notifySuccess(
        this._localize("firmware_repository.save_success", {
          device: displayName,
          version: record.version,
        })
      );
      this._saveMode = false;
      this._device = record.device;
      this._displayNameFallback = displayName;
      await this._load();
    } catch (error) {
      this._error =
        error instanceof ClientValidationError &&
        error.errorCode === "firmware_repository_summary_required"
          ? this._localize("firmware_repository.summary_required")
          : apiErrorDetails(error) || this._localize("firmware_repository.save_failed");
    } finally {
      this._busy = false;
    }
  };

  private _renderRecord(record: FirmwareRepositoryRecord) {
    const menuKey = `${record.device}/${record.version}`;
    const actionsOpen = this._open && this._openMenuFor === menuKey;
    const hasSpecificArtifacts =
      record.ota_bin !== undefined ||
      record.ota_md5 !== undefined ||
      record.factory_bin !== undefined ||
      record.factory_md5 !== undefined;
    const artifactTypes: Array<FirmwareRepositoryArtifactType | "legacy"> = [];
    if (record.ota_bin || record.ota_md5) artifactTypes.push("ota");
    if (record.factory_bin || record.factory_md5) artifactTypes.push("factory");
    if (!hasSpecificArtifacts && (record.bin || record.md5)) {
      artifactTypes.push("legacy");
    }
    return html`<article class="record" role="listitem">
      <div class="record-content">
        <div class="record-heading">
          <h3>${record.version}</h3>
          ${
            record.esphome_version && record.esphome_version !== record.version
              ? html`<span class="esphome-version">
                  ${this._localize("firmware_repository.esphome_version", {
                    version: record.esphome_version,
                  })}
                </span>`
              : nothing
          }
          ${artifactTypes.map(
            (type) =>
              html`<span class="artifact-type artifact-type--${type}">
                ${this._localize(`firmware_repository.artifact_${type}`)}
              </span>`
          )}
          <span class="status status--${record.status}">
            ${this._localize(`firmware_repository.status_${record.status}`)}
          </span>
          <div class="version-actions">
            <button
              type="button"
              class="version-menu-btn"
              title=${this._localize("firmware_repository.version_actions", {
                version: record.version,
              })}
              aria-label=${this._localize("firmware_repository.version_actions", {
                version: record.version,
              })}
              aria-haspopup="menu"
              aria-expanded=${actionsOpen ? "true" : "false"}
              ?disabled=${this._busy}
              @click=${(event: MouseEvent) => this._toggleActionsMenu(menuKey, event)}
            >
              <wa-icon library="mdi" name="dots-vertical"></wa-icon>
            </button>
            ${
              actionsOpen
                ? html`
                    <div
                      class="menu version-menu repository-action-popover"
                      popover="manual"
                      role="menu"
                    >
                      ${
                        record.status !== "published"
                          ? html`<div
                              class="menu-item"
                              role="menuitem"
                              tabindex="0"
                              @click=${() => {
                                this._closeActionsMenu();
                                void this._publish(record);
                              }}
                              @keydown=${this._onItemKeydown}
                            >
                              <wa-icon
                                library="mdi"
                                name="check-circle-outline"
                              ></wa-icon>
                              ${this._localize("firmware_repository.publish")}
                            </div>`
                          : nothing
                      }
                      <div
                        class="menu-item menu-item--danger"
                        role="menuitem"
                        tabindex="0"
                        @click=${() => {
                          this._closeActionsMenu();
                          this._requestDelete(record);
                        }}
                        @keydown=${this._onItemKeydown}
                      >
                        <wa-icon library="mdi" name="delete"></wa-icon>
                        ${this._localize("firmware_repository.delete")}
                      </div>
                    </div>
                  `
                : nothing
            }
          </div>
        </div>
        <div class="artifact-download-row">
          <button
            type="button"
            class="action-btn compact-download-btn"
            title=${this._localize("firmware_repository.download_yaml")}
            aria-label=${this._localize("firmware_repository.download_yaml")}
            ?disabled=${this._busy}
            @click=${() => this._downloadFile(record, "yaml")}
          >
            <wa-icon library="mdi" name="download"></wa-icon>
            ${this._localize("firmware_repository.download_yaml")}
          </button>
          ${
            hasSpecificArtifacts
              ? html`
                  ${this._renderArtifactActions(
                    record,
                    "ota",
                    record.ota_bin,
                    record.ota_md5
                  )}
                  ${this._renderArtifactActions(
                    record,
                    "factory",
                    record.factory_bin,
                    record.factory_md5
                  )}
                `
              : this._renderArtifactActions(record, undefined, record.bin, record.md5)
          }
        </div>
      </div>
    </article>`;
  }

  @state()
  private _openMenuFor: string | null = null;

  private _positionActionsMenu(): void {
    const menu = this.shadowRoot?.querySelector<
      HTMLElement & { showPopover?: () => void; hidePopover?: () => void }
    >(".repository-action-popover");
    const anchor = this._menuAnchor;
    if (!this._open || !menu || !anchor) return;

    if (menu.showPopover) {
      try {
        if (!menu.matches(":popover-open")) menu.showPopover();
      } catch {
        menu.removeAttribute("popover");
      }
    } else {
      menu.removeAttribute("popover");
    }

    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let top = anchorRect.bottom + VERSION_MENU_OFFSET;
    if (top + menuRect.height > window.innerHeight - VERSION_MENU_MARGIN) {
      const topAbove = anchorRect.top - menuRect.height - VERSION_MENU_OFFSET;
      top =
        topAbove >= VERSION_MENU_MARGIN
          ? topAbove
          : Math.max(
              VERSION_MENU_MARGIN,
              window.innerHeight - menuRect.height - VERSION_MENU_MARGIN
            );
    }
    const left = Math.min(
      Math.max(VERSION_MENU_MARGIN, anchorRect.right - menuRect.width),
      Math.max(
        VERSION_MENU_MARGIN,
        window.innerWidth - menuRect.width - VERSION_MENU_MARGIN
      )
    );
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }

  private _toggleActionsMenu(menuKey: string, event: MouseEvent): void {
    if (this._open && this._openMenuFor === menuKey) {
      this._closeActionsMenu();
      return;
    }
    this._menuAnchor = event.currentTarget as HTMLElement;
    this._openMenuFor = menuKey;
    this._open = true;
    void this.updateComplete.then(() => this._positionActionsMenu());
  }

  private _closeActionsMenu = (): void => {
    const menu = this.shadowRoot?.querySelector<
      HTMLElement & { hidePopover?: () => void }
    >(".repository-action-popover");
    if (menu?.matches(":popover-open")) {
      menu.hidePopover?.();
    }
    this._menuAnchor = null;
    this._openMenuFor = null;
    this._close();
  };

  private _renderArtifactActions(
    record: FirmwareRepositoryRecord,
    type: FirmwareRepositoryArtifactType | undefined,
    binary: string | null | undefined,
    md5: string | null | undefined
  ): TemplateResult | typeof nothing {
    if (!binary && !md5) return nothing;

    const labelKey = type
      ? `firmware_repository.artifact_${type}`
      : "firmware_repository.artifact_legacy";
    const label = this._localize(labelKey);
    const downloadKey = type
      ? `firmware_repository.download_${type}`
      : "firmware_repository.download_bin";
    return html`<wa-button-group class="artifact-split-btn" .label=${label}>
      ${
        binary
          ? html`<wa-button
              type="button"
              class="artifact-download-main"
              size="small"
              appearance="outlined"
              title=${this._localize(downloadKey)}
              .disabled=${this._busy}
              @click=${() => this._downloadFile(record, "bin", type)}
            >
              <wa-icon slot="start" library="mdi" name="download"></wa-icon>
              ${this._localize(downloadKey)}
            </wa-button>`
          : nothing
      }
      ${
        md5
          ? html`<wa-dropdown
              class="artifact-dropdown"
              placement="bottom-end"
              @wa-select=${(event: CustomEvent<{ item: Element }>) =>
                this._onArtifactMenuSelect(record, md5, type, event)}
            >
              <wa-button
                slot="trigger"
                class="artifact-menu-trigger"
                type="button"
                size="small"
                appearance="outlined"
                with-caret
                aria-label=${this._localize(
                  "firmware_repository.artifact_checksum_actions",
                  {
                    artifact: label,
                    version: record.version,
                  }
                )}
                .disabled=${this._busy}
              ></wa-button>
              <wa-dropdown-item value="copy-md5" size="small" ?disabled=${this._busy}>
                <wa-icon slot="icon" library="mdi" name="content-copy"></wa-icon>
                ${this._localize("firmware.copy_md5")}
              </wa-dropdown-item>
              <wa-dropdown-item value="download-md5" size="small" ?disabled=${this._busy}>
                <wa-icon slot="icon" library="mdi" name="download"></wa-icon>
                ${this._localize("firmware.download_md5")}
              </wa-dropdown-item>
            </wa-dropdown>`
          : nothing
      }
    </wa-button-group>`;
  }

  private _onArtifactMenuSelect(
    record: FirmwareRepositoryRecord,
    md5: string,
    type: FirmwareRepositoryArtifactType | undefined,
    event: CustomEvent<{ item: Element }>
  ): void {
    const item = event.detail.item as Element & { value?: string };
    const value = item.getAttribute("value") ?? item.value;
    if (value === "copy-md5") {
      void copyToClipboard(md5).then((copied) => {
        if (copied) {
          notifySuccess(this._localize("firmware.md5_copied"));
        } else {
          notifyError(this._localize("firmware.md5_copy_failed"));
        }
      });
    } else if (value === "download-md5") {
      void this._downloadFile(record, "md5", type);
    }
  }

  private _load = async (): Promise<void> => {
    if (this._loading) return;
    this._loading = true;
    this._error = "";
    try {
      this._records = (await this._api.firmwareRepositoryList())
        .filter((record) => record.device === this._device)
        .sort(compareFirmwareRecordsLatestFirst);
    } catch (error) {
      this._error =
        apiErrorDetails(error) || this._localize("firmware_repository.load_failed");
    } finally {
      this._loading = false;
    }
  };

  private _publish = async (record: FirmwareRepositoryRecord): Promise<void> => {
    if (this._busy) return;
    this._busy = true;
    try {
      await this._api.firmwareRepositoryPublish(record.device, record.version);
      notifySuccess(
        this._localize("firmware_repository.publish_success", {
          device: firmwareDisplayName(record, this._displayNameFallback),
          version: record.version,
        })
      );
      await this._load();
    } catch (error) {
      notifyError(
        apiErrorDetails(error) || this._localize("firmware_repository.publish_failed")
      );
    } finally {
      this._busy = false;
    }
  };

  private _requestDelete(record: FirmwareRepositoryRecord): void {
    this._pendingDelete = record;
    this._deleteConfirm.open();
  }

  private _downloadFile = async (
    record: FirmwareRepositoryRecord,
    file: FirmwareRepositoryFile,
    type?: FirmwareRepositoryArtifactType
  ): Promise<void> => {
    if (this._busy) return;
    this._busy = true;
    try {
      const { blob, filename } = type
        ? await this._api.firmwareRepositoryDownload(
            record.device,
            record.version,
            file,
            type
          )
        : await this._api.firmwareRepositoryDownload(record.device, record.version, file);
      const mimeType =
        file === "bin"
          ? "application/octet-stream"
          : file === "md5"
            ? "text/plain"
            : "text/yaml";
      downloadBlob(blob, filename, mimeType);
    } catch (error) {
      notifyError(
        apiErrorDetails(error) || this._localize("firmware_repository.download_failed")
      );
    } finally {
      this._busy = false;
    }
  };

  private _onDeleteConfirmed = async (): Promise<void> => {
    const record = this._pendingDelete;
    this._pendingDelete = null;
    if (!record || this._busy) return;
    this._busy = true;
    try {
      await this._api.firmwareRepositoryDelete(record.device, record.version);
      notifySuccess(
        this._localize("firmware_repository.delete_success", {
          device: firmwareDisplayName(record, this._displayNameFallback),
          version: record.version,
        })
      );
      await this._load();
    } catch (error) {
      notifyError(
        apiErrorDetails(error) || this._localize("firmware_repository.delete_failed")
      );
    } finally {
      this._busy = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-firmware-repository-dialog": ESPHomeFirmwareRepositoryDialog;
  }
}
