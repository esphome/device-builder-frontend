import { consume } from "@lit/context";
import {
  mdiClose,
  mdiHandshakeOutline,
  mdiPaletteOutline,
  mdiSendOutline,
  mdiServerNetwork,
  mdiTranslate,
  mdiVectorDifference,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
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
  "handshake-outline": mdiHandshakeOutline,
  "palette-outline": mdiPaletteOutline,
  "send-outline": mdiSendOutline,
  "server-network": mdiServerNetwork,
  translate: mdiTranslate,
  "vector-difference": mdiVectorDifference,
});

@customElement("esphome-settings-dialog")
export class ESPHomeSettingsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

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
    const renderItem = (s: SectionDef) => html`
      <button
        class="nav-item ${s.id === this._section ? "nav-item--active" : ""}"
        @click=${() => this._selectSection(s.id)}
      >
        <wa-icon library="mdi" name=${s.icon}></wa-icon>
        <span>${this._localize(s.labelKey)}</span>
      </button>
    `;
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
