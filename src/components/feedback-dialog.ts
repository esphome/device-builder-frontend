import { consume } from "@lit/context";
import {
  mdiAccessPointNetwork,
  mdiArrowLeft,
  mdiBugOutline,
  mdiChevronRight,
  mdiChip,
  mdiClipboardListOutline,
  mdiForumOutline,
  mdiLightbulbOutline,
  mdiMagnify,
  mdiOpenInNew,
} from "@mdi/js";
import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  localizeContext,
  serverVersionContext,
  versionContext,
} from "../context/index.js";
import { dialogChromeStyles } from "../styles/dialog-chrome.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";

registerMdiIcons({
  "access-point-network": mdiAccessPointNetwork,
  "arrow-left": mdiArrowLeft,
  "bug-outline": mdiBugOutline,
  "chevron-right": mdiChevronRight,
  chip: mdiChip,
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

type DrillScreen = "browse" | "bug";
type Screen = "main" | DrillScreen;

interface FeedbackLinkBase {
  icon: string;
  labelKey: string;
  descKey?: string;
}

// Opens a URL. "versionSource" prefills the destination form's "version" field
// from the matching context: "dashboard" is our server version, "esphome" is
// the installed core version.
interface ExternalLink extends FeedbackLinkBase {
  href: string;
  versionSource?: "dashboard" | "esphome";
  drillTo?: never;
}

// Navigates to a second in-dialog screen instead of opening a link; rendered as
// a button with a chevron rather than an anchor.
interface DrillLink extends FeedbackLinkBase {
  drillTo: DrillScreen;
  href?: never;
  versionSource?: never;
}

// Discriminated union so a link is always exactly one of the two shapes; a row
// can never omit both href and drillTo and silently render an empty anchor.
type FeedbackLink = ExternalLink | DrillLink;

// Both the "Report a new issue" and "Browse open issues" rows drill into a
// second screen that splits Device Builder from ESPHome core, so people stop
// filing core firmware problems here and status reports reach their template.
const BUG_LINKS: ReadonlyArray<FeedbackLink> = [
  {
    icon: "bug-outline",
    labelKey: "feedback.bug_builder",
    descKey: "feedback.bug_builder_desc",
    href: "https://github.com/esphome/device-builder/issues/new?template=bug_report.yml",
    versionSource: "dashboard",
  },
  {
    icon: "access-point-network",
    labelKey: "feedback.bug_status",
    descKey: "feedback.bug_status_desc",
    href: "https://github.com/esphome/device-builder/issues/new?template=device_status.yml",
    versionSource: "dashboard",
  },
  {
    icon: "chip",
    labelKey: "feedback.bug_esphome",
    descKey: "feedback.bug_esphome_desc",
    href: "https://github.com/esphome/esphome/issues/new?template=bug_report.yml",
    versionSource: "esphome",
  },
];

const BROWSE_LINKS: ReadonlyArray<FeedbackLink> = [
  {
    icon: "bug-outline",
    labelKey: "feedback.browse_builder",
    descKey: "feedback.browse_builder_desc",
    href: "https://github.com/esphome/device-builder/issues",
  },
  {
    icon: "chip",
    labelKey: "feedback.browse_esphome",
    descKey: "feedback.browse_esphome_desc",
    href: "https://github.com/esphome/esphome/issues",
  },
];

const DRILL_SCREENS: Record<
  DrillScreen,
  { titleKey: string; links: ReadonlyArray<FeedbackLink> }
> = {
  browse: { titleKey: "feedback.browse_issues", links: BROWSE_LINKS },
  bug: { titleKey: "feedback.new_issue", links: BUG_LINKS },
};

const SECTIONS: ReadonlyArray<{
  labelKey: string;
  links: ReadonlyArray<FeedbackLink>;
}> = [
  {
    labelKey: "feedback.group_bug",
    links: [
      {
        icon: "magnify",
        labelKey: "feedback.browse_issues",
        drillTo: "browse",
      },
      {
        icon: "bug-outline",
        labelKey: "feedback.new_issue",
        drillTo: "bug",
      },
    ],
  },
  {
    labelKey: "feedback.group_feature",
    links: [
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
    ],
  },
  {
    labelKey: "feedback.group_community",
    links: [
      {
        icon: "forum-outline",
        labelKey: "feedback.discord",
        href: "https://discord.gg/Rf2jWGVjaK",
      },
    ],
  },
];

@customElement("esphome-feedback-dialog")
export class ESPHomeFeedbackDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: serverVersionContext, subscribe: true })
  @state()
  private _serverVersion = "";

  @consume({ context: versionContext, subscribe: true })
  @state()
  private _esphomeVersion = "";

  @state()
  private _open = false;

  @state()
  private _screen: Screen = "main";

  private _hrefFor(link: FeedbackLink): string {
    if (!link.href) {
      return "";
    }
    const version =
      link.versionSource === "esphome"
        ? this._esphomeVersion
        : link.versionSource === "dashboard"
          ? this._serverVersion
          : "";
    if (!version) {
      return link.href;
    }
    const url = new URL(link.href);
    url.searchParams.set("version", version);
    return url.toString();
  }

  static styles = [
    espHomeStyles,
    // Neutral header + title + footer (shared) — dialog-chrome.ts.
    dialogChromeStyles,
    css`
      esphome-base-dialog {
        --width: 460px;
      }

      /* Extra bottom padding here (the link list has no actions row). */
      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
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

      .section-header {
        margin: var(--wa-space-m) 0 var(--wa-space-2xs);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--wa-color-text-quiet);
      }

      .link {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-xs) var(--wa-space-s);
        border-radius: var(--wa-border-radius-m);
        /* A faint grey outline at rest gives each row a quiet edge; the brand
           wash takes over on hover. No glow, no ring. */
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: transparent;
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
        text-decoration: none;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      /* The drill row is a button; strip the native chrome so it matches the
         anchor rows. */
      button.link {
        width: 100%;
        text-align: left;
        font-family: inherit;
        cursor: pointer;
      }

      .link:hover {
        border-color: transparent;
        background: var(--esphome-tint);
      }

      .link:hover .link-external,
      .link:focus-visible .link-external {
        opacity: 1;
      }

      .link-icon {
        font-size: 20px;
        color: var(--esphome-primary);
        flex-shrink: 0;
      }

      .link-text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .link-desc {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.4;
      }

      .back-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--wa-space-2xs);
        border: none;
        background: transparent;
        color: var(--wa-color-text-normal);
        cursor: pointer;
        font-size: 20px;
      }

      .link-external {
        font-size: 14px;
        color: var(--wa-color-text-quiet);
        flex-shrink: 0;
        opacity: 0;
        transition: opacity 0.12s;
      }

      /* The drill chevron is the only cue a row navigates deeper, so it stays
         visible at rest (unlike the hover-only external-link glyph) for touch
         users with no hover state. */
      .link-chevron {
        font-size: 18px;
        color: var(--wa-color-text-quiet);
        flex-shrink: 0;
      }

      .link.featured {
        padding: var(--wa-space-s) var(--wa-space-m);
        border-color: var(--esphome-primary);
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .link.featured:hover {
        border-color: var(--esphome-primary-hover);
        background: var(--esphome-primary-hover);
      }

      .link.featured .link-icon,
      .link.featured .link-external {
        color: var(--esphome-on-primary);
      }

      .link.featured .link-external {
        opacity: 1;
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
    this._screen = "main";
  };

  private _goTo(screen: Screen): void {
    this._screen = screen;
  }

  // A screen swap removes the control that had focus (the drill row, or the back
  // button), so move focus to the new screen's entry control; otherwise keyboard
  // and screen-reader users are dropped back to document.body.
  protected updated(changed: PropertyValues): void {
    if (!this._open || !changed.has("_screen")) {
      return;
    }
    const previous = changed.get("_screen") as Screen | undefined;
    if (previous === undefined) {
      return;
    }
    const target =
      this._screen === "main"
        ? this.renderRoot.querySelector<HTMLElement>(
            `button.link[data-drill="${previous}"]`
          )
        : this.renderRoot.querySelector<HTMLElement>(".back-button");
    target?.focus();
  }

  private _renderLinkBody(link: FeedbackLink) {
    return html`
      <wa-icon class="link-icon" library="mdi" name=${link.icon}></wa-icon>
      <span class="link-text">
        <span class="link-label">${this._localize(link.labelKey)}</span>
        ${
          link.descKey
            ? html`<span class="link-desc">${this._localize(link.descKey)}</span>`
            : ""
        }
      </span>
    `;
  }

  private _renderLink(link: FeedbackLink, featured = false) {
    if (link.drillTo) {
      const screen = link.drillTo;
      return html`
        <button class="link" data-drill=${screen} @click=${() => this._goTo(screen)}>
          ${this._renderLinkBody(link)}
          <wa-icon class="link-chevron" library="mdi" name="chevron-right"></wa-icon>
        </button>
      `;
    }
    return html`
      <a
        class=${featured ? "link featured" : "link"}
        href=${this._hrefFor(link)}
        target="_blank"
        rel="noopener noreferrer"
        @click=${this.close}
      >
        ${this._renderLinkBody(link)}
        <wa-icon class="link-external" library="mdi" name="open-in-new"></wa-icon>
      </a>
    `;
  }

  protected render() {
    const drill = this._screen === "main" ? null : DRILL_SCREENS[this._screen];
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._localize(drill ? drill.titleKey : "feedback.title")}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        ${
          drill
            ? html`<button
                slot="header-prefix"
                class="back-button"
                aria-label=${this._localize("feedback.back")}
                @click=${() => this._goTo("main")}
              >
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
              </button>`
            : ""
        }
        ${
          drill
            ? html`<div class="links">
                ${drill.links.map((link) => this._renderLink(link))}
              </div>`
            : this._renderMainScreen()
        }
      </esphome-base-dialog>
    `;
  }

  private _renderMainScreen() {
    return html`
      <p class="description">${this._localize("feedback.description")}</p>
      <div class="links">
        ${this._renderLink(SURVEY_LINK, true)}
        ${SECTIONS.map(
          (section) => html`
            <h3 class="section-header">${this._localize(section.labelKey)}</h3>
            ${section.links.map((link) => this._renderLink(link))}
          `
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-feedback-dialog": ESPHomeFeedbackDialog;
  }
}
