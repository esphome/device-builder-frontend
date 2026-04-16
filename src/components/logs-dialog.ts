import { consume } from "@lit/context";
import { mdiClose, mdiPlay, mdiStop, mdiDeleteSweep } from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./ansi-log.js";

registerMdiIcons({
  close: mdiClose,
  play: mdiPlay,
  stop: mdiStop,
  "delete-sweep": mdiDeleteSweep,
});

/** Demo log lines shown when no real backend connection is available. */
const DEMO_LOGS: string[] = [
  "\x1b[36m[00:00:00][C][logger:185]\x1b[0m Log initialized",
  "\x1b[36m[00:00:00][C][wifi:037]\x1b[0m Setting up WiFi...",
  "\x1b[32m[00:00:01][I][wifi:274]\x1b[0m WiFi Connected! SSID: 'MyNetwork', IP: 192.168.1.42",
  "\x1b[32m[00:00:01][I][app:029]\x1b[0m Running through setup()...",
  "\x1b[36m[00:00:01][C][i2c:022]\x1b[0m Setting up I2C bus...",
  "\x1b[36m[00:00:01][C][i2c:048]\x1b[0m   SDA Pin: GPIO21",
  "\x1b[36m[00:00:01][C][i2c:049]\x1b[0m   SCL Pin: GPIO22",
  "\x1b[36m[00:00:01][C][i2c:050]\x1b[0m   Frequency: 50000 Hz",
  "\x1b[32m[00:00:02][I][bme280:159]\x1b[0m BME280 found at address 0x76",
  "\x1b[32m[00:00:02][I][app:062]\x1b[0m setup() finished successfully!",
  "",
  "\x1b[35m[00:00:05][D][sensor:094]\x1b[0m 'BME280 Temperature': Sending state \x1b[1m22.45\x1b[0m \x1b[35m\u00b0C\x1b[0m",
  "\x1b[35m[00:00:05][D][sensor:094]\x1b[0m 'BME280 Humidity': Sending state \x1b[1m58.20\x1b[0m \x1b[35m%\x1b[0m",
  "\x1b[35m[00:00:05][D][sensor:094]\x1b[0m 'BME280 Pressure': Sending state \x1b[1m1013.25\x1b[0m \x1b[35mhPa\x1b[0m",
  "\x1b[32m[00:00:05][I][api:102]\x1b[0m Client 'Home Assistant 2024.3.1' connected",
  "",
  "\x1b[35m[00:00:10][D][sensor:094]\x1b[0m 'BME280 Temperature': Sending state \x1b[1m22.51\x1b[0m \x1b[35m\u00b0C\x1b[0m",
  "\x1b[35m[00:00:10][D][sensor:094]\x1b[0m 'BME280 Humidity': Sending state \x1b[1m57.90\x1b[0m \x1b[35m%\x1b[0m",
  "\x1b[35m[00:00:10][D][sensor:094]\x1b[0m 'BME280 Pressure': Sending state \x1b[1m1013.30\x1b[0m \x1b[35mhPa\x1b[0m",
  "\x1b[33m[00:00:12][W][component:204]\x1b[0m Component 'ota' took a long time for an operation (120ms).",
  "",
  "\x1b[35m[00:00:15][D][sensor:094]\x1b[0m 'BME280 Temperature': Sending state \x1b[1m22.48\x1b[0m \x1b[35m\u00b0C\x1b[0m",
  "\x1b[35m[00:00:15][D][sensor:094]\x1b[0m 'BME280 Humidity': Sending state \x1b[1m58.10\x1b[0m \x1b[35m%\x1b[0m",
  "\x1b[32m[00:00:15][I][wifi:274]\x1b[0m WiFi signal strength: -42 dBm",
];

@customElement("esphome-logs-dialog")
export class ESPHomeLogsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = true;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property()
  configuration = "";

  @property()
  name = "";

  @state()
  private _streaming = false;

  @state()
  private _lines: string[] = [];

  @state()
  private _streamId = "";

  private _demoTimer: ReturnType<typeof setInterval> | null = null;
  private _demoIndex = 0;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    css`
      :host {
        --term-bg: #1e1e1e;
        --term-bg-alt: #252526;
        --term-fg: #d4d4d4;
        --term-fg-muted: #808080;
        --term-border: #3c3c3c;
        --term-hover: #2a2d2e;
        --term-accent: #4ec9b0;
        --term-error: #f44747;
      }

      :host([light]) {
        --term-bg: #f5f5f5;
        --term-bg-alt: #e8e8e8;
        --term-fg: #1e1e1e;
        --term-fg-muted: #6e6e6e;
        --term-border: #d0d0d0;
        --term-hover: #dcdcdc;
        --term-accent: #0d8a6f;
        --term-error: #c02020;
      }

      wa-dialog {
        --width: 720px;
      }

      wa-dialog::part(header) {
        background: var(--term-bg);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--term-accent);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        min-width: unset;
        min-height: unset;
        color: var(--term-fg-muted);
        cursor: pointer;
      }

      wa-dialog::part(body) {
        padding: 0;
        background: var(--term-bg);
        overflow: hidden;
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .logs-content {
        display: flex;
        flex-direction: column;
        height: 60vh;
        min-height: 300px;
        max-height: 70vh;
        overflow: hidden;
      }

      esphome-ansi-log {
        flex: 1;
        min-height: 0;
        --log-height: 100%;
      }

      /* Override ansi-log border-radius inside the dialog */
      esphome-ansi-log::part(container) {
        border-radius: 0;
      }

      .terminal-toolbar {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        padding: 6px var(--wa-space-m);
        background: var(--term-bg-alt);
        border-top: 1px solid var(--term-border);
      }

      .terminal-toolbar .spacer {
        flex: 1;
      }

      .term-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        font-family: "SF Mono", "Fira Code", monospace;
        cursor: pointer;
        border: 1px solid var(--term-border);
        transition: background 0.1s, border-color 0.1s;
      }

      .term-btn wa-icon {
        font-size: 14px;
      }

      .term-btn--ghost {
        background: transparent;
        color: var(--term-fg-muted);
      }

      .term-btn--ghost:hover {
        background: var(--term-hover);
        color: var(--term-fg);
        border-color: var(--term-fg-muted);
      }

      .term-btn--start {
        background: color-mix(in srgb, var(--term-accent), transparent 85%);
        color: var(--term-accent);
        border-color: color-mix(in srgb, var(--term-accent), transparent 60%);
      }

      .term-btn--start:hover {
        background: color-mix(in srgb, var(--term-accent), transparent 75%);
      }

      .term-btn--stop {
        background: color-mix(in srgb, var(--term-error), transparent 85%);
        color: var(--term-error);
        border-color: color-mix(in srgb, var(--term-error), transparent 60%);
      }

      .term-btn--stop:hover {
        background: color-mix(in srgb, var(--term-error), transparent 75%);
      }

      .streaming-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--term-accent);
        animation: pulse 1.5s infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    `,
  ];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("_darkMode")) {
      this.toggleAttribute("light", !this._darkMode);
    }
  }

  public open() {
    this._lines = [];
    this._streaming = false;
    this._streamId = "";
    this._demoIndex = 0;
    this._dialog.open = true;
    this._startDemo();
  }

  public close() {
    this._stopStreaming();
    this._dialog.open = false;
  }

  protected render() {
    const title = this._localize("dashboard.logs_title", { name: this.name });

    return html`
      <wa-dialog
        label=${title}
        light-dismiss
        @wa-after-hide=${this._onDialogHide}
      >
        <div class="logs-content">
          <esphome-ansi-log
            .lines=${this._lines}
            placeholder=${this._localize("dashboard.logs_placeholder")}
            ?light=${!this._darkMode}
          ></esphome-ansi-log>
          <div class="terminal-toolbar">
            ${this._streaming
              ? html`<span class="streaming-dot"></span>`
              : ""}
            <span class="spacer"></span>
            <button
              class="term-btn term-btn--ghost"
              @click=${this._clearLogs}
              title=${this._localize("dashboard.logs_clear")}
            >
              <wa-icon library="mdi" name="delete-sweep"></wa-icon>
              ${this._localize("dashboard.logs_clear")}
            </button>
            ${this._streaming
              ? html`
                  <button class="term-btn term-btn--stop" @click=${this._stopStreaming}>
                    <wa-icon library="mdi" name="stop"></wa-icon>
                    ${this._localize("dashboard.logs_stop")}
                  </button>
                `
              : html`
                  <button class="term-btn term-btn--start" @click=${this._startDemo}>
                    <wa-icon library="mdi" name="play"></wa-icon>
                    ${this._localize("dashboard.logs_start")}
                  </button>
                `}
          </div>
        </div>
      </wa-dialog>
    `;
  }

  /**
   * Start streaming demo logs.
   * In a real scenario this would call this._api.logs(configuration, "OTA", callbacks).
   */
  private _startDemo() {
    if (this._streaming) return;
    this._streaming = true;
    this._demoIndex = 0;
    this._lines = [];

    // Drip-feed demo lines to simulate real-time streaming
    this._demoTimer = setInterval(() => {
      if (this._demoIndex >= DEMO_LOGS.length) {
        // Loop from the sensor readings portion
        this._demoIndex = 11;
      }
      this._lines = [...this._lines, DEMO_LOGS[this._demoIndex]];
      this._demoIndex++;
    }, 350);
  }

  private _stopStreaming() {
    this._streaming = false;
    if (this._demoTimer) {
      clearInterval(this._demoTimer);
      this._demoTimer = null;
    }
  }

  private _clearLogs() {
    this._lines = [];
  }

  private _onDialogHide() {
    this._stopStreaming();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-logs-dialog": ESPHomeLogsDialog;
  }
}
