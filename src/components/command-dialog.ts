import { consume } from "@lit/context";
import {
  mdiAlertCircle,
  mdiCheckCircle,
  mdiClose,
  mdiConsole,
  mdiDownload,
  mdiKey,
  mdiKeyOutline,
  mdiPlaylistCheck,
  mdiRefresh,
  mdiServerNetwork,
  mdiStop,
  mdiTimerSand,
} from "@mdi/js";
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import { JobSource, JobStatus, JobType } from "../api/types.js";
import type { ConfiguredDevice, FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeAnsiLog } from "./ansi-log.js";
import {
  apiContext,
  buildOffloadJobsContext,
  darkModeContext,
  devicesContext,
  firmwareJobsContext,
  localizeContext,
} from "../context/index.js";
import type { RemoteBuildJobState } from "../context/index.js";
import { dialogCloseButtonStyles } from "../styles/dialog-close-button.js";
import { espHomeStyles } from "../styles/shared.js";
import { downloadAnsiText } from "../util/download-text.js";
import { dispatchShowLogsAfterInstall } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { commandDialogStyles } from "./command-dialog/styles.js";
import {
  detachStream,
  followJob,
  onForceLocalClick,
  startCommand,
  stopCommand,
  toggleShowSecrets,
} from "./command-dialog/commands.js";
import {
  renderBanner,
  renderQueuedOverlay,
  renderRemoteBuilderSubLine,
  renderResetSuggestion,
  renderToolbar,
} from "./command-dialog/renderers.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./ansi-log.js";

registerMdiIcons({
  close: mdiClose,
  console: mdiConsole,
  download: mdiDownload,
  key: mdiKey,
  "key-outline": mdiKeyOutline,
  stop: mdiStop,
  refresh: mdiRefresh,
  "check-circle": mdiCheckCircle,
  "alert-circle": mdiAlertCircle,
  "playlist-check": mdiPlaylistCheck,
  "server-network": mdiServerNetwork,
  "timer-sand": mdiTimerSand,
});

export type CommandType =
  | "install"
  | "compile"
  | "validate"
  | "clean"
  | "reset"
  | "rename";

export type CommandState = "running" | "success" | "error";

const JOB_TYPE_TO_COMMAND: Record<string, CommandType> = {
  [JobType.COMPILE]: "compile",
  [JobType.INSTALL]: "install",
  [JobType.UPLOAD]: "install",
  [JobType.CLEAN]: "clean",
  [JobType.RESET_BUILD_ENV]: "reset",
  [JobType.RENAME]: "rename",
};

@customElement("esphome-command-dialog")
export class ESPHomeCommandDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true }) @state() _localize: LocalizeFunc = (key) => key;
  @consume({ context: darkModeContext, subscribe: true }) @state() _darkMode = true;
  @consume({ context: apiContext }) _api!: ESPHomeAPI;

  // Live firmware-job snapshot keyed by job_id. Drives the queued overlay so
  // we tell the user the dialog is waiting in line instead of sitting empty.
  @consume({ context: firmwareJobsContext, subscribe: true })
  @state()
  _jobs: Map<string, FirmwareJob> = new Map();

  // Resolves the running job's friendly name for the "waiting for: <device>" hint.
  @consume({ context: devicesContext, subscribe: true })
  @state()
  _devices: ConfiguredDevice[] = [];

  // Receiver-side projection of jobs this offloader submitted. The local
  // FirmwareJob flips to RUNNING the moment the runner dispatches to peer-
  // link, so _isQueued can't see the cross-offloader case where our job
  // parks behind another offloader's build on the same receiver.
  @consume({ context: buildOffloadJobsContext, subscribe: true })
  @state()
  _offloadJobs: Map<string, RemoteBuildJobState> | null = null;

  @property() configuration = "";
  @property() name = "";

  @state() _commandType: CommandType = "validate";
  @state() _state: CommandState | null = null;
  @state() _lines: string[] = [];
  @state() _statusMessage = "";

  // Distinguishes user-stopped from backend-failed. Both flip _state to "error"
  // but only real failures get the reset-build-env hint.
  @state() _userStopped = false;

  // Re-runs validation when flipped — --show-secrets is set at spawn time.
  // Resets per open() so resolved secrets never leak into a screen-share
  // without an explicit click.
  @state() _showSecrets = false;

  // Auto-flip to logs after successful install. Reset per open() so an opt-out
  // on one run doesn't silently persist.
  @state() _showLogsAfterInstall = true;

  // Flips true when the output stream contains an ESPHome validation-failure
  // marker. Lets the failure hint switch from "clean/reset" (C++ compile help)
  // to "open in editor" (YAML help). Reset per open().
  @state() _failedDuringValidate = false;

  // Locally-primed status / source so the queued overlay + remote-builder
  // sub-line paint on the first frame instead of waiting for the next jobs
  // context update.
  @state() _jobStatus: JobStatus | null = null;
  _primedSource: { source: JobSource; source_label: string } | null = null;

  // True while "Build locally instead" override is mid-flight.
  @state() _switchingToLocal = false;

  // Guard re-entrancy on the show-secrets toggle — detachStream clears
  // _streamId synchronously, so a fast double-click without this guard
  // would let two restarts race.
  _restartInflight = false;

  // Stream id (validate streaming or follow_job streaming).
  _streamId = "";
  // Install target — "OTA" for network, an actual port for server-serial.
  _port = "OTA";
  // Active job id (cancel target). Empty for validate.
  _jobId = "";

  @query("wa-dialog") _dialog!: HTMLElement & { open: boolean };
  @query("esphome-ansi-log") _ansiLog?: ESPHomeAnsiLog;

  static styles = [espHomeStyles, dialogCloseButtonStyles, commandDialogStyles];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("_darkMode")) {
      this.toggleAttribute("light", !this._darkMode);
    }
    // When a job ends, the success/error banner takes ~56px of flex space
    // below the log; the container shrinks, scrollTop is preserved, and
    // the bottom slides out of view — which trips ansi-log's _isUserScrolled
    // latch and disables auto-scroll for trailing lines. Re-pin on the
    // running → terminal transition.
    if (changedProperties.has("_state")) {
      const prev = changedProperties.get("_state") as CommandState | null;
      if (
        prev === "running" &&
        (this._state === "success" || this._state === "error")
      ) {
        this._resetAnsiLogScroll();
      }
    }
  }

  public open(type: CommandType, options?: { port?: string }) {
    this._commandType = type;
    this._port = options?.port ?? "OTA";
    this._state = null;
    this._lines = [];
    this._statusMessage = "";
    this._jobId = "";
    this._jobStatus = null;
    this._primedSource = null;
    this._failedDuringValidate = false;
    // Always start with secrets redacted on a fresh open — opt-in per session.
    this._showSecrets = false;
    this._showLogsAfterInstall = true;
    void detachStream(this);
    this._dialog.open = true;
    this._resetAnsiLogScroll();
    void this._start();
  }

  _resetAnsiLogScroll() {
    // The ansi-log instance is reused across opens; scrollToBottom clears
    // its _isUserScrolled latch so streaming-to-bottom re-engages.
    this.updateComplete.then(() => this._ansiLog?.scrollToBottom());
  }

  // Attach to a firmware job's stream. Handles any state — terminal jobs
  // replay buffered output and resolve to the final success/error banner.
  public followJob(job: FirmwareJob, displayName: string) {
    this.configuration = job.configuration;
    this.name = displayName;
    this._commandType = JOB_TYPE_TO_COMMAND[job.job_type] ?? "install";
    this._port = job.port || "OTA";
    this._state = "running";
    this._lines = [];
    this._statusMessage = "";
    this._userStopped = false;
    // Fresh attach is a fresh session — reset toggle defaults so a prior
    // opt-out doesn't silently inherit.
    this._showSecrets = false;
    this._showLogsAfterInstall = true;
    this._jobId = job.job_id;
    this._jobStatus = job.status;
    this._primedSource = {
      source: job.source,
      source_label: job.source_label,
    };
    // Cancel any prior follow before starting a new one — without this,
    // every reopen layered fresh streams while previous ones still pumped
    // onOutput into _lines (lines duplicated per leaked subscription).
    void detachStream(this);
    this._dialog.open = true;
    this._resetAnsiLogScroll();
    followJob(this, job.job_id);
  }

  public close = () => {
    void detachStream(this);
    this._dialog.open = false;
  };

  // Reopen without clearing line buffer / status. Used by logs-dialog's
  // "Back to install" after the post-install hand-off.
  public reopen() {
    this._dialog.open = true;
    this._resetAnsiLogScroll();
  }

  // Successful-install hand-off: ask the host to open the logs dialog
  // tailing the same configuration, and only hide this dialog if a host
  // acknowledged via preventDefault().
  _flipToLogs = () => {
    const handled = dispatchShowLogsAfterInstall(this, {
      configuration: this.configuration,
      name: this.name,
      port: this._port,
      reopenInstall: () => this.reopen(),
    });
    if (handled) this._dialog.open = false;
  };

  private get _title(): string {
    return this._localize(`command.${this._commandType}_title`, { name: this.name });
  }

  // True when following a queued job. Context wins once it has the entry —
  // the backend may transition QUEUED → RUNNING before we see it locally;
  // _jobStatus only fills the gap before the first context update.
  get _isQueued(): boolean {
    if (!this._jobId) return false;
    const ctxStatus = this._jobs.get(this._jobId)?.status;
    return (ctxStatus ?? this._jobStatus) === JobStatus.QUEUED;
  }

  // True when our job is parked on the receiver behind another offloader's
  // build. The local FirmwareJob flips to RUNNING the moment the runner
  // dispatches to peer-link, so _isQueued above misses this case; the
  // receiver's job_state_changed{queued} surfaces it here.
  get _isRemoteQueued(): boolean {
    if (!this._jobId || !this._offloadJobs) return false;
    return this._offloadJobs.get(this._jobId)?.status === JobStatus.QUEUED;
  }

  _openFirmwareJobs = () => {
    // Closing frees the user to interact with the firmware-tasks list;
    // follow_job will reattach if they click back into this device's job.
    this.close();
    this.dispatchEvent(
      new CustomEvent("open-firmware-jobs", { bubbles: true, composed: true }),
    );
  };

  // Close + navigate to /device/<config>. Device page just closes (user
  // is already on the editor).
  _tryOpenInEditor = () => {
    const configuration = this.configuration;
    this.close();
    if (!configuration) return;
    this.dispatchEvent(
      new CustomEvent("request-open-editor", {
        detail: { configuration },
        bubbles: true,
        composed: true,
      }),
    );
  };

  // Per-device clean: same dialog instance, same configuration. Non-
  // destructive (just wipes .esphome/build/<name>/) so no confirm needed.
  _tryCleanBuild = () => this.open("clean");

  _tryResetBuildEnv = () => {
    this.close();
    this.dispatchEvent(
      new CustomEvent("open-reset-build-env", { bubbles: true, composed: true }),
    );
  };

  _toggleShowLogsAfterInstall = () => {
    this._showLogsAfterInstall = !this._showLogsAfterInstall;
  };

  _toggleShowSecrets = () => {
    void toggleShowSecrets(this);
  };

  _onForceLocalClick = () => {
    void onForceLocalClick(this);
  };

  _downloadOutput = () => {
    const stem = this.configuration.replace(/\.ya?ml$/, "") || "output";
    downloadAnsiText(this._lines, `${stem}-${this._commandType}.txt`);
  };

  _start = () => startCommand(this);
  _stop = () => stopCommand(this);

  private _onDialogHide = () => {
    void detachStream(this);
  };

  protected render() {
    return html`
      <wa-dialog label=${this._title} light-dismiss @wa-after-hide=${this._onDialogHide}>
        <div class="content">
          ${renderRemoteBuilderSubLine(this)}
          <div class="log-area">
            <esphome-ansi-log
              .lines=${this._lines}
              ?light=${!this._darkMode}
            ></esphome-ansi-log>
            ${renderQueuedOverlay(this)}
          </div>
          ${renderBanner(this)} ${renderResetSuggestion(this)}
          ${renderToolbar(this)}
        </div>
      </wa-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-command-dialog": ESPHomeCommandDialog;
  }
}
