import { consume } from "@lit/context";
import { mdiAlertCircleOutline, mdiClipboardTextOutline, mdiDownload } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  devicesContext,
  isHaAddonContext,
  localizeContext,
  serverVersionContext,
  versionContext,
} from "../context/index.js";
import { modalDialogStyles } from "../styles/modal-dialog.js";
import { espHomeStyles } from "../styles/shared.js";
import { copyToClipboard } from "../util/copy-to-clipboard.js";
import { notifyError, notifySuccess } from "../util/notify.js";
import {
  type CrashReport,
  type CrashScrape,
  buildFullReport,
  buildIssueUrl,
  distillValidatedConfig,
  platformFromIntegrations,
  scrapeCrashData,
} from "../util/crash-report.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { configurationStem, downloadBlob } from "../util/download-text.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./base-dialog.js";

registerMdiIcons({
  "alert-circle-outline": mdiAlertCircleOutline,
  "clipboard-text-outline": mdiClipboardTextOutline,
  download: mdiDownload,
});

// The backend caps `esphome config` at 60s; the margin covers WS latency.
const VALIDATE_TIMEOUT_MS = 90_000;

/**
 * "Report this crash" flow: scrape the log buffer handed over by the
 * logs dialog, capture the sanitized config via `devices/validate`,
 * then open a fully pre-filled esphome/esphome issue. The URL prefill
 * is the sole delivery channel (it survives GitHub's form rehydration;
 * manual pasting does not); truncated content stays available via the
 * downloadable report.
 */
@customElement("esphome-crash-report-dialog")
export class ESPHomeCrashReportDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @consume({ context: isHaAddonContext, subscribe: true })
  @state()
  private _isHaAddon = false;

  @consume({ context: serverVersionContext, subscribe: true })
  @state()
  private _serverVersion = "";

  @consume({ context: versionContext, subscribe: true })
  @state()
  private _esphomeVersion = "";

  private readonly _dialog = new DialogOpenController(this);

  @state()
  private _scrape: CrashScrape = scrapeCrashData([]);

  // null = validate still in flight (collecting phase); "" = config
  // unavailable (validation failed or empty); else the sanitized YAML.
  @state()
  private _configYaml: string | null = null;

  // Why the config is unavailable, so a transport failure reads
  // differently from a genuinely invalid config. "" once config is
  // present; "invalid" when validation rejected; "transport" when the
  // stream errored or stalled (a connection issue, not the user's YAML).
  @state()
  private _configError: "" | "invalid" | "transport" = "";

  // The user's own "what was the device doing" context; required before
  // the report can be sent — a crash report without it isn't actionable.
  @state()
  private _userDescription = "";

  // Set once the report was delivered (copied/downloaded) and the issue
  // opened; the dialog then stays up offering copy-again / download, so a
  // clipboard overwritten before the paste isn't a dead end.
  @state()
  private _delivered = false;

  // True when the whole report fit the pre-filled URL — no paste needed.
  @state()
  private _prefillComplete = false;

  private _configuration = "";
  private _name = "";
  // The rendered report backing the delivered-state re-copy / download.
  private _reportText = "";
  private _issueUrl = "";
  // Bumped per open(); a validate stream from a previous open must not
  // populate this session's config.
  private _session = 0;
  private _validateStreamId = "";
  // Handle for the validate-stall timeout, cleared alongside the stream so
  // a dialog closed/reopened mid-validate doesn't leave the timer to fire.
  private _validateTimer = 0;

  static styles = [
    espHomeStyles,
    modalDialogStyles,
    css`
      esphome-base-dialog {
        --width: 480px;
      }

      .collecting {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) 0;
        color: var(--wa-color-text-quiet);
      }

      .summary {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        margin: 0 0 var(--wa-space-m);
        padding: 0;
        list-style: none;
        font-size: var(--wa-font-size-s);
      }

      .summary li {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
      }

      .summary wa-icon {
        flex-shrink: 0;
        color: var(--esphome-primary);
      }

      .summary li.degraded {
        color: var(--wa-color-text-quiet);
      }

      .summary li.degraded wa-icon {
        color: var(--wa-color-warning-fill-loud, orange);
      }

      .hint {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
        margin: 0 0 var(--wa-space-s);
      }

      .describe-required {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-warning-fill-loud, orange);
        margin: 0 0 var(--wa-space-s);
      }

      .describe-label {
        display: block;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        margin: 0 0 var(--wa-space-2xs);
      }

      .describe-input {
        width: 100%;
        box-sizing: border-box;
        resize: vertical;
        font: inherit;
        font-size: var(--wa-font-size-s);
        padding: var(--wa-space-xs);
        border-radius: var(--wa-border-radius-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
        margin: 0 0 var(--wa-space-2xs);
      }

      .describe-note {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        margin: 0 0 var(--wa-space-m);
      }

      /* Primary-CTA colour only; shape and the disabled state come from
         modalDialogStyles' shared .btn / .btn:disabled. */
      .btn--confirm {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--confirm:hover:not(:disabled) {
        background: var(--esphome-primary-hover);
      }
    `,
  ];

  /** Open with a snapshot of the logs dialog's buffer. */
  public open(configuration: string, name: string, lines: string[]): void {
    this._stopValidateStream();
    this._configuration = configuration;
    this._name = name;
    this._session += 1;
    this._configYaml = null;
    this._configError = "";
    this._delivered = false;
    this._userDescription = "";
    this._reportText = "";
    this._issueUrl = "";
    this._scrape = scrapeCrashData(lines);
    this._dialog.open = true;
    this._captureConfig(this._session);
  }

  private _captureConfig(session: number): void {
    const collected: string[] = [];
    const finish = (yaml: string, error: "" | "invalid" | "transport") => {
      // Guard the session first: a stale stream's result must not clear the
      // timer a newer open() already armed for the current session.
      if (session !== this._session) return;
      clearTimeout(this._validateTimer);
      this._validateTimer = 0;
      this._validateStreamId = "";
      if (this._dialog.open) {
        this._configYaml = yaml;
        this._configError = error;
      }
    };
    // A stalled stream must not stick the spinner forever; a stall is a
    // transport issue, not the user's config.
    this._validateTimer = window.setTimeout(() => {
      if (session !== this._session) return;
      this._stopValidateStream();
      finish("", "transport");
    }, VALIDATE_TIMEOUT_MS);
    this._validateStreamId = this._api.validate(this._configuration, {
      onOutput: (line) => collected.push(line),
      onResult: (result) =>
        result.success
          ? finish(distillValidatedConfig(collected), "")
          : finish("", "invalid"),
      onError: (err) => {
        // A WS/transport failure, distinct from an invalid config; log it
        // and surface a "capture failed" note rather than "invalid".
        console.warn("Config validation stream failed", err);
        finish("", "transport");
      },
    });
  }

  // Kill an in-flight validate so an abandoned session doesn't leave the
  // backend's esphome config subprocess running to completion.
  private _stopValidateStream(): void {
    clearTimeout(this._validateTimer);
    this._validateTimer = 0;
    if (!this._validateStreamId) return;
    void this._api
      .stopStream(this._validateStreamId)
      .catch((err) => console.warn("Failed to stop the validate stream", err));
    this._validateStreamId = "";
  }

  private _buildReport(): CrashReport {
    const device = this._devices.find((d) => d.configuration === this._configuration);
    return {
      scrape: this._scrape,
      configYaml: this._configYaml ?? "",
      userDescription: this._userDescription.trim(),
      meta: {
        deviceName: this._name,
        configuration: this._configuration,
        esphomeVersion: device?.current_version || this._esphomeVersion,
        deployedVersion: device?.runtime_state.deployed_version ?? "",
        dashboardVersion: this._serverVersion,
        // Plain-ESP32 sidecars can leave target_platform empty; the
        // integration list always names the platform component.
        targetPlatform:
          device?.target_platform ||
          platformFromIntegrations(device?.loaded_integrations ?? []),
        board: device?.board_id ?? "",
        installation: this._detectInstallation(),
      },
    };
  }

  // Maps the deployment signals onto the bug form's installation
  // dropdown. Unknown ("" — the desktop app, or before the handshake
  // populates serverInfo) omits the fact so the value isn't guessed.
  private _detectInstallation(): string {
    if (this._isHaAddon) return "Home Assistant Add-on";
    const info = this._api.serverInfo;
    // Unknown (no serverInfo, desktop app, or a backend that predates
    // in_docker) omits the fact rather than guessing pip vs Docker.
    if (!info || info.desktop_version || info.in_docker === undefined) return "";
    return info.in_docker ? "Docker" : "pip";
  }

  // Download the full report first — the user always keeps a complete
  // copy even if the pre-fill was truncated — then open the issue. The
  // dialog stays open so the download / copy / issue link stay one click
  // away until the user closes it themselves. window.open with noopener
  // returns null by spec, so blocking can't be detected here; the manual
  // "Open GitHub issue" link in the delivered state is the fallback.
  // Arrow properties: used directly as @click handlers, so `this` must
  // stay the dialog instance (repo convention for handlers).
  private _openIssue = (): void => {
    const report = this._buildReport();
    this._reportText = buildFullReport(report);
    const { url, complete } = buildIssueUrl(report);
    this._issueUrl = url;
    this._prefillComplete = complete;
    this._downloadReport();
    window.open(url, "_blank", "noopener");
    this._delivered = true;
  };

  private _downloadReport = (): void => {
    const stem = configurationStem(this._configuration, "device");
    downloadBlob(this._reportText, `${stem}-crash-report.md`, "text/markdown");
  };

  private _copyReport = async (): Promise<void> => {
    if (await copyToClipboard(this._reportText)) {
      notifySuccess(this._localize("crash_report.copied"));
    } else {
      notifyError(this._localize("crash_report.copy_failed"));
    }
  };

  private _renderSummaryRow(text: string, degraded: boolean) {
    return html`<li class=${degraded ? "degraded" : ""}>
      <wa-icon
        library="mdi"
        name=${degraded ? "alert-circle-outline" : "clipboard-text-outline"}
      ></wa-icon>
      <span>${text}</span>
    </li>`;
  }

  private _renderDelivered() {
    return html`
      <p class="hint">
        ${this._localize(
          this._prefillComplete
            ? "crash_report.delivered_hint_complete"
            : "crash_report.delivered_hint"
        )}
      </p>
      <div class="actions">
        <button class="btn btn--cancel" @click=${() => (this._dialog.open = false)}>
          ${this._localize("layout.close")}
        </button>
        <button class="btn btn--cancel" @click=${this._copyReport}>
          ${this._localize("crash_report.copy_report")}
        </button>
        <button class="btn btn--cancel" @click=${this._downloadReport}>
          <wa-icon library="mdi" name="download"></wa-icon>
          ${this._localize("crash_report.download_report")}
        </button>
        <a
          class="btn btn--confirm"
          href=${this._issueUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          ${this._localize("crash_report.open_issue")}
        </a>
      </div>
    `;
  }

  private _onDescriptionInput = (e: Event): void => {
    this._userDescription = (e.target as HTMLTextAreaElement).value;
  };

  private _renderReady() {
    const scrape = this._scrape;
    const decoded = scrape.decodedFrames.length > 0;
    const configFailed = this._configYaml === "";
    const described = this._userDescription.trim() !== "";
    return html`
      <label class="describe-label" for="crash-description"
        >${this._localize("crash_report.describe_label")}</label
      >
      <textarea
        id="crash-description"
        class="describe-input"
        rows="3"
        aria-describedby="crash-description-note"
        placeholder=${this._localize("crash_report.describe_placeholder")}
        .value=${this._userDescription}
        @input=${this._onDescriptionInput}
      ></textarea>
      <p id="crash-description-note" class="describe-note">
        ${this._localize("crash_report.describe_english")}
      </p>
      <ul class="summary">
        ${this._renderSummaryRow(
          this._localize(
            !scrape.crashFound
              ? "crash_report.crash_scrolled_out"
              : decoded
                ? "crash_report.includes_backtrace_decoded"
                : "crash_report.includes_backtrace_raw"
          ),
          !scrape.crashFound || !decoded
        )}
        ${this._renderSummaryRow(
          this._localize("crash_report.includes_log_lines", {
            warnings: String(scrape.warnings.length),
            config: String(scrape.configLines.length),
          }),
          false
        )}
        ${this._renderSummaryRow(
          this._localize(
            this._configError === "transport"
              ? "crash_report.config_capture_failed"
              : configFailed
                ? "crash_report.config_unavailable"
                : "crash_report.includes_config"
          ),
          configFailed
        )}
      </ul>
      <p class="hint">${this._localize("crash_report.hint")}</p>
      ${
        described
          ? nothing
          : html`<p class="describe-required" role="status">
              ${this._localize("crash_report.describe_required")}
            </p>`
      }
      <div class="actions">
        <button class="btn btn--cancel" @click=${() => (this._dialog.open = false)}>
          ${this._localize("layout.cancel")}
        </button>
        <button
          class="btn btn--confirm"
          ?disabled=${!described}
          @click=${this._openIssue}
        >
          <wa-icon library="mdi" name="download"></wa-icon>
          ${this._localize("crash_report.download_and_open")}
        </button>
      </div>
    `;
  }

  private _onAfterHide = (): void => {
    this._dialog.open = false;
    this._stopValidateStream();
  };

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("crash_report.title", { name: this._name })}
        @request-close=${this._dialog.onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        ${
          this._configYaml === null
            ? html`<div class="collecting">
                <wa-spinner></wa-spinner>
                <span>${this._localize("crash_report.collecting")}</span>
              </div>`
            : this._delivered
              ? this._renderDelivered()
              : this._renderReady()
        }
      </esphome-base-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-crash-report-dialog": ESPHomeCrashReportDialog;
  }
}
