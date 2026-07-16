import { consume } from "@lit/context";
import {
  mdiClose,
  mdiDownload,
  mdiKey,
  mdiKeyOutline,
  mdiPlaylistCheck,
  mdiRefresh,
  mdiServerNetwork,
  mdiStop,
  mdiTextBoxOutline,
  mdiTimerOutline,
  mdiTimerSand,
} from "@mdi/js";
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import { JobSource, JobStatus } from "../api/types/firmware-jobs.js";
import type { PairingSummary } from "../api/types/remote-build.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { RemoteBuildJobState } from "../context/index.js";
import {
  apiContext,
  buildOffloadJobsContext,
  buildOffloadPairingsContext,
  darkModeContext,
  desktopVersionContext,
  devicesContext,
  firmwareJobsContext,
  localizeContext,
  versionContext,
} from "../context/index.js";
import { fullscreenMobileDialog } from "../styles/dialog-mobile.js";
import { espHomeStyles } from "../styles/shared.js";
import { initialDarkMode } from "../util/dark-mode.js";
import { configurationStem, downloadAnsiText } from "../util/download-text.js";
import { LightDismissController } from "../util/light-dismiss-controller.js";
import { LineBatcher } from "../util/line-batcher.js";
import { dispatchShowLogsAfterInstall } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { RunTimerController } from "../util/run-timer-controller.js";
import {
  deriveFollowCommandType,
  detachStream,
  findDependentUpload,
  followJob,
  onForceLocalClick,
  resetRunState,
  startCommand,
  stopCommand,
  toggleShowSecrets,
} from "./command-dialog/commands.js";
import {
  renderCompileTimer,
  renderOffloadHintSlot,
  renderQueuedOverlay,
  renderRemoteBuilderSubLine,
  renderResetSuggestion,
  renderToolbar,
  showRunTimer,
} from "./command-dialog/renderers.js";
import { commandDialogStyles } from "./command-dialog/styles.js";
import type { ESPHomeProcessTerminal } from "./process-terminal/process-terminal.js";
import {
  fillTerminalOnMobile,
  termButtonStyles,
  termTokens,
} from "./process-terminal/process-terminal.styles.js";
import { remoteBuildHintStyles, requestResetPeerBuildEnv } from "./remote-build-hint.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";
import "./process-terminal/process-terminal.js";

registerMdiIcons({
  close: mdiClose,
  "text-box-outline": mdiTextBoxOutline,
  download: mdiDownload,
  key: mdiKey,
  "key-outline": mdiKeyOutline,
  stop: mdiStop,
  refresh: mdiRefresh,
  "playlist-check": mdiPlaylistCheck,
  "server-network": mdiServerNetwork,
  "timer-sand": mdiTimerSand,
  "timer-outline": mdiTimerOutline,
});

export type CommandType =
  "install" | "compile" | "validate" | "clean" | "reset" | "rename";

export type CommandState = "running" | "success" | "error";

@customElement("esphome-command-dialog")
export class ESPHomeCommandDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;
  @consume({ context: darkModeContext, subscribe: true }) @state() _darkMode =
    initialDarkMode();
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

  // Pairings + offloader version drive the per-reason NO_COMPATIBLE_PEER
  // toast — frontend classifies "all offline" vs "all wrong version"
  // from the local snapshot so the wording matches the operator's
  // actual remediation step.
  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  _pairings: Map<string, PairingSummary> | null = null;

  @consume({ context: desktopVersionContext, subscribe: true })
  @state()
  _desktopVersion = "";

  @consume({ context: versionContext, subscribe: true })
  @state()
  _appVersion = "";

  @property() configuration = "";
  @property() name = "";

  @state() _open = false;
  @state() _commandType: CommandType = "validate";
  @state() _state: CommandState | null = null;
  @state() _lines: string[] = [];
  @state() _statusMessage = "";

  // rAF batch buffer for streamed output — coalesce per-line writes
  // into one render per frame instead of one per line (#348).
  private _lineBatch = new LineBatcher((batch) => {
    this._lines = [...this._lines, ...batch];
  });

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

  // Flips true when a chain COMPILE succeeded but its dependent flash is
  // missing — the build itself was fine, so the clean/reset hint is suppressed.
  @state() _compileMissingDependent = false;

  // Locally-primed status / source so the queued overlay + remote-builder
  // sub-line paint on the first frame instead of waiting for the next jobs
  // context update.
  @state() _jobStatus: JobStatus | null = null;
  _primedSource: {
    source: JobSource;
    source_label: string;
    source_esphome_version: string;
    source_pin_sha256: string;
  } | null = null;

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
  // Install flashes the bootloader image instead of the app (OTA-only).
  _bootloader = false;
  // Active job id (cancel target). Empty for validate. Cleared when the stream
  // ends, so it can't back the timer's total-run lookup past a completed job.
  _jobId = "";
  // The job the timer reports on — the followed (compile) job. Unlike _jobId it
  // survives the stream ending, so the detail popover can still read the job's
  // started_at/completed_at for the total run time after an install's flash.
  _timerJobId = "";

  // Build run/compile clocks.
  _timer = new RunTimerController(this, {
    job: () => (this._timerJobId ? this._jobs.get(this._timerJobId) : undefined),
    jobId: () => this._timerJobId,
    runEnded: () => this._state === "success" || this._state === "error",
    // Tick while the run is live so both the total and the compile detail
    // advance; stop once it freezes at completion.
    tick: () =>
      this._open && this._timer.totalRunElapsedMs !== null && !this._timer.isRunFrozen,
  });

  // The timer's detail popover: open flag here, dismissal shared. Escape is
  // capture-phase and claimed, so the hosting dialog doesn't also close.
  @state() _timerDetailOpen = false;
  private _timerDetailDismiss = new LightDismissController(
    this,
    () => this._closeTimerDetail(),
    {
      // The timer button toggles itself; only clicks outside the wrap close.
      container: () => this.shadowRoot?.querySelector(".compile-timer-wrap"),
      escapeTarget: document,
      escapeCapture: true,
      onEscape: (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
    }
  );

  // Dismissal binds imperatively (not from willUpdate) so it works on a
  // not-yet-connected host, where Lit defers updates.
  _toggleTimerDetail = () => {
    this._timerDetailOpen = !this._timerDetailOpen;
    this._timerDetailDismiss.set(this._timerDetailOpen);
  };

  _closeTimerDetail() {
    this._timerDetailOpen = false;
    this._timerDetailDismiss.set(false);
  }

  @query("esphome-process-terminal") _terminal?: ESPHomeProcessTerminal;

  static styles = [
    espHomeStyles,
    termTokens,
    termButtonStyles,
    commandDialogStyles,
    remoteBuildHintStyles,
    // Log output is content-heavy: full-screen on mobile, terminal fills it. #41
    fullscreenMobileDialog("esphome-base-dialog"),
    fillTerminalOnMobile,
  ];

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
      if (prev === "running" && (this._state === "success" || this._state === "error")) {
        this._resetAnsiLogScroll();
      }
    }
  }

  /** Point the dialog at *device* and open — the shared host entry point. */
  public openForDevice(
    device: ConfiguredDevice,
    type: CommandType,
    options?: { port?: string; bootloader?: boolean }
  ) {
    this.configuration = device.configuration;
    this.name = device.friendly_name || device.name;
    this.open(type, options);
  }

  public open(type: CommandType, options?: { port?: string; bootloader?: boolean }) {
    this._commandType = type;
    this._port = options?.port ?? "OTA";
    this._bootloader = options?.bootloader ?? false;
    this._state = null;
    this._lines = [];
    this._resetPendingLines();
    this._statusMessage = "";
    this._jobId = "";
    this._timerJobId = "";
    this._jobStatus = null;
    this._primedSource = null;
    this._timer.reset();
    this._closeTimerDetail();
    this._failedDuringValidate = false;
    // Always start with secrets redacted on a fresh open — opt-in per session.
    this._showSecrets = false;
    this._showLogsAfterInstall = true;
    void detachStream(this);
    this._open = true;
    this._resetAnsiLogScroll();
    void this._start();
  }

  _resetAnsiLogScroll() {
    // The ansi-log instance is reused across opens; scrollToBottom clears
    // its _isUserScrolled latch so streaming-to-bottom re-engages.
    this.updateComplete.then(() => this._terminal?.scrollToBottom());
  }

  // Attach to a firmware job's stream. Handles any state — terminal jobs
  // replay buffered output and resolve to the final success/error banner.
  // ``commandType`` overrides the derivation when the caller knows the
  // command before the jobs context does (a just-queued rename's COMPILE
  // head); reattach paths omit it and derive from the chain shape.
  public followJob(job: FirmwareJob, displayName: string, commandType?: CommandType) {
    this.configuration = job.configuration;
    this.name = displayName;
    this._commandType = commandType ?? deriveFollowCommandType(this._jobs, job);
    // Restore off the chain's UPLOAD when following a COMPILE head, so a
    // "Build locally instead" retry keeps the target address and keeps
    // flashing the bootloader.
    const dependent = findDependentUpload(this._jobs, job);
    this._port = dependent?.port || job.port || "OTA";
    this._bootloader = (dependent ?? job).flash_bootloader === true;
    resetRunState(this);
    // Fresh attach is a fresh session — reset toggle defaults so a prior
    // opt-out doesn't silently inherit.
    this._showSecrets = false;
    this._showLogsAfterInstall = true;
    this._jobId = job.job_id;
    this._timerJobId = job.job_id;
    this._jobStatus = job.status;
    this._primedSource = {
      source: job.source,
      source_label: job.source_label,
      source_esphome_version: job.source_esphome_version,
      source_pin_sha256: job.source_pin_sha256,
    };
    // Reattaching to a still-running (or finished) build: restore the true
    // compile clock so the replayed buffer doesn't restart the timer from now.
    this._timer.attach(job);
    this._closeTimerDetail();
    // Cancel any prior follow before starting a new one — without this,
    // every reopen layered fresh streams while previous ones still pumped
    // onOutput into _lines (lines duplicated per leaked subscription).
    void detachStream(this);
    this._open = true;
    this._resetAnsiLogScroll();
    followJob(this, job.job_id);
  }

  public close = () => {
    void detachStream(this);
    this._closeTimerDetail();
    this._open = false;
  };

  // Close the terminal and open Settings → Send builds so the user can pair a
  // faster machine. The build keeps running in the background queue.
  _tryOpenBuildOffloadSettings = () => {
    this.close();
    this.dispatchEvent(
      new CustomEvent("open-settings", {
        detail: { section: "build_offload" },
        bubbles: true,
        composed: true,
      })
    );
  };

  // Reopen without clearing line buffer / status. Used by logs-dialog's
  // "Back to install" after the post-install hand-off.
  public reopen() {
    this._open = true;
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
    if (handled) this._open = false;
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
      new CustomEvent("open-firmware-jobs", { bubbles: true, composed: true })
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
      })
    );
  };

  // Per-device clean: same dialog instance, same configuration. Non-
  // destructive (just wipes .esphome/build/<name>/) so no confirm needed.
  _tryCleanBuild = () => this.open("clean");

  _tryResetBuildEnv = () => {
    this.close();
    this.dispatchEvent(
      new CustomEvent("open-reset-build-env", { bubbles: true, composed: true })
    );
  };

  _tryResetRemoteBuildEnv = (pin: string) => {
    this.close();
    requestResetPeerBuildEnv(this, pin);
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

  // Buffer a streamed line; flushed on the next animation frame.
  _enqueueLine(line: string): void {
    this._timer.noteLine(line);
    this._lineBatch.enqueue(line);
  }

  // Drain pending lines into ``_lines`` now. Called from terminal
  // callbacks, detachStream, and _downloadOutput so consumers
  // don't race the rAF.
  _flushPendingLines(): void {
    this._lineBatch.flush();
  }

  // Drop the pending batch and cancel any scheduled flush. Paired
  // with every ``_lines = []`` reset.
  _resetPendingLines(): void {
    this._lineBatch.reset();
  }

  _downloadOutput = () => {
    this._flushPendingLines();
    const stem = configurationStem(this.configuration, "output");
    downloadAnsiText(this._lines, `${stem}-${this._commandType}.txt`);
  };

  _start = () => startCommand(this);
  _stop = () => stopCommand(this);

  // Flip _open the moment the user initiates a close (X / Esc / outside-click)
  // so streamed lines re-rendering with ?open can't re-assert open=true and
  // cancel wa-dialog's in-flight hide (same race logs-dialog guards). No
  // host-side veto, so the close still proceeds to after-hide.
  private _onDialogRequestClose = () => {
    this._open = false;
  };

  private _onDialogHide = () => {
    this._open = false;
    this._closeTimerDetail();
    void detachStream(this);
  };

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._title}
        @request-close=${this._onDialogRequestClose}
        @after-hide=${this._onDialogHide}
      >
        <esphome-process-terminal
          .lines=${this._lines}
          ?light=${!this._darkMode}
          ?streaming=${this._state === "running" && !showRunTimer(this)}
          .state=${this._state}
          .statusMessage=${this._statusMessage}
        >
          ${renderRemoteBuilderSubLine(this)} ${renderQueuedOverlay(this)}
          ${renderResetSuggestion(this)} ${renderOffloadHintSlot(this)}
          ${renderCompileTimer(this)}
          <div class="toolbar-slot" slot="toolbar-right">${renderToolbar(this)}</div>
        </esphome-process-terminal>
      </esphome-base-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-command-dialog": ESPHomeCommandDialog;
  }
}
