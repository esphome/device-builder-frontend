import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
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
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  buildOffloadPairingsContext,
  buildServerPeersContext,
  devicesContext,
  firmwareJobsContext,
  localizeContext,
} from "../context/index.js";
import { primaryDialogHeaderStyles } from "../styles/dialog-header.js";
import { espHomeStyles } from "../styles/shared.js";
import { textStyles } from "../styles/text.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { getErrorMessage } from "../util/error-message.js";
import { cancelFirmwareJob } from "../util/firmware-job-actions.js";
import { firmwareJobDisplayName } from "../util/firmware-job-display.js";
import { notifyError } from "../util/notify.js";
import { NowTickController } from "../util/now-tick-controller.js";
import { pairingDisplayName } from "../util/pairing-display-name.js";
import { postInstallShowLogsHandler } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";
import "./base-dialog.js";
import "./command-dialog.js";
import type { ESPHomeCommandDialog } from "./command-dialog.js";
import "./confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "./confirm-dialog.js";
import { firmwareJobsDialogStyles } from "./firmware-jobs-dialog/styles.js";
import type { PairingSummary, PeerSummary } from "../api/types/remote-build.js";
import { canResetBuildEnv } from "./remote-build-hint.js";
import { bucketJobs, renderEmpty, renderGroups } from "./shared/firmware-jobs-list.js";
import { firmwareJobsListStyles } from "./shared/firmware-jobs-list-styles.js";
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
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;
  @consume({ context: apiContext }) _api!: ESPHomeAPI;
  @consume({ context: firmwareJobsContext, subscribe: true }) @state() _jobs: Map<
    string,
    FirmwareJob
  > = new Map();
  @consume({ context: devicesContext, subscribe: true })
  @state()
  _devices: ConfiguredDevice[] = [];
  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  _pairings: Map<string, PairingSummary> | null = null;
  @consume({ context: buildServerPeersContext, subscribe: true })
  @state()
  _buildServerPeers: PeerSummary[] | null = null;

  private readonly _dialog = new DialogOpenController(this);
  @query("esphome-command-dialog") private _commandDialog!: ESPHomeCommandDialog;
  // Logs dialog for the post-install hand-off when reattaching from this
  // surface. Without one, request-show-logs-after-install would no-op. (#139)
  @query("esphome-logs-dialog") private _logsDialog!: ESPHomeLogsDialog;
  @query("#reset-local-confirm") private _confirmDialog!: ESPHomeConfirmDialog;
  @query("#reset-peer-confirm") private _resetPeerConfirmDialog!: ESPHomeConfirmDialog;

  // The pairing a pending remote-reset confirm targets; null when the
  // confirm dialog is closed.
  @state() private _pendingResetPeer: { pin_sha256: string; label: string } | null = null;

  private _onPostInstallShowLogs = postInstallShowLogsHandler(
    () => this._logsDialog,
    () => this._localize
  );

  // Ticker for live relative-time strings ("started 2m ago"). Open-only.
  private readonly _ticker = new NowTickController(this);

  get _now(): number {
    return this._ticker.now;
  }

  open() {
    this._dialog.open = true;
    this._ticker.start();
  }

  close() {
    this._dialog.open = false;
    this._ticker.stop();
  }

  // Open the Reset Build Environment confirm flow without needing this
  // dialog open. The confirm + command dialogs are siblings of the jobs
  // dialog in this host's shadow DOM, so they work even when it's closed
  // — surfaces like the header kebab can entry-point the same flow.
  openResetBuildEnv() {
    this._confirmDialog.open();
  }

  // Same entry-point shape for the REMOTE reset, gated on the pairing
  // still being reset-capable (a race with disconnect/unpair no-ops).
  openResetPeerBuildEnv(pin_sha256: string) {
    const pairing = this._pairings?.get(pin_sha256);
    if (pairing === undefined || !canResetBuildEnv(pairing)) return;
    this._pendingResetPeer = {
      pin_sha256,
      label: pairingDisplayName(pairing),
    };
    this._resetPeerConfirmDialog.open();
  }

  // Catch open-reset-build-env from the inner command-dialog so the
  // post-failure hint works when reviewing a past failed install from this
  // list. The app-shell listener sits on esphome-layout, but this dialog is
  // a sibling of that layout — without local handling the event bubbles past.
  private _onLocalResetEvent = (e: Event) => {
    e.stopPropagation();
    this.openResetBuildEnv();
  };

  private _onRemoteResetEvent = (e: CustomEvent<{ pin_sha256: string }>) => {
    e.stopPropagation();
    this.openResetPeerBuildEnv(e.detail.pin_sha256);
  };

  static styles = [
    espHomeStyles,
    primaryDialogHeaderStyles,
    textStyles,
    firmwareJobsListStyles,
    firmwareJobsDialogStyles,
  ];

  /** Bucket the live jobs Map into sorted / active / terminal lists.
   *  Memoised on the upstream Map reference; the context provider
   *  hands out a new Map identity on every job-lifecycle push, so
   *  the cache invalidates exactly when the lists would change. One
   *  sort + two filter passes per push, not per render. */
  private _bucketJobs = memoizeOne(bucketJobs);

  protected render() {
    const { sorted, active, terminal } = this._bucketJobs(this._jobs);
    const hasJobs = sorted.length > 0;

    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("firmware_jobs.title")}
        @request-close=${this._dialog.onRequestClose}
        @after-hide=${this._onAfterHide}
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
          ${
            terminal.length > 0
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
              : nothing
          }
        </div>
        ${hasJobs ? renderGroups(this, active, terminal) : renderEmpty(this._localize)}
      </esphome-base-dialog>
      <esphome-command-dialog
        @open-reset-build-env=${this._onLocalResetEvent}
        @open-reset-peer-build-env=${this._onRemoteResetEvent}
        @request-show-logs-after-install=${this._onPostInstallShowLogs}
      ></esphome-command-dialog>
      <esphome-logs-dialog></esphome-logs-dialog>
      <esphome-confirm-dialog
        id="reset-local-confirm"
        heading=${this._localize("firmware_jobs.reset_confirm_title")}
        confirm-label=${this._localize("firmware_jobs.reset_confirm_button")}
        message=${this._localize("firmware_jobs.reset_confirm_message")}
        @confirm=${this._onResetConfirmed}
      ></esphome-confirm-dialog>
      <esphome-confirm-dialog
        id="reset-peer-confirm"
        heading=${this._localize("firmware_jobs.reset_peer_confirm_title", {
          label: this._pendingResetPeer?.label ?? "",
        })}
        confirm-label=${this._localize("firmware_jobs.reset_peer_confirm_button")}
        message=${this._localize("firmware_jobs.reset_peer_confirm_message", {
          label: this._pendingResetPeer?.label ?? "",
        })}
        @confirm=${this._onResetPeerConfirmed}
      ></esphome-confirm-dialog>
    `;
  }

  private _onAfterHide = (): void => {
    this._dialog.open = false;
    this._ticker.stop();
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
    await cancelFirmwareJob(this._api, this._localize, job.job_id);
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

  private _onResetPeerConfirmed = async () => {
    // Deliberately not cleared: the closing dialog's heading/message still
    // bind to it, and the next openResetPeerBuildEnv overwrites it anyway.
    const pending = this._pendingResetPeer;
    if (pending === null) return;
    let job: FirmwareJob;
    try {
      job = await this._api.remoteBuildResetPeerBuildEnv({
        pin_sha256: pending.pin_sha256,
      });
    } catch (err) {
      notifyError(
        this._localize("firmware_jobs.reset_peer_failed", {
          label: pending.label,
          detail: getErrorMessage(err),
        })
      );
      return;
    }
    // Same landing as the local reset: watch the server-side wipe live.
    // A busy refusal surfaces in this job's stream (the mirror fails
    // with a retry-when-idle message), not as a command error.
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
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-firmware-jobs-dialog": ESPHomeFirmwareJobsDialog;
  }
}
