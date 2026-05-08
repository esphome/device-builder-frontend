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
  mdiStop,
  mdiTimerSand,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import { JobStatus, JobType } from "../api/types.js";
import type { FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { ESPHomeAnsiLog } from "./ansi-log.js";
import type { ConfiguredDevice } from "../api/types.js";
import {
  apiContext,
  darkModeContext,
  devicesContext,
  firmwareJobsContext,
  localizeContext,
} from "../context/index.js";
import { dialogCloseButtonStyles } from "../styles/dialog-close-button.js";
import { espHomeStyles } from "../styles/shared.js";
import { downloadAnsiText } from "../util/download-text.js";
import { firmwareJobDisplayName } from "../util/firmware-job-display.js";
import { isTerminalJobStatus } from "../util/firmware-job-status.js";
import { dispatchShowLogsAfterInstall } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";

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
  "timer-sand": mdiTimerSand,
});

export type CommandType =
  | "install"
  | "compile"
  | "validate"
  | "clean"
  | "reset"
  | "rename";
type CommandState = "running" | "success" | "error";

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
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = true;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  /** Live snapshot of every backend firmware job, keyed by job_id.
   *  Drives the "queued — another task is running" overlay so we can
   *  tell the user the current dialog is waiting in line instead of
   *  silently sitting on an empty log. */
  @consume({ context: firmwareJobsContext, subscribe: true })
  @state()
  private _jobs: Map<string, FirmwareJob> = new Map();

  /** Configured devices — used to resolve the running job's friendly
   *  name for the queued-overlay's "waiting for: <device>" hint. */
  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @property()
  configuration = "";

  @property()
  name = "";

  @state() private _commandType: CommandType = "validate";
  @state() private _state: CommandState | null = null;
  @state() private _lines: string[] = [];
  @state() private _statusMessage = "";
  /** Distinguishes "user clicked Stop" from "the backend job failed".
   *  Both routes flip ``_state`` to ``"error"``, but only real
   *  failures should surface the reset-build-env hint — a user-cancel
   *  isn't a build problem. */
  @state() private _userStopped = false;
  /** Show-secrets toggle for the validate path. Re-runs validation
   *  when flipped (the ``--show-secrets`` flag is set on the
   *  ``esphome config`` subprocess at spawn time, so toggling has
   *  to tear down and re-spawn the underlying stream — same shape
   *  as logs-dialog's States toggle). Persisted only for the
   *  current dialog session: each fresh ``open`` resets to off so
   *  resolved secrets never leak into a screen-share without an
   *  explicit click. */
  @state() private _showSecrets = false;
  /** Auto-flip to the logs dialog after a successful install. Default
   *  on so users see device output the way ``esphome run`` does on
   *  the CLI; opt out by clicking the toolbar toggle before the
   *  install finishes. Reset to default per ``open()`` so an opt-out
   *  on one run doesn't silently persist into unrelated future runs. */
  @state() private _showLogsAfterInstall = true;
  /** Guard against re-entrancy on the show-secrets toggle.
   *  ``_detachStream`` clears ``_streamId`` synchronously and only
   *  awaits the backend stop afterwards; without this flag a fast
   *  double-click could fire two overlapping restarts (the second
   *  finds ``_streamId === ""``, treats the detach as a no-op, and
   *  spawns its own stream while the first is still awaiting the
   *  backend's stop response). Plain boolean rather than a queue —
   *  on a double-click we want the second click to be a no-op, not
   *  to chain another restart after the first. */
  private _restartInflight = false;

  /** Active job ID (for cancel). Not used for validate. */
  private _jobId = "";
  /** Latest known status of the followed job. Primed from the
   *  ``firmware/install`` (etc.) response so the queued overlay can
   *  render immediately on open instead of waiting for the matching
   *  ``job_queued`` event to land in ``firmwareJobsContext``. The
   *  context value takes precedence once it arrives — see
   *  ``_isQueued`` below. */
  @state()
  private _jobStatus: JobStatus | null = null;
  /** Stream message ID (for both validate streaming and follow_job streaming). */
  private _streamId = "";
  /** Install target port — "OTA" for network, an actual port for server-serial. */
  private _port = "OTA";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  @query("esphome-ansi-log")
  private _ansiLog?: ESPHomeAnsiLog;

  static styles = [
    espHomeStyles,
    dialogCloseButtonStyles,
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

      /* Match the logs-dialog width — same body content (ANSI-coloured
         terminal output from esphome's --dashboard mode), same wrap
         budget. 900 wrapped routinely on retina laptops where the
         timestamp + [C][module:NNN] prefix eats more horizontal real
         estate than expected; 1300 fits the common case end-to-end on
         a 13-inch laptop and leaves long-tail lines (multi-component
         config dumps, stack traces) to the user's browser scrollbar.
         min(..., 94vw) keeps the dialog from kissing the viewport
         edges on smaller screens. */
      wa-dialog {
        --width: min(1300px, 94vw);
      }
      /* Header matches the device-editor's title bar
         (--esphome-primary background with --esphome-on-primary
         text) so Validate / Install / Clean dialogs read as part
         of the dashboard chrome. Body keeps the terminal palette. */
      wa-dialog::part(header) {
        background: var(--esphome-primary);
        /* Right padding is 0 so the close button sits flush with the
           dialog's corner — the button is explicitly sized to a 40x40
           square below to give the X a comfortable hit target right
           where the user reaches for it. */
        padding: 0 0 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }
      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
      }
      /* Close-button styling lives in
         src/styles/dialog-close-button.ts — see the
         dialogCloseButtonStyles import below. */
      wa-dialog::part(body) {
        padding: 0;
        background: var(--term-bg);
        overflow: hidden;
      }
      wa-dialog::part(footer) {
        display: none;
      }

      .content {
        display: flex;
        flex-direction: column;
        height: 60vh;
        min-height: 300px;
        max-height: 70vh;
        overflow: hidden;
      }
      /* Wrapper that owns the queued overlay's positioning context.
         Anchoring on this (rather than .content) means the overlay
         covers only the log area — the toolbar / banner stay
         interactive even on narrow viewports where their height
         doesn't match the previous hard-coded offset. */
      .log-area {
        position: relative;
        flex: 1;
        min-height: 0;
        display: flex;
      }
      esphome-ansi-log {
        flex: 1;
        min-height: 0;
        --log-height: 100%;
      }
      esphome-ansi-log::part(container) {
        border-radius: 0;
      }

      /* Queued-overlay — covers the empty log area while the job is
         waiting in line behind another firmware task. The dialog
         deliberately doesn't auto-close so the user can keep watching;
         the "View firmware tasks" button gives them a quick out. */
      .queued-overlay {
        position: absolute;
        inset: 0;
        background: var(--term-bg);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 24px;
        text-align: center;
        font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
        color: var(--term-fg);
        z-index: 1;
      }
      .queued-overlay wa-icon[name="timer-sand"] {
        font-size: 48px;
        color: var(--term-accent);
        animation: queued-pulse 2s ease-in-out infinite;
      }
      @keyframes queued-pulse {
        0%,
        100% {
          opacity: 0.7;
        }
        50% {
          opacity: 1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .queued-overlay wa-icon[name="timer-sand"] {
          animation: none;
        }
      }
      .queued-title {
        font-size: 16px;
        font-weight: 700;
      }
      .queued-message {
        font-size: 13px;
        color: var(--term-fg-muted);
        max-width: 420px;
        line-height: 1.5;
      }

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

      /* Reset-build-env suggestion — surfaced only on install/compile
         failures. Sits between the error banner and the toolbar so the
         user reads "what failed" first, then "what to try next". Visual
         language is intentionally calmer than the banner (muted bg, no
         red) — this is a hint, not a second error. The action is an
         inline link inside the sentence rather than a separate button
         so the CTA reads as part of the hint. */
      .reset-suggestion {
        padding: 10px 20px;
        border-top: 1px solid var(--term-border);
        background: var(--term-bg-alt);
        font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
        font-size: 12px;
        line-height: 1.5;
        color: var(--term-fg-muted);
      }
      .reset-suggestion-link {
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        color: var(--term-accent);
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .reset-suggestion-link:hover,
      .reset-suggestion-link:focus-visible {
        color: var(--term-accent);
        text-decoration-thickness: 2px;
        outline: none;
      }

      .terminal-toolbar {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        padding: 6px var(--wa-space-m);
        background: var(--term-bg-alt);
        border-top: 1px solid var(--term-border);
      }
      .terminal-toolbar .spacer {
        flex: 1;
      }

      .streaming-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--term-accent);
        animation: pulse 1.5s infinite;
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.3;
        }
      }

      .term-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        font-family: "SF Mono", "Fira Code", monospace;
        cursor: pointer;
        border: 1px solid var(--term-border);
        transition:
          background 0.1s,
          border-color 0.1s;
      }
      .term-btn wa-icon {
        font-size: 14px;
      }
      .term-btn--ghost {
        background: transparent;
        color: var(--term-fg-muted);
      }
      .term-btn--ghost:hover {
        background: var(--term-hover);
        color: var(--term-fg);
        border-color: var(--term-fg-muted);
      }
      /* Active state for toggle ghost buttons (e.g. show-secrets).
         Same accent palette as the start button so it reads as "this
         mode is currently on" without being mistaken for a destructive
         or stop action. Mirrors the logs-dialog --states toggle. */
      .term-btn--ghost.is-active {
        background: color-mix(in srgb, var(--term-accent), transparent 85%);
        color: var(--term-accent);
        border-color: color-mix(in srgb, var(--term-accent), transparent 60%);
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
    /* When a job ends, the success/error banner takes ~56px of flex
       space below the log. The log container shrinks, scrollTop is
       preserved, and the bottom of the log slides out of view —
       which also trips ansi-log's _isUserScrolled latch and disables
       auto-scroll for any trailing lines. Re-pin to the new bottom
       and clear the latch on the running → terminal transition. */
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
    /* Always start with secrets redacted on a fresh open — the
       toggle is opt-in per session so a screen-share / pair-coding
       moment can't accidentally inherit a previous "show secrets"
       state. */
    this._showSecrets = false;
    this._showLogsAfterInstall = true;
    this._detachStream();
    this._dialog.open = true;
    this._resetAnsiLogScroll();
    this._start();
  }

  private _resetAnsiLogScroll() {
    /* The ansi-log instance is reused across opens; if the user
       scrolled up in a previous session its ``_isUserScrolled`` flag
       is still set and would suppress auto-scroll for the new
       session. ``scrollToBottom()`` clears the flag and re-engages
       streaming-to-bottom for the next batch of lines. */
    this.updateComplete.then(() => this._ansiLog?.scrollToBottom());
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
    this._userStopped = false;
    /* Match ``open()``: every fresh attach is a fresh session, so
       reset the per-toggle defaults rather than letting the prior
       run's choice leak into this one. Most relevant for
       ``_showLogsAfterInstall`` because a user who flipped the
       toggle off on a prior install would otherwise see this re-
       attached install silently inherit that opt-out. */
    this._showSecrets = false;
    this._showLogsAfterInstall = true;
    this._jobId = job.job_id;
    /* Prime from the job we were handed so the queued overlay can
       render on the very first paint instead of after the next
       context update. */
    this._jobStatus = job.status;
    // Cancel any prior follow before starting a new one. Without
    // this, every reopen of the dialog (clicking the busy spinner
    // again while a job is still running) layered on a fresh
    // ``firmwareFollowJob`` while the previous one was still pumping
    // ``onOutput`` callbacks into ``this._lines`` — each new line
    // appeared once per leaked subscription, so output duplicated
    // five times after five clicks.
    this._detachStream();
    this._dialog.open = true;
    this._resetAnsiLogScroll();
    this._followJob(job.job_id);
  }

  public close() {
    this._detachStream();
    this._dialog.open = false;
  }

  /**
   * Reopen this dialog without clearing the line buffer or status.
   * Used by the logs-dialog's "Back to install" button after the
   * post-install hand-off so the user can review the install
   * output. Safe to call when the dialog has been dismissed via X
   * / Escape — the dialog instance stays in the DOM and all state
   * lives on this host. */
  public reopen() {
    this._dialog.open = true;
    this._resetAnsiLogScroll();
  }

  /**
   * Successful-install hand-off: ask the host to open the logs
   * dialog tailing the same configuration, and (only if a host
   * acknowledged the request via ``preventDefault()``) hide this
   * dialog so the logs dialog has the screen to itself. The
   * install ``port`` carries through so server-serial installs
   * become server-serial logs and OTA installs become network
   * logs.
   *
   * The event is cancelable: contexts that don't mount a
   * ``<esphome-logs-dialog>`` (e.g. ``firmware-jobs-dialog``,
   * which mounts its own ``<esphome-command-dialog>`` for past
   * job output but no logs viewer) leave the command dialog
   * open instead of vanishing into nothing. Pages that DO wire
   * the handoff call ``e.preventDefault()`` from
   * ``handlePostInstallShowLogs`` to claim it. */
  private _flipToLogs = () => {
    const handled = dispatchShowLogsAfterInstall(this, {
      configuration: this.configuration,
      name: this.name,
      port: this._port,
      reopenInstall: () => this.reopen(),
    });
    if (handled) this._dialog.open = false;
  };

  /**
   * Tear down the active stream subscription, both client-side
   * (drops the local handler so its closure stops appending to
   * ``_lines``) and backend-side (the queued task can stop pushing
   * lines for a job we're no longer watching). Safe to call when
   * no stream is active.
   */
  private async _detachStream(): Promise<void> {
    if (!this._streamId) return;
    const streamId = this._streamId;
    this._streamId = "";
    /* Awaiting here lets callers that need the backend subprocess
       to actually exit before respawning (e.g. the show-secrets
       toggle, which restarts the same command with a different
       flag) chain off the promise. Swallow errors — a stop that
       fails because the stream already finished is the common
       case, not a bug. */
    try {
      await this._api.stopStream(streamId);
    } catch {
      /* ignore */
    }
  }

  private get _title(): string {
    return this._localize(`command.${this._commandType}_title`, { name: this.name });
  }

  protected render() {
    return html`
      <wa-dialog label=${this._title} light-dismiss @wa-after-hide=${this._onDialogHide}>
        <div class="content">
          <div class="log-area">
            <esphome-ansi-log
              .lines=${this._lines}
              ?light=${!this._darkMode}
            ></esphome-ansi-log>
            ${this._renderQueuedOverlay()}
          </div>
          ${this._renderBanner()} ${this._renderResetSuggestion()}
          ${this._renderToolbar()}
        </div>
      </wa-dialog>
    `;
  }

  /** True when this dialog is following a job that's still in the
   *  queue — backend serialises firmware work, so an Install kicked
   *  off while another job is running sits at QUEUED until its turn. */
  private get _isQueued(): boolean {
    if (!this._jobId) return false;
    /* Context wins once it has the entry — the backend may transition
       the job (e.g. QUEUED → RUNNING) before we'd see it locally.
       The locally-primed ``_jobStatus`` only fills the gap before the
       first context update. */
    const ctxStatus = this._jobs.get(this._jobId)?.status;
    return (ctxStatus ?? this._jobStatus) === JobStatus.QUEUED;
  }

  /** The job currently holding the firmware queue, if any. Used to
   *  tell the user *which* device they're waiting on so they can
   *  decide whether to cancel the in-flight task. */
  private get _runningJob(): FirmwareJob | null {
    for (const job of this._jobs.values()) {
      if (job.status === JobStatus.RUNNING) return job;
    }
    return null;
  }

  private _jobDisplayName(job: FirmwareJob): string {
    return firmwareJobDisplayName(job, this._devices, this._localize);
  }

  private _renderQueuedOverlay() {
    if (!this._isQueued) return nothing;
    const running = this._runningJob;
    return html`
      <div class="queued-overlay" role="status" aria-live="polite">
        <wa-icon library="mdi" name="timer-sand"></wa-icon>
        <div class="queued-title">${this._localize("command.queued_title")}</div>
        <div class="queued-message">
          ${running
            ? this._localize("command.queued_waiting_for", {
                name: this._jobDisplayName(running),
              })
            : this._localize("command.queued_message")}
        </div>
        <button class="term-btn term-btn--start" @click=${this._openFirmwareJobs}>
          <wa-icon library="mdi" name="playlist-check"></wa-icon>
          ${this._localize("command.queued_view_all")}
        </button>
      </div>
    `;
  }

  private _openFirmwareJobs() {
    /* Closing the command dialog frees the user to interact with the
       firmware-tasks list (cancel the running job, see the full
       queue, etc.) — the dialog's follow_job stream will reattach if
       they click back into this device's job from the tasks list. */
    this.close();
    this.dispatchEvent(
      new CustomEvent("open-firmware-jobs", {
        bubbles: true,
        composed: true,
      })
    );
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

  /** Hint shown after a failed install / compile pointing the user
   *  at "Reset Build Environment". Build-env corruption is a common
   *  cause of compile failures (stale toolchain, half-installed
   *  platform/library); the legacy dashboard surfaced a Clean All
   *  button at the top level for this reason. We keep the entry-
   *  point in the kebab and contextually offer it here so users
   *  don't have to dig for it after a failure. Limited to install /
   *  compile because the other command types don't have a build
   *  step that the reset would help with.
   *
   *  Rendered as an inline link inside the sentence rather than a
   *  separate button so the call-to-action reads as part of the
   *  hint ("try reset build environment") instead of a standalone
   *  next-step. The translation puts the link text behind a
   *  ``{action}`` marker so other locales can place it wherever
   *  reads naturally. */
  private _renderResetSuggestion() {
    if (this._state !== "error") return nothing;
    if (this._userStopped) return nothing;
    if (this._commandType !== "install" && this._commandType !== "compile") {
      return nothing;
    }
    const text = this._localize("command.try_reset_suggestion");
    const [before, after = ""] = text.split("{action}");
    return html`
      <div class="reset-suggestion" role="status">
        ${before}<button
          class="reset-suggestion-link"
          @click=${this._tryResetBuildEnv}
        >
          ${this._localize("command.try_reset_button")}</button>${after}
      </div>
    `;
  }

  /** Hand off to the firmware-jobs-dialog's reset flow. We close the
   *  current command dialog first so the user can see the confirm
   *  prompt clearly — same pattern as ``_openFirmwareJobs`` above. */
  private _tryResetBuildEnv = () => {
    this.close();
    this.dispatchEvent(
      new CustomEvent("open-reset-build-env", {
        bubbles: true,
        composed: true,
      })
    );
  };

  private _renderToolbar() {
    return html`
      <div class="terminal-toolbar">
        ${this._renderStatus()}
        <span class="spacer"></span>
        ${this._renderShowSecretsToggle()} ${this._renderShowLogsAfterInstallToggle()}
        ${this._lines.length > 0
          ? html`<button
              class="term-btn term-btn--ghost"
              @click=${this._downloadOutput}
              title=${this._localize("command.download")}
              aria-label=${this._localize("command.download")}
            >
              <wa-icon library="mdi" name="download"></wa-icon>
            </button>`
          : nothing}
        ${this._renderActions()}
      </div>
    `;
  }

  /**
   * Render a toolbar toggle button — shared shape used by every
   * is-active toggle in this dialog (and mirrored by the logs-dialog
   * "States" toggle). Ghost button, ``is-active`` class when on,
   * ``aria-pressed`` for screen readers, label and tooltip swap
   * between the active and inactive states. Each per-toggle render
   * method just supplies the active flag, click handler, icon, and
   * the four translation keys.
   */
  private _renderToolbarToggle(opts: {
    active: boolean;
    onClick: () => void;
    iconActive: string;
    iconInactive: string;
    labelKeyActive: string;
    labelKeyInactive: string;
    tooltipKeyActive: string;
    tooltipKeyInactive: string;
  }) {
    const labelKey = opts.active ? opts.labelKeyActive : opts.labelKeyInactive;
    const tooltipKey = opts.active ? opts.tooltipKeyActive : opts.tooltipKeyInactive;
    const icon = opts.active ? opts.iconActive : opts.iconInactive;
    return html`<button
      class="term-btn term-btn--ghost ${opts.active ? "is-active" : ""}"
      @click=${opts.onClick}
      title=${this._localize(tooltipKey)}
      aria-pressed=${opts.active ? "true" : "false"}
    >
      <wa-icon library="mdi" name=${icon}></wa-icon>
      ${this._localize(labelKey)}
    </button>`;
  }

  /**
   * Show-secrets toggle — validate only.
   *
   * ``--show-secrets`` is an ``esphome config`` flag, not something
   * the compile / install / clean flows respect, so the toggle is
   * hidden on every other command type to keep the toolbar from
   * accumulating inert buttons.
   */
  private _renderShowSecretsToggle() {
    if (this._commandType !== "validate") return nothing;
    return this._renderToolbarToggle({
      active: this._showSecrets,
      onClick: this._toggleShowSecrets,
      iconActive: "key",
      iconInactive: "key-outline",
      labelKeyActive: "command.hide_secrets",
      labelKeyInactive: "command.show_secrets",
      tooltipKeyActive: "command.hide_secrets_tooltip",
      tooltipKeyInactive: "command.show_secrets_tooltip",
    });
  }

  /**
   * Show-logs-after-install toggle — install only, only while the
   * install is still running.
   *
   * When on (default), a successful install dispatches
   * ``request-show-logs-after-install`` and the host flips the logs
   * dialog open so the user sees device output the way
   * ``esphome run`` does on the CLI. The toggle disappears once the
   * install settles to success / error — the user has already
   * declared their preference, no point in showing a no-op control
   * once the decision has been made.
   */
  private _renderShowLogsAfterInstallToggle() {
    if (this._commandType !== "install") return nothing;
    if (this._state === "success" || this._state === "error") return nothing;
    return this._renderToolbarToggle({
      active: this._showLogsAfterInstall,
      onClick: this._toggleShowLogsAfterInstall,
      iconActive: "console",
      iconInactive: "console",
      /* Single label both ways — this is a checkbox-style toggle
         (the ``is-active`` styling carries the on/off signal); the
         text never swaps to "Skip logs after" so the user only has
         to read one phrase to know what the control does. */
      labelKeyActive: "command.show_logs_after_install",
      labelKeyInactive: "command.show_logs_after_install",
      tooltipKeyActive: "command.show_logs_after_install_tooltip",
      tooltipKeyInactive: "command.show_logs_after_install_tooltip",
    });
  }

  private _toggleShowLogsAfterInstall = () => {
    this._showLogsAfterInstall = !this._showLogsAfterInstall;
  };

  /**
   * Save the buffered output to a text file. File-name pattern is
   * configuration stem + command type so a user with several saved
   * files can tell which is which.
   */
  private _downloadOutput() {
    const stem = this.configuration.replace(/\.ya?ml$/, "") || "output";
    downloadAnsiText(this._lines, `${stem}-${this._commandType}.txt`);
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
        /* Retry only makes sense for the command types that ``_start``
           knows how to re-run from the dialog itself (validate /
           install / compile / clean). RENAME jobs come in via
           ``followJob`` and the user originally launched them from
           the dashboard's rename dialog; surfacing a Retry button
           here would no-op (``_startFirmwareJob`` returns early for
           unknown types) and leave the user staring at an action
           that did nothing. Just show Close — the user can re-open
           the rename dialog from the device card. */
        return this._commandType === "rename"
          ? html`<button class="term-btn term-btn--ghost" @click=${this.close}>
              ${this._localize("command.close")}
            </button>`
          : html` <button class="term-btn term-btn--start" @click=${this._start}>
                <wa-icon library="mdi" name="refresh"></wa-icon> ${this._localize(
                  "command.retry"
                )}
              </button>
              <button class="term-btn term-btn--ghost" @click=${this.close}>
                ${this._localize("command.close")}
              </button>`;
      case "success":
        /* Surface a "Show logs" action on a successful install so
           the user has a one-click path back to the live logs
           dialog after they've clicked its "Back to install"
           button. The same auto-flip path is reused so
           server-serial installs open server-serial logs and OTA
           installs open network logs. Other command types
           (compile / clean) don't have a sensible logs follow-up,
           so we only surface it for install.

           Hosts that mount this dialog are expected to wire
           ``@request-show-logs-after-install`` to their logs-
           dialog; if a host neglects to, the click no-ops rather
           than misbehaving.

           Rendered as a ghost button (not ``term-btn--start``) on
           purpose — the toolbar's "Logs after" toggle was
           previously shown with the blue accent palette while the
           install ran, and reusing that styling here would make
           the post-success "Logs" button look like the toggle
           "stayed on" rather than collapsing into a regular
           action. */
        return this._commandType === "install"
          ? html`<button class="term-btn term-btn--ghost" @click=${this._flipToLogs}>
                <wa-icon library="mdi" name="console"></wa-icon>
                ${this._localize("command.show_logs")}
              </button>
              <button class="term-btn term-btn--ghost" @click=${this.close}>
                ${this._localize("command.close")}
              </button>`
          : html`<button class="term-btn term-btn--ghost" @click=${this.close}>
              ${this._localize("command.close")}
            </button>`;
      default:
        return nothing;
    }
  }

  // ─── Command execution ─────────────────────────────────────

  private async _start() {
    this._detachStream();
    this._jobId = "";
    this._state = "running";
    this._lines = [];
    this._statusMessage = "";
    this._userStopped = false;

    if (this._commandType === "validate") {
      this._startValidateStream();
      return;
    }
    await this._startFirmwareJob();
  }

  /** Validate uses the per-connection streaming command (not a queued job). */
  private _startValidateStream() {
    this._streamId = this._api.validate(
      this.configuration,
      {
        onOutput: (line) => {
          this._lines = [...this._lines, line];
        },
        onResult: (data) => {
          this._streamId = "";
          this._state = data.success ? "success" : "error";
          this._statusMessage = this._localize(
            data.success ? "command.validate_success" : "command.validate_failed"
          );
        },
        onError: (error) => {
          this._streamId = "";
          this._state = "error";
          this._statusMessage = error;
        },
      },
      { showSecrets: this._showSecrets }
    );
  }

  /**
   * Re-run validation with the show-secrets flag flipped.
   *
   * The ``--show-secrets`` flag is baked into the esphome config
   * subprocess at spawn time, so flipping the toggle has to tear
   * down the current stream and start a fresh one. Mirrors the
   * logs-dialog "States" toggle. Output is cleared before the
   * restart so users don't see the redacted-then-resolved values
   * stitched into one scrollback, and the ansi-log scroll position
   * is reset so a previously-scrolled-up view doesn't suppress
   * auto-scroll on the new output.
   *
   * Serialised via ``_restartInflight`` so a fast double-toggle
   * doesn't race two restarts. ``_detachStream`` clears the stream
   * id synchronously, so without the guard a second click during
   * the awaited stop sees ``_streamId === ""``, proceeds with a
   * no-op detach + spawn, and when the original ``await`` resumes
   * it spawns another stream against the same dialog — two
   * concurrent ``esphome config`` runs interleaving into
   * ``_lines``.
   */
  private async _toggleShowSecrets() {
    this._showSecrets = !this._showSecrets;
    if (this._commandType !== "validate") return;
    if (this._restartInflight) return;
    this._restartInflight = true;
    try {
      await this._detachStream();
      this._lines = [];
      this._state = "running";
      this._statusMessage = "";
      this._resetAnsiLogScroll();
      this._startValidateStream();
    } finally {
      this._restartInflight = false;
    }
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
    /* Prime status from the API response so the queued overlay shows
       up immediately. The matching ``job_queued`` event will lands in
       ``firmwareJobsContext`` shortly after and the getter will
       prefer that live value going forward. */
    this._jobStatus = job.status;
    this._followJob(job.job_id);
  }

  /** Attach to a job's output stream. Works for queued, running, or finished jobs. */
  private _followJob(jobId: string) {
    /* Snapshot whether this attach saw the job live (QUEUED /
       RUNNING) — captured locally so the closure below can gate
       the auto-flip on it. Reattaching to a job that's already
       terminal is a review path: yanking the user to logs after
       they opened firmware-tasks specifically to read the past
       install output is the surprise behaviour. The toolbar
       toggle and the post-success "Logs" button stay unconditional
       — those are user-initiated, not automatic. */
    const wasLiveAtAttach = !isTerminalJobStatus(this._jobStatus);
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
            : `command.${this._commandType}_failed`
        );
        this._jobId = "";
        if (
          success &&
          wasLiveAtAttach &&
          this._commandType === "install" &&
          this._showLogsAfterInstall
        ) {
          this._flipToLogs();
        }
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
    this._userStopped = true;
    this._statusMessage = this._localize("command.stopped");
    this._detachStream();
    this._jobId = "";
  }

  private _onDialogHide() {
    this._detachStream();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-command-dialog": ESPHomeCommandDialog;
  }
}
