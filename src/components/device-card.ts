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
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DeviceState } from "../api/types.js";
import type { FirmwareJob, Label } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { labelsContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { labelChipStyles } from "../util/label-chip-template.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { deviceCardStyles } from "./device-card/styles.js";
import { navigateCards, onHostContextMenu } from "./device-card/keyboard-nav.js";
import {
  renderEncryptionIcon,
  renderLabels,
  renderStatusBadge,
} from "./device-card/render-bits.js";

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
  @property({ type: Boolean, attribute: "has-pending-changes" }) hasPendingChanges =
    false;
  @property({ type: Boolean, attribute: "has-update-available" }) hasUpdateAvailable =
    false;
  @property({ type: Boolean, attribute: "api-enabled" }) apiEnabled = false;
  @property({ type: Boolean, attribute: "api-encrypted" }) apiEncrypted = false;

  // api_encryption TXT observed via mDNS. Combined with apiEncrypted and
  // hasPendingChanges to drive the 4-state lock indicator.
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
        class="device-card ${this.selectMode
          ? "device-card--selectable"
          : "device-card--clickable"} ${this.selectMode && this.selected
          ? "device-card--selected"
          : ""}"
      >
        <div class="device-card-header">
          ${this.selectMode
            ? html`
                <wa-icon
                  class="device-checkbox ${this.selected
                    ? "device-checkbox--checked"
                    : ""}"
                  library="mdi"
                  name=${this.selected ? "checkbox-marked" : "checkbox-blank-outline"}
                ></wa-icon>
              `
            : nothing}
          <div class="device-card-header-left">
            <div class="device-name-wrap">
              <h3 class="device-name">${this.name}</h3>
              ${this.hasPendingChanges
                ? html`<span
                    class="indicator-dot indicator-dot--modified"
                    title=${this._localize("dashboard.status_modified")}
                  ></span>`
                : nothing}
              ${this.hasUpdateAvailable
                ? html`<span
                    class="indicator-dot indicator-dot--update"
                    title=${this._localize("dashboard.status_update_available")}
                  ></span>`
                : nothing}
              ${renderEncryptionIcon(this)}
            </div>
            <p class="device-config">${this.configuration}</p>
          </div>
          ${renderStatusBadge(this)}
        </div>
        ${renderLabels(this)}
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
                ${this._renderAccentAction()}
                <button
                  class="action-btn action-btn--ghost action-btn--tile"
                  @click=${() => this._emit("open-logs")}
                  aria-label=${this._localize("dashboard.drawer_logs")}
                  title=${this._localize("dashboard.drawer_logs")}
                >
                  <wa-icon library="mdi" name="console"></wa-icon>
                </button>
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

  // Update / Install accent: icon-only so only Edit keeps a label.
  // Long-language locales (French / Dutch) overflow a 300px-min card if
  // every action is labelled; upload icon reads clearly without one.
  private _renderAccentAction() {
    if (this.hasUpdateAvailable) {
      return html`<button
        class="action-btn action-btn--accent action-btn--tile"
        ?disabled=${this.busy}
        @click=${() => this._emit("update-device")}
        aria-label=${this._localize("dashboard.update")}
        title=${this._localize("dashboard.update")}
      >
        <wa-icon library="mdi" name="upload"></wa-icon>
      </button>`;
    }
    if (this.hasPendingChanges) {
      return html`<button
        class="action-btn action-btn--accent action-btn--tile"
        ?disabled=${this.busy}
        @click=${() => this._emit("install-device")}
        aria-label=${this._localize("dashboard.install")}
        title=${this._localize("dashboard.install")}
      >
        <wa-icon library="mdi" name="upload"></wa-icon>
      </button>`;
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
