import { consume } from "@lit/context";
import {
  mdiBugOutline,
  mdiClipboardListOutline,
  mdiForumOutline,
  mdiLightbulbOutline,
  mdiMagnify,
  mdiOpenInNew,
} from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext, serverVersionContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";

registerMdiIcons({
  "bug-outline": mdiBugOutline,
  "clipboard-list-outline": mdiClipboardListOutline,
  "forum-outline": mdiForumOutline,
  "lightbulb-outline": mdiLightbulbOutline,
  magnify: mdiMagnify,
  "open-in-new": mdiOpenInNew,
});

const SURVEY_LINK = {
  icon: "clipboard-list-outline",
  labelKey: "feedback.survey",
  href: "https://usabi.li/do/3wv9cloipto9/wadwk6",
} as const;

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
  {
    icon: "forum-outline",
    labelKey: "feedback.discord",
    href: "https://discord.gg/Rf2jWGVjaK",
  },
] as const;

const NEW_ISSUE_LABEL_KEY = "feedback.new_issue";

@customElement("esphome-feedback-dialog")
export class ESPHomeFeedbackDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: serverVersionContext, subscribe: true })
  @state()
  private _serverVersion = "";

  @state()
  private _open = false;

  private _hrefFor(link: (typeof LINKS)[number]): string {
    if (link.labelKey !== NEW_ISSUE_LABEL_KEY || !this._serverVersion) {
      return link.href;
    }
    const url = new URL(link.href);
    url.searchParams.set("version", this._serverVersion);
    return url.toString();
  }

  static styles = [
    espHomeStyles,
    css`
      esphome-base-dialog {
        --width: 460px;
      }

      /* Close-button styling comes from esphome-base-dialog (dialogCloseButtonStyles). */
      esphome-base-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      esphome-base-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }

      esphome-base-dialog::part(footer) {
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
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .link:hover {
        background: var(--esphome-tint);
        border-color: var(--esphome-tint-border);
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

      .link.featured {
        background: var(--esphome-primary);
        border-color: var(--esphome-primary);
        color: var(--esphome-on-primary);
        margin-bottom: var(--wa-space-s);
      }

      .link.featured:hover {
        background: var(--esphome-primary-hover);
        border-color: var(--esphome-primary-hover);
      }

      .link.featured .link-icon,
      .link.featured .link-external,
      .link.featured:hover .link-icon {
        color: var(--esphome-on-primary);
      }

      .link.featured .link-label {
        font-weight: var(--wa-font-weight-bold);
      }
    `,
  ];

  open() {
    this._open = true;
  }

  close() {
    this._open = false;
  }

  // Flip the reactive flag on the initiating close (X / Esc / outside-click)
  // before the hide animation, then let after-hide settle it.
  private _onRequestClose = (): void => {
    this._open = false;
  };

  private _onAfterHide = (): void => {
    this._open = false;
  };

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._localize("feedback.title")}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <p class="description">${this._localize("feedback.description")}</p>
        <div class="links">
          <a
            class="link featured"
            href=${SURVEY_LINK.href}
            target="_blank"
            rel="noopener noreferrer"
            @click=${this.close}
          >
            <wa-icon class="link-icon" library="mdi" name=${SURVEY_LINK.icon}></wa-icon>
            <span class="link-label">${this._localize(SURVEY_LINK.labelKey)}</span>
            <wa-icon class="link-external" library="mdi" name="open-in-new"></wa-icon>
          </a>
          ${LINKS.map(
            (link) => html`
              <a
                class="link"
                href=${this._hrefFor(link)}
                target="_blank"
                rel="noopener noreferrer"
                @click=${this.close}
              >
                <wa-icon class="link-icon" library="mdi" name=${link.icon}></wa-icon>
                <span class="link-label">${this._localize(link.labelKey)}</span>
                <wa-icon class="link-external" library="mdi" name="open-in-new"></wa-icon>
              </a>
            `
          )}
        </div>
      </esphome-base-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-feedback-dialog": ESPHomeFeedbackDialog;
  }
}
