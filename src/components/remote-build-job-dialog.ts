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
 * Cancellation while running isn't supported here; the
 * cancel_job reverse-direction control message is deferred
 * to phase 5d. Closing the dialog mid-build leaves the job
 * running on the receiver; the user can re-open to see
 * live progress until terminal.
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
    this._step = "input";
    this._open = true;
  }

  private _close = () => {
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
      ${this._errorMessage
        ? html`<div class="field-error" role="alert">
            ${this._errorMessage}
          </div>`
        : nothing}
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
      ${job?.error_message
        ? html`<div class="field-error" role="alert">${job.error_message}</div>`
        : nothing}
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
