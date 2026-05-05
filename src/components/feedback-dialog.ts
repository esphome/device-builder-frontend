import { consume } from "@lit/context";
import {
  mdiBugOutline,
  mdiLightbulbOutline,
  mdiMagnify,
  mdiOpenInNew,
} from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "bug-outline": mdiBugOutline,
  "lightbulb-outline": mdiLightbulbOutline,
  magnify: mdiMagnify,
  "open-in-new": mdiOpenInNew,
});

const LINKS = [
  {
    icon: "magnify",
    labelKey: "feedback.browse_issues",
    href: "https://github.com/esphome/device-builder/issues",
  },
  {
    icon: "bug-outline",
    labelKey: "feedback.new_issue",
    href: "https://github.com/esphome/device-builder/issues/new?template=bug_report.yml",
  },
  {
    icon: "magnify",
    labelKey: "feedback.browse_features",
    href: "https://github.com/orgs/esphome/discussions/categories/builder-features-or-enhancements?discussions_q=is%3Aopen+category%3A%22Builder+features+or+enhancements%22+sort%3Atop",
  },
  {
    icon: "lightbulb-outline",
    labelKey: "feedback.new_feature",
    href: "https://github.com/orgs/esphome/discussions/new?category=builder-features-or-enhancements",
  },
] as const;

@customElement("esphome-feedback-dialog")
export class ESPHomeFeedbackDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 460px;
      }

      wa-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      wa-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
      }

      wa-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .description {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
        margin: 0 0 var(--wa-space-m);
      }

      .links {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
      }

      .link {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: 10px var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
        text-decoration: none;
        transition: background 0.12s, border-color 0.12s;
      }

      .link:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
        border-color: color-mix(in srgb, var(--esphome-primary), transparent 60%);
      }

      .link:hover .link-icon {
        color: var(--esphome-primary);
      }

      .link-icon {
        font-size: 18px;
        color: var(--wa-color-text-quiet);
        flex-shrink: 0;
      }

      .link-label {
        flex: 1;
      }

      .link-external {
        font-size: 14px;
        color: var(--wa-color-text-quiet);
        flex-shrink: 0;
      }
    `,
  ];

  open() {
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    return html`
      <wa-dialog
        label=${this._localize("feedback.title")}
        light-dismiss
      >
        <p class="description">${this._localize("feedback.description")}</p>
        <div class="links">
          ${LINKS.map(
            (link) => html`
              <a
                class="link"
                href=${link.href}
                target="_blank"
                rel="noopener noreferrer"
                @click=${this.close}
              >
                <wa-icon class="link-icon" library="mdi" name=${link.icon}></wa-icon>
                <span class="link-label">${this._localize(link.labelKey)}</span>
                <wa-icon
                  class="link-external"
                  library="mdi"
                  name="open-in-new"
                ></wa-icon>
              </a>
            `,
          )}
        </div>
      </wa-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-feedback-dialog": ESPHomeFeedbackDialog;
  }
}
