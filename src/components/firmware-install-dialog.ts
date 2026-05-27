import { consume } from "@lit/context";
import {
  mdiAlertCircle,
  mdiArrowExpand,
  mdiArrowCollapse,
  mdiCheckCircle,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiConsole,
} from "@mdi/js";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import { JobSource, type ConfiguredDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";
import type { DetectedChip } from "../util/web-serial.js";
import { firmwareInstallDialogStyles } from "./firmware-install-dialog/styles.js";
import { remoteBuildHintStyles } from "./remote-build-hint.js";
import {
  renderFooter,
  renderLogs,
  renderProgress,
  renderStatus,
} from "./firmware-install-dialog/renderers.js";
import {
  flipToLogs,
  startDownload,
  startWebSerialInstall,
} from "./firmware-install-dialog/install-flow.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./ansi-log.js";
import "./base-dialog.js";

registerMdiIcons({
  "alert-circle": mdiAlertCircle,
  "arrow-expand": mdiArrowExpand,
  "arrow-collapse": mdiArrowCollapse,
  "check-circle": mdiCheckCircle,
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  close: mdiClose,
  console: mdiConsole,
});

export type InstallStep =
  | "connecting"
  | "queued"
  | "installing"
  | "compiling"
  | "flashing"
  | "done"
  | "download-ready"
  | "error";

export type Installer = "web-serial" | "web-download" | "binary-download" | null;

@customElement("esphome-firmware-install-dialog")
export class ESPHomeFirmwareInstallDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;
  @consume({ context: darkModeContext, subscribe: true }) @state() _darkMode = true;
  @consume({ context: apiContext }) _api!: ESPHomeAPI;

  @state() _open = false;
  @state() _step: InstallStep = "installing";
  @state() _title = "";
  @state() _statusMessage = "";
  @state() _errorMessage = "";

  // Drives the reset-build-env hint — only build failures benefit; chip
  // mismatch / Web Serial connection errors don't.
  @state() _failedDuringCompile = false;

  // Flips when output contains an ESPHome validation marker, swapping the
  // hint from clean/reset (C++ help) to "open in editor" (YAML help).
  @state() _failedDuringValidate = false;

  // Source of the most recent compile job. REMOTE means the toolchain lives
  // on a paired receiver, so the local "reset build environment" link can't
  // help — the build-failure hint swaps to a plain-text "ask the operator
  // of <receiver>" instruction. Populated by compileAndWait once the backend
  // returns the job; LOCAL until then so a failure before the job creates
  // (e.g. WS dropped) still shows the local hint.
  @state() _jobSource: JobSource = JobSource.LOCAL;
  @state() _jobSourceLabel = "";

  @state() _logLines: string[] = [];
  @state() _logsExpanded = false;
  @state() _flashPercent = 0;
  @state() _downloadedFilename = "";

  // Reset per _init so an opt-out on one run doesn't persist. installWebDownload
  // doesn't connect to a device, so the toggle is install-only.
  @state() _showLogsAfterInstall = true;

  // Which entry opened the dialog — controls success-screen wording, footer
  // chrome, and whether the show-logs toggle is offered.
  @state() _installer: Installer = null;

  _device: ConfiguredDevice | null = null;
  _jobId = "";
  _streamId = "";

  // Reject hook for the in-flight _compileAndWait promise. _detachStream
  // removes the local handler so onResult/onError can never fire after a
  // teardown — without this the awaiter would hang and leak install tasks
  // per dialog reopen.
  _compileReject: ((err: Error) => void) | null = null;
  _detected: DetectedChip | null = null;

  static styles = [espHomeStyles, firmwareInstallDialogStyles, remoteBuildHintStyles];

  installWebSerial(device: ConfiguredDevice) {
    this._init(device);
    this._installer = "web-serial";
    this._step = "connecting";
    this._statusMessage = this._localize("firmware.status_connecting");
    void startWebSerialInstall(this);
  }

  // Compile on the server, download the resulting binary, show instructions
  // to flash it via web.esphome.io. Fallback when neither OTA nor Web Serial
  // is available (HTTP dashboard, offline first-flash).
  installWebDownload(device: ConfiguredDevice) {
    this._init(device);
    this._installer = "web-download";
    this._step = "queued";
    this._statusMessage = this._localize("firmware.status_queued");
    void startDownload(this);
  }

  // Compile + download with no opinion on how to flash. Always available so
  // users can plug into esptool.py / picotool / a UF2 mass-storage flow.
  installBinaryDownload(device: ConfiguredDevice) {
    this._init(device);
    this._installer = "binary-download";
    this._step = "queued";
    this._statusMessage = this._localize("firmware.status_queued");
    void startDownload(this);
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
    // followJob from the prior compile would push lines into _logLines.
    this._detachStream();
    this._device = device;
    this._open = true;
    this._step = "installing";
    this._title = this._localize("firmware.install_title", {
      name: device.friendly_name || device.name,
    });
    this._statusMessage = "";
    this._errorMessage = "";
    this._logLines = [];
    this._logsExpanded = false;
    this._flashPercent = 0;
    this._downloadedFilename = "";
    this._showLogsAfterInstall = true;
    this._installer = null;
    this._failedDuringCompile = false;
    this._failedDuringValidate = false;
    this._jobSource = JobSource.LOCAL;
    this._jobSourceLabel = "";
    // _detachStream already cleared _jobId / _streamId / _compileReject.
    this._detected = null;
  }

  // Tear down active follow_job: client-side (drop local handler) and
  // backend-side (stop pushing lines). Settles a pending _compileAndWait so
  // the parent flow doesn't hang. Cancels the underlying job so the backend
  // stops working for a dismissed dialog.
  _detachStream() {
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
      this._api.firmwareCancel(this._jobId).catch(() => {});
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

  // Drop into red error state. detail is optional — render skips it entirely
  // when empty so a single-string call doesn't paint the same text twice.
  _fail(title: string, detail = "") {
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

  _toggleShowLogsAfterInstall = () => {
    this._showLogsAfterInstall = !this._showLogsAfterInstall;
  };

  _showLogsAgain = () => {
    if (this._detected) flipToLogs(this, this._detected.port);
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

  // wa-dialog's close button (header X) and Escape both fire wa-after-hide.
  // Same stream teardown as _close — otherwise a header-X-then-reopen leaves
  // the prior followJob attached and lines duplicate into the new session.
  _onClose = () => {
    this._open = false;
    this._detachStream();
  };

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._title}
        @after-hide=${this._onClose}
      >
        ${renderStatus(this)} ${renderProgress(this)} ${renderLogs(this)}
        ${renderFooter(this)}
      </esphome-base-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-firmware-install-dialog": ESPHomeFirmwareInstallDialog;
  }
}
