import { consume } from "@lit/context";
import { mdiArrowLeft, mdiSerialPort } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SerialPort } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import type { DeploymentEnvironment } from "../../util/environment.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
  "serial-port": mdiSerialPort,
});

/**
 * Server-side serial-port picker rendered inline inside the new-
 * device wizard's board step when WebSerial isn't available.
 *
 * Presentation-only: the parent (``wizard-step-board``) owns the
 * port list and the ``config/detect_chip`` call. This element
 * fires ``select-port`` / ``back`` and otherwise just renders the
 * current state. Splitting it out keeps ``wizard-step-board.ts``
 * from blowing past the file-size cap and lines the markup up with
 * the install dialog's port-select view ([install-method-dialog.ts]
 * lines 569-609) so the two stay visually consistent.
 *
 * The heading key varies by where the backend lives: on
 * ``localhost`` the user is plugging the board into their own
 * computer; on the HA add-on they're plugging it into the HA
 * server; remote setups fall back to the generic "computer
 * running the device builder" phrasing.
 */
@customElement("esphome-wizard-step-board-port-select")
export class ESPHomeWizardStepBoardPortSelect extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  environment: DeploymentEnvironment = "remote";

  @property({ attribute: false })
  ports: SerialPort[] = [];

  @property({ type: Boolean })
  loading = false;

  @property({ type: Boolean })
  detecting = false;

  @property({ attribute: false })
  errorMessage = "";

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .heading {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        margin: 0;
        line-height: 1.3;
      }

      .back-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 0;
        background: none;
        border: none;
        font-family: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
        align-self: flex-start;
      }

      .back-btn wa-icon {
        font-size: 16px;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        padding: var(--wa-space-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        cursor: pointer;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .option:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
        border-color: var(--esphome-primary);
      }

      .option wa-icon {
        font-size: 28px;
        color: var(--esphome-primary);
        flex-shrink: 0;
      }

      .info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .desc {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.4;
      }

      .status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-xl) 0;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }

      .empty {
        text-align: center;
        padding: var(--wa-space-l) 0;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        line-height: 1.5;
      }

      .error {
        text-align: center;
        padding: var(--wa-space-l) 0;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        line-height: 1.5;
      }
    `,
  ];

  protected render() {
    return html`
      <button class="back-btn" type="button" @click=${this._onBack}>
        <wa-icon library="mdi" name="arrow-left"></wa-icon>
        ${this._localize("wizard.connect_your_board_back")}
      </button>
      <h3 class="heading" role="status">${this._headingText()}</h3>
      ${this._renderBody()}
    `;
  }

  private _renderBody() {
    if (this.detecting) {
      return html`
        <div class="status">
          <wa-spinner></wa-spinner>
          ${this._localize("wizard.connect_your_board_detecting")}
        </div>
      `;
    }
    if (this.loading) {
      return html`
        <div class="status">
          <wa-spinner></wa-spinner>
          ${this._localize("wizard.connect_your_board_loading_ports")}
        </div>
      `;
    }
    if (this.errorMessage) {
      return html`<div class="error">${this.errorMessage}</div>`;
    }
    if (this.ports.length === 0) {
      return html`
        <div class="empty">
          ${this._localize("wizard.connect_your_board_no_ports")}
        </div>
      `;
    }
    return html`
      <div class="list">
        ${this.ports.map(
          (p) => html`
            <div class="option" @click=${() => this._onSelect(p.port)}>
              <wa-icon library="mdi" name="serial-port"></wa-icon>
              <div class="info">
                <span class="title">${p.port}</span>
                ${p.desc ? html`<span class="desc">${p.desc}</span>` : nothing}
              </div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private _headingText(): string {
    switch (this.environment) {
      case "ha-addon":
        return this._localize("wizard.connect_your_board_select_port_ha");
      case "localhost":
        return this._localize("wizard.connect_your_board_select_port_localhost");
      case "remote":
      default:
        return this._localize("wizard.connect_your_board_select_port_remote");
    }
  }

  private _onSelect(port: string) {
    this.dispatchEvent(
      new CustomEvent("select-port", {
        detail: { port },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onBack = () => {
    this.dispatchEvent(new CustomEvent("back", { bubbles: true, composed: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-board-port-select": ESPHomeWizardStepBoardPortSelect;
  }
}
