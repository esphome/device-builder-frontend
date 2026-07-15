import { consume } from "@lit/context";
import { mdiAlertCircleOutline, mdiClipboardTextOutline, mdiDownload } from "@mdi/js";
import { LitElement, css, html } from "lit";
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
import {
  type CrashReport,
  type CrashScrape,
  buildFullReport,
  buildIssueUrl,
  distillValidatedConfig,
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

/**
 * "Report this crash" flow: scrape the log buffer handed over by the
 * logs dialog, capture the sanitized config via `devices/validate`,
 * then copy the full report to the clipboard and open a pre-filled
 * esphome/esphome issue.
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

  @state()
  private _copyFailed = false;

  private _configuration = "";
  private _name = "";
  // Bumped per open(); a validate stream from a previous open must not
  // populate this session's config.
  private _session = 0;
  private _validateStreamId = "";

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

      .btn--confirm {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--confirm:hover {
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
    this._copyFailed = false;
    this._scrape = scrapeCrashData(lines);
    this._dialog.open = true;
    this._captureConfig(this._session);
  }

  private _captureConfig(session: number): void {
    const collected: string[] = [];
    const finish = (yaml: string) => {
      if (session !== this._session) return;
      this._validateStreamId = "";
      if (this._dialog.open) this._configYaml = yaml;
    };
    this._validateStreamId = this._api.validate(this._configuration, {
      onOutput: (line) => collected.push(line),
      onResult: (result) =>
        finish(result.success ? distillValidatedConfig(collected) : ""),
      onError: () => finish(""),
    });
  }

  // Kill an in-flight validate so an abandoned session doesn't leave the
  // backend's esphome config subprocess running to completion.
  private _stopValidateStream(): void {
    if (!this._validateStreamId) return;
    void this._api.stopStream(this._validateStreamId).catch(() => undefined);
    this._validateStreamId = "";
  }

  private _buildReport(): CrashReport {
    const device = this._devices.find((d) => d.configuration === this._configuration);
    return {
      scrape: this._scrape,
      configYaml: this._configYaml ?? "",
      meta: {
        deviceName: this._name,
        configuration: this._configuration,
        esphomeVersion: device?.current_version || this._esphomeVersion,
        deployedVersion: device?.runtime_state.deployed_version ?? "",
        dashboardVersion: this._serverVersion,
        targetPlatform: device?.target_platform ?? "",
        board: device?.board_id ?? "",
        isHaAddon: this._isHaAddon,
      },
    };
  }

  private async _copyAndOpen(): Promise<void> {
    const report = this._buildReport();
    if (!(await copyToClipboard(buildFullReport(report)))) {
      this._copyFailed = true;
      return;
    }
    this._openIssue(report, "clipboard");
  }

  private _downloadAndOpen(): void {
    const report = this._buildReport();
    const stem = configurationStem(this._configuration, "device");
    downloadBlob(buildFullReport(report), `${stem}-crash-report.md`, "text/markdown");
    this._openIssue(report, "download");
  }

  private _openIssue(report: CrashReport, delivery: "clipboard" | "download"): void {
    window.open(buildIssueUrl(report, delivery), "_blank", "noopener");
    this._dialog.open = false;
  }

  private _renderSummaryRow(text: string, degraded: boolean) {
    return html`<li class=${degraded ? "degraded" : ""}>
      <wa-icon
        library="mdi"
        name=${degraded ? "alert-circle-outline" : "clipboard-text-outline"}
      ></wa-icon>
      <span>${text}</span>
    </li>`;
  }

  private _renderReady() {
    const scrape = this._scrape;
    const decoded = scrape.decodedFrames.length > 0;
    const configFailed = this._configYaml === "";
    return html`
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
            configFailed
              ? "crash_report.config_unavailable"
              : "crash_report.includes_config"
          ),
          configFailed
        )}
      </ul>
      <p class="hint">
        ${this._localize(
          this._copyFailed ? "crash_report.copy_failed_hint" : "crash_report.hint"
        )}
      </p>
      <div class="actions">
        <button class="btn btn--cancel" @click=${() => (this._dialog.open = false)}>
          ${this._localize("layout.cancel")}
        </button>
        ${
          this._copyFailed
            ? html`<button class="btn btn--confirm" @click=${this._downloadAndOpen}>
                <wa-icon library="mdi" name="download"></wa-icon>
                ${this._localize("crash_report.download_and_open")}
              </button>`
            : html`<button class="btn btn--confirm" @click=${this._copyAndOpen}>
                ${this._localize("crash_report.copy_and_open")}
              </button>`
        }
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
