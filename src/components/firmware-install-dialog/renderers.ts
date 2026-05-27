import { html, nothing, type TemplateResult } from "lit";
import { JobSource } from "../../api/types.js";
import { splitTemplate } from "../../util/template-split.js";
import { renderRemoteBuildFailureSuggestion } from "../remote-build-hint.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";

// Matches the receiver-side _fail_locally "peer-link session lost" shape from
// the backend's remote_runner. Substring match because the wire is free-form.
function isPeerLinkSessionLostError(message: string): boolean {
  return message.includes("peer-link session lost");
}

function renderValidationFailureSuggestion(
  host: ESPHomeFirmwareInstallDialog
): TemplateResult {
  const text = host._localize("command.validation_failed_suggestion");
  const [before, after] = splitTemplate(text, "{editor_action}");
  return html`
    <div class="reset-suggestion" role="status">
      ${before}<button class="reset-suggestion-link" @click=${host._tryOpenInEditor}>
        ${host._localize("command.try_open_editor_button")}</button
      >${after}
    </div>
  `;
}

// C++ build failure → clean (surgical) → reset (nuclear) staircase.
// REMOTE-sourced jobs drop the link half — firmware/reset_build_env wipes
// the LOCAL toolchain cache, which doesn't help when the broken cache is
// on the paired receiver. Per esphome/device-builder#608 we deliberately
// don't fan reset out to receivers; the operator-action model handles it.
function renderBuildFailureSuggestion(
  host: ESPHomeFirmwareInstallDialog
): TemplateResult {
  if (host._jobSource === JobSource.REMOTE && host._jobSourceLabel) {
    return renderRemoteBuildFailureSuggestion(host, host._jobSourceLabel);
  }
  const text = host._localize("command.try_reset_suggestion");
  const [before, middle, after] = splitTemplate(text, "{clean_action}", "{reset_action}");
  return html`
    <div class="reset-suggestion" role="status">
      ${before}<button class="reset-suggestion-link" @click=${host._tryCleanBuild}>
        ${host._localize("command.try_clean_button")}</button
      >${middle}<button class="reset-suggestion-link" @click=${host._tryResetBuildEnv}>
        ${host._localize("command.try_reset_button")}</button
      >${after}
    </div>
  `;
}

// Compile-step failure hint. Validation → editor. Receiver-session-lost →
// skip (build env was fine, connection wasn't). C++ build → clean/reset.
function renderResetSuggestion(
  host: ESPHomeFirmwareInstallDialog
): TemplateResult | typeof nothing {
  if (!host._failedDuringCompile) return nothing;
  if (host._failedDuringValidate) return renderValidationFailureSuggestion(host);
  if (isPeerLinkSessionLostError(host._errorMessage)) return nothing;
  return renderBuildFailureSuggestion(host);
}

export function renderStatus(host: ESPHomeFirmwareInstallDialog): TemplateResult {
  if (host._step === "done") {
    return html`
      <div class="status">
        <wa-icon
          class="status-icon status-icon--success"
          library="mdi"
          name="check-circle"
        ></wa-icon>
        <span class="status-text">${host._statusMessage}</span>
      </div>
    `;
  }
  if (host._step === "download-ready") {
    const filename = host._downloadedFilename;
    // Manual binary download: just acknowledge the file — no web.esphome.io checklist.
    if (host._installer === "binary-download") {
      return html`
        <div class="status">
          <wa-icon
            class="status-icon status-icon--success"
            library="mdi"
            name="check-circle"
          ></wa-icon>
          <span class="status-text"
            >${host._localize("firmware.binary_download_done_title")}</span
          >
          <span class="status-detail"
            >${host._localize("firmware.binary_download_done_body", { filename })}</span
          >
        </div>
      `;
    }
    return html`
      <div class="status">
        <wa-icon
          class="status-icon status-icon--success"
          library="mdi"
          name="check-circle"
        ></wa-icon>
        <span class="status-text"
          >${host._localize("firmware.web_download_done_title")}</span
        >
        <span class="status-detail"
          >${host._localize("firmware.web_download_done_body", { filename })}</span
        >
      </div>
      <ol class="instructions">
        <li>${host._localize("firmware.web_download_step_open")}</li>
        <li>${host._localize("firmware.web_download_step_connect")}</li>
        <li>${host._localize("firmware.web_download_step_install", { filename })}</li>
      </ol>
      <p class="instructions-note">
        ${host._localize("dashboard.install_method_web_download_desc")}
      </p>
    `;
  }
  if (host._step === "error") {
    return html`
      <div class="status">
        <wa-icon
          class="status-icon status-icon--error"
          library="mdi"
          name="alert-circle"
        ></wa-icon>
        <span class="status-text">${host._statusMessage}</span>
        ${host._errorMessage
          ? html`<span class="status-detail">${host._errorMessage}</span>`
          : nothing}
      </div>
      ${renderResetSuggestion(host)}
    `;
  }
  return html`
    <div class="status">
      <wa-spinner></wa-spinner>
      <span class="status-text">${host._statusMessage}</span>
    </div>
  `;
}

export function renderProgress(
  host: ESPHomeFirmwareInstallDialog
): TemplateResult | typeof nothing {
  if (host._step !== "flashing") return nothing;
  return html`
    <div class="progress-bar">
      <div class="progress-bar-fill" style="width:${host._flashPercent}%"></div>
    </div>
  `;
}

export function renderLogs(
  host: ESPHomeFirmwareInstallDialog
): TemplateResult | typeof nothing {
  if (host._logLines.length === 0) return nothing;
  return html`
    <div class="logs-header">
      <button
        class="logs-toggle"
        @click=${() => {
          host._logsExpanded = !host._logsExpanded;
        }}
      >
        <wa-icon
          library="mdi"
          name=${host._logsExpanded ? "chevron-up" : "chevron-down"}
        ></wa-icon>
        ${host._logsExpanded
          ? host._localize("firmware.hide_details")
          : host._localize("firmware.show_details")}
      </button>
    </div>
    ${host._logsExpanded
      ? html`<div class="logs-container">
          <esphome-ansi-log
            .lines=${host._logLines}
            ?light=${!host._darkMode}
          ></esphome-ansi-log>
        </div>`
      : nothing}
  `;
}

export function renderFooter(host: ESPHomeFirmwareInstallDialog): TemplateResult {
  const isRunning =
    host._step !== "done" && host._step !== "error" && host._step !== "download-ready";
  if (isRunning) {
    // Web Serial only — installWebDownload doesn't connect to a device.
    const showToggle = host._installer === "web-serial";
    return html`
      <div class="footer">
        ${showToggle
          ? html`<button
              class="btn btn--ghost ${host._showLogsAfterInstall ? "is-active" : ""}"
              @click=${host._toggleShowLogsAfterInstall}
              aria-pressed=${host._showLogsAfterInstall ? "true" : "false"}
              title=${host._localize("command.show_logs_after_install_tooltip")}
            >
              <wa-icon library="mdi" name="console"></wa-icon>
              ${host._localize("command.show_logs_after_install")}
            </button>`
          : nothing}
        <button class="btn btn--ghost" @click=${host._cancel}>
          ${host._localize("command.stop")}
        </button>
      </div>
    `;
  }
  if (host._step === "download-ready") {
    if (host._installer === "binary-download") {
      return html`
        <div class="footer">
          <button class="btn btn--primary" @click=${host._close}>
            ${host._localize("command.close")}
          </button>
        </div>
      `;
    }
    return html`
      <div class="footer">
        <button class="btn btn--ghost" @click=${host._close}>
          ${host._localize("command.close")}
        </button>
        <a
          class="btn btn--primary"
          href="https://web.esphome.io"
          target="_blank"
          rel="noopener noreferrer"
        >
          ${host._localize("firmware.web_download_open_button")}
        </a>
      </div>
    `;
  }
  // Web Serial install success — surface "Logs" so users can flip back after
  // they've clicked logs-dialog's "Back to install". _detected survives
  // _onClose but not _close, so the button only renders while the SerialPort
  // reference is still around.
  const canShowLogs =
    host._installer === "web-serial" && host._step === "done" && host._detected !== null;
  return html`
    <div class="footer">
      ${canShowLogs
        ? html`<button class="btn btn--primary" @click=${host._showLogsAgain}>
              <wa-icon library="mdi" name="console"></wa-icon>
              ${host._localize("command.show_logs")}
            </button>
            <button class="btn btn--ghost" @click=${host._close}>
              ${host._localize("command.close")}
            </button>`
        : html`<button class="btn btn--primary" @click=${host._close}>
            ${host._localize("command.close")}
          </button>`}
    </div>
  `;
}
