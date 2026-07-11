import { consume } from "@lit/context";
import {
  mdiArchiveOutline,
  mdiCheck,
  mdiCog,
  mdiCogRefresh,
  mdiCommentQuestionOutline,
  mdiDotsVertical,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiKeyVariant,
  mdiMagnify,
  mdiPlaylistCheck,
  mdiUpdate,
  mdiWifiCog,
} from "@mdi/js";
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AdoptableDevice } from "../api/types/devices.js";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import { JobStatus } from "../api/types/firmware-jobs.js";
import type { OffloaderAlertSnapshotEntry } from "../api/types/remote-build-events.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  buildOffloadAlertsContext,
  desktopUpdateCapableContext,
  firmwareJobsContext,
  importableDevicesContext,
  localizeContext,
  onboardingPendingContext,
} from "../context/index.js";
import { dropdownMenuStyles } from "../styles/dropdown-menu.js";
import { espHomeStyles } from "../styles/shared.js";
import { navigate } from "../util/navigation.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { OPEN_COMMAND_PALETTE_EVENT } from "./command-palette-actions.js";
import { headerActionsStyles } from "./esphome-header-actions.styles.js";
import { OverflowMenuElement } from "./overflow-menu-element.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "archive-outline": mdiArchiveOutline,
  check: mdiCheck,
  cog: mdiCog,
  "cog-refresh": mdiCogRefresh,
  "comment-question-outline": mdiCommentQuestionOutline,
  "dots-vertical": mdiDotsVertical,
  "eye-off-outline": mdiEyeOffOutline,
  "eye-outline": mdiEyeOutline,
  "key-variant": mdiKeyVariant,
  magnify: mdiMagnify,
  "playlist-check": mdiPlaylistCheck,
  update: mdiUpdate,
  "wifi-cog": mdiWifiCog,
});

/** True on Apple platforms, where the search shortcut uses the ⌘ glyph.
 *  ``userAgentData`` first; ``navigator.platform`` is deprecated but remains
 *  the only signal on Firefox and Safari. Read lazily and guarded so importing
 *  the module never touches an absent ``navigator``. */
function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad/i.test(
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform
  );
}

@customElement("esphome-header-actions")
export class ESPHomeHeaderActions extends OverflowMenuElement {
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

  /** True on the dashboard route. Dashboard-only menu entries
   *  (Archived Devices) hide elsewhere; their dialog is hosted on the
   *  dashboard page, so the entry would no-op anywhere else. */
  @property({ type: Boolean, attribute: "dashboard-route" })
  dashboardRoute = false;

  /** True when onboarding still has work to do (currently:
   *  Wi-Fi step pending — data-derived from ``secrets.yaml``).
   *  The Wi-Fi kebab entry is ALWAYS shown (so a user can rotate
   *  credentials without hand-editing ``secrets.yaml``); this flag
   *  only selects the entry's wording — ``Set up Wi-Fi`` when
   *  nothing is configured yet vs ``Change Wi-Fi credentials`` once
   *  it is. It tracks ``secrets.yaml`` in real time (the app-shell
   *  re-fetches the snapshot on every ``secrets-saved`` event), so
   *  the label flips the moment credentials are saved or cleared.
   *  Owned by the app shell, threaded via context. */
  @consume({ context: onboardingPendingContext, subscribe: true })
  @state()
  private _onboardingPending = false;

  /** Adoptable / ignored discoveries. Subscribed here so the
   *  kebab can gate the "Show ignored discoveries" entry on the
   *  presence of at least one ignored card — when there are no
   *  ignored discoveries the action has nothing to flip. */
  @consume({ context: importableDevicesContext, subscribe: true })
  @state()
  private _importableDevices: AdoptableDevice[] = [];

  /** Mirror of the dashboard's ``_showIgnored`` flag (persisted
   *  in ``localStorage``). The dashboard owns the write path; we
   *  listen to the ``esphome-show-ignored-changed`` window event
   *  so the menu label flips in real time. */
  @state()
  private _showIgnored = false;

  /** True only under an ESPHome Desktop app (0.14.0+) that exposes its update
   *  `api`; gates the "Check for updates" entry. Provided by the app shell
   *  from the server handshake. */
  @consume({ context: desktopUpdateCapableContext, subscribe: true })
  @state()
  private _desktopUpdateCapable = false;

  /** Computed once per instance: the platform is constant for a session, so
   *  the search-shortcut check needn't re-run the regex on every render. */
  private readonly _isApplePlatform = isApplePlatform();

  static styles = [espHomeStyles, dropdownMenuStyles, headerActionsStyles];

  connectedCallback(): void {
    super.connectedCallback();
    this._showIgnored = localStorage.getItem("esphome-show-ignored") === "true";
    window.addEventListener("esphome-show-ignored-changed", this._onShowIgnoredChanged);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(
      "esphome-show-ignored-changed",
      this._onShowIgnoredChanged
    );
  }

  private _onShowIgnoredChanged = (e: Event) => {
    this._showIgnored = (e as CustomEvent<{ value: boolean }>).detail.value;
  };

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
    const ignoredCount = this._importableDevices.filter((d) => d.ignored).length;
    // ⌘ is a locale-independent Apple glyph; the "Ctrl" label localizes (STRG in German).
    const searchShortcut = this._isApplePlatform
      ? "⌘K"
      : this._localize("layout.search_shortcut");
    return html`
      <button
        type="button"
        class="menu-btn menu-kebab"
        @click=${this._toggle}
        title=${kebabLabel}
        aria-label=${kebabLabel}
      >
        <wa-icon library="mdi" name="dots-vertical"></wa-icon>
        ${
          activeCount > 0 || hasAlerts
            ? html`<span class="menu-btn-badge" aria-hidden="true"></span>`
            : nothing
        }
      </button>
      ${
        this._open
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
                  @keydown=${this._onItemKeydown}
                >
                  <wa-icon library="mdi" name="playlist-check"></wa-icon>
                  <span class="menu-item-label"
                    >${this._localize("firmware_jobs.menu_item")}</span
                  >
                  ${
                    activeCount > 0
                      ? html`<span class="menu-item-count">${activeCount}</span>`
                      : nothing
                  }
                </div>
                <div
                  class="menu-item"
                  role="menuitem"
                  tabindex="0"
                  @click=${this._openSecrets}
                  @keydown=${this._onItemKeydown}
                >
                  <wa-icon library="mdi" name="key-variant"></wa-icon>
                  <span class="menu-item-label">${this._localize("layout.secrets")}</span>
                </div>
                <div
                  class="menu-item"
                  role="menuitem"
                  tabindex="0"
                  @click=${this._openOnboarding}
                  @keydown=${this._onItemKeydown}
                >
                  <wa-icon library="mdi" name="wifi-cog"></wa-icon>
                  <span class="menu-item-label"
                    >${
                      this._onboardingPending
                        ? this._localize("onboarding.menu_item_setup_wifi")
                        : this._localize("onboarding.menu_item_change_wifi")
                    }</span
                  >
                </div>
                ${
                  this.dashboardRoute
                    ? html`<div
                        class="menu-item"
                        role="menuitem"
                        tabindex="0"
                        @click=${this._openArchivedDevices}
                        @keydown=${this._onItemKeydown}
                      >
                        <wa-icon library="mdi" name="archive-outline"></wa-icon>
                        ${this._localize("layout.archived_devices")}
                      </div>`
                    : nothing
                }
                ${
                  ignoredCount > 0
                    ? html`<div
                        class="menu-item"
                        role="menuitemcheckbox"
                        tabindex="0"
                        aria-checked=${this._showIgnored ? "true" : "false"}
                        @click=${this._toggleShowIgnoredDiscoveries}
                        @keydown=${this._onItemKeydown}
                      >
                        <wa-icon
                          library="mdi"
                          name=${this._showIgnored ? "eye-off-outline" : "eye-outline"}
                        ></wa-icon>
                        <span class="menu-item-label"
                          >${
                            this._showIgnored
                              ? this._localize("layout.hide_ignored_discoveries")
                              : this._localize("layout.show_ignored_discoveries", {
                                  count: ignoredCount,
                                })
                          }</span
                        >
                      </div>`
                    : nothing
                }
                <div
                  class="menu-item"
                  role="menuitem"
                  tabindex="0"
                  @click=${this._openResetBuildEnv}
                  @keydown=${this._onItemKeydown}
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
                  @keydown=${this._onItemKeydown}
                >
                  <wa-icon library="mdi" name="cog"></wa-icon>
                  <span class="menu-item-label"
                    >${this._localize("layout.settings")}</span
                  >
                  ${
                    hasAlerts
                      ? html`<span class="menu-item-count"
                          >${this._offloaderAlertsCount()}</span
                        >`
                      : nothing
                  }
                </div>
                ${
                  this._desktopUpdateCapable
                    ? html`<div
                        class="menu-item"
                        role="menuitem"
                        tabindex="0"
                        @click=${this._openCheckForUpdates}
                        @keydown=${this._onItemKeydown}
                      >
                        <wa-icon library="mdi" name="update"></wa-icon>
                        <span class="menu-item-label"
                          >${this._localize("layout.check_for_updates")}</span
                        >
                      </div>`
                    : nothing
                }
                <div
                  class="menu-item"
                  role="menuitem"
                  tabindex="0"
                  @click=${this._openSearch}
                  @keydown=${this._onItemKeydown}
                >
                  <wa-icon library="mdi" name="magnify"></wa-icon>
                  <span class="menu-item-label">${this._localize("layout.search")}</span>
                  <kbd class="menu-item-shortcut">${searchShortcut}</kbd>
                </div>
                <div class="menu-divider" role="separator"></div>
                <div
                  class="menu-item"
                  role="menuitem"
                  tabindex="0"
                  @click=${this._openFeedback}
                  @keydown=${this._onItemKeydown}
                >
                  <wa-icon library="mdi" name="comment-question-outline"></wa-icon>
                  ${this._localize("layout.feedback_menu")}
                </div>
              </div>
            `
          : nothing
      }
    `;
  }

  private _openArchivedDevices = () => {
    /* Dashboard hosts the dialog instance and listens for this
       window event to open it. */
    this._close();
    window.dispatchEvent(new Event("esphome-show-archived-dialog"));
  };

  private _toggleShowIgnoredDiscoveries = () => {
    /* Dashboard owns the ``_showIgnored`` flag and the
       ``localStorage`` persistence. Fire the intent here; the
       dashboard handler also pops the discovery section open so
       the banner doesn't reappear collapsed after the user
       explicitly asked to see those cards. */
    this._close();
    window.dispatchEvent(new Event("esphome-show-ignored-from-menu"));
  };

  private _openSecrets() {
    this._close();
    navigate("/secrets");
  }

  /** Opens the Wi-Fi credentials dialog on demand. The kebab item
   *  is always present (its label tracks ``_onboardingPending`` —
   *  setup vs change), so a user can both complete first-run setup
   *  and rotate already-configured credentials without ever
   *  hand-editing ``secrets.yaml``. */
  private _openOnboarding() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-onboarding-wifi", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _openFirmwareJobs() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-firmware-jobs", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _openResetBuildEnv() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-reset-build-env", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _openSettings() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-settings", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _openSearch() {
    this._close();
    window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
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
      })
    );
  }

  private _openCheckForUpdates() {
    this._close();
    this.dispatchEvent(
      new CustomEvent("open-check-updates", {
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-header-actions": ESPHomeHeaderActions;
  }
}
