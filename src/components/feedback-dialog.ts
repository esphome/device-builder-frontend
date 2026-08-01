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
  mdiServerNetwork,
} from "@mdi/js";
import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext, serverVersionContext } from "../context/index.js";
import { dialogChromeStyles } from "../styles/dialog-chrome.js";
import { espHomeStyles } from "../styles/shared.js";
import type { DeviceTarget } from "../util/bug-report-prefill.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { feedbackLinkStyles } from "./feedback-link.styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";
import "./feedback-device-picker.js";

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
  "server-network": mdiServerNetwork,
});

const SURVEY_LINK = {
  icon: "clipboard-list-outline",
  labelKey: "feedback.survey",
  href: "https://usabi.li/do/3wv9cloipto9/wadwk6",
} as const;

type DrillScreen = "browse" | "bug";
type Screen = "main" | DrillScreen | "device";

interface FeedbackLinkBase {
  icon: string;
  labelKey: string;
  descKey?: string;
}

// Opens a URL. "versionSource: dashboard" prefills the destination form's
// "version" field with our server version. (The ESPHome core version flows
// through the device picker's own URL builder, not here.)
interface ExternalLink extends FeedbackLinkBase {
  href: string;
  versionSource?: "dashboard";
  drillTo?: never;
  deviceTarget?: never;
}

// Navigates to a second in-dialog screen instead of opening a link; rendered
// as a button with a chevron rather than an anchor. The device screen must
// know which bug path it prefills for, so its rows carry a target.
type DrillLink = FeedbackLinkBase & { href?: never; versionSource?: never } & (
    | { drillTo: DrillScreen; deviceTarget?: never }
    | { drillTo: "device"; deviceTarget: DeviceTarget }
  );

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
    drillTo: "device",
    deviceTarget: "builder",
  },
  {
    icon: "access-point-network",
    labelKey: "feedback.bug_status",
    descKey: "feedback.bug_status_desc",
    drillTo: "device",
    deviceTarget: "status",
  },
  {
    icon: "server-network",
    labelKey: "feedback.bug_remote_build",
    descKey: "feedback.bug_remote_build_desc",
    href: "https://github.com/esphome/device-builder/issues/new?template=remote_build.yml",
    versionSource: "dashboard",
  },
  {
    icon: "chip",
    labelKey: "feedback.bug_esphome",
    descKey: "feedback.bug_esphome_desc",
    drillTo: "device",
    deviceTarget: "esphome",
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
  { titleKey: string; noteKey?: string; links: ReadonlyArray<FeedbackLink> }
> = {
  browse: { titleKey: "feedback.browse_issues", links: BROWSE_LINKS },
  bug: {
    titleKey: "feedback.new_issue",
    noteKey: "feedback.write_in_english",
    links: BUG_LINKS,
  },
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

// The focus-restore key for a drill row; device rows key on their target
// so the two are distinguishable.
const drillKey = (link: DrillLink): string =>
  link.drillTo === "device" ? `device-${link.deviceTarget}` : link.drillTo;

@customElement("esphome-feedback-dialog")
export class ESPHomeFeedbackDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: serverVersionContext, subscribe: true })
  @state()
  private _serverVersion = "";

  private readonly _dialog = new DialogOpenController(this);

  @state()
  private _screen: Screen = "main";

  // Which bug path the device screen prefills for; set when its row drills.
  @state()
  private _deviceTarget: DeviceTarget = "builder";

  static styles = [
    espHomeStyles,
    // Neutral header + title + footer (shared) — dialog-chrome.ts.
    dialogChromeStyles,
    feedbackLinkStyles,
    css`
      esphome-base-dialog {
        --width: 460px;
      }

      /* Extra bottom padding here (the link list has no actions row). */
      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l) var(--wa-space-l);
      }

      .section-header {
        margin: var(--wa-space-m) 0 var(--wa-space-2xs);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--wa-color-text-quiet);
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
    `,
  ];

  open() {
    // Reset before showing: a reopen racing the previous close's
    // after-hide must leave no stale screen (the picker abandons its
    // capture when its screen unmounts).
    this._goTo("main");
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  private _onAfterHide = (): void => {
    this._dialog.open = false;
    this._goTo("main");
  };

  private _goTo(screen: Screen): void {
    this._screen = screen;
  }

  private _drill(link: DrillLink): void {
    if (link.drillTo === "device") this._deviceTarget = link.deviceTarget;
    this._goTo(link.drillTo);
  }

  // The device screen sits under the bug screen, so Back unwinds one level.
  private _goBack(): void {
    this._goTo(this._screen === "device" ? "bug" : "main");
  }

  // A screen swap removes the control that had focus (the drill row, or the back
  // button), so move focus to the new screen's entry control; otherwise keyboard
  // and screen-reader users are dropped back to document.body.
  protected updated(changed: PropertyValues): void {
    if (!this._dialog.open || !changed.has("_screen")) {
      return;
    }
    const previous = changed.get("_screen") as Screen | undefined;
    if (previous === undefined) {
      return;
    }
    // Unwinding focuses the row that drilled here (device rows key on
    // their target); drilling deeper focuses the back button.
    const previousKey = previous === "device" ? `device-${this._deviceTarget}` : previous;
    const target =
      this._screen === "main" || previous === "device"
        ? this.renderRoot.querySelector<HTMLElement>(
            `button.link[data-drill="${previousKey}"]`
          )
        : this.renderRoot.querySelector<HTMLElement>(".back-button");
    // A device→main jump (close/reopen race) has no device row to
    // return to; land on the first row rather than document.body.
    (target ?? this.renderRoot.querySelector<HTMLElement>("button.link"))?.focus();
  }

  private _hrefFor(link: FeedbackLink): string {
    if (!link.href) {
      return "";
    }
    const version = link.versionSource === "dashboard" ? this._serverVersion : "";
    if (!version) {
      return link.href;
    }
    const url = new URL(link.href);
    url.searchParams.set("version", version);
    return url.toString();
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
      return html`
        <button
          class="link"
          data-drill=${drillKey(link)}
          @click=${() => this._drill(link)}
        >
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
    const isDevice = this._screen === "device";
    // Inline comparisons: narrowing doesn't survive an alias of a
    // mutable @state field, and an unnarrowed index widens `drill` to any.
    const drill =
      this._screen === "main" || this._screen === "device"
        ? null
        : DRILL_SCREENS[this._screen];
    const label = isDevice
      ? this._localize("feedback.device_title")
      : this._localize(drill ? drill.titleKey : "feedback.title");
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${label}
        @request-close=${this._dialog.onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        ${
          this._screen !== "main"
            ? html`<button
                slot="header-prefix"
                class="back-button"
                aria-label=${this._localize("feedback.back")}
                @click=${() => this._goBack()}
              >
                <wa-icon library="mdi" name="arrow-left"></wa-icon>
              </button>`
            : ""
        }
        ${
          isDevice
            ? html`<esphome-feedback-device-picker
                .target=${this._deviceTarget}
                .active=${this._dialog.open}
                @picker-close=${this.close}
              ></esphome-feedback-device-picker>`
            : drill
              ? html`
                  ${
                    drill.noteKey
                      ? html`<p class="description">${this._localize(drill.noteKey)}</p>`
                      : ""
                  }
                  <div class="links">
                    ${drill.links.map((link) => this._renderLink(link))}
                  </div>
                `
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
