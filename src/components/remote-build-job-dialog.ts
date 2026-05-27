import { consume } from "@lit/context";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { ESPHomeAPI } from "../api/index.js";
import { APIError } from "../api/api-error.js";
import {
  ErrorCode,
  JobStatus,
  JobType,
  type ConfiguredDevice,
  type RemoteBuildSubmitTarget,
} from "../api/types.js";
import {
  apiContext,
  buildOffloadJobsContext,
  darkModeContext,
  devicesContext,
  localizeContext,
  type RemoteBuildJobState,
} from "../context/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { inputStyles } from "../styles/inputs.js";
import { jobStatusPillStyles } from "../styles/job-status-pill.js";
import { espHomeStyles } from "../styles/shared.js";
import { isTerminalJobStatus } from "../util/firmware-job-status.js";
import { renderErrorBanner } from "../util/render-error.js";

import "./ansi-log.js";
import "./base-dialog.js";

type Step = "input" | "submitting" | "list";

/** Per-row UI state for the cancel button. Lives only in the
 *  dialog; the shared buildOffloadJobsContext map doesn't carry
 *  these because they're transient per-tab concerns (an in-flight
 *  cancel_job WS call doesn't outlive the dialog and isn't visible
 *  to a different tab). */
interface JobRowUIState {
  cancelInFlight: boolean;
  cancelRequested: boolean;
  errorMessage: string;
}

const FRESH_ROW_STATE: JobRowUIState = {
  cancelInFlight: false,
  cancelRequested: false,
  errorMessage: "",
};

/**
 * Dispatch + watch remote builds on paired build servers.
 *
 * Two entry points share one dialog instance:
 *
 *   open({pin_sha256, receiver_label}) — lands on the input
 *   step pre-targeted at *pairing*; on submit transitions to
 *   the list step with the new job's row auto-expanded so the
 *   submitter sees the running build immediately.
 *
 *   openForJob(job_id) — skips the input step and opens the
 *   list step with *job_id* auto-expanded.
 *
 * The list step renders every entry in buildOffloadJobsContext
 * as a row sorted newest-first, with a status pill plus a
 * collapsible body carrying the receiver's streamed output.
 * Per-row Cancel routes through ``remote_build/cancel_job``;
 * the receiver's JOB_CANCELLED event flips the row's pill
 * through the existing OFFLOADER_JOB_STATE_CHANGED stream.
 *
 * Closing the list step dismisses every terminal entry in the
 * map (mirrors the "operator's I've seen the result" semantics
 * that the single-job dialog applied to its one tracked job).
 * Non-terminal entries stay in the map so re-opening picks
 * back up on the live build.
 *
 * Dispatches remote-build-job-submitted with the job seed
 * (pin / receiver_label / configuration / target / job_id) on
 * a successful ack so app-shell stamps the in-flight jobs map's
 * display fields. Wire frames don't carry those fields;
 * without the dispatch the list view would fall back to empty
 * placeholders.
 */
@customElement("esphome-remote-build-job-dialog")
export class ESPHomeRemoteBuildJobDialog extends LitElement {
  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api?: ESPHomeAPI;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize!: LocalizeFunc;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @consume({ context: buildOffloadJobsContext, subscribe: true })
  @state()
  private _jobs: Map<string, RemoteBuildJobState> | null = null;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = false;

  @state() private _open = false;
  @state() private _step: Step = "input";
  /** Pin + label of the pairing the input step is targeting.
   *  Empty when the dialog was opened via openForJob (list-only
   *  flow has no associated "submit a new build for X" context). */
  @state() private _pinSha256 = "";
  @state() private _receiverLabel = "";
  @state() private _configuration = "";
  @state() private _target: RemoteBuildSubmitTarget = JobType.COMPILE;
  @state() private _submitErrorMessage = "";
  /** job_id of the row currently expanded in the list view, or
   *  empty when no row is expanded. Single-expand keeps the
   *  ansi-log render cost bounded to one busy job at a time. */
  @state() private _expandedJobId = "";
  /** Transient per-row UI state for the Cancel button. Pruned
   *  when an entry leaves the shared jobs map so a re-submitted
   *  job_id (theoretical) can't inherit a stale cancelRequested. */
  @state() private _rowState: Map<string, JobRowUIState> = new Map();

  /** Prune _rowState entries whose job_id no longer appears in
   *  the shared jobs map (entry dismissed elsewhere, or a stale
   *  row from a previous open). Keeps the Map's lifetime tied
   *  to the data it annotates so a re-submitted job_id can't
   *  inherit a stale cancelRequested. */
  protected updated(changed: PropertyValues): void {
    if (!changed.has("_jobs")) return;
    if (this._rowState.size === 0) return;
    if (!this._jobs) return;
    const pruned = new Map<string, JobRowUIState>();
    for (const [job_id, state] of this._rowState) {
      if (this._jobs.has(job_id)) pruned.set(job_id, state);
    }
    if (pruned.size !== this._rowState.size) this._rowState = pruned;
  }

  /** Open the dialog targeting *pairing*, defaulting the
   *  configuration to the first device on the list (or empty
   *  if no devices are configured). After a successful submit
   *  the dialog transitions to the list step with the new
   *  job's row auto-expanded. */
  open(args: { pin_sha256: string; receiver_label: string }): void {
    this._pinSha256 = args.pin_sha256;
    this._receiverLabel = args.receiver_label;
    this._configuration = this._devices[0]?.configuration ?? "";
    this._target = JobType.COMPILE;
    this._submitErrorMessage = "";
    this._step = "input";
    this._open = true;
  }

  /** Open the dialog on the list step with *job_id* auto-
   *  expanded. Used by settings-dialog's per-row "View build"
   *  affordance to drop the user into the running view for
   *  the job they just clicked, without losing access to
   *  the other in-flight jobs visible in the same list. */
  openForJob(job_id: string): void {
    this._pinSha256 = "";
    this._receiverLabel = "";
    this._submitErrorMessage = "";
    this._expandedJobId = job_id;
    this._step = "list";
    this._open = true;
  }

  private _close = () => {
    if (!this._open) return;
    // Dismiss every terminal entry in the shared jobs map when
    // the operator closes the list step. Mirrors the original
    // single-job dialog's "closing on terminal == I've seen the
    // result" semantics applied across the list. Non-terminal
    // entries stay so a re-open picks back up on the live build.
    if (this._step === "list" && this._jobs) {
      for (const job of this._jobs.values()) {
        if (isTerminalJobStatus(job.status)) {
          this.dispatchEvent(
            new CustomEvent("remote-build-job-dismissed", {
              bubbles: true,
              composed: true,
              detail: { job_id: job.job_id },
            })
          );
        }
      }
    }
    this._open = false;
    this._submitErrorMessage = "";
    this._rowState = new Map();
    this._expandedJobId = "";
  };

  private _onConfigurationChange = (e: Event) => {
    this._configuration = (e.target as HTMLSelectElement).value;
  };

  private _onTargetChange = (e: Event) => {
    this._target = (e.target as HTMLSelectElement).value as RemoteBuildSubmitTarget;
  };

  private _onSubmit = async () => {
    if (this._api === undefined || !this._pinSha256 || !this._configuration) {
      return;
    }
    this._submitErrorMessage = "";
    this._step = "submitting";
    try {
      const result = await this._api.submitRemoteBuildJob({
        pin_sha256: this._pinSha256,
        configuration: this._configuration,
        target: this._target,
      });
      if (!result.accepted) {
        // Receiver rejected the job (queue full, manifest
        // mismatch, hash mismatch). reason carries the code.
        this._submitErrorMessage = this._localize(
          "settings.remote_build_submit_rejected",
          { reason: result.reason ?? "" }
        );
        this._step = "input";
        return;
      }
      // Bubble the seed up so app-shell stamps the in-flight
      // jobs map's display fields. Wire frames don't carry
      // them; the list view would otherwise read empty
      // strings until the user dismisses.
      this.dispatchEvent(
        new CustomEvent("remote-build-job-submitted", {
          bubbles: true,
          composed: true,
          detail: {
            job_id: result.job_id,
            pin_sha256: this._pinSha256,
            receiver_label: this._receiverLabel,
            configuration: this._configuration,
            target: this._target,
          },
        })
      );
      this._expandedJobId = result.job_id;
      this._step = "list";
    } catch (err) {
      this._submitErrorMessage = this._formatSubmitError(err);
      this._step = "input";
    }
  };

  private _onCancel = async (job: RemoteBuildJobState) => {
    if (this._api === undefined) return;
    const row = this._rowState.get(job.job_id) ?? FRESH_ROW_STATE;
    if (row.cancelInFlight || row.cancelRequested) return;
    if (isTerminalJobStatus(job.status)) return;
    this._patchRowState(job.job_id, { errorMessage: "", cancelInFlight: true });
    try {
      const result = await this._api.cancelRemoteBuildJob({
        pin_sha256: job.pin_sha256,
        job_id: job.job_id,
      });
      if (result.sent) {
        // Frame made it onto the peer-link wire. Lock the
        // button to "Cancel sent" while we wait for the
        // receiver's JOB_CANCELLED-driven flip through
        // OFFLOADER_JOB_STATE_CHANGED — a re-click would just
        // fire a duplicate frame the receiver silently drops
        // on the unknown-correlation path.
        this._patchRowState(job.job_id, {
          cancelInFlight: false,
          cancelRequested: true,
        });
      } else {
        // sent=false is the documented signal for a same-tick
        // Noise-encrypt / WS-send failure on the offloader
        // side. The receiver never saw the cancel, so locking
        // the button to "Cancel sent" would be a lie. Surface
        // it as a generic error and leave the button enabled
        // so the user can retry once the underlying transport
        // settles.
        this._patchRowState(job.job_id, {
          cancelInFlight: false,
          errorMessage: this._localize("settings.remote_build_cancel_generic_error"),
        });
      }
    } catch (err) {
      this._patchRowState(job.job_id, {
        cancelInFlight: false,
        errorMessage: this._formatCancelError(err),
      });
    }
  };

  /** Merge *diff* into the row state for *job_id*, falling back
   *  to a fresh row if no entry exists yet. Clones the map so
   *  Lit picks up the change. */
  private _patchRowState(job_id: string, diff: Partial<JobRowUIState>): void {
    const next = new Map(this._rowState);
    const existing = next.get(job_id) ?? FRESH_ROW_STATE;
    next.set(job_id, { ...existing, ...diff });
    this._rowState = next;
  }

  /** Toggle the expanded row. Clicking the already-expanded row
   *  collapses it; clicking a different row expands that one
   *  (single-expand bounds the ansi-log render cost to one
   *  active output panel at a time). */
  private _onToggleRow = (job_id: string) => {
    this._expandedJobId = this._expandedJobId === job_id ? "" : job_id;
  };

  private _onDismissRow = (job_id: string) => {
    this.dispatchEvent(
      new CustomEvent("remote-build-job-dismissed", {
        bubbles: true,
        composed: true,
        detail: { job_id },
      })
    );
    if (this._expandedJobId === job_id) this._expandedJobId = "";
  };

  private _formatCancelError(err: unknown): string {
    if (err instanceof APIError) {
      switch (err.errorCode) {
        case ErrorCode.PRECONDITION_FAILED:
          return this._localize("settings.remote_build_cancel_precondition_failed");
        case ErrorCode.NOT_FOUND:
          return this._localize("settings.remote_build_cancel_not_found");
        default:
          return this._localize("settings.remote_build_cancel_generic_error");
      }
    }
    return this._localize("settings.remote_build_cancel_generic_error");
  }

  private _formatSubmitError(err: unknown): string {
    if (err instanceof APIError) {
      switch (err.errorCode) {
        case ErrorCode.PRECONDITION_FAILED:
          return this._localize("settings.remote_build_submit_precondition_failed");
        case ErrorCode.UNAVAILABLE:
          return this._localize("settings.remote_build_submit_unavailable");
        case ErrorCode.NOT_FOUND:
          return this._localize("settings.remote_build_submit_not_found");
        case ErrorCode.INVALID_ARGS:
          return this._localize("settings.remote_build_submit_invalid_args", {
            details: err.details,
          });
        default:
          return this._localize("settings.remote_build_submit_generic_error");
      }
    }
    return this._localize("settings.remote_build_submit_generic_error");
  }

  private _renderInput() {
    if (this._devices.length === 0) {
      return html`
        <p class="empty">${this._localize("settings.remote_build_submit_no_devices")}</p>
        <div class="actions">
          <button class="btn-secondary" type="button" @click=${this._close}>
            ${this._localize("layout.close")}
          </button>
        </div>
      `;
    }
    return html`
      <div class="field">
        <label for="rb-config">
          ${this._localize("settings.remote_build_submit_configuration_label")}
        </label>
        <select
          id="rb-config"
          .value=${this._configuration}
          @change=${this._onConfigurationChange}
        >
          ${this._devices.map(
            (d) => html`<option value=${d.configuration}>${d.name}</option>`
          )}
        </select>
      </div>
      <div class="field">
        <label for="rb-target">
          ${this._localize("settings.remote_build_submit_target_label")}
        </label>
        <select id="rb-target" .value=${this._target} @change=${this._onTargetChange}>
          <option value=${JobType.COMPILE}>
            ${this._localize("settings.remote_build_submit_target_compile")}
          </option>
          <option value=${JobType.UPLOAD}>
            ${this._localize("settings.remote_build_submit_target_upload")}
          </option>
        </select>
      </div>
      ${renderErrorBanner(this._submitErrorMessage)}
      <div class="actions">
        <button class="btn-secondary" type="button" @click=${this._close}>
          ${this._localize("layout.close")}
        </button>
        <button
          class="btn-primary"
          type="button"
          ?disabled=${!this._configuration}
          @click=${this._onSubmit}
        >
          ${this._localize("settings.remote_build_submit_action")}
        </button>
      </div>
    `;
  }

  private _renderSubmitting() {
    return html`
      <p class="status-line">
        ${this._localize("settings.remote_build_submit_in_flight", {
          label: this._receiverLabel,
        })}
      </p>
    `;
  }

  /** Sort *jobs* newest-first by started_at. Entries that were
   *  seeded via an event-before-submit race carry 0; they sort
   *  to the bottom, which is fine because they're rare and the
   *  display-field backfill on the next dispatch repairs the
   *  ordering. */
  private _sortedJobs(): RemoteBuildJobState[] {
    if (!this._jobs) return [];
    return [...this._jobs.values()].sort((a, b) => b.started_at - a.started_at);
  }

  private _renderList() {
    const jobs = this._sortedJobs();
    if (jobs.length === 0) {
      return html`
        <p class="empty">${this._localize("settings.remote_build_list_empty")}</p>
        <div class="actions">
          <button class="btn-secondary" type="button" @click=${this._close}>
            ${this._localize("layout.close")}
          </button>
        </div>
      `;
    }
    return html`
      <ul class="job-list" role="list">
        ${jobs.map((job) => this._renderJobRow(job))}
      </ul>
      <div class="actions">
        <button class="btn-secondary" type="button" @click=${this._close}>
          ${this._localize("layout.close")}
        </button>
      </div>
    `;
  }

  private _renderJobRow(job: RemoteBuildJobState) {
    const terminal = isTerminalJobStatus(job.status);
    const expanded = this._expandedJobId === job.job_id;
    const row = this._rowState.get(job.job_id) ?? FRESH_ROW_STATE;
    const headerLabel =
      job.receiver_label || this._localize("settings.remote_build_unknown_receiver");
    const headerConfig =
      job.configuration || this._localize("settings.remote_build_unknown_configuration");
    return html`
      <li class="job-row">
        <button
          class="job-summary"
          type="button"
          aria-expanded=${expanded ? "true" : "false"}
          @click=${() => this._onToggleRow(job.job_id)}
        >
          <span class=${`status-pill status-${job.status}`}>
            ${this._localize(`settings.remote_build_status_${job.status}`)}
          </span>
          <span class="job-summary-text">
            <span class="job-receiver">${headerLabel}</span>
            <span class="job-meta-line">
              ${headerConfig} &middot;
              ${this._localize(`settings.remote_build_submit_target_${job.target}`)}
            </span>
          </span>
          <span class="chevron" aria-hidden="true"> ${expanded ? "▾" : "▸"} </span>
        </button>
        ${expanded
          ? html`
              <div class="job-body">
                ${renderErrorBanner(job.error_message)}
                ${renderErrorBanner(row.errorMessage)}
                <div class="logs-container">
                  <esphome-ansi-log
                    .lines=${job.output}
                    ?light=${!this._darkMode}
                  ></esphome-ansi-log>
                </div>
                <div class="row-actions">
                  ${terminal
                    ? html`<button
                        class="btn-secondary"
                        type="button"
                        @click=${() => this._onDismissRow(job.job_id)}
                      >
                        ${this._localize("settings.remote_build_dismiss_row")}
                      </button>`
                    : html`<button
                        class="btn-danger"
                        type="button"
                        ?disabled=${row.cancelInFlight || row.cancelRequested}
                        @click=${() => this._onCancel(job)}
                      >
                        ${this._localize(
                          row.cancelRequested
                            ? "settings.remote_build_cancel_pending"
                            : row.cancelInFlight
                              ? "settings.remote_build_cancel_in_flight"
                              : "settings.remote_build_cancel_action"
                        )}
                      </button>`}
                </div>
              </div>
            `
          : nothing}
      </li>
    `;
  }

  protected render() {
    if (!this._open) return nothing;
    let body;
    let title;
    switch (this._step) {
      case "input":
        title = this._localize("settings.remote_build_submit_title", {
          label: this._receiverLabel,
        });
        body = this._renderInput();
        break;
      case "submitting":
        title = this._localize("settings.remote_build_submit_title", {
          label: this._receiverLabel,
        });
        body = this._renderSubmitting();
        break;
      case "list":
        title = this._localize("settings.remote_build_list_title");
        body = this._renderList();
        break;
    }
    // ?busy gates outside-click + Esc + close-button while
    // the submit_job WS round-trip is in flight: base-dialog
    // flips light-dismiss off and vetoes wa-request-close
    // when busy, so the dialog can't dismiss between the
    // submit and the ack returning. Orphaning that response
    // would fire remote-build-job-submitted against an
    // already-closed dialog. Mirrors pair-build-server-dialog's
    // gate.
    const busy = this._step === "submitting";
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        ?busy=${busy}
        .label=${title}
        @after-hide=${this._close}
      >
        ${body}
      </esphome-base-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    jobStatusPillStyles,
    css`
      esphome-base-dialog {
        --width: 560px;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        margin-bottom: var(--wa-space-m);
      }

      .field-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-s);
        margin-top: var(--wa-space-xs);
      }

      /* Destructive variant for the per-row Cancel-this-job
         button. Mirrors confirm-dialog's destructive btn tint
         without dragging the whole confirm-dialog style block in.
         The other two buttons in this dialog (.btn-primary /
         .btn-secondary) inherit browser-default chrome. */
      .btn-danger {
        background: var(--esphome-error);
        color: var(--esphome-on-primary);
        border: var(--wa-border-width-s) solid var(--esphome-error);
        border-radius: var(--wa-border-radius-m);
        padding: 0 var(--wa-space-m);
        min-height: var(--wa-form-control-height);
        font-family: inherit;
        font-size: var(--wa-font-size-s);
        cursor: pointer;
      }

      .btn-danger:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-error), black 10%);
        border-color: color-mix(in srgb, var(--esphome-error), black 10%);
      }

      .btn-danger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-m);
      }

      .row-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-s);
      }

      .empty {
        color: var(--wa-color-neutral-500);
        margin: var(--wa-space-m) 0;
      }

      .job-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
      }

      .job-row {
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-lowered);
      }

      .job-summary {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        width: 100%;
        padding: var(--wa-space-s) var(--wa-space-m);
        background: transparent;
        border: 0;
        border-radius: var(--wa-border-radius-m);
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        color: inherit;
      }

      .job-summary:hover {
        background: var(--wa-color-surface-border);
      }

      .job-summary-text {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        gap: 2px;
      }

      .job-receiver {
        font-weight: var(--wa-font-weight-semibold);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .job-meta-line {
        color: var(--wa-color-neutral-500);
        font-size: var(--wa-font-size-s);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .chevron {
        color: var(--wa-color-neutral-500);
        font-size: var(--wa-font-size-s);
      }

      .job-body {
        padding: 0 var(--wa-space-m) var(--wa-space-m);
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .logs-container {
        height: 320px;
        overflow: hidden;
        margin-top: var(--wa-space-s);
      }

      esphome-ansi-log {
        height: 100%;
      }

      .status-line {
        margin: var(--wa-space-l) 0;
        color: var(--wa-color-neutral-500);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-remote-build-job-dialog": ESPHomeRemoteBuildJobDialog;
  }
}
