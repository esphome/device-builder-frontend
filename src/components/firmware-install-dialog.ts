import { consume } from "@lit/context";
import {
  mdiArrowCollapse,
  mdiArrowExpand,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiDownload,
  mdiOpenInNew,
  mdiTextBoxOutline,
} from "@mdi/js";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import { type FirmwareBinary, JobSource } from "../api/types/firmware-jobs.js";
import type { PairingSummary } from "../api/types/remote-build.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  activeJobsContext,
  apiContext,
  buildOffloadPairingsContext,
  darkModeContext,
  desktopVersionContext,
  firmwareJobsContext,
  localizeContext,
} from "../context/index.js";
import { fullscreenMobileDialog } from "../styles/dialog-mobile.js";
import { espHomeStyles } from "../styles/shared.js";
import { initialDarkMode } from "../util/dark-mode.js";
import { LogBuffer } from "../util/log-buffer.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { RunTimerController } from "../util/run-timer-controller.js";
import type { DetectedChip } from "../util/web-serial.js";
import {
  downloadSelectedBinary,
  flipToLogs,
  handOffToFlasher,
  showOtaLogs,
  startArtifactDownload,
  startDownload,
  startUsbFlash,
  startWebSerialInstall,
  waitForRunningJob,
} from "./firmware-install-dialog/install-flow.js";
import {
  cardState,
  cardStatusDetail,
  cardStatusMessage,
  renderFooter,
  renderOffloadHintSlot,
  renderResetSuggestion,
  renderStatusExtra,
} from "./firmware-install-dialog/renderers.js";
import { firmwareInstallDialogStyles } from "./firmware-install-dialog/styles.js";
import { remoteBuildHintStyles, requestResetPeerBuildEnv } from "./remote-build-hint.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./ansi-log.js";
import "./base-dialog.js";
import "./process-terminal/process-terminal.js";

registerMdiIcons({
  "arrow-expand": mdiArrowExpand,
  "arrow-collapse": mdiArrowCollapse,
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  close: mdiClose,
  download: mdiDownload,
  "open-in-new": mdiOpenInNew,
  "text-box-outline": mdiTextBoxOutline,
});

export type InstallStep =
  | "connecting"
  | "queued"
  | "installing"
  | "compiling"
  | "flashing"
  | "done"
  | "choose-binary"
  | "downloading"
  | "download-ready"
  | "error";

export type Installer = "web-serial" | "binary-download" | "web-flash" | null;

export type InstallFailureKind = "compile" | "validate" | "chip-mismatch" | null;

@customElement("esphome-firmware-install-dialog")
export class ESPHomeFirmwareInstallDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;
  @consume({ context: darkModeContext, subscribe: true }) @state() _darkMode =
    initialDarkMode();
  @consume({ context: apiContext }) _api!: ESPHomeAPI;

  // Live job snapshot — the compile job's progress gauge is the second
  // compile-start signal beside the log scanner (covers raw ninja builds).
  @consume({ context: firmwareJobsContext, subscribe: true })
  @state()
  _jobs: Map<string, FirmwareJob> = new Map();

  // Active job per configuration — the download flow waits for a running
  // build instead of reading artifacts it's rewriting (#1200). Not @state:
  // read imperatively at download start, never in render.
  @consume({ context: activeJobsContext, subscribe: true })
  _activeJobs: Map<string, FirmwareJob> = new Map();

  // Suppress the "set up a build server" hint once a build server is paired.
  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  _pairings: Map<string, PairingSummary> | null = null;

  @consume({ context: desktopVersionContext, subscribe: true })
  @state()
  _desktopVersion = "";

  @state() _open = false;
  @state() _step: InstallStep = "installing";
  @state() _title = "";
  @state() _statusMessage = "";
  @state() _errorMessage = "";

  // What made the install fail, when a specific kind was recognised.
  // "compile" drives the reset-build-env hint, "validate" swaps that hint to
  // "open in editor" (YAML help), "chip-mismatch" swaps the footer's Retry
  // (which would loop on the same stale board) for a change-board hand-off.
  // null: no failure, or an unclassified one (e.g. Web Serial connection).
  @state() _failureKind: InstallFailureKind = null;

  // Source of the most recent compile job. REMOTE means the toolchain lives
  // on a paired receiver, so the local "reset build environment" link can't
  // help — the build-failure hint swaps to a plain-text "ask the operator
  // of <receiver>" instruction. Populated by compileAndWait once the backend
  // returns the job; LOCAL until then so a failure before the job creates
  // (e.g. WS dropped) still shows the local hint.
  @state() _jobSource: JobSource = JobSource.LOCAL;
  @state() _jobSourceLabel = "";
  @state() _jobSourcePin = "";

  @state() _logsExpanded = false;
  @state() _flashPercent = 0;
  @state() _downloadedFilename = "";

  // Formats offered by the manual download picker; populated only when a
  // device produces more than one (e.g. ESP32 factory + OTA).
  @state() _binaries: FirmwareBinary[] = [];

  // Reset per _init so an opt-out on one run doesn't persist. Only the
  // web-serial install connects to a device, so the toggle is install-only.
  @state() _showLogsAfterInstall = true;

  // Which entry opened the dialog — controls success-screen wording, footer
  // chrome, and whether the show-logs toggle is offered.
  @state() _installer: Installer = null;

  _device: ConfiguredDevice | null = null;
  _jobId = "";
  _streamId = "";

  // The streamed output, batched into one render per frame instead of one
  // per line (#1203). Uncapped: an install log is finite and the user reads
  // back through it after a failure.
  _log = new LogBuffer(this);

  // Build compile clocks — drives the compiling-step elapsed readout + the
  // offload hint. The step-based runEnded backstop freezes the span when the
  // flow leaves compiling without a summary banner.
  _timer = new RunTimerController(this, {
    job: () => (this._jobId ? this._jobs.get(this._jobId) : undefined),
    jobId: () => this._jobId,
    runEnded: () => this._step !== "compiling" && this._step !== "queued",
    tick: () => this._open && this._timer.isCompiling,
  });

  // The compiled factory image for the "web-flash" installer, held between the
  // download-ready step and the user clicking "Open USB flasher". Detached
  // (nulled) once transferred to the flasher tab.
  _usbFirmware: ArrayBuffer | null = null;
  _usbFirmwareName = "";

  // Teardown for an in-flight external-flasher hand-off (set by
  // handOffToFlasher). Called from _detachStream so closing / reusing the
  // dialog removes the message listener + timers. Null when none is active.
  _usbFlashTeardown: (() => void) | null = null;

  // Reject hook for the in-flight _compileAndWait promise. _detachStream
  // removes the local handler so onResult/onError can never fire after a
  // teardown — without this the awaiter would hang and leak install tasks
  // per dialog reopen.
  _compileReject: ((err: Error) => void) | null = null;
  _detected: DetectedChip | null = null;

  static styles = [
    espHomeStyles,
    firmwareInstallDialogStyles,
    remoteBuildHintStyles,
    // Content-heavy (build status + expandable log): full-screen on mobile
    // so it doesn't overflow a centered box. #41
    fullscreenMobileDialog("esphome-base-dialog"),
  ];

  installWebSerial(device: ConfiguredDevice) {
    this._init(device);
    this._installer = "web-serial";
    this._step = "connecting";
    this._statusMessage = this._localize("firmware.status_connecting");
    void startWebSerialInstall(this);
  }

  // "Flash via USB": compile + download the factory image here (logs/errors
  // visible), then land on the ready step. The flasher tab is opened only when
  // the user clicks Open USB flasher — never before a working image exists.
  installUsbFlash(device: ConfiguredDevice) {
    this._init(device);
    this._installer = "web-flash";
    this._step = "queued";
    this._statusMessage = this._localize("firmware.status_queued");
    void startUsbFlash(this);
  }

  // Hand the compiled firmware to the external flasher. Called from the
  // download-ready "Open USB flasher" button (a user gesture, so the popup
  // isn't blocked).
  _openUsbFlasher = () => handOffToFlasher(this);

  // Compile + download with no opinion on how to flash. Always available so
  // users can plug into esptool.py / picotool / a UF2 mass-storage flow.
  installBinaryDownload(device: ConfiguredDevice) {
    this._init(device);
    this._installer = "binary-download";
    this._step = "queued";
    this._statusMessage = this._localize("firmware.status_queued");
    void startDownload(this);
  }

  // Three-dot "Download" entry; compiles only when nothing is built.
  downloadArtifacts(device: ConfiguredDevice) {
    this._init(device);
    this._installer = "binary-download";
    this._title = this._localize("firmware.download_title", {
      name: device.friendly_name || device.name,
    });
    this._step = "queued";
    this._statusMessage = this._localize("firmware.status_queued");
    void startArtifactDownload(this);
  }

  // Picked a format in the choose-binary step.
  _onChooseBinary(file: string) {
    void downloadSelectedBinary(this, file);
  }

  // Reopen without clearing state. Used by logs-dialog's "Back to install"
  // after the Web Serial post-install hand-off so users can review output.
  public reopen() {
    this._open = true;
  }

  private _init(device: ConfiguredDevice) {
    // Dispose any prior stream before resetting state. _init re-runs on every
    // installWebSerial including reopens after the user dismissed the previous
    // run (which only flips _open) — without this teardown, a still-attached
    // followJob from the prior compile would push lines into the buffer.
    this._detachStream();
    this._device = device;
    this._open = true;
    this._step = "installing";
    this._title = this._localize("firmware.install_title", {
      name: device.friendly_name || device.name,
    });
    this._statusMessage = "";
    this._errorMessage = "";
    this._log.reset();
    this._logsExpanded = false;
    this._flashPercent = 0;
    this._downloadedFilename = "";
    this._binaries = [];
    this._showLogsAfterInstall = true;
    this._installer = null;
    this._failureKind = null;
    this._jobSource = JobSource.LOCAL;
    this._jobSourceLabel = "";
    this._jobSourcePin = "";
    this._timer.reset();
    this._usbFirmware = null;
    this._usbFirmwareName = "";
    // _detachStream already cleared _jobId / _streamId / _compileReject.
    this._detected = null;
  }

  // Tear down active follow_job: client-side (drop local handler) and
  // backend-side (stop pushing lines). Settles a pending _compileAndWait so
  // the parent flow doesn't hang. Cancels the underlying job so the backend
  // stops working for a dismissed dialog, unless ``cancelJob: false`` —
  // then the job is released to finish in the background queue.
  _detachStream({ cancelJob = true }: { cancelJob?: boolean } = {}) {
    // Land any buffered lines before teardown so nothing streamed is lost.
    this._log.flush();
    // Tear down an in-flight USB-flasher hand-off (message listener + timers)
    // too, so closing or reusing the dialog can't leak it or let a stale
    // flasher tab mutate the next install's state. Pure teardown, no _fail.
    if (this._usbFlashTeardown) {
      this._usbFlashTeardown();
      this._usbFlashTeardown = null;
    }
    if (this._streamId) {
      this._api.stopStream(this._streamId).catch(() => {});
      this._streamId = "";
    }
    if (this._compileReject) {
      const reject = this._compileReject;
      this._compileReject = null;
      reject(new Error("Install dialog dismissed"));
    }
    if (this._jobId) {
      if (cancelJob) this._api.firmwareCancel(this._jobId).catch(() => {});
      this._jobId = "";
    }
  }

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("_darkMode")) {
      this.toggleAttribute("light", !this._darkMode);
    }
    if (changedProperties.has("_logsExpanded")) {
      this.toggleAttribute("expanded", this._logsExpanded);
    }
  }

  // Close the dialog and open Settings → Send builds. The install flow ends
  // (the flash needs this dialog), but the compile itself is released to
  // finish in the background queue, so its artifacts warm the next install.
  _tryOpenBuildOffloadSettings = () => {
    this._detachStream({ cancelJob: false });
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-settings", {
        detail: { section: "build_offload" },
        bubbles: true,
        composed: true,
      })
    );
  };

  // Drop into red error state. detail is optional — render skips it entirely
  // when empty so a single-string call doesn't paint the same text twice.
  _fail(title: string, detail = "") {
    // The expanded log must show every line up to the failure, not race the rAF.
    this._log.flush();
    this._step = "error";
    this._statusMessage = title;
    this._errorMessage = detail;
    this._logsExpanded = true;
  }

  // Close + navigate to /device/<configuration>. Same payload shape as
  // command-dialog's request-open-editor handler.
  _tryOpenInEditor = () => {
    const device = this._device;
    this._close();
    if (!device) return;
    this.dispatchEvent(
      new CustomEvent("request-open-editor", {
        detail: { configuration: device.configuration },
        bubbles: true,
        composed: true,
      })
    );
  };

  // Chip-mismatch recovery: close and hand off to the host page's board
  // reselect flow. Closing first is deliberate — the dialog's _device
  // snapshot is stale after a board change; a fresh install re-reads state.
  _tryChangeBoard = () => {
    const device = this._device;
    this._close();
    if (!device) return;
    this.dispatchEvent(
      new CustomEvent("request-change-board", {
        detail: { configuration: device.configuration },
        bubbles: true,
        composed: true,
      })
    );
  };

  // Per-device clean: dashboard routes through command-dialog's clean flow.
  _tryCleanBuild = () => {
    const device = this._device;
    this._close();
    if (!device) return;
    this.dispatchEvent(
      new CustomEvent("clean-build", {
        detail: device,
        bubbles: true,
        composed: true,
      })
    );
  };

  _tryResetBuildEnv = () => {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-reset-build-env", { bubbles: true, composed: true })
    );
  };

  _tryResetRemoteBuildEnv = (pin: string) => {
    this._close();
    requestResetPeerBuildEnv(this, pin);
  };

  _toggleShowLogsAfterInstall = () => {
    this._showLogsAfterInstall = !this._showLogsAfterInstall;
  };

  _showLogsAgain = () => {
    if (this._detected) flipToLogs(this, this._detected.port);
  };

  // Web-flash success: the flash happened in the external tab, so view the
  // rebooted device's logs over OTA/native-API rather than a local port.
  _showUsbLogs = () => showOtaLogs(this);

  // Re-run the install after a flash failure: a full reset (_init) + fresh
  // build/flash, so a transient error (serial noise, the external flasher's
  // chip-init failing, a closed flasher tab) can be retried in place. Routes by
  // installer since web-flash hands off to the external tab again.
  _retry = async () => {
    const device = this._device;
    if (!device) return;
    // A foreign build may have started while the error screen sat open;
    // Retry bypasses the page-level seam guards, so re-running now would
    // supersede it (#1202). Wait it out like the download flow instead.
    const running = this._activeJobs.get(device.configuration);
    if (running) {
      this._step = "queued";
      this._errorMessage = "";
      // Drop the failed run's log and clocks so the wait streams only the
      // foreign build, not the old failure's lines or elapsed time.
      this._log.reset();
      this._timer.reset();
      this._statusMessage = this._localize("firmware.status_waiting_build");
      const settled = await waitForRunningJob(
        this,
        running.job_id,
        "firmware.install_failed"
      );
      if (!settled) return;
    }
    if (this._installer === "web-flash") this.installUsbFlash(device);
    else this.installWebSerial(device);
  };

  _cancel = async () => {
    if (this._jobId) {
      try {
        await this._api.firmwareCancel(this._jobId);
      } catch {
        /* ignore */
      }
    }
    this._close();
  };

  _close = () => {
    this._open = false;
    this._device = null;
    // _detachStream already clears _jobId (and cancels the backend job +
    // settles any pending compile promise) — no need to clear it here.
    this._detachStream();
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  };

  // Flip _open the moment a close is requested (X / Escape / outside-click) so
  // streamed log lines re-rendering with ?open can't re-assert open=true and
  // cancel the in-flight hide (the race logs / command dialogs also guard).
  // Teardown stays in _onClose (after-hide).
  _onRequestClose = () => {
    this._open = false;
  };

  // base-dialog's after-hide fires once the dialog has fully hidden (header X,
  // Escape, or a programmatic close). Same stream teardown as _close —
  // otherwise a header-X-then-reopen leaves the prior followJob attached and
  // lines duplicate into the new session.
  _onClose = () => {
    this._open = false;
    this._detachStream();
  };

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._title}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onClose}
      >
        <esphome-process-terminal
          variant="card"
          ?light=${!this._darkMode}
          .state=${cardState(this)}
          .statusMessage=${cardStatusMessage(this)}
          .statusDetail=${cardStatusDetail(this)}
          .progress=${this._step === "flashing" ? this._flashPercent : null}
        >
          ${renderResetSuggestion(this)} ${renderOffloadHintSlot(this)}
          ${renderStatusExtra(this)}
          <div slot="toolbar-right">${renderFooter(this)}</div>
        </esphome-process-terminal>
      </esphome-base-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-firmware-install-dialog": ESPHomeFirmwareInstallDialog;
  }
}
