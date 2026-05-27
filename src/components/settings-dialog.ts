import { consume } from "@lit/context";
import {
  mdiClose,
  mdiHandshake,
  mdiHandshakeOutline,
  mdiPalette,
  mdiPaletteOutline,
  mdiSend,
  mdiSendOutline,
  mdiServerNetwork,
  mdiServerNetworkOutline,
  mdiTranslate,
  mdiVectorDifference,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { OffloaderAlertSnapshotEntry } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { buildOffloadAlertsContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";
import {
  settingsRowStyles,
  settingsSharedStyles,
} from "./settings-dialog/shared-styles.js";
import { SECTIONS, type Section, type SectionDef } from "./settings-dialog/types.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";
import "./settings-dialog/appearance-section.js";
import "./settings-dialog/build-offload-section.js";
import "./settings-dialog/build-server-section.js";
import "./settings-dialog/editor-section.js";
import "./settings-dialog/language-section.js";
import "./settings-dialog/pairing-requests-section.js";

registerMdiIcons({
  close: mdiClose,
  handshake: mdiHandshake,
  "handshake-outline": mdiHandshakeOutline,
  palette: mdiPalette,
  "palette-outline": mdiPaletteOutline,
  send: mdiSend,
  "send-outline": mdiSendOutline,
  "server-network": mdiServerNetwork,
  "server-network-outline": mdiServerNetworkOutline,
  translate: mdiTranslate,
  "vector-difference": mdiVectorDifference,
});

@customElement("esphome-settings-dialog")
export class ESPHomeSettingsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Offloader-side alerts (pin_mismatch / peer_revoked).
   *  Drives the notification dot on the 'Send builds' nav item
   *  so the operator sees there's an alert to act on without
   *  having to click into the section first. ``null`` until
   *  subscribe_events snapshot lands. The header-actions
   *  component owns the matching dot on the settings gear. */
  @consume({ context: buildOffloadAlertsContext, subscribe: true })
  @state()
  private _offloaderAlerts: Map<string, OffloaderAlertSnapshotEntry> | null = null;

  @state()
  private _section: Section = "appearance";

  @state()
  private _open = false;

  static styles = [espHomeStyles, settingsSharedStyles, settingsRowStyles];

  open() {
    this._section = "appearance";
    this._open = true;
  }

  close() {
    this._open = false;
  }

  protected render() {
    const current = SECTIONS.find((s) => s.id === this._section) ?? SECTIONS[0];
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label="${this._localize("settings.title")} - ${this._localize(current.labelKey)}"
        @request-close=${this._onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <div class="layout">
          <aside class="sidebar">
            <nav class="nav">${this._renderNav()}</nav>
          </aside>
          <main class="content">
            <div class="content-body">
              ${this._open ? this._renderSection() : nothing}
            </div>
          </main>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _renderNav() {
    const flat = SECTIONS.filter((s) => !s.group);
    const experimental = SECTIONS.filter((s) => s.group === "experimental");
    // Pre-compute whether to render the alert dot on the
    // 'Send builds' (build_offload) entry. The dot's meaning is
    // 'something in this section needs your attention' -- driven
    // by the offloader-side alerts dict (pin_mismatch /
    // peer_revoked). Other sections don't have alert surfaces
    // today; the alertedSection switch lets future sections
    // (e.g. pairing_requests with PENDING rows) attach the same
    // dot without rewriting the render loop.
    const offloadAlerted =
      this._offloaderAlerts !== null && this._offloaderAlerts.size > 0;
    const sectionAlerted = (id: Section): boolean => {
      switch (id) {
        case "build_offload":
          return offloadAlerted;
        default:
          return false;
      }
    };
    const renderItem = (s: SectionDef) => {
      // The .nav-item-dot below is aria-hidden because it
      // carries no text content (purely visual chrome).
      // Without a parallel signal in the button's
      // accessible name, screen-reader users wouldn't be
      // told that this section needs attention. Inject
      // 'settings.nav_item_attention_suffix' into the
      // button's aria-label so the SR announcement reads
      // e.g. "Send builds, attention needed".
      const label = this._localize(s.labelKey);
      const ariaLabel = sectionAlerted(s.id)
        ? this._localize("settings.nav_item_attention_aria", { label })
        : label;
      // Swap to the filled MDI variant when this nav item is the
      // active section so the icon matches the bolded label.
      // Icons without an outline/filled pair (e.g. translate)
      // fall back to the same name.
      const isActive = s.id === this._section;
      const iconName = isActive && s.iconActive !== undefined ? s.iconActive : s.icon;
      return html`
        <button
          class="nav-item ${isActive ? "nav-item--active" : ""}"
          @click=${() => this._selectSection(s.id)}
          aria-label=${ariaLabel}
        >
          <wa-icon library="mdi" name=${iconName}></wa-icon>
          <span>${label}</span>
          ${sectionAlerted(s.id)
            ? html`<span class="nav-item-dot" aria-hidden="true"></span>`
            : nothing}
        </button>
      `;
    };
    return html`
      ${flat.map(renderItem)}
      ${experimental.length
        ? html`
            <div class="nav-group-header">
              ${this._localize("settings.experimental_tag")}
            </div>
            ${experimental.map(renderItem)}
          `
        : nothing}
    `;
  }

  private _renderSection() {
    switch (this._section) {
      case "appearance":
        return html`<esphome-settings-appearance></esphome-settings-appearance>`;
      case "language":
        return html`<esphome-settings-language></esphome-settings-language>`;
      case "editor":
        return html`<esphome-settings-editor></esphome-settings-editor>`;
      case "build_server":
        return html`<esphome-settings-build-server></esphome-settings-build-server>`;
      case "pairing_requests":
        return html`<esphome-settings-pairing-requests></esphome-settings-pairing-requests>`;
      case "build_offload":
        return html`<esphome-settings-build-offload></esphome-settings-build-offload>`;
    }
  }

  private _selectSection(section: Section) {
    this._section = section;
  }

  private _onRequestClose = (): void => {
    // Flip the local flag on the initiating click so the 1Hz
    // pairing tick can't re-assert ?open=true mid-hide animation.
    this._open = false;
  };

  private _onAfterHide = () => {
    this._open = false;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-dialog": ESPHomeSettingsDialog;
  }
}
