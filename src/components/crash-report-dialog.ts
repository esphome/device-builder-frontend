import { consume } from "@lit/context";
import { mdiAlertCircleOutline, mdiClipboardTextOutline, mdiDownload } from "@mdi/js";
import { html, LitElement } from "lit";
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
  isFilableTitle,
  MAX_TITLE_LENGTH,
  MIN_TITLE_LENGTH,
  suggestTitleFor,
} from "../util/crash-report-title.js";
import {
  buildFullReport,
  buildIssueUrl,
  type CrashReport,
  type CrashReportMeta,
  type CrashScrape,
  issuePlatform,
  platformFromIntegrations,
  scrapeCrashData,
} from "../util/crash-report.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { configurationStem, downloadBlob } from "../util/download-text.js";
import { detectInstallation } from "../util/installation.js";
import { captureMaskedConfig } from "../util/masked-config-capture.js";
import { notifyError, notifySuccess } from "../util/notify.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { crashReportDialogStyles } from "./crash-report-dialog.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./base-dialog.js";

registerMdiIcons({
  "alert-circle-outline": mdiAlertCircleOutline,
  "clipboard-text-outline": mdiClipboardTextOutline,
  download: mdiDownload,
});

// Ids the required-field warnings render under, so each field's
// aria-describedby can point at the one that belongs to it.
const TITLE_ERROR_ID = "crash-title-error";
const DESCRIBE_ERROR_ID = "crash-description-error";

/**
 * "Report this crash" flow: scrape the log buffer handed over by the
 * logs dialog, read the device's YAML and mask its credentials, then
 * open a fully pre-filled esphome/esphome issue. The URL prefill
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

  // null = config read still in flight (collecting phase); "" = config
  // unavailable (read failed); else the masked editor YAML.
  @state()
  private _configYaml: string | null = null;

  // The user's own "what was the device doing" context; required before
  // the report can be sent — a crash report without it isn't actionable.
  @state()
  private _userDescription = "";

  // The issue title, seeded from the crash location on open() and editable.
  // Required, so a crash whose frames decode to nothing can't be filed
  // under a title every other report already shares.
  @state()
  private _userTitle = "";

  // Whether the crash decoded to a location worth naming, so the note under
  // the field doesn't claim a suggestion in the empty case it exists for.
  @state()
  private _titleSuggested = false;

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
  // The log viewer's decode is what knows the build was stale; read only when
  // the report is built on click, so it drives no render.
  private _staleBuild = false;
  // The rendered report backing the delivered-state re-copy / download.
  private _reportText = "";
  private _issueUrl = "";
  // Bumped per open(); a config read from a previous open must not
  // populate this session's config.
  private _session = 0;

  static styles = [espHomeStyles, modalDialogStyles, crashReportDialogStyles];

  /** Open with a snapshot of the logs dialog's buffer. */
  public open(
    configuration: string,
    name: string,
    lines: string[],
    staleBuild = false
  ): void {
    this._configuration = configuration;
    this._name = name;
    this._session += 1;
    this._configYaml = null;
    this._delivered = false;
    this._userDescription = "";
    this._reportText = "";
    this._issueUrl = "";
    this._scrape = scrapeCrashData(lines);
    this._staleBuild = staleBuild;
    this._userTitle = suggestTitleFor(
      this._scrape,
      issuePlatform(this._buildMeta().targetPlatform)
    );
    this._titleSuggested = this._userTitle !== "";
    this._dialog.open = true;
    void this._captureConfig(this._session);
  }

  private async _captureConfig(session: number): Promise<void> {
    const masked = await captureMaskedConfig(
      this._api,
      this._configuration,
      () => session !== this._session || !this._dialog.open
    );
    if (masked !== null) this._configYaml = masked;
  }

  private _buildReport(): CrashReport {
    return {
      scrape: this._scrape,
      configYaml: this._configYaml ?? "",
      userDescription: this._userDescription.trim(),
      userTitle: this._userTitle.trim(),
      staleBuild: this._staleBuild,
      meta: this._buildMeta(),
    };
  }

  // Split out of _buildReport so open() can seed the title suggestion,
  // which needs the platform, before any of the report exists.
  private _buildMeta(): CrashReportMeta {
    const device = this._devices.find((d) => d.configuration === this._configuration);
    return {
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
      installation: detectInstallation(this._api, this._isHaAddon),
    };
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

  private _onTitleInput = (e: Event): void => {
    this._userTitle = (e.target as HTMLInputElement).value;
  };

  // The warning each required field still owes, as its localize key; ""
  // once the field passes. One source drives the warnings, the fields'
  // invalid state and the confirm gate, so none can disagree.
  private get _missing(): { title: string; description: string } {
    // A title that is present but too brief gets its own message: the
    // empty-field wording leaves the user retyping variations with no hint
    // that length is the problem.
    return {
      title: isFilableTitle(this._userTitle)
        ? ""
        : this._userTitle.trim()
          ? "crash_report.title_too_short"
          : "crash_report.title_required",
      description: this._userDescription.trim() ? "" : "crash_report.describe_required",
    };
  }

  // The two required fields. Split out because the dialog's render was past
  // the ~100-line mark the README treats as the signal to extract.
  private _renderFields(missing: { title: string; description: string }) {
    // String-attribute aria form per CLAUDE.md — Lit's `?aria-` boolean
    // binding drops the attribute on false, losing the announcement.
    // The error id doubles as the flag: a field is invalid exactly when it
    // has a warning to point at, so the two can't be wired up separately.
    const titleError = missing.title ? TITLE_ERROR_ID : "";
    const describeError = missing.description ? DESCRIBE_ERROR_ID : "";
    const describedBy = (note: string, error: string) =>
      error ? `${note} ${error}` : note;
    return html`
      <label class="describe-label" for="crash-title"
        >${this._localize("crash_report.title_label")}</label
      >
      <input
        id="crash-title"
        class="describe-input"
        type="text"
        maxlength=${MAX_TITLE_LENGTH}
        aria-invalid=${titleError ? "true" : "false"}
        aria-describedby=${describedBy("crash-title-note", titleError)}
        placeholder=${this._localize("crash_report.title_placeholder")}
        .value=${this._userTitle}
        @input=${this._onTitleInput}
      />
      <p id="crash-title-note" class="describe-note">
        ${this._localize(
          this._titleSuggested
            ? "crash_report.title_note"
            : "crash_report.title_note_undecoded"
        )}
      </p>
      <label class="describe-label" for="crash-description"
        >${this._localize("crash_report.describe_label")}</label
      >
      <textarea
        id="crash-description"
        class="describe-input"
        rows="3"
        aria-invalid=${describeError ? "true" : "false"}
        aria-describedby=${describedBy("crash-description-note", describeError)}
        placeholder=${this._localize("crash_report.describe_placeholder")}
        .value=${this._userDescription}
        @input=${this._onDescriptionInput}
      ></textarea>
      <p id="crash-description-note" class="describe-note">
        ${this._localize("crash_report.describe_english")}
      </p>
    `;
  }

  private _renderReady() {
    const scrape = this._scrape;
    const decoded = scrape.decodedFrames.length > 0;
    const configFailed = this._configYaml === "";
    const missing = this._missing;
    const warnings = [
      { id: TITLE_ERROR_ID, key: missing.title },
      { id: DESCRIBE_ERROR_ID, key: missing.description },
    ].filter((warning) => warning.key);
    return html`
      ${this._renderFields(missing)}
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
              ? "crash_report.config_capture_failed"
              : "crash_report.includes_config"
          ),
          configFailed
        )}
      </ul>
      <p class="hint">${this._localize("crash_report.hint")}</p>
      ${warnings.map(
        ({ id, key }) =>
          html`<p id=${id} class="describe-required" role="status">
            ${this._localize(key, { min: String(MIN_TITLE_LENGTH) })}
          </p>`
      )}
      <div class="actions">
        <button class="btn btn--cancel" @click=${() => (this._dialog.open = false)}>
          ${this._localize("layout.cancel")}
        </button>
        <button
          class="btn btn--confirm"
          ?disabled=${warnings.length > 0}
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
