import { consume } from "@lit/context";
import {
  mdiAlertCircle,
  mdiCheckCircle,
  mdiClose,
  mdiRefresh,
  mdiStop,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import { JobStatus, JobType } from "../api/types.js";
import type { FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./ansi-log.js";

registerMdiIcons({
  close: mdiClose,
  stop: mdiStop,
  refresh: mdiRefresh,
  "check-circle": mdiCheckCircle,
  "alert-circle": mdiAlertCircle,
});

export type CommandType = "install" | "compile" | "validate" | "clean" | "reset";
type CommandState = "running" | "success" | "error";

const JOB_TYPE_TO_COMMAND: Record<string, CommandType> = {
  [JobType.COMPILE]: "compile",
  [JobType.INSTALL]: "install",
  [JobType.UPLOAD]: "install",
  [JobType.CLEAN]: "clean",
  [JobType.RESET_BUILD_ENV]: "reset",
};

@customElement("esphome-command-dialog")
export class ESPHomeCommandDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = true;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property()
  configuration = "";

  @property()
  name = "";

  @state() private _commandType: CommandType = "validate";
  @state() private _state: CommandState | null = null;
  @state() private _lines: string[] = [];
  @state() private _statusMessage = "";

  /** Active job ID (for cancel). Not used for validate. */
  private _jobId = "";
  /** Stream message ID (for both validate streaming and follow_job streaming). */
  private _streamId = "";
  /** Install target port — "OTA" for network, an actual port for server-serial. */
  private _port = "OTA";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    css`
      :host {
        --term-bg: #1e1e1e;
        --term-bg-alt: #252526;
        --term-fg: #d4d4d4;
        --term-fg-muted: #808080;
        --term-border: #3c3c3c;
        --term-hover: #2a2d2e;
        --term-accent: #4ec9b0;
        --term-error: #f44747;
        --term-success: #6a9955;
      }

      :host([light]) {
        --term-bg: #f5f5f5;
        --term-bg-alt: #e8e8e8;
        --term-fg: #1e1e1e;
        --term-fg-muted: #6e6e6e;
        --term-border: #d0d0d0;
        --term-hover: #dcdcdc;
        --term-accent: #0d8a6f;
        --term-error: #c02020;
        --term-success: #3d7a28;
      }

      wa-dialog { --width: min(900px, 90vw); }
      /* Header matches the device-editor's title bar
         (--esphome-primary background with --esphome-on-primary
         text) so Validate / Install / Clean dialogs read as part
         of the dashboard chrome. Body keeps the terminal palette. */
      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }
      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
      }
      wa-dialog::part(close-button__base) {
        background: transparent; border: none; box-shadow: none;
        padding: 0; min-width: unset; min-height: unset;
        color: var(--esphome-on-primary); cursor: pointer;
      }
      /* Same affordance for hover and keyboard focus so the close
         button is discoverable either way on the new lighter
         background. */
      wa-dialog::part(close-button__base):hover,
      wa-dialog::part(close-button__base):focus-visible {
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
        outline: none;
      }
      wa-dialog::part(body) { padding: 0; background: var(--term-bg); overflow: hidden; }
      wa-dialog::part(footer) { display: none; }

      .content {
        display: flex;
        flex-direction: column;
        height: 60vh;
        min-height: 300px;
        max-height: 70vh;
        overflow: hidden;
      }
      esphome-ansi-log {
        flex: 1;
        min-height: 0;
        --log-height: 100%;
      }
      esphome-ansi-log::part(container) { border-radius: 0; }

      .status-banner {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 20px;
        border-top: 1px solid var(--term-border);
        font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
        font-size: 14px;
        font-weight: 600;
      }
      .status-banner wa-icon {
        font-size: 28px;
        flex-shrink: 0;
      }
      .status-banner--success {
        background: color-mix(in srgb, var(--term-success), transparent 85%);
        color: var(--term-success);
      }
      .status-banner--error {
        background: color-mix(in srgb, var(--term-error), transparent 85%);
        color: var(--term-error);
      }

      .terminal-toolbar {
        flex-shrink: 0;
        display: flex; align-items: center; gap: var(--wa-space-xs);
        padding: 6px var(--wa-space-m);
        background: var(--term-bg-alt);
        border-top: 1px solid var(--term-border);
      }
      .terminal-toolbar .spacer { flex: 1; }

      .streaming-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--term-accent);
        animation: pulse 1.5s infinite;
      }
      @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

      .term-btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 5px; padding: 4px 12px; border-radius: 4px;
        font-size: 12px; font-weight: 600;
        font-family: "SF Mono", "Fira Code", monospace;
        cursor: pointer; border: 1px solid var(--term-border);
        transition: background 0.1s, border-color 0.1s;
      }
      .term-btn wa-icon { font-size: 14px; }
      .term-btn--ghost { background: transparent; color: var(--term-fg-muted); }
      .term-btn--ghost:hover {
        background: var(--term-hover); color: var(--term-fg);
        border-color: var(--term-fg-muted);
      }
      .term-btn--stop {
        background: color-mix(in srgb, var(--term-error), transparent 85%);
        color: var(--term-error);
        border-color: color-mix(in srgb, var(--term-error), transparent 60%);
      }
      .term-btn--stop:hover {
        background: color-mix(in srgb, var(--term-error), transparent 75%);
      }
      .term-btn--start {
        background: color-mix(in srgb, var(--term-accent), transparent 85%);
        color: var(--term-accent);
        border-color: color-mix(in srgb, var(--term-accent), transparent 60%);
      }
      .term-btn--start:hover {
        background: color-mix(in srgb, var(--term-accent), transparent 75%);
      }
    `,
  ];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("_darkMode")) {
      this.toggleAttribute("light", !this._darkMode);
    }
  }

  public open(type: CommandType, options?: { port?: string }) {
    this._commandType = type;
    this._port = options?.port ?? "OTA";
    this._state = null;
    this._lines = [];
    this._statusMessage = "";
    this._jobId = "";
    this._streamId = "";
    this._dialog.open = true;
    this._start();
  }

  /**
   * Attach to a firmware job's output stream. Handles any state —
   * terminal jobs replay buffered output and resolve to the final
   * success/error banner. `displayName` shows in the title; pass the
   * device's friendly name, or a synthetic label for jobs with an
   * empty `configuration` (e.g. `reset_build_env`).
   */
  public followJob(job: FirmwareJob, displayName: string) {
    this.configuration = job.configuration;
    this.name = displayName;
    this._commandType = JOB_TYPE_TO_COMMAND[job.job_type] ?? "install";
    this._port = job.port || "OTA";
    this._state = "running";
    this._lines = [];
    this._statusMessage = "";
    this._jobId = job.job_id;
    this._streamId = "";
    this._dialog.open = true;
    this._followJob(job.job_id);
  }

  public close() {
    this._streamId = "";
    this._dialog.open = false;
  }

  private get _title(): string {
    return this._localize(`command.${this._commandType}_title`, { name: this.name });
  }

  protected render() {
    return html`
      <wa-dialog label=${this._title} light-dismiss @wa-after-hide=${this._onDialogHide}>
        <div class="content">
          <esphome-ansi-log .lines=${this._lines} ?light=${!this._darkMode}></esphome-ansi-log>
          ${this._renderBanner()}
          ${this._renderToolbar()}
        </div>
      </wa-dialog>
    `;
  }

  private _renderBanner() {
    if (this._state !== "success" && this._state !== "error") return nothing;
    const isSuccess = this._state === "success";
    const icon = isSuccess ? "check-circle" : "alert-circle";
    const modifier = isSuccess ? "success" : "error";
    return html`
      <div class="status-banner status-banner--${modifier}">
        <wa-icon library="mdi" name=${icon}></wa-icon>
        <span>${this._statusMessage}</span>
      </div>
    `;
  }

  private _renderToolbar() {
    return html`
      <div class="terminal-toolbar">
        ${this._renderStatus()} <span class="spacer"></span> ${this._renderActions()}
      </div>
    `;
  }

  private _renderStatus() {
    if (this._state === "running") return html`<span class="streaming-dot"></span>`;
    return nothing;
  }

  private _renderActions() {
    switch (this._state) {
      case "running":
        return html`<button class="term-btn term-btn--stop" @click=${this._stop}>
          <wa-icon library="mdi" name="stop"></wa-icon> ${this._localize("command.stop")}
        </button>`;
      case "error":
        return html`
          <button class="term-btn term-btn--start" @click=${this._start}>
            <wa-icon library="mdi" name="refresh"></wa-icon> ${this._localize("command.retry")}
          </button>
          <button class="term-btn term-btn--ghost" @click=${this.close}>${this._localize("command.close")}</button>`;
      case "success":
        return html`<button class="term-btn term-btn--ghost" @click=${this.close}>${this._localize("command.close")}</button>`;
      default: return nothing;
    }
  }

  // ─── Command execution ─────────────────────────────────────

  private async _start() {
    this._streamId = "";
    this._jobId = "";
    this._state = "running";
    this._lines = [];
    this._statusMessage = "";

    if (this._commandType === "validate") {
      this._startValidateStream();
      return;
    }
    await this._startFirmwareJob();
  }

  /** Validate uses the per-connection streaming command (not a queued job). */
  private _startValidateStream() {
    this._streamId = this._api.validate(this.configuration, {
      onOutput: (line) => { this._lines = [...this._lines, line]; },
      onResult: (data) => {
        this._streamId = "";
        this._state = data.success ? "success" : "error";
        this._statusMessage = this._localize(
          data.success ? "command.validate_success" : "command.validate_failed",
        );
      },
      onError: (error) => {
        this._streamId = "";
        this._state = "error";
        this._statusMessage = error;
      },
    });
  }

  /**
   * Queue a firmware job, then follow its output via follow_job.
   * follow_job sends historical output first, then streams live lines,
   * and finally sends a result event when the job finishes.
   */
  private async _startFirmwareJob() {
    let job: FirmwareJob;
    try {
      switch (this._commandType) {
        case "install":
          job = await this._api.firmwareInstall(this.configuration, this._port);
          break;
        case "compile":
          job = await this._api.firmwareCompile(this.configuration);
          break;
        case "clean":
          job = await this._api.firmwareClean(this.configuration);
          break;
        default:
          return;
      }
    } catch (err) {
      this._state = "error";
      const msg = err instanceof Error ? err.message : String(err);
      this._statusMessage = msg;
      return;
    }

    this._jobId = job.job_id;
    this._followJob(job.job_id);
  }

  /** Attach to a job's output stream. Works for queued, running, or finished jobs. */
  private _followJob(jobId: string) {
    this._streamId = this._api.firmwareFollowJob(jobId, {
      onOutput: (line) => {
        this._lines = [...this._lines, line];
      },
      onResult: (data) => {
        this._streamId = "";
        const result = data as unknown as { status: string; exit_code: number | null };
        const success = result.status === JobStatus.COMPLETED;
        this._state = success ? "success" : "error";
        this._statusMessage = this._localize(
          success
            ? `command.${this._commandType}_success`
            : `command.${this._commandType}_failed`,
        );
        this._jobId = "";
      },
      onError: (error) => {
        this._streamId = "";
        this._state = "error";
        this._statusMessage = error;
        this._jobId = "";
      },
    });
  }

  // ─── Stop / cleanup ────────────────────────────────────────

  private _stop() {
    if (this._state !== "running") return;
    if (this._jobId) {
      this._api.firmwareCancel(this._jobId).catch(() => {});
    }
    this._state = "error";
    this._statusMessage = this._localize("command.stopped");
    this._streamId = "";
    this._jobId = "";
  }

  private _onDialogHide() {
    this._streamId = "";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-command-dialog": ESPHomeCommandDialog;
  }
}
