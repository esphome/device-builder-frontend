import { html, nothing, type TemplateResult } from "lit";
import { type FirmwareBinary, JobSource } from "../../api/types/firmware-jobs.js";
import { configurationStem, downloadAnsiText } from "../../util/download-text.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import type { ProcessTerminalState } from "../process-terminal/process-terminal.js";
import {
  renderBuildFailureSuggestion,
  renderValidationFailureSuggestion,
} from "../process-terminal/reset-suggestion.js";

// Map the backend's stable artifact `type` to a localized label, falling back
// to the platform-supplied text when there's no translation — an unknown type
// or an untranslated key. _localize returns the key unchanged when it misses,
// so a result equal to the key means "no translation, use the backend text".
function localizedOrBackend(
  host: ESPHomeFirmwareInstallDialog,
  key: string,
  fallback: string | undefined
): string | undefined {
  const value = host._localize(key);
  return value === key ? fallback : value;
}

function artifactTitle(
  host: ESPHomeFirmwareInstallDialog,
  binary: FirmwareBinary
): string {
  if (!binary.type) return binary.title;
  return (
    localizedOrBackend(host, `firmware.download_type_${binary.type}`, binary.title) ??
    binary.title
  );
}

function artifactDescription(
  host: ESPHomeFirmwareInstallDialog,
  binary: FirmwareBinary
): string | undefined {
  if (!binary.type) return binary.description;
  return localizedOrBackend(
    host,
    `firmware.download_type_${binary.type}_desc`,
    binary.description
  );
}

// Matches the receiver-side _fail_locally "peer-link session lost" shape from
// the backend's remote_runner. Substring match because the wire is free-form.
function isPeerLinkSessionLostError(message: string): boolean {
  return message.includes("peer-link session lost");
}

// Compile-step failure hint. Validation → editor. Receiver-session-lost →
// skip (build env was fine, connection wasn't). C++ build → clean/reset, or
// the remote variant when the failed compile ran on a paired receiver. The
// markup lives in the shared reset-suggestion module so command-dialog and
// this dialog stay in lockstep.
export function renderResetSuggestion(
  host: ESPHomeFirmwareInstallDialog
): TemplateResult | typeof nothing {
  if (!host._failedDuringCompile) return nothing;
  if (host._failedDuringValidate) return renderValidationFailureSuggestion(host);
  if (isPeerLinkSessionLostError(host._errorMessage)) return nothing;
  const remoteLabel =
    host._jobSource === JobSource.REMOTE && host._jobSourceLabel
      ? host._jobSourceLabel
      : null;
  return renderBuildFailureSuggestion(host, remoteLabel);
}

// ── card status mapping ──────────────────────────────────────────────
// The <esphome-process-terminal> card renders the spinner / success / error
// icon from `state` plus the bold message and quiet detail; these helpers
// resolve those three values for each install step. The choose-binary and
// download-ready screens have no status icon — their bespoke bodies render in
// the status-extra slot below.

export function cardState(host: ESPHomeFirmwareInstallDialog): ProcessTerminalState {
  switch (host._step) {
    case "choose-binary":
      return null;
    case "download-ready":
    case "done":
      return "success";
    case "error":
      return "error";
    case "connecting":
    case "queued":
    case "installing":
    case "compiling":
    case "flashing":
    case "downloading":
      return "running";
    default:
      // Exhaustive: adding an InstallStep without mapping it here is a
      // compile error (host._step is no longer narrowed to never).
      return host._step satisfies never;
  }
}

function downloadReadyTitle(host: ESPHomeFirmwareInstallDialog): string {
  if (host._installer === "binary-download") {
    const isElf = host._downloadedFilename.endsWith(".elf");
    return host._localize(
      isElf ? "firmware.elf_download_done_title" : "firmware.binary_download_done_title"
    );
  }
  return host._localize("firmware.web_download_done_title");
}

function downloadReadyDetail(host: ESPHomeFirmwareInstallDialog): string {
  const filename = host._downloadedFilename;
  if (host._installer === "binary-download") {
    const isElf = filename.endsWith(".elf");
    return host._localize(
      isElf ? "firmware.elf_download_done_body" : "firmware.binary_download_done_body",
      { filename }
    );
  }
  return host._localize("firmware.web_download_done_body", { filename });
}

export function cardStatusMessage(host: ESPHomeFirmwareInstallDialog): string {
  if (host._step === "choose-binary") {
    return host._localize("firmware.choose_binary_title");
  }
  if (host._step === "download-ready") return downloadReadyTitle(host);
  return host._statusMessage;
}

export function cardStatusDetail(host: ESPHomeFirmwareInstallDialog): string {
  if (host._step === "choose-binary") {
    return host._localize("firmware.choose_binary_desc");
  }
  if (host._step === "download-ready") return downloadReadyDetail(host);
  if (host._step === "error") return host._errorMessage;
  return "";
}

// ── status-extra slot ────────────────────────────────────────────────
// Bespoke bodies that don't fit the standard status block: the binary-format
// picker (choose-binary), the web-flasher instructions / "choose another
// format" link (download-ready), and the collapsible compile / esptool log.

function renderBinaryList(host: ESPHomeFirmwareInstallDialog): TemplateResult {
  return html`
    <div class="binary-list">
      ${host._binaries.map((binary) => {
        const desc = artifactDescription(host, binary);
        return html`
          <button
            type="button"
            class="binary-option"
            @click=${() => host._onChooseBinary(binary.file)}
          >
            <span class="title">${artifactTitle(host, binary)}</span>
            ${desc ? html`<span class="desc">${desc}</span>` : nothing}
          </button>
        `;
      })}
    </div>
  `;
}

function renderDownloadReadyExtra(
  host: ESPHomeFirmwareInstallDialog
): TemplateResult | typeof nothing {
  // Manual binary download: offer to pick a different format when more than
  // one was produced. The ELF is debug symbols, not a flashable image, so no
  // web.esphome.io checklist here.
  if (host._installer === "binary-download") {
    return host._binaries.length > 1
      ? html`<button
          type="button"
          class="reset-suggestion-link"
          @click=${() => (host._step = "choose-binary")}
        >
          ${host._localize("firmware.choose_binary_again")}
        </button>`
      : nothing;
  }
  const filename = host._downloadedFilename;
  return html`
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

export function renderStatusExtra(
  host: ESPHomeFirmwareInstallDialog
): TemplateResult | typeof nothing {
  const binaryList = host._step === "choose-binary" ? renderBinaryList(host) : nothing;
  const downloadExtra =
    host._step === "download-ready" ? renderDownloadReadyExtra(host) : nothing;
  const logs = renderLogs(host);
  // Skip the slotted wrapper entirely when there's nothing to show, so the
  // card doesn't carry an empty element.
  if (binaryList === nothing && downloadExtra === nothing && logs === nothing) {
    return nothing;
  }
  return html`<div slot="status-extra">${binaryList} ${downloadExtra} ${logs}</div>`;
}

function downloadInstallLogs(host: ESPHomeFirmwareInstallDialog): void {
  const stem = configurationStem(host._device?.configuration, "install");
  downloadAnsiText(host._logLines, `${stem}-install.txt`);
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
      <button class="logs-toggle" @click=${() => downloadInstallLogs(host)}>
        <wa-icon library="mdi" name="download"></wa-icon>
        ${host._localize("dashboard.logs_download")}
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
  if (host._step === "choose-binary" || host._step === "downloading") {
    // Compile is done and the byte fetch can't be cancelled, so offer Close
    // rather than a Stop that would target an already-finished job.
    return html`
      <div class="footer">
        <button class="btn btn--ghost" @click=${host._close}>
          ${host._localize("command.close")}
        </button>
      </div>
    `;
  }
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
              <wa-icon library="mdi" name="text-box-outline"></wa-icon>
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
              <wa-icon library="mdi" name="text-box-outline"></wa-icon>
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
