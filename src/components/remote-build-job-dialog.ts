import "@home-assistant/webawesome/dist/components/dialog/dialog.js";

import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
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
import { dialogCloseButtonStyles } from "../styles/dialog-close-button.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { isTerminalJobStatus } from "../util/firmware-job-status.js";

import "./ansi-log.js";

type Step = "input" | "submitting" | "running";

/**
 * Dispatch + watch a remote build on a paired build server.
 *
 * Two-step dialog: pick configuration + target (compile /
 * upload), then watch the receiver's build run live with a
 * lifecycle pill + ansi-log of the streamed output.
 *
 * Triggered from settings-dialog's Send-builds section: the
 * caller invokes open(pairing) with the target pin +
 * label, the dialog shows the input form, hits
 * remote_build/submit_job on confirm, then transitions
 * to the live progress view that consumes
 * OFFLOADER_JOB_STATE_CHANGED / OFFLOADER_JOB_OUTPUT events
 * through buildOffloadJobsContext.
 *
 * Cancel button (phase 5d) routes through
 * ``remote_build/cancel_job``. Fire-and-forget on the wire;
 * the terminal ``status: "cancelled"`` flip arrives via the
 * existing ``OFFLOADER_JOB_STATE_CHANGED`` event stream the
 * dialog already watches. Closing the dialog mid-build (with
 * or without cancelling) leaves the receiver alone; the user
 * can re-open to see live progress until terminal.
 *
 * Dispatches remote-build-job-submitted with the job seed
 * (pin / receiver_label / configuration / target / job_id)
 * on a successful ack so the parent app-shell can stamp the
 * in-flight jobs map's display fields. The wire frames
 * don't carry those fields; without the dispatch the
 * progress view falls back to "(unknown)" placeholders.
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
  @state() private _pinSha256 = "";
  @state() private _receiverLabel = "";
  @state() private _configuration = "";
  @state() private _target: RemoteBuildSubmitTarget = JobType.COMPILE;
  @state() private _jobId = "";
  @state() private _errorMessage = "";
  /** True between the user clicking Cancel and the cancel_job
   *  WS round-trip resolving. Disables the button so a
   *  double-click can't fire a second frame; the running
   *  status pill stays "running" until the receiver's
   *  JOB_CANCELLED-driven state-change event flips it through
   *  the OFFLOADER_JOB_STATE_CHANGED plumbing. */
  @state() private _cancelInFlight = false;
  /** True once the cancel_job WS round-trip has resolved
   *  successfully on a still-non-terminal job. Keeps the
   *  Cancel button disabled (and re-labelled) while we wait
   *  for the terminal cancelled flip — a re-click would just
   *  fire a duplicate frame the receiver would silently drop. */
  @state() private _cancelRequested = false;

  /** Open the dialog targeting *pairing*, defaulting the
   *  configuration to the first device on the list (or empty
   *  if no devices are configured). The caller passes the
   *  target pin + display label; everything else is
   *  user-driven from there. */
  open(args: { pin_sha256: string; receiver_label: string }): void {
    this._pinSha256 = args.pin_sha256;
    this._receiverLabel = args.receiver_label;
    this._configuration = this._devices[0]?.configuration ?? "";
    this._target = JobType.COMPILE;
    this._jobId = "";
    this._errorMessage = "";
    this._cancelInFlight = false;
    this._cancelRequested = false;
    this._step = "input";
    this._open = true;
  }

  /** Open the dialog re-attached to an existing remote-build
   *  job, skipping the input form and landing directly on the
   *  running view. Used by settings-dialog's per-row "View
   *  build" affordance to let the user check on a running
   *  build (or last result) after closing the dialog without
   *  losing access to the live output buffer.
   *
   *  Display fields (configuration / target / receiver_label)
   *  come from the job entry itself; the entry was stamped
   *  on the original submit's success bubble through
   *  registerRemoteBuildJob, so a job that originated in this
   *  tab carries full display fields. A job whose state was
   *  observed only via wire events (events arrived before the
   *  ack landed, or a different tab dispatched it) carries
   *  empty display strings — the running view tolerates them
   *  and shows the live status / output regardless. */
  openForJob(job_id: string): void {
    const job = this._jobs?.get(job_id);
    if (!job) return;
    this._jobId = job_id;
    this._pinSha256 = job.pin_sha256;
    this._receiverLabel = job.receiver_label;
    this._configuration = job.configuration;
    this._target = job.target;
    this._errorMessage = "";
    this._cancelInFlight = false;
    // A re-attached job that's still non-terminal might already
    // have an in-flight cancel in another tab, but we've got no
    // visibility into that. Keep the button enabled and let the
    // receiver's idempotent silent-drop on duplicate cancel
    // (unknown-correlation path or terminal-job CommandError)
    // absorb a redundant click — same shape as the e2e
    // unknown-correlation test pins.
    this._cancelRequested = false;
    this._step = "running";
    this._open = true;
  }

  private _close = () => {
    // Idempotent: bound to the close-button @click AND the
    // wa-dialog @wa-after-hide, which fires when ?open flips
    // to false — so without this guard the second invocation
    // would re-fire the dismiss event. dismissRemoteBuildJob
    // is idempotent itself, but double-emitting an event the
    // parent listens to is observable and risks future
    // side-effects on subscribers.
    if (!this._open) return;
    // Closing on a terminal job (completed / failed /
    // cancelled) is the operator's "I've seen the result"
    // signal — drop the entry from buildOffloadJobsContext so
    // it doesn't accumulate forever. Closing on a still-
    // running job only hides this dialog; the receiver keeps
    // building and the job entry stays in the shared map
    // until it reaches a terminal state and is explicitly
    // dismissed.
    const job = this._job;
    if (job && isTerminalJobStatus(job.status)) {
      this.dispatchEvent(
        new CustomEvent("remote-build-job-dismissed", {
          bubbles: true,
          composed: true,
          detail: { job_id: job.job_id },
        }),
      );
    }
    this._open = false;
    this._errorMessage = "";
  };

  private get _job(): RemoteBuildJobState | undefined {
    return this._jobId ? this._jobs?.get(this._jobId) : undefined;
  }

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
    this._errorMessage = "";
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
        this._errorMessage = this._localize(
          "settings.remote_build_submit_rejected",
          { reason: result.reason ?? "" },
        );
        this._step = "input";
        return;
      }
      this._jobId = result.job_id;
      // Bubble the seed up so app-shell stamps the in-flight
      // jobs map's display fields. Wire frames don't carry
      // them; the progress view would otherwise read empty
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
        }),
      );
      this._step = "running";
    } catch (err) {
      this._errorMessage = this._formatSubmitError(err);
      this._step = "input";
    }
  };

  private _onCancel = async () => {
    if (
      this._api === undefined ||
      !this._pinSha256 ||
      !this._jobId ||
      this._cancelInFlight ||
      this._cancelRequested
    ) {
      return;
    }
    const job = this._job;
    if (job && isTerminalJobStatus(job.status)) return;
    this._errorMessage = "";
    this._cancelInFlight = true;
    try {
      const result = await this._api.cancelRemoteBuildJob({
        pin_sha256: this._pinSha256,
        job_id: this._jobId,
      });
      if (result.sent) {
        // Frame made it onto the peer-link wire. Lock the
        // button to "Cancel sent" while we wait for the
        // receiver's JOB_CANCELLED-driven flip through
        // OFFLOADER_JOB_STATE_CHANGED — a re-click would just
        // fire a duplicate frame the receiver silently drops
        // on the unknown-correlation path.
        this._cancelRequested = true;
      } else {
        // sent=false is the documented signal for a same-tick
        // Noise-encrypt / WS-send failure on the offloader
        // side. The receiver never saw the cancel, so locking
        // the button to "Cancel sent" would be a lie. Surface
        // it as a generic error and leave the button enabled
        // so the user can retry once the underlying transport
        // settles.
        this._errorMessage = this._localize(
          "settings.remote_build_cancel_generic_error",
        );
      }
    } catch (err) {
      this._errorMessage = this._formatCancelError(err);
    } finally {
      this._cancelInFlight = false;
    }
  };

  /** Render an error banner row, or ``nothing`` when *message*
   *  is empty. Centralises the field-error markup so the input
   *  step's submit-error, the running step's per-job
   *  ``error_message`` (terminal failures from the receiver),
   *  and the running step's local cancel-error all share one
   *  visual shape. */
  private _renderErrorBanner(message: string | undefined) {
    if (!message) return nothing;
    return html`<div class="field-error" role="alert">${message}</div>`;
  }

  private _formatCancelError(err: unknown): string {
    if (err instanceof APIError) {
      switch (err.errorCode) {
        case ErrorCode.PRECONDITION_FAILED:
          return this._localize(
            "settings.remote_build_cancel_precondition_failed",
          );
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
          return this._localize(
            "settings.remote_build_submit_precondition_failed",
          );
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
        <p class="empty">
          ${this._localize("settings.remote_build_submit_no_devices")}
        </p>
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
            (d) => html`<option value=${d.configuration}>${d.name}</option>`,
          )}
        </select>
      </div>
      <div class="field">
        <label for="rb-target">
          ${this._localize("settings.remote_build_submit_target_label")}
        </label>
        <select
          id="rb-target"
          .value=${this._target}
          @change=${this._onTargetChange}
        >
          <option value=${JobType.COMPILE}>
            ${this._localize("settings.remote_build_submit_target_compile")}
          </option>
          <option value=${JobType.UPLOAD}>
            ${this._localize("settings.remote_build_submit_target_upload")}
          </option>
        </select>
      </div>
      ${this._renderErrorBanner(this._errorMessage)}
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

  private _renderRunning() {
    const job = this._job;
    const status = job?.status ?? JobStatus.QUEUED;
    const terminal = isTerminalJobStatus(status);
    // Cancel hides on terminal status (the job's done; nothing
    // to cancel) and stays disabled during the cancel_job WS
    // round-trip and after a successful send while we wait for
    // the receiver's JOB_CANCELLED-driven status flip. Re-clicks
    // would just fire a duplicate frame the receiver silently
    // drops on the unknown-correlation path.
    const cancelDisabled = this._cancelInFlight || this._cancelRequested;
    const cancelLabelKey = this._cancelRequested
      ? "settings.remote_build_cancel_pending"
      : this._cancelInFlight
        ? "settings.remote_build_cancel_in_flight"
        : "settings.remote_build_cancel_action";
    return html`
      <div class="job-meta">
        <span class=${`status-pill status-${status}`}>
          ${this._localize(`settings.remote_build_status_${status}`)}
        </span>
        <span class="job-meta-line">
          ${job?.configuration || this._configuration} &middot;
          ${this._localize(`settings.remote_build_submit_target_${this._target}`)}
        </span>
      </div>
      ${this._renderErrorBanner(job?.error_message)}
      ${this._renderErrorBanner(this._errorMessage)}
      <div class="logs-container">
        <esphome-ansi-log
          .lines=${job?.output ?? []}
          ?light=${!this._darkMode}
        ></esphome-ansi-log>
      </div>
      <div class="actions">
        <button class="btn-secondary" type="button" @click=${this._close}>
          ${this._localize(
            terminal ? "layout.close" : "settings.remote_build_running_minimize",
          )}
        </button>
        ${terminal
          ? nothing
          : html`<button
              class="btn-danger"
              type="button"
              ?disabled=${cancelDisabled}
              @click=${this._onCancel}
            >
              ${this._localize(cancelLabelKey)}
            </button>`}
      </div>
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
      case "running":
        title = this._localize("settings.remote_build_running_title", {
          label: this._receiverLabel,
        });
        body = this._renderRunning();
        break;
    }
    // Gate light-dismiss while the submit_job WS round-trip
    // is in flight: outside-click / Esc / close-button can't
    // dismiss between the submit and the ack returning, which
    // would orphan the response (a successful ack would fire
    // remote-build-job-submitted against an already-closed
    // dialog). Mirrors pair-build-server-dialog's gate.
    const busy = this._step === "submitting";
    return html`
      <wa-dialog
        ?open=${this._open}
        ?light-dismiss=${!busy}
        @wa-request-close=${this._onRequestClose}
        @wa-after-hide=${this._close}
      >
        <header slot="label">${title}</header>
        <button
          class="dialog-close"
          slot="header-actions"
          aria-label=${this._localize("layout.close")}
          ?disabled=${busy}
          @click=${this._close}
        >
          ✕
        </button>
        ${body}
      </wa-dialog>
    `;
  }

  private _onRequestClose = (e: Event): void => {
    if (this._step === "submitting") {
      e.preventDefault();
    }
  };

  static styles = [
    espHomeStyles,
    inputStyles,
    dialogCloseButtonStyles,
    css`
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

      /* Destructive variant for the in-dialog Cancel-this-job
         button. Mirrors confirm-dialog's destructive btn tint
         without dragging the whole confirm-dialog style block in.
         The other two buttons in this dialog (.btn-primary /
         .btn-secondary) inherit browser-default chrome — leaving
         them alone here to keep the diff focused on the Cancel
         affordance; a button-style normalisation pass would be a
         separate cleanup. */
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

      .empty {
        color: var(--wa-color-neutral-500);
        margin: var(--wa-space-m) 0;
      }

      .job-meta {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        margin-bottom: var(--wa-space-s);
      }

      .job-meta-line {
        color: var(--wa-color-neutral-500);
        font-size: var(--wa-font-size-s);
      }

      .status-pill {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .status-queued,
      .status-running {
        background: color-mix(in srgb, var(--esphome-primary), transparent 80%);
        color: var(--esphome-primary);
      }

      .status-completed {
        background: color-mix(in srgb, var(--esphome-success), transparent 80%);
        color: var(--esphome-success);
      }

      .status-failed,
      .status-cancelled {
        background: color-mix(in srgb, var(--esphome-error), transparent 80%);
        color: var(--esphome-error);
      }

      .logs-container {
        height: 320px;
        overflow: hidden;
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
