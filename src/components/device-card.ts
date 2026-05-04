import { consume } from "@lit/context";
import {
  mdiCancel,
  mdiCheckCircle,
  mdiCheckNetworkOutline,
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiCloseCircle,
  mdiConsole,
  mdiDotsVertical,
  mdiHelpNetworkOutline,
  mdiLock,
  mdiLockAlert,
  mdiLockClock,
  mdiLockOpenVariant,
  mdiNetworkOffOutline,
  mdiOpenInNew,
  mdiPencil,
  mdiUpload,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DeviceState, JobStatus, JobType } from "../api/types.js";
import type { FirmwareJob } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { getCompactEncryptionVisual } from "../util/encryption-state.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  cancel: mdiCancel,
  "check-circle": mdiCheckCircle,
  "checkbox-blank-outline": mdiCheckboxBlankOutline,
  "checkbox-marked": mdiCheckboxMarked,
  "close-circle": mdiCloseCircle,
  console: mdiConsole,
  "dots-vertical": mdiDotsVertical,
  "check-network-outline": mdiCheckNetworkOutline,
  "help-network-outline": mdiHelpNetworkOutline,
  lock: mdiLock,
  "lock-alert": mdiLockAlert,
  "lock-clock": mdiLockClock,
  "lock-open-variant": mdiLockOpenVariant,
  "network-off-outline": mdiNetworkOffOutline,
  "open-in-new": mdiOpenInNew,
  pencil: mdiPencil,
  upload: mdiUpload,
});

const RECENT_JOB_ICON: Record<JobStatus, string | null> = {
  [JobStatus.QUEUED]: null,
  [JobStatus.RUNNING]: null,
  [JobStatus.COMPLETED]: "check-circle",
  [JobStatus.FAILED]: "close-circle",
  [JobStatus.CANCELLED]: "cancel",
};

const RECENT_JOB_VARIANT: Record<JobStatus, string> = {
  [JobStatus.QUEUED]: "",
  [JobStatus.RUNNING]: "",
  [JobStatus.COMPLETED]: "completed",
  [JobStatus.FAILED]: "failed",
  [JobStatus.CANCELLED]: "cancelled",
};

const RECENT_JOB_LABEL: Record<JobStatus, string> = {
  [JobStatus.QUEUED]: "",
  [JobStatus.RUNNING]: "",
  [JobStatus.COMPLETED]: "firmware_jobs.status_completed",
  [JobStatus.FAILED]: "firmware_jobs.status_failed",
  [JobStatus.CANCELLED]: "firmware_jobs.status_cancelled",
};

@customElement("esphome-device-card")
export class ESPHomeDeviceCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  name = "";

  @property()
  configuration = "";

  @property()
  state: DeviceState = DeviceState.UNKNOWN;

  @property({ type: Boolean, attribute: "has-pending-changes" })
  hasPendingChanges = false;

  @property({ type: Boolean, attribute: "has-update-available" })
  hasUpdateAvailable = false;

  @property({ type: Boolean, attribute: "api-enabled" })
  apiEnabled = false;

  @property({ type: Boolean, attribute: "api-encrypted" })
  apiEncrypted = false;

  /** ``api_encryption`` TXT observed via mDNS — see api/types.ts for
   *  the tri-state semantics. Combined with ``apiEncrypted`` and
   *  ``hasPendingChanges`` to drive the four-state lock indicator. */
  @property({ attribute: false })
  apiEncryptionActive: string | null = null;

  @property({ type: Boolean })
  busy = false;

  /** The currently-running job, if any. Powers the status-badge
   *  label so a rename reads as "Renaming" rather than the generic
   *  "Installing" copy the install/compile path uses. */
  @property({ attribute: false })
  activeJob: FirmwareJob | null = null;

  @property({ attribute: false })
  recentJob: FirmwareJob | null = null;

  @property({ type: Boolean, attribute: "select-mode" })
  selectMode = false;

  @property({ type: Boolean })
  selected = false;

  /** Pre-built http URL to the device's web UI when its YAML exposes
   *  ``web_server`` and we have a host. Empty string hides the inline
   *  Visit Web button. Pre-built so the card doesn't have to know
   *  about ``ConfiguredDevice`` shape; ``buildWebUiUrl`` is the
   *  shared source of truth for protocol/port logic. */
  @property()
  webUrl = "";

  /** Briefly highlight the card with an accent border + glow, e.g.
   *  to point out a freshly-adopted device. Driven by the dashboard;
   *  cleared by a timer on its end. */
  @property({ type: Boolean, reflect: true })
  highlight = false;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
        outline: none;
      }

      .device-card {
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-raised);
        overflow: visible;
        display: flex;
        flex-direction: column;
        transition: box-shadow 0.15s;
      }

      .device-card:hover {
        box-shadow: var(--wa-shadow-m);
      }

      /* Keyboard focus ring on the card itself. The host carries
         tabindex/role so screen readers and Tab land here; we draw the
         outline on the inner card so it follows the rounded corners. */
      :host(:focus-visible) .device-card {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 2px;
      }

      .device-card--clickable {
        cursor: pointer;
      }

      .device-card--selectable {
        cursor: pointer;
      }

      .device-card--selected {
        border-color: var(--esphome-primary);
        background: color-mix(in srgb, var(--esphome-primary), transparent 95%);
      }

      /* Brief accent flash to draw the eye to a just-adopted card.
         The dashboard sets the highlight attribute for ~4s after a
         successful adoption, then clears it; the animation runs once
         during that window. Honours prefers-reduced-motion: keep the
         static border tint, drop the glow pulse. */
      :host([highlight]) .device-card {
        border-color: var(--esphome-primary);
        animation: card-highlight-glow 2s ease-out 1;
      }
      @keyframes card-highlight-glow {
        0% {
          box-shadow: 0 0 0 0
            color-mix(in srgb, var(--esphome-primary), transparent 40%);
        }
        50% {
          box-shadow: 0 0 0 8px
            color-mix(in srgb, var(--esphome-primary), transparent 65%);
        }
        100% {
          box-shadow: 0 0 0 0
            color-mix(in srgb, var(--esphome-primary), transparent 100%);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        :host([highlight]) .device-card {
          animation: none;
        }
      }

      .device-card-header {
        padding: var(--wa-space-m) var(--wa-space-m) var(--wa-space-s);
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--wa-space-xs);
      }

      .device-card-header:last-child {
        border-bottom: none;
      }

      .device-card-header-left {
        flex: 1;
        min-width: 0;
      }

      .device-name-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 var(--wa-space-2xs);
      }

      .device-name {
        margin: 0;
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .indicator-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .indicator-dot--modified {
        background: var(--esphome-warning, #f59e0b);
        box-shadow: 0 0 5px color-mix(in srgb, var(--esphome-warning, #f59e0b), transparent 50%);
      }

      .indicator-dot--update {
        background: var(--esphome-primary);
        box-shadow: 0 0 5px color-mix(in srgb, var(--esphome-primary), transparent 50%);
      }

      /* API-encryption indicator. Four states (see encryption-state.ts):
           secure     → filled lock, success palette ("this is fine")
           insecure   → open lock, warning palette ("plaintext API")
           pending    → lock with clock, info palette ("flash to apply")
           mismatch   → lock with alert, error palette ("YAML/device disagree") */
      .encryption-icon {
        font-size: 14px;
        flex-shrink: 0;
      }
      .encryption-icon.secure {
        color: var(--esphome-success);
        opacity: 0.85;
      }
      .encryption-icon.insecure {
        color: var(--esphome-warning, #f59e0b);
      }
      .encryption-icon.pending {
        color: var(--esphome-primary);
      }
      .encryption-icon.mismatch {
        color: var(--esphome-error);
      }

      .device-config {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .device-status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        letter-spacing: 0.02em;
        flex-shrink: 0;
        margin-top: 2px;
      }

      .device-status.offline {
        background: color-mix(in srgb, var(--esphome-error), transparent 85%);
        color: var(--esphome-error);
      }

      .device-status.online {
        background: color-mix(in srgb, var(--esphome-success), transparent 85%);
        color: var(--esphome-success);
      }

      .device-status.unknown {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
      }

      .device-status wa-icon {
        font-size: 13px;
      }

      .device-status.busy {
        background: color-mix(in srgb, var(--esphome-primary), transparent 85%);
        color: var(--esphome-primary);
        cursor: pointer;
      }

      .device-status.busy wa-spinner {
        font-size: 12px;
        --indicator-color: var(--esphome-primary);
        --track-color: transparent;
      }

      .device-status.completed {
        background: color-mix(in srgb, var(--esphome-success), transparent 85%);
        color: var(--esphome-success);
        animation: completed-pulse 1s ease-in-out infinite;
      }

      /* Pulse the success badge so it reads as transient — the
         dashboard's RECENT_JOB_TTL_MS_COMPLETED window is short and
         the throb signals "this is going away momentarily" instead of
         "this is the device's permanent state". */
      @keyframes completed-pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.55;
        }
      }

      /* Honour prefers-reduced-motion: reduce — keep the badge
         solid and let the colour alone signal completion. */
      @media (prefers-reduced-motion: reduce) {
        .device-status.completed {
          animation: none;
        }
      }

      .device-status.failed {
        background: color-mix(in srgb, var(--esphome-error), transparent 85%);
        color: var(--esphome-error);
      }

      .device-status.cancelled {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
      }

      .action-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        pointer-events: none;
      }

      .device-checkbox {
        font-size: 22px;
        color: var(--wa-color-text-quiet);
        flex-shrink: 0;
        transition: color 0.12s;
      }

      .device-checkbox--checked {
        color: var(--esphome-primary);
      }

      /* ─── Action buttons ─── */

      .device-actions {
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        padding: var(--wa-space-s) var(--wa-space-m);
      }

      .action-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 12px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: var(--wa-border-width-s) solid transparent;
        /* Reset anchor presentation so the Visit Web UI link
           (rendered as <a> for rel=noopener security) matches the
           surrounding <button> action controls — no underline, no
           visited tint. */
        text-decoration: none;
        transition:
          background 0.12s,
          border-color 0.12s;
        white-space: nowrap;
        min-width: 0;
      }

      .action-btn wa-icon {
        font-size: 15px;
      }

      .action-btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .action-btn--primary:hover {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .action-btn--accent {
        background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
        color: var(--esphome-primary);
        border-color: color-mix(in srgb, var(--esphome-primary), transparent 70%);
      }

      .action-btn--accent:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 82%);
        border-color: var(--esphome-primary);
      }

      .action-btn--ghost {
        background: transparent;
        color: var(--wa-color-text-normal);
        border-color: var(--wa-color-surface-border);
      }

      .action-btn--ghost:hover {
        background: var(--wa-color-surface-lowered);
        border-color: var(--wa-color-text-quiet);
      }

      .action-btn--icon-only {
        padding: 5px;
        flex-shrink: 0;
        margin-left: auto;
      }

      /* Compact icon-only button that sits inline with the labelled
         buttons — same visual size as the kebab but without the auto
         left-margin that pushes the kebab to the right edge. Used by
         the Visit Web UI control (icon-only since the open-in-new
         icon is self-explanatory). */
      .action-btn--tile {
        padding: 5px;
        flex-shrink: 0;
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    /* The host is the focusable target for keyboard nav: Tab lands on
       the card, Enter/Space activates it, arrow keys move to a sibling
       card in the grid. Inner action buttons remain in the tab order
       after the card so keyboard users can reach Edit / Install / Logs
       without leaving the keyboard. */
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    if (!this.hasAttribute("role")) this.setAttribute("role", "button");
    this.addEventListener("keydown", this._onKeydown);
    this.addEventListener("keyup", this._onKeyup);
    /* Activation has to live on the host. Some assistive tech
       activates a focused role="button" by dispatching `click` on the
       focused element itself; if the handler were on the inner
       .device-card div, that synthesised click wouldn't reach it.
       Inner buttons + the actions row already stopPropagation, so a
       host-level click only fires for clicks on the card body. */
    this.addEventListener("click", this._onClick);
    this.addEventListener("contextmenu", this._onHostContextMenu);
  }

  disconnectedCallback() {
    this.removeEventListener("keydown", this._onKeydown);
    this.removeEventListener("keyup", this._onKeyup);
    this.removeEventListener("click", this._onClick);
    this.removeEventListener("contextmenu", this._onHostContextMenu);
    super.disconnectedCallback();
  }

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("name")) {
      /* Label is just the device name; selected state is conveyed via
         aria-pressed below so screen readers announce it in the user's
         locale instead of a hard-coded English string. */
      this.setAttribute("aria-label", this.name);
    }
    if (changedProperties.has("selectMode") || changedProperties.has("selected")) {
      if (this.selectMode) {
        this.setAttribute("aria-pressed", String(this.selected));
      } else {
        this.removeAttribute("aria-pressed");
      }
    }
  }

  protected render() {
    return html`
      <div
        class="device-card ${this.selectMode ? "device-card--selectable" : "device-card--clickable"} ${this.selectMode && this.selected ? "device-card--selected" : ""}"
      >
        <div class="device-card-header">
          ${this.selectMode
            ? html`
                <wa-icon
                  class="device-checkbox ${this.selected ? "device-checkbox--checked" : ""}"
                  library="mdi"
                  name=${this.selected ? "checkbox-marked" : "checkbox-blank-outline"}
                ></wa-icon>
              `
            : nothing}
          <div class="device-card-header-left">
            <div class="device-name-wrap">
              <h3 class="device-name">${this.name}</h3>
              ${this.hasPendingChanges
                ? html`<span class="indicator-dot indicator-dot--modified" title=${this._localize("dashboard.status_modified")}></span>`
                : nothing}
              ${this.hasUpdateAvailable
                ? html`<span class="indicator-dot indicator-dot--update" title=${this._localize("dashboard.status_update_available")}></span>`
                : nothing}
              ${this._renderEncryptionIcon()}
            </div>
            <p class="device-config">${this.configuration}</p>
          </div>
          ${this._renderStatusBadge()}
        </div>
        ${!this.selectMode
          ? html`
              <div class="device-actions" @click=${(e: Event) => e.stopPropagation()}>
                <button
                  class="action-btn action-btn--primary"
                  ?disabled=${this.busy}
                  @click=${() => this._emit("edit-device")}
                >
                  <wa-icon library="mdi" name="pencil"></wa-icon>
                  ${this._localize("dashboard.edit")}
                </button>
                ${this.hasUpdateAvailable
                  ? html`
                      <button
                        class="action-btn action-btn--accent"
                        ?disabled=${this.busy}
                        @click=${() => this._emit("update-device")}
                      >
                        <wa-icon library="mdi" name="upload"></wa-icon>
                        ${this._localize("dashboard.update")}
                      </button>
                    `
                  : this.hasPendingChanges
                    ? html`
                        <button
                          class="action-btn action-btn--accent"
                          ?disabled=${this.busy}
                          @click=${() => this._emit("install-device")}
                        >
                          <wa-icon library="mdi" name="upload"></wa-icon>
                          ${this._localize("dashboard.install")}
                        </button>
                      `
                    : nothing}
                ${
                  // Collapse Logs to icon-only when an accent action
                  // (Install/Update) is present — Edit + accent + Logs
                  // + kebab overflows the 300px-min card in long-language
                  // locales like Dutch ("Bewerken"/"Installeren"/"Logboek").
                  // Logs collapses first since the console icon reads
                  // clearly without a label.
                  this.hasPendingChanges || this.hasUpdateAvailable
                    ? html`<button
                        class="action-btn action-btn--ghost action-btn--tile"
                        @click=${() => this._emit("open-logs")}
                        aria-label=${this._localize("dashboard.drawer_logs")}
                        title=${this._localize("dashboard.drawer_logs")}
                      >
                        <wa-icon library="mdi" name="console"></wa-icon>
                      </button>`
                    : html`<button
                        class="action-btn action-btn--ghost"
                        @click=${() => this._emit("open-logs")}
                      >
                        <wa-icon library="mdi" name="console"></wa-icon>
                        ${this._localize("dashboard.drawer_logs")}
                      </button>`
                }
                ${this.webUrl
                  ? html`<a
                      class="action-btn action-btn--ghost action-btn--tile"
                      href=${this.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label=${this._localize("dashboard.action_visit_web_ui")}
                      title=${this._localize("dashboard.action_visit_web_ui")}
                      @click=${(e: Event) => e.stopPropagation()}
                    >
                      <wa-icon library="mdi" name="open-in-new"></wa-icon>
                    </a>`
                  : nothing}
                <button
                  class="action-btn action-btn--ghost action-btn--icon-only"
                  aria-label=${this._localize("dashboard.more_options")}
                  @click=${this._onDotsClick}
                >
                  <wa-icon library="mdi" name="dots-vertical"></wa-icon>
                </button>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _renderEncryptionIcon() {
    // Compact-view variant: same gate the dashboard table uses,
    // hiding the green lock when mDNS has confirmed encryption
    // (the steady state on a healthy fleet) while keeping every
    // other state — including "waiting / unknown" — visible.
    // (issue #141)
    const visual = getCompactEncryptionVisual({
      api_enabled: this.apiEnabled,
      api_encrypted: this.apiEncrypted,
      api_encryption_active: this.apiEncryptionActive,
      has_pending_changes: this.hasPendingChanges,
    });
    if (!visual) return nothing;
    return html`<wa-icon
      class="encryption-icon ${visual.cssClass}"
      library="mdi"
      name=${visual.iconName}
      title=${this._localize(visual.tooltipKey)}
    ></wa-icon>`;
  }

  private _renderStatusBadge() {
    if (this.busy) {
      const labelKey =
        this.activeJob?.job_type === JobType.RENAME
          ? "dashboard.status_renaming"
          : "dashboard.status_installing";
      return html`<div
        class="device-status busy"
        @click=${(e: Event) => {
          e.stopPropagation();
          this._emit("show-progress");
        }}
      >
        <wa-spinner></wa-spinner>
        ${this._localize(labelKey)}
      </div>`;
    }
    if (this.recentJob) {
      const status = this.recentJob.status;
      const icon = RECENT_JOB_ICON[status];
      if (icon) {
        return html`<div
          class="device-status ${RECENT_JOB_VARIANT[status]}"
          title=${this._localize(RECENT_JOB_LABEL[status])}
        >
          <wa-icon library="mdi" name=${icon}></wa-icon>
          ${this._localize(RECENT_JOB_LABEL[status])}
        </div>`;
      }
    }
    // Transport-agnostic network icons — wifi/wifi-off implied a
    // wireless link, but plenty of devices on the network are on
    // ethernet. The ``check-network-outline`` /
    // ``network-off-outline`` / ``help-network-outline`` trio reads
    // as "online", "offline", and "unknown" without baking in a
    // guess about the link type.
    const stateIcon =
      this.state === DeviceState.ONLINE
        ? "check-network-outline"
        : this.state === DeviceState.OFFLINE
          ? "network-off-outline"
          : "help-network-outline";
    return html`<div class="device-status ${this.state}">
      <wa-icon library="mdi" name=${stateIcon}></wa-icon>
      ${this.state === DeviceState.ONLINE
        ? this._localize("dashboard.online")
        : this.state === DeviceState.OFFLINE
          ? this._localize("dashboard.offline")
          : this._localize("dashboard.unknown")}
    </div>`;
  }

  private _onKeydown = (e: KeyboardEvent) => {
    /* Only handle keys that actually originate on the host. Inner
       buttons (Edit, Install, kebab, etc.) get their own keyboard
       behaviour from the browser; if the user is focused on Edit and
       presses Enter, the button click handler fires — we shouldn't
       also navigate the card. composedPath()[0] is the real target
       inside the shadow tree; e.target is retargeted to the host
       from outside, so it can't be used to distinguish these. */
    if (e.composedPath()[0] !== this) return;

    if (e.key === "Enter") {
      /* Native buttons activate Enter on keydown — match that so users
         get the same instant feedback they'd see on a <button>. */
      if (e.repeat) return;
      e.preventDefault();
      this._emit(this.selectMode ? "toggle-select" : "card-click");
      return;
    }

    if (e.key === " ") {
      /* Space activation is deferred to keyup (the native <button>
         contract). preventDefault on keydown stops the page-scroll
         that Space would otherwise trigger; the actual emit happens
         in _onKeyup so a held-down Space doesn't fire repeatedly. */
      e.preventDefault();
      this._spaceArmed = true;
      return;
    }

    if (
      e.key === "ArrowRight" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "Home" ||
      e.key === "End"
    ) {
      e.preventDefault();
      this._navigateCards(e.key);
    }
  };

  private _spaceArmed = false;
  private _onKeyup = (e: KeyboardEvent) => {
    if (e.key !== " ") return;
    if (e.composedPath()[0] !== this) return;
    if (!this._spaceArmed) return;
    this._spaceArmed = false;
    e.preventDefault();
    this._emit(this.selectMode ? "toggle-select" : "card-click");
  };

  private _navigateCards(key: string) {
    const grid = this.parentElement;
    if (!grid) return;
    const cards = Array.from(
      grid.querySelectorAll<ESPHomeDeviceCard>("esphome-device-card"),
    );
    const idx = cards.indexOf(this);
    if (idx < 0) return;

    if (key === "Home") return cards[0]?.focus();
    if (key === "End") return cards[cards.length - 1]?.focus();
    if (key === "ArrowRight") return cards[idx + 1]?.focus();
    if (key === "ArrowLeft") return cards[idx - 1]?.focus();

    /* Up / Down: pick the card on the next row whose horizontal centre
       is closest to ours. The grid uses auto-fill columns so the column
       count varies by viewport — using the rendered rects keeps the nav
       working at any width without re-deriving the column count. */
    const rect = this.getBoundingClientRect();
    const myCenter = rect.left + rect.width / 2;
    const direction = key === "ArrowDown" ? 1 : -1;
    const withRects = cards
      .filter((c) => c !== this)
      .map((c) => ({ c, r: c.getBoundingClientRect() }))
      .filter(({ r }) => direction * (r.top - rect.top) > 1);
    if (!withRects.length) return;
    withRects.sort((a, b) => direction * (a.r.top - b.r.top));
    const targetTop = withRects[0].r.top;
    const sameRow = withRects.filter(({ r }) => Math.abs(r.top - targetTop) < 1);
    sameRow.sort(
      (a, b) =>
        Math.abs(a.r.left + a.r.width / 2 - myCenter) -
        Math.abs(b.r.left + b.r.width / 2 - myCenter),
    );
    sameRow[0]?.c.focus();
  }

  private _onClick = () => {
    this._emit(this.selectMode ? "toggle-select" : "card-click");
  };

  private _onHostContextMenu = (e: MouseEvent) => {
    /* Suppressed in select mode — the dashboard hides per-row actions
       there and a right-click menu would just be misleading. Otherwise
       open the same overflow menu the kebab dispatches. */
    if (this.selectMode) return;
    /* Don't hijack right-clicks that originate on inner interactive
       controls. The Visit Web UI link in particular needs the
       browser's native context menu so users can "Open in new tab" /
       "Copy link"; same goes for any inner button. composedPath()
       crosses the shadow boundary so we see the real target. */
    for (const el of e.composedPath()) {
      if (!(el instanceof HTMLElement)) continue;
      if (el === this) break;
      const tag = el.tagName;
      if (tag === "A" || tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }
    }
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("card-context-menu", {
        detail: { x: e.clientX, y: e.clientY },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onDotsClick(e: MouseEvent) {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    this.dispatchEvent(
      new CustomEvent("card-context-menu", {
        detail: { x: rect.right, y: rect.bottom },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _emit(name: string) {
    this.dispatchEvent(
      new CustomEvent(name, { bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-card": ESPHomeDeviceCard;
  }
}
