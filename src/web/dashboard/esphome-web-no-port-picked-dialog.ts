import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import { espHomeStyles } from "../../styles/shared.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

/**
 * USB-serial driver help for common ESP bridge chips. Static (not localized):
 * these are product names + vendor download URLs. Mirrors the legacy
 * web.esphome.io "No port selected" dialog.
 */
interface DriverRow {
  chips: string;
  links: { labelKey: string; href: string }[];
}

const DRIVERS: DriverRow[] = [
  {
    chips: "CP2102",
    links: [
      {
        labelKey: "web.no_port.windows_mac",
        href: "https://www.silabs.com/products/development-tools/software/usb-to-uart-bridge-vcp-drivers",
      },
    ],
  },
  {
    chips: "CH342, CH343, CH9102",
    links: [
      {
        labelKey: "web.no_port.windows",
        href: "https://www.wch.cn/downloads/CH343SER_ZIP.html",
      },
      {
        labelKey: "web.no_port.mac",
        href: "https://www.wch.cn/downloads/CH34XSER_MAC_ZIP.html",
      },
    ],
  },
  {
    chips: "CH340, CH341",
    links: [
      {
        labelKey: "web.no_port.windows",
        href: "https://www.wch.cn/downloads/CH341SER_ZIP.html",
      },
      {
        labelKey: "web.no_port.mac",
        href: "https://www.wch.cn/downloads/CH341SER_MAC_ZIP.html",
      },
    ],
  },
];

/**
 * Shown when the user dismisses the serial port picker (or no port is listed):
 * troubleshooting steps + USB-serial driver links, with an optional "Try again"
 * that re-runs the flow. Ported from legacy web.esphome.io's no-port-picked
 * dialog. Opened imperatively via ``openNoPortPickedDialog`` (so ``localize`` is
 * passed in rather than consumed from context — it lives outside the app-shell
 * tree once appended to ``document.body``).
 */
@customElement("esphome-web-no-port-picked-dialog")
export class ESPHomeWebNoPortPickedDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  /** Injected by the opener (this dialog renders outside the context tree). */
  @property({ attribute: false }) localize: LocalizeFunc = (key) => key;

  /** Optional retry — re-prompts the port picker. Renders a "Try again" button. */
  @property({ attribute: false }) onTryAgain?: () => void;

  private _tryAgain(): void {
    this.open = false;
    this.onTryAgain?.();
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  protected render() {
    return html`
      <esphome-base-dialog
        .label=${this.localize("web.no_port.title")}
        ?open=${this.open}
        @after-hide=${this._onAfterHide}
      >
        <p>${this.localize("web.no_port.intro")}</p>
        <ol>
          <li>${this.localize("web.no_port.step_connected")}</li>
          <li>${this.localize("web.no_port.step_light")}</li>
          <li>${this.localize("web.no_port.step_cable")}</li>
          <li>
            ${this.localize("web.no_port.step_drivers")}
            <ul class="drivers">
              ${DRIVERS.map(
                (d) =>
                  html`<li>
                    <span class="chips">${d.chips}:</span>
                    ${d.links.map(
                      (l, i) =>
                        html`${i > 0 ? " · " : ""}<a
                            href=${l.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            >${this.localize(l.labelKey)}</a
                          >`
                    )}
                  </li>`
              )}
            </ul>
          </li>
        </ol>
        <div class="actions">
          ${
            this.onTryAgain
              ? html`<wa-button variant="brand" @click=${this._tryAgain}>
                  ${this.localize("web.no_port.try_again")}
                </wa-button>`
              : nothing
          }
          <wa-button @click=${() => (this.open = false)}>
            ${
              this.onTryAgain
                ? this.localize("layout.cancel")
                : this.localize("layout.close")
            }
          </wa-button>
        </div>
      </esphome-base-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      ol {
        padding-left: 1.5em;
      }
      li + li {
        margin-top: var(--wa-space-2xs);
      }
      .drivers {
        margin: var(--wa-space-2xs) 0 0;
        padding-left: 1.2em;
      }
      .chips {
        font-weight: var(--wa-font-weight-semibold);
      }
      a {
        color: var(--esphome-primary);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-m);
      }
    `,
  ];
}

/**
 * Open the no-port-picked help dialog. Pass ``onTryAgain`` to offer a retry
 * (re-prompts the picker); omit it for a plain "Close".
 */
export function openNoPortPickedDialog(
  localize: LocalizeFunc,
  onTryAgain?: () => void
): void {
  const dialog = document.createElement("esphome-web-no-port-picked-dialog");
  dialog.localize = localize;
  dialog.onTryAgain = onTryAgain;
  dialog.addEventListener("after-hide", () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  dialog.open = true;
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-no-port-picked-dialog": ESPHomeWebNoPortPickedDialog;
  }
}
