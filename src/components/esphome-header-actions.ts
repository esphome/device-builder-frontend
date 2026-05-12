import { consume } from "@lit/context";
import {
  mdiArchiveOutline,
  mdiCheck,
  mdiCog,
  mdiCogRefresh,
  mdiCommentQuestionOutline,
  mdiDotsVertical,
  mdiEyeOutline,
  mdiKeyVariant,
  mdiPlaylistCheck,
  mdiWifiCog,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { JobStatus } from "../api/types.js";
import type { FirmwareJob, OffloaderAlertSnapshotEntry } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  buildOffloadAlertsContext,
  firmwareJobsContext,
  localizeContext,
  onboardingPendingContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { EscapeController } from "../util/escape-controller.js";
import { navigate } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "archive-outline": mdiArchiveOutline,
  check: mdiCheck,
  cog: mdiCog,
  "cog-refresh": mdiCogRefresh,
  "comment-question-outline": mdiCommentQuestionOutline,
  "dots-vertical": mdiDotsVertical,
  "eye-outline": mdiEyeOutline,
  "key-variant": mdiKeyVariant,
  "playlist-check": mdiPlaylistCheck,
  "wifi-cog": mdiWifiCog,
});

@customElement("esphome-header-actions")
export class ESPHomeHeaderActions extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: firmwareJobsContext, subscribe: true })
  @state()
  private _jobs: Map<string, FirmwareJob> = new Map();

  /** Offloader-side alerts (pin_mismatch / peer_revoked).
   *  Drives a notification dot on the settings gear so the
   *  operator notices something needs attention without having
   *  to open Settings → Send builds first. ``null`` until the
   *  subscribe_events snapshot lands. Empty map = no alerts. */
  @consume({ context: buildOffloadAlertsContext, subscribe: true })
  @state()
  private _offloaderAlerts: Map<string, OffloaderAlertSnapshotEntry> | null = null;

  @state()
  private _open = false;

  /** True when onboarding still has work to do (currently:
   *  Wi-Fi step pending — data-derived from ``secrets.yaml``).
   *  Gates a dedicated ``Set up Wi-Fi…`` kebab entry so a user
   *  who declined the wizard with "I don't use Wi-Fi" — or who
   *  cleared the credentials by hand from the Secrets editor —
   *  still has a one-click re-entry into the wizard. The entry
   *  appears / disappears in real time as ``secrets.yaml``
   *  changes (the app-shell re-fetches the snapshot on every
   *  ``secrets-saved`` event). Owned by the app shell, threaded
   *  via context. */
  @consume({ context: onboardingPendingContext, subscribe: true })
  @state()
  private _onboardingPending = false;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        gap: 0;
      }

      .menu-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        border: none;
        background: none;
        color: var(--esphome-on-primary);
        cursor: pointer;
        padding: 6px;
        border-radius: var(--wa-border-radius-m);
        opacity: 0.85;
        transition: opacity 0.12s, background 0.12s;
      }

      .menu-btn:hover {
        opacity: 1;
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
      }

      .menu-btn:focus-visible {
        outline: 2px solid var(--esphome-on-primary);
        outline-offset: 2px;
        opacity: 1;
      }

      .menu-btn wa-icon {
        font-size: 20px;
      }

      .menu-btn-badge {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--esphome-warning, #f59e0b);
        box-shadow: 0 0 0 2px var(--esphome-primary);
      }

      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
      }

      .menu {
        position: fixed;
        z-index: 101;
        min-width: 220px;
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        box-shadow: var(--wa-shadow-l);
        padding: var(--wa-space-xs) 0;
        animation: menu-in 0.12s ease-out;
      }

      @keyframes menu-in {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: 8px var(--wa-space-m);
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-normal);
        cursor: pointer;
        transition: background 0.1s;
        user-select: none;
      }

      .menu-item:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
      }

      .menu-item wa-icon {
        font-size: 16px;
        color: var(--wa-color-text-quiet);
      }

      .menu-item:hover wa-icon {
        color: var(--esphome-primary);
      }

      .menu-item--active wa-icon {
        color: var(--esphome-primary);
      }

      .menu-item-label {
        flex: 1;
      }

      .menu-item .check {
        font-size: 14px;
        color: var(--esphome-primary);
      }

      .menu-item-count {
        margin-left: auto;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-on-primary);
        background: var(--esphome-primary);
        border-radius: 999px;
        padding: 1px 8px;
        min-width: 18px;
        text-align: center;
      }

      .menu-divider {
        height: 1px;
        background: var(--wa-color-surface-border);
        margin: var(--wa-space-2xs) 0;
      }

      .menu-label {
        padding: var(--wa-space-2xs) var(--wa-space-m);
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
    `,
  ];

  protected render() {
    let activeCount = 0;
    for (const job of this._jobs.values()) {
      if (job.status === JobStatus.QUEUED || job.status === JobStatus.RUNNING) {
        activeCount++;
      }
    }
    const kebabLabel =
      activeCount > 0
        ? this._localize("layout.more_options_with_count", { count: activeCount })
        : this._localize("dashboard.more_options");
    const hasAlerts = this._offloaderAlertsCount() > 0;
    return html`
      <button
        type="button"
        class="menu-btn menu-kebab"
        @click=${this._toggle}
        title=${kebabLabel}
        aria-label=${kebabLabel}
      >
        <wa-icon library="mdi" name="dots-vertical"></wa-icon>
        ${activeCount > 0 || hasAlerts
          ? html`<span class="menu-btn-badge" aria-hidden="true"></span>`
          : nothing}
      </button>
      ${this._open
        ? html`
            <div class="backdrop" @click=${this._close}></div>
            <div
              class="menu"
              role="menu"
              style="position:fixed;top:var(--esphome-header-height, 48px);right:var(--wa-space-s);"
            >
              <div
                class="menu-item"
                role="menuitem"
                tabindex="0"
                @click=${this._openFirmwareJobs}
                @keydown=${this._onMenuItemKeydown}
              >
                <wa-icon library="mdi" name="playlist-check"></wa-icon>
                <span class="menu-item-label">${this._localize("firmware_jobs.menu_item")}</span>
                ${activeCount > 0
                  ? html`<span class="menu-item-count">${activeCount}</span>`
                  : nothing}
              </div>
              <div
                class="menu-item"
                role="menuitem"
                tabindex="0"
                @click=${this._openSecrets}
                @keydown=${this._onMenuItemKeydown}
              >
                <wa-icon library="mdi" name="key-variant"></wa-icon>
                <span class="menu-item-label">${this._localize("layout.secrets")}</span>
              </div>
              ${this._onboardingPending
                ? html`<div
                    class="menu-item"
                    role="menuitem"
                    tabindex="0"
                    @click=${this._openOnboarding}
                    @keydown=${this._onMenuItemKeydown}
                  >
                    <wa-icon library="mdi" name="wifi-cog"></wa-icon>
                    <span class="menu-item-label"
                      >${this._localize("onboarding.menu_item_setup_wifi")}</span
                    >
                  </div>`
                : nothing}
              <div
                class="menu-item"
                role="menuitem"
                tabindex="0"
                @click=${this._openArchivedDevices}
                @keydown=${this._onMenuItemKeydown}
              >
                <wa-icon library="mdi" name="archive-outline"></wa-icon>
                ${this._localize("layout.archived_devices")}
              </div>
              <div
                class="menu-item"
                role="menuitem"
                tabindex="0"
                @click=${this._openResetBuildEnv}
                @keydown=${this._onMenuItemKeydown}
              >
                <wa-icon library="mdi" name="cog-refresh"></wa-icon>
                ${this._localize("layout.reset_build_env")}
              </div>
              <div class="menu-divider" role="separator"></div>
              <div
                class="menu-item"
                role="menuitem"
                tabindex="0"
                @click=${this._openSettings}
                @keydown=${this._onMenuItemKeydown}
              >
                <wa-icon library="mdi" name="cog"></wa-icon>
                <span class="menu-item-label">${this._localize("layout.settings")}</span>
                ${hasAlerts
                  ? html`<span class="menu-item-count">${this._offloaderAlertsCount()}</span>`
                  : nothing}
              </div>
              <div class="menu-divider" role="separator"></div>
              <div
                class="menu-item"
                role="menuitem"
                tabindex="0"
                @click=${this._openFeedback}
                @keydown=${this._onMenuItemKeydown}
              >
                <wa-icon library="mdi" name="comment-question-outline"></wa-icon>
                ${this._localize("layout.feedback_menu")}
              </div>
            </div>
          `
        : nothing}
    `;
  }

  private _toggle() {
    this._open = !this._open;
  }

  private _close() {
    this._open = false;
  }

  private _escape = new EscapeController(this, (e) => {
    e.preventDefault();
    this._close();
  });

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has("_open")) this._escape.set(this._open);
  }

  private _onMenuItemKeydown = (e: KeyboardEvent) => {
    /* The kebab menu items are ``<div role="menuitem">`` rather than
       <button>s so they sit visually flush with the checkbox-style
       toggle below. role + tabindex make them focusable; this handler
       maps Enter / Space to the same click the mouse would dispatch.
       ``e.currentTarget.click()`` re-uses the @click handler bound on
       the same element, so any per-item logic stays where it lives. */
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).click();
    }
  };

  private _openArchivedDevices = () => {
    /* Dashboard hosts the dialog instance and listens for this
       window event to open it. */
    this._close();
    window.dispatchEvent(new Event("esphome-show-archived-dialog"));
  };

  private _openSecrets() {
    this._close();
    navigate("/secrets");
  }

  /** Re-launches the onboarding wizard on demand. The kebab item
   *  is gated on ``_onboardingPending`` (data-derived from
   *  ``secrets.yaml``), so it appears only when there's actually
   *  something to onboard — a user who declined "I don't use Wi-Fi"
   *  earlier sees the entry and can change their mind. */
  private _openOnboarding() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-onboarding-wifi", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _openFirmwareJobs() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-firmware-jobs", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _openResetBuildEnv() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-reset-build-env", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _openSettings() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-settings", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _offloaderAlertsCount(): number {
    return this._offloaderAlerts === null ? 0 : this._offloaderAlerts.size;
  }

  private _openFeedback() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-feedback", {
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-header-actions": ESPHomeHeaderActions;
  }
}
