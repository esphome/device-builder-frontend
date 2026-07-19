import { html, nothing, type TemplateResult } from "lit";
import { type FirmwareBinary, JobSource } from "../../api/types/firmware-jobs.js";
import { FLASHER_HOST } from "../../common/docs.js";
import { activeLocale } from "../../common/localize.js";
import { configurationStem, downloadAnsiText } from "../../util/download-text.js";
import { formatElapsed } from "../../util/format-job-time.js";
import { pairingDisplayNameForPin } from "../../util/pairing-display-name.js";
import { canResetBuildEnv } from "../remote-build-hint.js";
import type { ESPHomeFirmwareInstallDialog } from "../firmware-install-dialog.js";
import {
  renderOffloadHint,
  shouldShowOffloadHint,
} from "../process-terminal/offload-hint.js";
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
  if (host._failureKind === "validate") return renderValidationFailureSuggestion(host);
  if (host._failureKind !== "compile") return nothing;
  if (isPeerLinkSessionLostError(host._errorMessage)) return nothing;
  const remoteLabel =
    host._jobSource === JobSource.REMOTE && host._jobSourceLabel
      ? pairingDisplayNameForPin(host._pairings, host._jobSourcePin, host._jobSourceLabel)
      : null;
  const pairing = host._jobSourcePin
    ? host._pairings?.get(host._jobSourcePin)
    : undefined;
  const resetPin = pairing && canResetBuildEnv(pairing) ? host._jobSourcePin : null;
  return renderBuildFailureSuggestion(host, remoteLabel, resetPin);
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
  if (host._installer === "web-flash") {
    return host._localize("firmware.usb_built_title");
  }
  // binary-download
  const isElf = host._downloadedFilename.endsWith(".elf");
  return host._localize(
    isElf ? "firmware.elf_download_done_title" : "firmware.binary_download_done_title"
  );
}

function downloadReadyDetail(host: ESPHomeFirmwareInstallDialog): string {
  if (host._installer === "web-flash") {
    // A blocked pop-up parks here with the firmware still built; show why so the
    // user can allow pop-ups and click Open again (handOffToFlasher clears it).
    if (host._errorMessage) return host._errorMessage;
    return host._localize("firmware.usb_built_body", { host: FLASHER_HOST });
  }
  // binary-download
  const filename = host._downloadedFilename;
  const isElf = filename.endsWith(".elf");
  return host._localize(
    isElf ? "firmware.elf_download_done_body" : "firmware.binary_download_done_body",
    { filename }
  );
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
  // Hidden tabs throttle timers, which can stall the Web Serial write and fail
  // the flash; there's no API to opt out, so warn the user to stay on the page.
  if (host._step === "flashing") {
    return host._localize(
      host._installer === "web-flash"
        ? "firmware.usb_flashing_detail"
        : "firmware.flashing_keep_visible"
    );
  }
  // Once compilation begins, surface the elapsed so a slow build reads as slow.
  if (host._step === "compiling" && host._timer.compileElapsedMs !== null) {
    return formatElapsed(host._timer.compileElapsedMs, activeLocale());
  }
  return "";
}

// Nudge a slow local compile toward "send builds to a faster machine". Same
// gate as the command-dialog: compile elapsed past the threshold, suppressed
// for remote builds and when offloading is already set up.
export function renderOffloadHintSlot(
  host: ESPHomeFirmwareInstallDialog
): TemplateResult | typeof nothing {
  if (!host._timer.isCompiling) return nothing;
  const visible = shouldShowOffloadHint({
    elapsedMs: host._timer.compileElapsedMs ?? 0,
    source: host._jobSource,
    pairings: host._pairings,
    desktop: Boolean(host._desktopVersion),
  });
  return visible ? renderOffloadHint(host) : nothing;
}

// ── status-extra slot ────────────────────────────────────────────────
// Bespoke bodies that don't fit the standard status block: the binary-format
// picker (choose-binary), the "choose another format" link (download-ready),
// and the collapsible compile / esptool log.

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
  // web-flash: the action is the "Open USB flasher" footer button; no extra body.
  if (host._installer === "web-flash") return nothing;
  // Manual binary download: offer to pick a different format when more than
  // one was produced.
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
  // Land the pending rAF batch so a mid-stream download can't drop the
  // last frame of lines (mirrors command-dialog's _downloadOutput).
  host._log.flush();
  const stem = configurationStem(host._device?.configuration, "install");
  downloadAnsiText(host._log.lines, `${stem}-install.txt`);
}

export function renderLogs(
  host: ESPHomeFirmwareInstallDialog
): TemplateResult | typeof nothing {
  if (host._log.lines.length === 0) return nothing;
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
        ${
          host._logsExpanded
            ? host._localize("firmware.hide_details")
            : host._localize("firmware.show_details")
        }
      </button>
      <button class="logs-toggle" @click=${() => downloadInstallLogs(host)}>
        <wa-icon library="mdi" name="download"></wa-icon>
        ${host._localize("dashboard.logs_download")}
      </button>
    </div>
    ${
      host._logsExpanded
        ? html`<div class="logs-container">
            <esphome-ansi-log
              .lines=${host._log.lines}
              ?light=${!host._darkMode}
            ></esphome-ansi-log>
          </div>`
        : nothing
    }
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
    // Web Serial only — the download / web-flash installers don't connect.
    const showToggle = host._installer === "web-serial";
    return html`
      <div class="footer">
        ${
          showToggle
            ? html`<button
                class="btn btn--ghost ${host._showLogsAfterInstall ? "is-active" : ""}"
                @click=${host._toggleShowLogsAfterInstall}
                aria-pressed=${host._showLogsAfterInstall ? "true" : "false"}
                title=${host._localize("command.show_logs_after_install_tooltip")}
              >
                <wa-icon library="mdi" name="text-box-outline"></wa-icon>
                ${host._localize("command.show_logs_after_install")}
              </button>`
            : nothing
        }
        <button class="btn btn--ghost" @click=${host._cancel}>
          ${host._localize("command.stop")}
        </button>
      </div>
    `;
  }
  if (host._step === "download-ready") {
    if (host._installer === "web-flash") {
      return html`
        <div class="footer">
          <button class="btn btn--ghost" @click=${host._close}>
            ${host._localize("command.close")}
          </button>
          <button class="btn btn--primary" @click=${host._openUsbFlasher}>
            ${host._localize("firmware.usb_open_button")}
            <wa-icon library="mdi" name="open-in-new"></wa-icon>
          </button>
        </div>
      `;
    }
    // binary-download
    return html`
      <div class="footer">
        <button class="btn btn--primary" @click=${host._close}>
          ${host._localize("command.close")}
        </button>
      </div>
    `;
  }
  // A chip mismatch against the stored board can't be retried into success —
  // offer the board-reselect hand-off instead.
  if (host._step === "error" && host._failureKind === "chip-mismatch") {
    return html`
      <div class="footer">
        <button class="btn btn--ghost" @click=${host._close}>
          ${host._localize("command.close")}
        </button>
        <button class="btn btn--primary" @click=${host._tryChangeBoard}>
          ${host._localize("firmware.change_board_action")}
        </button>
      </div>
    `;
  }
  // A failed Web Serial or USB (web-flash) flash can be retried in place: re-run
  // the install (web-flash re-opens the external flasher). Excludes compile /
  // validate failures, which surface the reset-build hint (renderResetSuggestion)
  // instead; re-flashing wouldn't address those.
  const canRetry =
    host._step === "error" &&
    (host._installer === "web-serial" || host._installer === "web-flash") &&
    host._failureKind === null;
  if (canRetry) {
    return html`
      <div class="footer">
        <button class="btn btn--ghost" @click=${host._close}>
          ${host._localize("command.close")}
        </button>
        <button class="btn btn--primary" @click=${host._retry}>
          ${host._localize("command.retry")}
        </button>
      </div>
    `;
  }
  // Web-flash success: the device flashed in the external tab and is rebooting;
  // offer its logs over OTA/native-API (the dashboard has no serial port).
  if (host._installer === "web-flash" && host._step === "done") {
    return html`
      <div class="footer">
        <button class="btn btn--ghost" @click=${host._close}>
          ${host._localize("command.close")}
        </button>
        <button class="btn btn--primary" @click=${host._showUsbLogs}>
          <wa-icon library="mdi" name="text-box-outline"></wa-icon>
          ${host._localize("command.show_logs")}
        </button>
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
      ${
        canShowLogs
          ? html`<button class="btn btn--primary" @click=${host._showLogsAgain}>
                <wa-icon library="mdi" name="text-box-outline"></wa-icon>
                ${host._localize("command.show_logs")}
              </button>
              <button class="btn btn--ghost" @click=${host._close}>
                ${host._localize("command.close")}
              </button>`
          : html`<button class="btn btn--primary" @click=${host._close}>
              ${host._localize("command.close")}
            </button>`
      }
    </div>
  `;
}
