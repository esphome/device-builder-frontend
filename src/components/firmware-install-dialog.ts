import { consume } from "@lit/context";
import {
  mdiAlertCircle,
  mdiArrowExpand,
  mdiArrowCollapse,
  mdiCheckCircle,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import { JobStatus } from "../api/types.js";
import type { ConfiguredDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";
import {
  connectToPort,
  detectChip,
  disconnect,
  flashFirmware,
  resetAndDisconnect,
  type DetectedChip,
} from "../util/web-serial.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./ansi-log.js";

registerMdiIcons({
  "alert-circle": mdiAlertCircle,
  "arrow-expand": mdiArrowExpand,
  "arrow-collapse": mdiArrowCollapse,
  "check-circle": mdiCheckCircle,
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
  close: mdiClose,
});

type InstallStep = "connecting" | "queued" | "installing" | "compiling" | "flashing" | "done" | "error";

function normalizeChipName(name: string): string {
  return name.split("(")[0].trim().toLowerCase().replace(/-/g, "");
}

@customElement("esphome-firmware-install-dialog")
export class ESPHomeFirmwareInstallDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = true;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state() private _open = false;
  @state() private _step: InstallStep = "installing";
  @state() private _title = "";
  @state() private _statusMessage = "";
  @state() private _errorMessage = "";
  @state() private _logLines: string[] = [];
  @state() private _logsExpanded = false;
  @state() private _logsFullHeight = false;
  @state() private _flashPercent = 0;

  private _device: ConfiguredDevice | null = null;
  private _jobId = "";
  private _streamId = "";
  private _detected: DetectedChip | null = null;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  // ─── Public API ────────────────────────────────────────

  /**
   * Install firmware via Web Serial. The only install path that lives in this
   * dialog — it needs chip detection + client-side flash progress, which the
   * generic terminal command dialog cannot represent. OTA, server-serial
   * installs, validate, compile, clean all run through `command-dialog.ts`.
   */
  installWebSerial(device: ConfiguredDevice) {
    this._init(device);
    this._step = "connecting";
    this._statusMessage = this._localize("firmware.status_connecting");
    this._dialog.open = true;
    this._startWebSerialInstall();
  }

  private _init(device: ConfiguredDevice) {
    this._device = device;
    this._open = true;
    this._step = "installing";
    this._title = this._localize("firmware.install_title", { name: device.friendly_name || device.name });
    this._statusMessage = "";
    this._errorMessage = "";
    this._logLines = [];
    this._logsExpanded = false;
    this._logsFullHeight = false;
    this._flashPercent = 0;
    this._jobId = "";
    this._streamId = "";
    this._detected = null;
  }

  // ─── Styles ────────────────────────────────────────────

  static styles = [
    espHomeStyles,
    css`
      :host {
        --term-bg: #1e1e1e;
        --term-fg: #d4d4d4;
        --term-border: #333;
        --term-success: #6a9955;
        --term-error: #f44747;
      }
      :host([light]) {
        --term-bg: #f5f5f5;
        --term-fg: #333;
        --term-border: #ddd;
        --term-success: #3d7a28;
        --term-error: #c72e2e;
      }

      wa-dialog { --width: 520px; transition: width 0.2s; }
      :host([expanded]) wa-dialog { --width: min(900px, 90vw); }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }
      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }
      wa-dialog::part(close-button__base) {
        background: transparent; border: none; box-shadow: none;
        padding: 0; min-width: unset; min-height: unset;
        color: var(--esphome-on-primary); cursor: pointer;
      }
      wa-dialog::part(body) {
        padding: var(--wa-space-l) var(--wa-space-xl);
      }
      wa-dialog::part(footer) { display: none; }

      .status {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--wa-space-m);
        padding: var(--wa-space-l) 0;
      }

      .status wa-spinner {
        font-size: 36px;
        --indicator-color: var(--esphome-primary);
        --track-color: color-mix(in srgb, var(--esphome-primary), transparent 80%);
      }

      .status-icon {
        font-size: 42px;
      }
      .status-icon--success { color: var(--esphome-success); }
      .status-icon--error { color: var(--esphome-error); }

      .status-text {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .status-detail {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        max-width: 380px;
        line-height: 1.5;
      }

      .progress-bar {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: var(--wa-color-surface-lowered);
        overflow: hidden;
        margin-top: var(--wa-space-xs);
      }

      .progress-bar-fill {
        height: 100%;
        border-radius: 3px;
        background: var(--esphome-primary);
        transition: width 0.2s;
      }

      .logs-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 0;
        margin-top: var(--wa-space-m);
        background: none;
        border: none;
        font-family: inherit;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        cursor: pointer;
      }
      .logs-toggle:hover { color: var(--wa-color-text-normal); }
      .logs-toggle wa-icon { font-size: 16px; }

      .logs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .expand-btn {
        display: inline-flex;
        align-items: center;
        padding: 0;
        background: none;
        border: none;
        font-size: 16px;
        color: var(--wa-color-text-quiet);
        cursor: pointer;
      }
      .expand-btn:hover { color: var(--wa-color-text-normal); }

      .logs-container {
        margin-top: var(--wa-space-s);
        border: 1px solid var(--term-border);
        border-radius: var(--wa-border-radius-m);
        overflow: hidden;
      }

      esphome-ansi-log {
        --log-height: 200px;
      }

      .logs-container--full esphome-ansi-log {
        --log-height: 50vh;
      }
      esphome-ansi-log::part(container) { border-radius: 0; }

      .footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-l);
        padding-top: var(--wa-space-m);
        border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 16px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: var(--wa-border-width-s) solid transparent;
      }

      .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }
      .btn--ghost {
        background: transparent;
        color: var(--wa-color-text-normal);
        border-color: var(--wa-color-surface-border);
      }
    `,
  ];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("_darkMode")) {
      this.toggleAttribute("light", !this._darkMode);
    }
    if (changedProperties.has("_logsFullHeight")) {
      this.toggleAttribute("expanded", this._logsFullHeight);
    }
  }

  // ─── Render ────────────────────────────────────────────

  protected render() {
    return html`
      <wa-dialog
        label=${this._title}
        ?open=${this._open}
        @wa-after-hide=${this._onClose}
      >
        ${this._renderStatus()}
        ${this._renderProgress()}
        ${this._renderLogs()}
        ${this._renderFooter()}
      </wa-dialog>
    `;
  }

  private _renderStatus() {
    if (this._step === "done") {
      return html`
        <div class="status">
          <wa-icon class="status-icon status-icon--success" library="mdi" name="check-circle"></wa-icon>
          <span class="status-text">${this._statusMessage}</span>
        </div>
      `;
    }
    if (this._step === "error") {
      return html`
        <div class="status">
          <wa-icon class="status-icon status-icon--error" library="mdi" name="alert-circle"></wa-icon>
          <span class="status-text">${this._statusMessage}</span>
          <span class="status-detail">${this._errorMessage}</span>
        </div>
      `;
    }
    return html`
      <div class="status">
        <wa-spinner></wa-spinner>
        <span class="status-text">${this._statusMessage}</span>
      </div>
    `;
  }

  private _renderProgress() {
    if (this._step !== "flashing") return nothing;
    return html`
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width:${this._flashPercent}%"></div>
      </div>
    `;
  }

  private _renderLogs() {
    if (this._logLines.length === 0) return nothing;
    return html`
      <div class="logs-header">
        <button class="logs-toggle" @click=${() => { this._logsExpanded = !this._logsExpanded; }}>
          <wa-icon library="mdi" name=${this._logsExpanded ? "chevron-up" : "chevron-down"}></wa-icon>
          ${this._logsExpanded ? this._localize("firmware.hide_details") : this._localize("firmware.show_details")}
        </button>
        ${this._logsExpanded
          ? html`<button class="expand-btn" @click=${() => { this._logsFullHeight = !this._logsFullHeight; }}>
              <wa-icon library="mdi" name=${this._logsFullHeight ? "arrow-collapse" : "arrow-expand"}></wa-icon>
            </button>`
          : nothing}
      </div>
      ${this._logsExpanded
        ? html`<div class="logs-container ${this._logsFullHeight ? "logs-container--full" : ""}">
            <esphome-ansi-log .lines=${this._logLines} ?light=${!this._darkMode}></esphome-ansi-log>
          </div>`
        : nothing}
    `;
  }

  private _renderFooter() {
    const isRunning = this._step !== "done" && this._step !== "error";
    return html`
      <div class="footer">
        ${isRunning
          ? html`<button class="btn btn--ghost" @click=${this._cancel}>${this._localize("command.stop")}</button>`
          : html`<button class="btn btn--primary" @click=${this._close}>${this._localize("command.close")}</button>`}
      </div>
    `;
  }

  // ─── Web Serial Install ────────────────────────────────

  private async _startWebSerialInstall() {
    const device = this._device;
    if (!device) return;

    // 1. Connect and detect chip
    let detected: DetectedChip;
    try {
      detected = await detectChip();
    } catch {
      this._close(); // User cancelled port selection
      return;
    }
    this._detected = detected;

    // 2. Verify chip matches device platform
    this._statusMessage = this._localize("firmware.status_verifying");
    const detectedNorm = normalizeChipName(detected.chipName);
    const expectedPlatform = device.target_platform;
    const expectedNorm = expectedPlatform ? expectedPlatform.toLowerCase().replace(/-/g, "") : "";
    console.debug("[Web Serial] Detected chip:", detected.chipName, "→", detectedNorm, "| Expected:", expectedPlatform, "→", expectedNorm);
    if (expectedNorm && expectedNorm !== "unknown" && detectedNorm !== expectedNorm) {
      try { await disconnect(detected.transport); } catch { /* ignore */ }
      this._fail(this._localize("firmware.chip_mismatch", { detected: detected.chipName, expected: expectedPlatform }));
      return;
    }

    // Disconnect during compile — we'll reconnect to flash
    try { await disconnect(detected.transport); } catch { /* ignore */ }

    // 3. Compile
    this._step = "queued";
    this._statusMessage = this._localize("firmware.status_queued");
    try {
      await this._compileAndWait(device.configuration);
    } catch {
      this._fail(this._localize("firmware.compile_failed"));
      return;
    }

    // 4. Download binary
    this._statusMessage = this._localize("firmware.status_downloading");
    let firmwareBytes: Uint8Array;
    let flashAddress = 0x10000;
    try {
      const binaries = await this._api.firmwareGetBinaries(device.configuration);
      // Prefer factory binary (flashes at 0x0, includes bootloader)
      const factory = binaries.find((b) => b.file.includes("factory"));
      const binary = factory || binaries[0];
      if (!binary) {
        this._fail(this._localize("serial.no_firmware"));
        return;
      }
      if (factory) flashAddress = 0x0;
      const result = await this._api.firmwareDownload(device.configuration, binary.file);
      firmwareBytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
    } catch {
      this._fail(this._localize("firmware.download_failed"));
      return;
    }

    // 5. Reconnect to the same port (no browser picker) and flash
    this._step = "flashing";
    this._statusMessage = this._localize("firmware.status_flashing");
    this._flashPercent = 0;
    let flashDetected: DetectedChip;
    try {
      flashDetected = await connectToPort(detected.port);
    } catch (err) {
      console.error("[Web Serial] Reconnect failed:", err);
      this._fail(this._localize("firmware.flash_failed"));
      return;
    }

    try {
      await flashFirmware(flashDetected.loader, firmwareBytes, flashAddress, (p) => {
        this._flashPercent = p.percent;
      });
    } catch (err) {
      console.error("[Web Serial] Flash error:", err);
      // If progress reached 100%, treat as success (device may have reset during verification)
      if (this._flashPercent >= 100) {
        console.debug("[Web Serial] Flash reached 100%, treating as success despite error");
      } else {
        try { await disconnect(flashDetected.transport); } catch { /* ignore */ }
        this._fail(err instanceof Error ? err.message : this._localize("firmware.flash_failed"));
        return;
      }
    }

    // 6. Reset
    this._statusMessage = this._localize("firmware.status_resetting");
    try {
      await resetAndDisconnect(flashDetected.loader, flashDetected.transport);
    } catch { /* ignore reset errors */ }

    this._statusMessage = this._localize("firmware.status_done");
    this._step = "done";
  }

  private _compileAndWait(configuration: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const job = await this._api.firmwareCompile(configuration);
        this._jobId = job.job_id;
        this._streamId = this._api.firmwareFollowJob(job.job_id, {
          onOutput: (line) => {
            if (this._step === "queued") {
              this._step = "compiling";
              this._statusMessage = this._localize("firmware.status_compiling");
            }
            this._logLines = [...this._logLines, line];
          },
          onResult: (data) => {
            this._streamId = "";
            this._jobId = "";
            const result = data as unknown as { status: string };
            result.status === JobStatus.COMPLETED ? resolve() : reject(new Error("Compilation failed"));
          },
          onError: (error) => {
            this._streamId = "";
            this._jobId = "";
            reject(new Error(error));
          },
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ─── Helpers ───────────────────────────────────────────

  private _fail(message: string) {
    this._step = "error";
    this._statusMessage = message;
    this._errorMessage = message;
    this._logsExpanded = true;
  }

  private async _cancel() {
    if (this._jobId) {
      try { await this._api.firmwareCancel(this._jobId); } catch { /* ignore */ }
    }
    this._close();
  }

  private _close() {
    this._open = false;
    this._device = null;
    this._jobId = "";
    this._streamId = "";
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  private _onClose() {
    this._open = false;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-firmware-install-dialog": ESPHomeFirmwareInstallDialog;
  }
}
