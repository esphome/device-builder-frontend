import { consume } from "@lit/context";
import {
  mdiCancel,
  mdiCheckCircle,
  mdiCheckNetworkOutline,
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiClockOutline,
  mdiCloseCircle,
  mdiDotsVertical,
  mdiHelpNetworkOutline,
  mdiLock,
  mdiLockAlert,
  mdiLockClock,
  mdiLockOpenVariant,
  mdiNetworkOffOutline,
  mdiOpenInNew,
  mdiPencil,
  mdiTextBoxOutline,
  mdiUpload,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Label } from "../api/types/devices.js";
import { DeviceState } from "../api/types/devices.js";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import type { LocalizeFunc } from "../common/localize.js";
import { labelsContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { labelChipStyles } from "../util/label-chip-template.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { busyActionLabel, updateActionTitle } from "../util/update-tooltip.js";
import { renderVisitWebUiLink } from "../util/visit-web-ui-link.js";
import { navigateCards, onHostContextMenu } from "./device-card/keyboard-nav.js";
import {
  renderEncryptionIcon,
  renderLabels,
  renderStatusBadge,
} from "./device-card/render-bits.js";
import { deviceCardStyles } from "./device-card/styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

registerMdiIcons({
  cancel: mdiCancel,
  "check-circle": mdiCheckCircle,
  "checkbox-blank-outline": mdiCheckboxBlankOutline,
  "checkbox-marked": mdiCheckboxMarked,
  "close-circle": mdiCloseCircle,
  "text-box-outline": mdiTextBoxOutline,
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
  "clock-outline": mdiClockOutline,
});

@customElement("esphome-device-card")
export class ESPHomeDeviceCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;
  @consume({ context: labelsContext, subscribe: true }) @state() _labelCatalog: Label[] =
    [];

  // Resolved against the catalog at render time so a recolor / rename in
  // another client repaints every card without per-card state.
  @property({ attribute: false }) labelIds: string[] = [];

  @property({ attribute: false }) name = "";
  @property() configuration = "";
  @property() state: DeviceState = DeviceState.UNKNOWN;
  // Raw device truth (``has_pending_changes``). Drives the 4-state encryption
  // lock indicator only — a local YAML edit not yet flashed, independent of
  // mDNS — so it stays in sync with the drawer's raw-flag badge.
  @property({ type: Boolean, attribute: "has-pending-changes" }) hasPendingChanges =
    false;
  // mDNS-gated display flags (see util/device-sync.ts): whether to surface the
  // modified / update affordances (dot + install / update button).
  @property({ type: Boolean, attribute: "show-modified" }) showModified = false;
  @property({ type: Boolean, attribute: "show-update" }) showUpdate = false;
  @property({ type: Boolean, attribute: "queued-update" }) queuedUpdate = false;

  // Installed + target ESPHome versions for the Update hover.
  @property({ attribute: false }) installedVersion = "";
  @property({ attribute: false }) availableVersion = "";
  @property({ type: Boolean, attribute: "api-enabled" }) apiEnabled = false;
  @property({ type: Boolean, attribute: "api-encrypted" }) apiEncrypted = false;

  // api_encryption TXT observed via mDNS. Combined with apiEncrypted and the
  // raw hasPendingChanges to drive the 4-state lock indicator.
  @property({ attribute: false }) apiEncryptionActive: string | null = null;

  @property({ type: Boolean }) busy = false;

  // The running job (if any) — powers the status-badge label so a rename
  // reads as "Renaming" rather than the install/compile path's "Installing".
  @property({ attribute: false }) activeJob: FirmwareJob | null = null;
  @property({ attribute: false }) recentJob: FirmwareJob | null = null;

  @property({ type: Boolean, attribute: "select-mode" }) selectMode = false;
  @property({ type: Boolean }) selected = false;

  // Pre-built so the card doesn't depend on ConfiguredDevice shape;
  // buildWebUiUrl is the shared source of truth for protocol/port logic.
  @property() webUrl = "";

  // Briefly highlight with an accent border + glow (e.g. a freshly-adopted
  // device). Driven + cleared by the dashboard.
  @property({ type: Boolean, reflect: true }) highlight = false;

  private _spaceArmed = false;

  static styles = [espHomeStyles, labelChipStyles, ...deviceCardStyles];

  connectedCallback() {
    super.connectedCallback();
    // Host is the focusable target for keyboard nav. Inner action buttons
    // remain in the tab order so keyboard users can reach Edit / Install
    // / Logs without leaving the keyboard.
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    if (!this.hasAttribute("role")) this.setAttribute("role", "button");
    this.addEventListener("keydown", this._onKeydown);
    this.addEventListener("keyup", this._onKeyup);
    // Activation has to live on the host — some assistive tech activates a
    // focused role="button" by dispatching click on the focused element
    // itself; on the inner .device-card it wouldn't reach. Inner buttons
    // + actions row already stopPropagation so this only fires on body.
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
      // Label is the device name; selected state is conveyed via
      // aria-pressed below so screen readers announce it in the user's locale.
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
        class="device-card ${
          this.selectMode ? "device-card--selectable" : "device-card--clickable"
        } ${this.selectMode && this.selected ? "device-card--selected" : ""}"
      >
        <div class="device-card-header">
          ${
            this.selectMode
              ? html`
                  <wa-icon
                    class="device-checkbox ${
                      this.selected ? "device-checkbox--checked" : ""
                    }"
                    library="mdi"
                    name=${this.selected ? "checkbox-marked" : "checkbox-blank-outline"}
                  ></wa-icon>
                `
              : nothing
          }
          <div class="device-card-header-left">
            <div class="device-name-wrap">
              <h3 class="device-name">${this.name}</h3>
              ${
                this.showModified
                  ? html`<span
                        id="ind-modified"
                        class="indicator-dot indicator-dot--modified"
                        tabindex="0"
                        role="img"
                        aria-label=${this._localize("dashboard.status_modified")}
                      ></span>
                      <wa-tooltip for="ind-modified">
                        ${this._localize("dashboard.status_modified")}
                      </wa-tooltip>`
                  : nothing
              }
              ${
                this.showUpdate
                  ? html`<span
                        id="ind-update"
                        class="indicator-dot indicator-dot--update"
                        tabindex="0"
                        role="img"
                        aria-label=${this._localize("dashboard.status_update_available")}
                      ></span>
                      <wa-tooltip for="ind-update">
                        ${this._localize("dashboard.status_update_available")}
                      </wa-tooltip>`
                  : nothing
              }
              ${
                this.queuedUpdate
                  ? html`<wa-icon
                        id="ind-queued"
                        class="indicator-queued"
                        library="mdi"
                        name="clock-outline"
                        tabindex="0"
                        role="img"
                        aria-label=${this._localize("dashboard.status_queued_update")}
                      ></wa-icon>
                      <wa-tooltip for="ind-queued">
                        ${this._localize("dashboard.status_queued_update")}
                      </wa-tooltip>`
                  : nothing
              }
              ${renderEncryptionIcon(this)}
            </div>
            <p class="device-config">${this.configuration}</p>
          </div>
          ${renderStatusBadge(this)}
        </div>
        ${renderLabels(this)}
        ${
          !this.selectMode
            ? html`
                <div class="device-actions" @click=${(e: Event) => e.stopPropagation()}>
                  <button
                    class="action-btn action-btn--primary"
                    @click=${() => this._emit("edit-device")}
                  >
                    <wa-icon library="mdi" name="pencil"></wa-icon>
                    ${this._localize("dashboard.edit")}
                  </button>
                  ${this._renderAccentAction()}
                  <button
                    id="btn-logs"
                    class="action-btn action-btn--ghost action-btn--tile"
                    @click=${() => this._emit("open-logs")}
                    aria-label=${this._localize("dashboard.drawer_logs")}
                  >
                    <wa-icon library="mdi" name="text-box-outline"></wa-icon>
                  </button>
                  <wa-tooltip for="btn-logs">
                    ${this._localize("dashboard.drawer_logs")}
                  </wa-tooltip>
                  ${
                    this.webUrl
                      ? renderVisitWebUiLink(this.webUrl, this._localize, {
                          className: "action-btn action-btn--ghost action-btn--tile",
                          onClick: (e) => e.stopPropagation(),
                          tooltipId: "btn-web-ui",
                        })
                      : nothing
                  }
                  <button
                    id="btn-more"
                    class="action-btn action-btn--ghost action-btn--icon-only"
                    aria-label=${this._localize("dashboard.more_options")}
                    @click=${this._onDotsClick}
                  >
                    <wa-icon library="mdi" name="dots-vertical"></wa-icon>
                  </button>
                  <wa-tooltip for="btn-more">
                    ${this._localize("dashboard.more_options")}
                  </wa-tooltip>
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  // Update / Install accent: icon-only so only Edit keeps a label.
  // Long-language locales (French / Dutch) overflow a 300px-min card if
  // every action is labelled; upload icon reads clearly without one.
  private _renderAccentAction() {
    if (this.showUpdate) {
      return html`<button
          id="btn-accent"
          class="action-btn action-btn--accent action-btn--tile"
          @click=${() => this._emit(this.busy ? "show-progress" : "update-device")}
          aria-label=${busyActionLabel(this._localize, this.busy, "dashboard.update")}
        >
          <wa-icon library="mdi" name="upload"></wa-icon>
        </button>
        <wa-tooltip for="btn-accent">
          ${updateActionTitle(
            this._localize,
            this.busy,
            this.installedVersion,
            this.availableVersion,
            "dashboard.update"
          )}
        </wa-tooltip>`;
    }
    if (this.showModified) {
      const label = busyActionLabel(this._localize, this.busy, "dashboard.install");
      return html`<button
          id="btn-accent"
          class="action-btn action-btn--accent action-btn--tile"
          @click=${() => this._emit(this.busy ? "show-progress" : "install-device")}
          aria-label=${label}
        >
          <wa-icon library="mdi" name="upload"></wa-icon>
        </button>
        <wa-tooltip for="btn-accent">${label}</wa-tooltip>`;
    }
    return nothing;
  }

  // Only handle keys originating on the host. composedPath()[0] is the real
  // target inside the shadow tree; e.target is retargeted from outside.
  private _onKeydown = (e: KeyboardEvent) => {
    if (e.composedPath()[0] !== this) return;

    if (e.key === "Enter") {
      // Native buttons activate Enter on keydown — match for instant feedback.
      if (e.repeat) return;
      e.preventDefault();
      this._emit(this.selectMode ? "toggle-select" : "card-click");
      return;
    }

    if (e.key === " ") {
      // Space activation deferred to keyup (native button contract).
      // preventDefault stops page-scroll; emit lives in keyup so a held
      // Space doesn't fire repeatedly.
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
      navigateCards(this, e.key);
    }
  };

  private _onKeyup = (e: KeyboardEvent) => {
    if (e.key !== " ") return;
    if (e.composedPath()[0] !== this) return;
    if (!this._spaceArmed) return;
    this._spaceArmed = false;
    e.preventDefault();
    this._emit(this.selectMode ? "toggle-select" : "card-click");
  };

  private _onClick = () => {
    this._emit(this.selectMode ? "toggle-select" : "card-click");
  };

  private _onHostContextMenu = (e: MouseEvent) => onHostContextMenu(this, e);

  private _onDotsClick(e: MouseEvent) {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    this.dispatchEvent(
      new CustomEvent("card-context-menu", {
        detail: { x: rect.right, y: rect.bottom },
        bubbles: true,
        composed: true,
      })
    );
  }

  _emit(name: string) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-card": ESPHomeDeviceCard;
  }
}
