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
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  devicesContext,
  isHaAddonContext,
  localizeContext,
  serverVersionContext,
  versionContext,
} from "../context/index.js";
import { dialogChromeStyles } from "../styles/dialog-chrome.js";
import { espHomeStyles } from "../styles/shared.js";
import { fitConfig, MAX_ISSUE_URL_LENGTH } from "../util/crash-report-budget.js";
import { issuePlatform, platformFromIntegrations } from "../util/crash-report.js";
import { matchesDeviceName } from "../util/device-search.js";
import { deviceSortKey, sortDevices } from "../util/device-sort.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { detectInstallation } from "../util/installation.js";
import { captureMaskedConfig } from "../util/masked-config-capture.js";
import { notifyError } from "../util/notify.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
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
  "server-network": mdiServerNetwork,
});

const SURVEY_LINK = {
  icon: "clipboard-list-outline",
  labelKey: "feedback.survey",
  href: "https://usabi.li/do/3wv9cloipto9/wadwk6",
} as const;

type DrillScreen = "browse" | "bug";
type Screen = "main" | DrillScreen | "device";

// The two bug paths that carry a device config. The templates' field ids
// differ: esphome's form has `config`/`additional`, the builder's has
// `config`/`extra`.
type DeviceTarget = "builder" | "esphome";

const DEVICE_TARGETS: Record<
  DeviceTarget,
  { href: string; factsParam: "additional" | "extra" }
> = {
  builder: {
    href: "https://github.com/esphome/device-builder/issues/new?template=bug_report.yml",
    factsParam: "extra",
  },
  esphome: {
    href: "https://github.com/esphome/esphome/issues/new?template=bug_report.yml",
    factsParam: "additional",
  },
};

// The builder template's `config` field is required; its own description
// tells reporters to write this when no device applies.
const NOT_DEVICE_SPECIFIC = "not device specific";

// Fleets larger than this get a filter input above the device rows.
const DEVICE_FILTER_THRESHOLD = 8;

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
// a button with a chevron rather than an anchor. `deviceTarget` marks the
// two bug rows that drill into the device picker.
interface DrillLink extends FeedbackLinkBase {
  drillTo: DrillScreen | "device";
  deviceTarget?: DeviceTarget;
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
    drillTo: "device",
    deviceTarget: "builder",
  },
  {
    icon: "access-point-network",
    labelKey: "feedback.bug_status",
    descKey: "feedback.bug_status_desc",
    href: "https://github.com/esphome/device-builder/issues/new?template=device_status.yml",
    versionSource: "dashboard",
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

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @consume({ context: isHaAddonContext, subscribe: true })
  @state()
  private _isHaAddon = false;

  private readonly _dialog = new DialogOpenController(this);

  @state()
  private _screen: Screen = "main";

  // Which bug path the device screen prefills for; set when its row drills.
  @state()
  private _deviceTarget: DeviceTarget = "builder";

  @state()
  private _deviceFilter = "";

  // The configuration whose config capture is in flight ("" = none);
  // drives the per-row spinner and blocks double-picks.
  @state()
  private _capturing = "";

  // Bumped per open() and screen change; a capture from a previous
  // session must not open a form for this one.
  private _captureSession = 0;

  // Base URL for a device-target form with the version param set.
  private _deviceTargetUrl(target: DeviceTarget, device?: ConfiguredDevice): URL {
    const url = new URL(DEVICE_TARGETS[target].href);
    const version =
      target === "esphome"
        ? device?.current_version || this._esphomeVersion
        : this._serverVersion;
    if (version) url.searchParams.set("version", version);
    return url;
  }

  private _openPrefilled(url: URL): void {
    window.open(url.toString(), "_blank", "noopener");
    this.close();
  }

  private _skipDevice = (): void => {
    const url = this._deviceTargetUrl(this._deviceTarget);
    if (this._deviceTarget === "builder") {
      url.searchParams.set("config", NOT_DEVICE_SPECIFIC);
    }
    this._openPrefilled(url);
  };

  // The facts the form's dropdowns can't carry (GitHub only prefills
  // input/textarea fields), rendered as a bullet list.
  private _deviceFacts(device: ConfiguredDevice): string {
    const platform = issuePlatform(
      device.target_platform || platformFromIntegrations(device.loaded_integrations ?? [])
    );
    const installation = detectInstallation(this._api, this._isHaAddon);
    return [
      `Device: ${deviceSortKey(device)} (${device.configuration})`,
      device.board_id && `Board: ${device.board_id}`,
      platform && `Platform: ${platform}`,
      device.runtime_state.deployed_version &&
        `ESPHome running: ${device.runtime_state.deployed_version}`,
      this._deviceTarget === "builder" &&
        this._esphomeVersion &&
        `ESPHome: ${this._esphomeVersion}`,
      installation && `Installation: ${installation}`,
    ]
      .filter(Boolean)
      .map((fact) => `- ${fact}`)
      .join("\n");
  }

  private async _pickDevice(device: ConfiguredDevice): Promise<void> {
    if (this._capturing) return;
    const session = ++this._captureSession;
    const target = this._deviceTarget;
    this._capturing = device.configuration;
    const masked = await captureMaskedConfig(
      this._api,
      device.configuration,
      () => session !== this._captureSession || !this._dialog.open
    );
    if (session !== this._captureSession) return;
    this._capturing = "";
    if (masked === null) return;
    const url = this._deviceTargetUrl(target, device);
    url.searchParams.set(DEVICE_TARGETS[target].factsParam, this._deviceFacts(device));
    if (masked === "") {
      // The form still opens with the facts; the config just isn't in it.
      notifyError(this._localize("feedback.device_capture_failed"));
    } else {
      // Set an empty param first so the `&config=` key overhead counts
      // against the measured budget.
      url.searchParams.set("config", "");
      const fitted = fitConfig(masked, MAX_ISSUE_URL_LENGTH - url.toString().length);
      if (fitted.text) url.searchParams.set("config", fitted.text);
      else url.searchParams.delete("config");
    }
    this._openPrefilled(url);
  }

  private _onFilterInput = (e: Event): void => {
    this._deviceFilter = (e.target as HTMLInputElement).value;
  };

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

      .device-filter {
        width: 100%;
        box-sizing: border-box;
        margin: 0 0 var(--wa-space-s);
        padding: var(--wa-space-xs) var(--wa-space-s);
        border-radius: var(--wa-border-radius-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: transparent;
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
        font-family: inherit;
      }

      button.link:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .link wa-spinner {
        font-size: 16px;
        flex-shrink: 0;
      }

      .device-list {
        max-height: 320px;
        overflow-y: auto;
      }
    `,
  ];

  open() {
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  private _onAfterHide = (): void => {
    this._dialog.open = false;
    this._screen = "main";
    this._deviceFilter = "";
    this._capturing = "";
    this._captureSession += 1;
  };

  private _goTo(screen: Screen): void {
    this._screen = screen;
    this._deviceFilter = "";
    this._capturing = "";
    this._captureSession += 1;
  }

  private _drill(link: DrillLink): void {
    if (link.deviceTarget) this._deviceTarget = link.deviceTarget;
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
      return html`
        <button class="link" data-drill=${link.drillTo} @click=${() => this._drill(link)}>
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
    const drill =
      this._screen === "main" || isDevice ? null : DRILL_SCREENS[this._screen];
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
          drill || isDevice
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
            ? this._renderDeviceScreen()
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

  private _renderDeviceScreen() {
    const filter = this._deviceFilter.trim().toLowerCase();
    const devices = sortDevices(this._devices).filter(
      (device) => !filter || matchesDeviceName(device, filter)
    );
    return html`
      <p class="description">${this._localize("feedback.device_note")}</p>
      ${
        this._devices.length > DEVICE_FILTER_THRESHOLD
          ? html`<input
              class="device-filter"
              type="search"
              placeholder=${this._localize("feedback.device_filter")}
              .value=${this._deviceFilter}
              @input=${this._onFilterInput}
            />`
          : ""
      }
      <div class="links device-list">
        <button class="link" @click=${this._skipDevice}>
          <wa-icon class="link-icon" library="mdi" name="bug-outline"></wa-icon>
          <span class="link-text">
            <span class="link-label">${this._localize("feedback.device_skip")}</span>
          </span>
          <wa-icon class="link-external" library="mdi" name="open-in-new"></wa-icon>
        </button>
        ${devices.map((device) => this._renderDeviceRow(device))}
      </div>
    `;
  }

  private _renderDeviceRow(device: ConfiguredDevice) {
    const busy = this._capturing === device.configuration;
    return html`
      <button
        class="link"
        ?disabled=${this._capturing !== "" && !busy}
        @click=${() => this._pickDevice(device)}
      >
        <wa-icon class="link-icon" library="mdi" name="chip"></wa-icon>
        <span class="link-text">
          <span class="link-label">${deviceSortKey(device)}</span>
          <span class="link-desc">${device.configuration}</span>
        </span>
        ${
          busy
            ? html`<wa-spinner></wa-spinner>`
            : html`<wa-icon
                class="link-external"
                library="mdi"
                name="open-in-new"
              ></wa-icon>`
        }
      </button>
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
