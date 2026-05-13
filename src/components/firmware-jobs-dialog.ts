import { consume } from "@lit/context";
import {
  mdiBroom,
  mdiCancel,
  mdiCheckCircle,
  mdiClockOutline,
  mdiClose,
  mdiCloseCircle,
  mdiCogRefresh,
  mdiDeleteSweep,
  mdiHammerWrench,
  mdiPlaylistRemove,
  mdiRenameOutline,
  mdiUpload,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice, FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  devicesContext,
  firmwareJobsContext,
  localizeContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { firmwareJobDisplayName } from "../util/firmware-job-display.js";
import { isTerminalJob as isTerminal } from "../util/firmware-job-status.js";
import { postInstallShowLogsHandler } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { firmwareJobsDialogStyles } from "./firmware-jobs-dialog/styles.js";
import {
  compareJobs,
  renderEmpty,
  renderGroups,
} from "./firmware-jobs-dialog/renderers.js";
import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./command-dialog.js";
import type { ESPHomeCommandDialog } from "./command-dialog.js";
import "./confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "./confirm-dialog.js";
import "./logs-dialog.js";
import type { ESPHomeLogsDialog } from "./logs-dialog.js";

registerMdiIcons({
  broom: mdiBroom,
  cancel: mdiCancel,
  "check-circle": mdiCheckCircle,
  "clock-outline": mdiClockOutline,
  close: mdiClose,
  "close-circle": mdiCloseCircle,
  "cog-refresh": mdiCogRefresh,
  "delete-sweep": mdiDeleteSweep,
  "hammer-wrench": mdiHammerWrench,
  "playlist-remove": mdiPlaylistRemove,
  "rename-outline": mdiRenameOutline,
  upload: mdiUpload,
});

@customElement("esphome-firmware-jobs-dialog")
export class ESPHomeFirmwareJobsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true }) @state() _localize: LocalizeFunc = (key) => key;
  @consume({ context: apiContext }) _api!: ESPHomeAPI;
  @consume({ context: firmwareJobsContext, subscribe: true }) @state() _jobs: Map<string, FirmwareJob> = new Map();
  @consume({ context: devicesContext, subscribe: true }) @state() _devices: ConfiguredDevice[] = [];

  @query("wa-dialog") private _dialog!: HTMLElement & { open: boolean };
  @query("esphome-command-dialog") private _commandDialog!: ESPHomeCommandDialog;
  // Logs dialog for the post-install hand-off when reattaching from this
  // surface. Without one, request-show-logs-after-install would no-op. (#139)
  @query("esphome-logs-dialog") private _logsDialog!: ESPHomeLogsDialog;
  @query("esphome-confirm-dialog") private _confirmDialog!: ESPHomeConfirmDialog;

  private _onPostInstallShowLogs = postInstallShowLogsHandler(
    () => this._logsDialog,
    () => this._localize,
  );

  // Ticker for live relative-time strings ("started 2m ago"). Open-only.
  @state() _now: number = Date.now();
  private _tickHandle: ReturnType<typeof setInterval> | null = null;

  open() {
    this._now = Date.now();
    this._dialog.open = true;
    this._startTicker();
  }

  close() {
    this._dialog.open = false;
    this._stopTicker();
  }

  // Open the Reset Build Environment confirm flow without needing this
  // dialog open. The confirm + command dialogs are siblings of the wa-dialog
  // in this host's shadow DOM, so they work even when the wa-dialog is closed
  // — surfaces like the header kebab can entry-point the same flow.
  openResetBuildEnv() {
    this._confirmDialog.open();
  }

  // Catch open-reset-build-env from the inner command-dialog so the
  // post-failure hint works when reviewing a past failed install from this
  // list. The app-shell listener sits on esphome-layout, but this dialog is
  // a sibling of that layout — without local handling the event bubbles past.
  private _onLocalResetEvent = (e: Event) => {
    e.stopPropagation();
    this.openResetBuildEnv();
  };

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopTicker();
  }

  static styles = [espHomeStyles, firmwareJobsDialogStyles];

  protected render() {
    const sorted = [...this._jobs.values()].sort(compareJobs);
    const active = sorted.filter((j) => !isTerminal(j));
    const terminal = sorted.filter((j) => isTerminal(j));
    const hasJobs = sorted.length > 0;

    return html`
      <wa-dialog
        light-dismiss
        label=${this._localize("firmware_jobs.title")}
        @wa-after-hide=${this._stopTicker}
      >
        <div class="toolbar">
          <button
            class="tool-btn"
            title=${this._localize("firmware_jobs.reset_build_env")}
            @click=${this._onResetClick}
          >
            <wa-icon library="mdi" name="cog-refresh"></wa-icon>
            ${this._localize("firmware_jobs.reset_build_env")}
          </button>
          <span class="spacer"></span>
          ${terminal.length > 0
            ? html`
                <button
                  class="tool-btn tool-btn--ghost"
                  title=${this._localize("firmware_jobs.clear_history")}
                  @click=${this._onClearHistory}
                >
                  <wa-icon library="mdi" name="delete-sweep"></wa-icon>
                  ${this._localize("firmware_jobs.clear_history")}
                </button>
              `
            : nothing}
        </div>
        ${hasJobs
          ? renderGroups(this, active, terminal)
          : renderEmpty(this._localize)}
      </wa-dialog>
      <esphome-command-dialog
        @open-reset-build-env=${this._onLocalResetEvent}
        @request-show-logs-after-install=${this._onPostInstallShowLogs}
      ></esphome-command-dialog>
      <esphome-logs-dialog></esphome-logs-dialog>
      <esphome-confirm-dialog
        heading=${this._localize("firmware_jobs.reset_confirm_title")}
        confirm-label=${this._localize("firmware_jobs.reset_confirm_button")}
        message=${this._localize("firmware_jobs.reset_confirm_message")}
        @confirm=${this._onResetConfirmed}
      ></esphome-confirm-dialog>
    `;
  }

  private _startTicker() {
    if (this._tickHandle !== null) return;
    this._tickHandle = setInterval(() => {
      this._now = Date.now();
    }, 30_000);
  }

  private _stopTicker = () => {
    if (this._tickHandle !== null) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
  };

  _jobDisplayName(job: FirmwareJob): string {
    return firmwareJobDisplayName(job, this._devices, this._localize);
  }

  _openJob(job: FirmwareJob) {
    this._commandDialog.followJob(job, this._jobDisplayName(job));
  }

  _onCancelClick(e: Event, job: FirmwareJob) {
    e.stopPropagation();
    void this._cancel(job);
  }

  private async _cancel(job: FirmwareJob) {
    try {
      await this._api.firmwareCancel(job.job_id);
    } catch {
      /* job may have finished — follow_jobs will reconcile */
    }
  }

  private _onResetClick = () => {
    this._confirmDialog.open();
  };

  private _onResetConfirmed = async () => {
    let job: FirmwareJob;
    try {
      job = await this._api.firmwareResetBuildEnv();
    } catch (err) {
      console.error("Failed to queue reset_build_env job:", err);
      return;
    }
    // Drop the user into the log viewer so they can watch the wipe.
    this._commandDialog.followJob(job, this._jobDisplayName(job));
  };

  private _onClearHistory = async () => {
    try {
      await this._api.firmwareClear();
    } catch (err) {
      console.error("Failed to clear firmware history:", err);
      return;
    }
    // firmware/clear has no broadcast event — let app-shell prune local context.
    this.dispatchEvent(
      new CustomEvent("firmware-history-cleared", {
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-firmware-jobs-dialog": ESPHomeFirmwareJobsDialog;
  }
}
