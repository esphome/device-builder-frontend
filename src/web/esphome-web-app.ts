import { provide } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import toast from "sonner-js";

import { defaultLocalize, loadLocalize, type LocalizeFunc } from "../common/localize.js";
import { darkModeContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import "./dashboard/esphome-web-dashboard.js";
import "./flash-receiver/esphome-web-flash-receiver.js";
import { parseFlasherParams } from "./flash-receiver/flash-handshake.js";
import "./header/esphome-web-header.js";
import { readMode, writeMode, type WebMode } from "./web-mode.js";

/**
 * Standalone ESPHome Web app shell.
 *
 * The backend-free counterpart to ``<esphome-app>``: it owns the theme,
 * localization, and the ESP ⇄ Pico mode, but there is no WebSocket, auth, or
 * device list. It provides only the two contexts the reused dialogs need
 * (``localize`` + ``darkMode``) and renders the header / dashboard chrome.
 */
@customElement("esphome-web-app")
export class ESPHomeWebApp extends LitElement {
  @provide({ context: localizeContext })
  @state()
  private _localize: LocalizeFunc = defaultLocalize;

  @provide({ context: darkModeContext })
  @state()
  private _darkMode = false;

  @state() private _mode: WebMode = readMode();

  // Flasher hand-off mode: opened by the dashboard as a postMessage flash
  // target (``#nonce=…`` + a ``window.opener``). Computed once at construction
  // — the hash/opener don't change over the page's life.
  private _flasherMode =
    window.opener != null && parseFlasherParams(window.location.hash) != null;

  private _darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

  connectedCallback(): void {
    super.connectedCallback();
    this._applySystemTheme();
    this._darkModeQuery.addEventListener("change", this._applySystemTheme);
    window.addEventListener("popstate", this._syncModeFromUrl);
    void this._init();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._darkModeQuery.removeEventListener("change", this._applySystemTheme);
    window.removeEventListener("popstate", this._syncModeFromUrl);
  }

  private async _init(): Promise<void> {
    toast.config({
      toastOptions: {
        // Mirrors the dashboard's toaster position (app-shell.ts).
        position: "bottom-right",
        richColors: true,
        duration: 4000,
        closeButton: true,
      },
    });
    try {
      this._localize = await loadLocalize();
    } catch {
      // Keep the synchronous English fallback already in place.
      this._localize = defaultLocalize;
    }
  }

  // ESPHome Web has no theme picker — it simply follows the OS preference,
  // toggling the document-level ``wa-light`` / ``wa-dark`` classes the shared
  // theme CSS keys off. Mirrors ``app-shell.applyTheme`` minus persistence.
  private _applySystemTheme = (): void => {
    const prefersDark = this._darkModeQuery.matches;
    this._darkMode = prefersDark;
    document.documentElement.classList.toggle("wa-dark", prefersDark);
    document.documentElement.classList.toggle("wa-light", !prefersDark);
  };

  private _syncModeFromUrl = (): void => {
    this._mode = readMode();
  };

  private _onToggleMode = (): void => {
    const next: WebMode = this._mode === "pico" ? "esp" : "pico";
    this._mode = next;
    writeMode(next);
  };

  protected render() {
    return html`
      <esphome-web-header
        .mode=${this._mode}
        ?minimal=${this._flasherMode}
        @toggle-mode=${this._onToggleMode}
      ></esphome-web-header>
      <main>
        ${
          this._flasherMode
            ? html`<esphome-web-flash-receiver></esphome-web-flash-receiver>`
            : html`<esphome-web-dashboard .mode=${this._mode}></esphome-web-dashboard>`
        }
      </main>
      <footer class="app-footer">
        <span>${this._localize("web.footer.tagline")}</span>
        <a href="https://esphome.io/" target="_blank" rel="noopener noreferrer">
          esphome.io
        </a>
      </footer>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
        min-height: 100vh;
        background-color: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
      }
      main {
        display: block;
        /* Keep the tail of the page clear of the fixed footer. */
        padding-bottom: var(--esphome-footer-height);
      }
      /* Mirrors esphome-layout's .app-footer (slim fixed version strip);
         keep in sync with src/components/esphome-layout.ts. */
      .app-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: var(--esphome-footer-height);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--wa-space-m);
        font-size: 10px;
        background: var(--wa-color-surface-default);
        color: color-mix(in srgb, var(--wa-color-text-quiet), transparent 30%);
        user-select: text;
      }
      .app-footer a {
        color: inherit;
        text-decoration: none;
        cursor: pointer;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-app": ESPHomeWebApp;
  }
}
