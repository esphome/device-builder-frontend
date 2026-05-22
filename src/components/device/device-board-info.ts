import { consume } from "@lit/context";
import {
  mdiArrowDecisionOutline,
  mdiArrowLeft,
  mdiClose,
  mdiCogOutline,
  mdiMemory,
  mdiOpenInNew,
  mdiPartyPopper,
  mdiPlusCircleOutline,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { withBase } from "../../util/base-path.js";
import { renderMarkdown } from "../../util/markdown.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import type { ESPHomeAddAutomationDialog } from "./add-automation-dialog.js";
import type { ESPHomeAddComponentDialog } from "./add-component-dialog.js";
import type { ESPHomeAddConfigDialog } from "./add-config-dialog.js";
import type { ESPHomeApiActionEditor } from "./automation-editor/api-action-editor.js";
import type { ESPHomeAutomationEditor } from "./automation-editor/automation-editor.js";
import type { ESPHomeScriptEditor } from "./automation-editor/script-editor.js";
import { isEmptyToPopulatedYamlChange } from "./device-board-info-helpers.js";
import type { ESPHomeDeviceSectionConfig } from "./device-section-config.js";

import "@home-assistant/webawesome/dist/components/badge/badge.js";
import "@home-assistant/webawesome/dist/components/callout/callout.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./add-automation-dialog.js";
import "./add-component-dialog.js";
import "./add-config-dialog.js";
import "./automation-editor/api-action-editor.js";
import "./automation-editor/automation-editor.js";
import "./automation-editor/script-editor.js";
import { locationFromSectionKey } from "./automation-editor/serialise.js";
import "./device-section-config.js";

registerMdiIcons({
  "open-in-new": mdiOpenInNew,
  memory: mdiMemory,
  "arrow-decision-outline": mdiArrowDecisionOutline,
  "arrow-left": mdiArrowLeft,
  "cog-outline": mdiCogOutline,
  close: mdiClose,
  "party-popper": mdiPartyPopper,
  "plus-circle-outline": mdiPlusCircleOutline,
});

/** The three top-level section groups the navigator can expand. */
export type NavSectionName = "core" | "components" | "automations";

@customElement("esphome-device-board-info")
export class ESPHomeDeviceBoardInfo extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property()
  yaml = "";

  @property()
  configuration = "";

  /** Show the "Congratulations!" banner above the step panels.
   *  Driven by a one-shot signal from the wizard so it only appears
   *  for the user who just created this device, this session. */
  @property({ type: Boolean })
  justCreated = false;

  /** Forwarded from the editor — true when the YAML pane is currently
   *  rendered in the layout. Section editor uses this to decide
   *  whether to show its "Show YAML editor" CTA. */
  @property({ type: Boolean })
  yamlPaneVisible = true;

  @property({ attribute: false })
  selectedSection: string | null = null;

  @property({ type: Number })
  selectedFromLine?: number;

  @query("esphome-device-section-config")
  private _sectionConfig!: ESPHomeDeviceSectionConfig;

  /** Refs to the three automation-family editors — one of these is
   *  mounted in the right pane when the navigator's selection lives
   *  under ``automation:`` (script / api_action / device-on /
   *  component-on / interval). YAML-driven reloads target whichever
   *  one is live. */
  @query("esphome-automation-editor")
  private _automationEditor!: ESPHomeAutomationEditor;

  @query("esphome-script-editor")
  private _scriptEditor!: ESPHomeScriptEditor;

  @query("esphome-api-action-editor")
  private _apiActionEditor!: ESPHomeApiActionEditor;

  @query("esphome-add-component-dialog")
  private _addComponentDialog!: ESPHomeAddComponentDialog;

  @query("esphome-add-automation-dialog")
  private _addAutomationDialog!: ESPHomeAddAutomationDialog;

  @query("esphome-add-config-dialog")
  private _addConfigDialog!: ESPHomeAddConfigDialog;

  private _reloadTimer: ReturnType<typeof setTimeout> | null = null;

  updated(changedProperties: Map<string, unknown>) {
    // Coalesce typing in the YAML editor pane to one
    // `reload()` per debounce window, but bypass the debounce
    // on the empty-to-populated transition (page-load arrival,
    // user cleared the pane and pasted new content) so the
    // section editor's empty-form window is bounded by the
    // next render frame rather than a full coalesce window.
    //
    // Calling `reload()` synchronously from `updated()` is the
    // right shape here: `reload()` mutates the child's `@state`,
    // which Lit batches into the same render pass that's about
    // to run anyway — no extra paint, no recursion. A separate
    // `requestAnimationFrame` would just delay the effect.
    if (changedProperties.has("yaml") && this.selectedSection) {
      const reload = () => {
        this._sectionConfig?.reload();
        this._automationEditor?.reload();
        this._scriptEditor?.reload();
        this._apiActionEditor?.reload();
      };
      if (this._reloadTimer) {
        clearTimeout(this._reloadTimer);
        this._reloadTimer = null;
      }
      const prev = changedProperties.get("yaml") as string | undefined;
      if (isEmptyToPopulatedYamlChange(prev, this.yaml)) {
        // Synchronous bypass: no timer to track, leave
        // `_reloadTimer` at its just-cleared `null` so the
        // "null means no timer" invariant holds.
        reload();
      } else {
        this._reloadTimer = setTimeout(reload, 1000);
      }
    }
  }

  connectedCallback() {
    super.connectedCallback();
    // Catch ID-reference "+ Add new <domain>" requests that bubble out
    // of the section editor's shared form, and open the add-component
    // dialog deep-linked to the requested domain.
    this.addEventListener(
      "request-add-component",
      this._onRequestAddComponent as EventListener
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._reloadTimer) clearTimeout(this._reloadTimer);
    this.removeEventListener(
      "request-add-component",
      this._onRequestAddComponent as EventListener
    );
  }

  private _onRequestAddComponent = (e: Event) => {
    const detail = (e as CustomEvent<{ domain: string }>).detail;
    if (!detail?.domain) return;
    e.stopPropagation();
    this._addComponentDialog?.openWithSearch(detail.domain);
  };

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
      }

      .board-header {
        display: flex;
        flex-direction: row;
        align-items: center;
        width: 100%;
        gap: var(--wa-space-l);
      }

      .board-info {
        display: flex;
        flex-direction: column;
        flex: 1;
        gap: var(--wa-space-s);
        min-width: 0;
      }

      .board-name {
        margin: 0;
      }

      .board-image {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 140px;
        height: 100px;
        padding: var(--wa-space-s);
        background: var(--wa-color-surface-lowered);
        border-radius: var(--wa-border-radius-l);
        box-sizing: border-box;
      }

      .board-image img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .board-tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-2xs);
      }

      .board-info-link {
        display: inline-flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        font-size: var(--wa-font-size-xs);
        color: var(--esphome-primary);
        text-decoration: underline;
        margin-left: 10px;
      }

      .board-info-link:hover {
        text-decoration: none;
      }

      .board-description {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .board-separator {
        height: 1px;
        background-color: var(--wa-color-surface-lowered);
        width: 100%;
        margin-top: var(--wa-space-m);
      }

      /* ─── Just-created welcome banner ─── */

      .welcome-banner {
        margin-top: var(--wa-space-m);
      }

      .welcome-banner-title {
        margin: var(--wa-space-xs) 0 var(--wa-space-2xs);
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .welcome-banner-text {
        margin: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
        line-height: 1.5;
      }

      .welcome-banner-close {
        position: absolute;
        top: var(--wa-space-2xs);
        right: var(--wa-space-2xs);
        background: transparent;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: var(--wa-color-text-quiet);
        border-radius: var(--wa-border-radius-s);
        transition:
          background 0.12s,
          color 0.12s;
      }

      .welcome-banner-close:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 80%);
        color: var(--wa-color-text-normal);
      }

      .welcome-banner-close wa-icon {
        font-size: 18px;
        display: block;
      }

      /* ─── Step CTA ─── */

      .step-section {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        padding-top: var(--wa-space-m);
      }

      .step-title {
        margin: 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .step-desc {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .action-item {
        padding: var(--wa-space-2xs) var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: transparent;
        color: var(--esphome-primary);
        border: var(--wa-border-width-s) solid var(--esphome-primary);
        gap: var(--wa-space-s);
        cursor: pointer;
        user-select: none;
        font-family: inherit;
        font-size: inherit;
        transition:
          background 0.12s,
          color 0.12s;
        align-self: flex-start;
        /* Equal width across the three step CTAs so they line up
           visually no matter how long the longest label is. */
        width: 280px;
        max-width: 100%;
        margin-top: var(--wa-space-s);
      }

      .action-item:hover {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .action-item:focus-visible {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 2px;
      }

      .action-item p {
        margin: var(--wa-space-xs) 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .action-item wa-icon {
        font-size: var(--wa-font-size-l);
      }

      .action-item div {
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs);
      }
    `,
  ];

  protected render() {
    const board = this.board;

    return html`
      ${!this.selectedSection && board
        ? html`
            <div class="board-header">
              <div class="board-info">
                <h3 class="board-name">${board.name}</h3>
                <div class="board-tags">
                  ${board.tags.map(
                    (tag) => html`<wa-badge variant="brand" pill>${tag}</wa-badge>`
                  )}
                  <a
                    class="board-info-link"
                    href=${board.docs_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ${this._localize("device.more_info")}
                    <wa-icon library="mdi" name="open-in-new"></wa-icon>
                  </a>
                </div>
                <p class="board-description">${renderMarkdown(board.description)}</p>
              </div>
              <div class="board-image">
                <img
                  src=${this._boardImageUrl(board)}
                  alt=${board.name}
                  referrerpolicy="no-referrer"
                  @error=${this._onImageError}
                />
              </div>
            </div>
            <div class="board-separator"></div>
          `
        : nothing}
      ${this.selectedSection
        ? this._renderSelectedSection()
        : html`
            ${this.justCreated ? this._renderWelcomeBanner() : nothing}
            ${this._renderStepSection({
              title: this._localize("device.step_core"),
              desc: this._localize("device.step_core_desc"),
              icon: "cog-outline",
              action: this._localize("device.show_core_configuration"),
              section: "core",
            })}
            ${this._renderStepSection({
              title: this._localize("device.step_components"),
              desc: this._localize("device.step_components_desc"),
              icon: "memory",
              action: this._localize("device.show_components"),
              section: "components",
            })}
            ${this._renderStepSection({
              title: this._localize("device.step_automations"),
              desc: this._localize("device.step_automations_desc"),
              icon: "arrow-decision-outline",
              action: this._localize("device.show_automations"),
              section: "automations",
            })}
          `}

      <esphome-add-config-dialog
        .boardName=${board?.name ?? ""}
        .configuration=${this.configuration}
        .platform=${board?.esphome.platform ?? ""}
        .board=${board}
        .yaml=${this.yaml}
      ></esphome-add-config-dialog>
      <esphome-add-component-dialog
        .boardName=${board?.name ?? ""}
        .configuration=${this.configuration}
        .platform=${board?.esphome.platform ?? ""}
        .board=${board}
        .yaml=${this.yaml}
      ></esphome-add-component-dialog>
      <esphome-add-automation-dialog
        .boardName=${board?.name ?? ""}
        .configuration=${this.configuration}
        .board=${board}
        .yaml=${this.yaml}
      ></esphome-add-automation-dialog>
    `;
  }

  /**
   * Render one of the three numbered "next steps" panels in the
   * unselected content pane (Core / Components / Automations). Each
   * has a heading, a longer description, and a CTA that expands the
   * matching section in the device navigator on the left — the goal
   * is to teach the user that the navigator is where you manage
   * these things, rather than handing them an add-button right here.
   */
  /**
   * Route an automation / script section key into the right
   * structured editor; everything else lands in the regular
   * ``<esphome-device-section-config>``.
   *
   * Four kinds today:
   *
   * - ``automation:script:<id>`` → ``<esphome-script-editor>``
   *   (scripts have their own chrome — id + run mode + parameters
   *   + actions, no trigger).
   * - ``automation:api_action:<name>`` → ``<esphome-api-action-editor>``
   *   (Home Assistant-callable actions — action name + variables +
   *   actions, no trigger).
   * - other ``automation:…`` keys → ``<esphome-automation-editor>``
   *   (trigger-based automations).
   * - anything else → component section editor.
   *
   * Each structured editor self-loads its parsed value from the
   * backend on mount based on ``.location``; we just resolve the
   * key into a typed location here so the editors don't have to
   * know about navigator routing.
   */
  private _renderSelectedSection() {
    const key = this.selectedSection!;
    const location = key.startsWith("automation:") ? locationFromSectionKey(key) : null;
    if (location?.kind === "script") {
      return html`<esphome-script-editor
        .configuration=${this.configuration}
        .board=${this.board}
        .platform=${this.board?.esphome.platform ?? ""}
        .location=${location}
        .yaml=${this.yaml}
      ></esphome-script-editor>`;
    }
    if (location?.kind === "api_action") {
      return html`<esphome-api-action-editor
        .configuration=${this.configuration}
        .board=${this.board}
        .platform=${this.board?.esphome.platform ?? ""}
        .location=${location}
        .yaml=${this.yaml}
      ></esphome-api-action-editor>`;
    }
    if (location) {
      return html`<esphome-automation-editor
        .configuration=${this.configuration}
        .board=${this.board}
        .platform=${this.board?.esphome.platform ?? ""}
        .location=${location}
        .yaml=${this.yaml}
      ></esphome-automation-editor>`;
    }
    return html`<esphome-device-section-config
      .configuration=${this.configuration}
      .sectionKey=${key}
      .fromLine=${this.selectedFromLine}
      .yaml=${this.yaml}
      .board=${this.board}
      .boardName=${this.board?.name ?? ""}
      ?yamlPaneVisible=${this.yamlPaneVisible}
    ></esphome-device-section-config>`;
  }

  private _renderStepSection(opts: {
    title: string;
    desc: string;
    icon: string;
    action: string;
    section: NavSectionName;
  }) {
    return html`
      <div class="step-section">
        <h4 class="step-title">${opts.title}</h4>
        <p class="step-desc">${opts.desc}</p>
        <button
          type="button"
          class="action-item"
          @click=${() => this._onShowNavSection(opts.section)}
        >
          <div>
            <wa-icon library="mdi" name=${opts.icon}></wa-icon>
            <p>${opts.action}</p>
          </div>
          <wa-icon library="mdi" name="arrow-left"></wa-icon>
        </button>
      </div>
    `;
  }

  /**
   * Ask the page to open the navigator drawer (mobile) and expand
   * the matching section. Bubbles up so we don't have to know the
   * page's state shape from in here.
   */
  private _onShowNavSection(section: NavSectionName) {
    this.dispatchEvent(
      new CustomEvent("nav-section-show", {
        detail: { section },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Welcome banner shown the first time the user lands on a freshly
   * created device. Tells them the wizard wrote a sensible default
   * configuration and points them at the next-step panels below.
   * Dismissible — emits an event the page handler clears the flag on.
   */
  private _renderWelcomeBanner() {
    if (!this.board) return nothing;
    return html`
      <wa-callout class="welcome-banner" variant="brand" role="status">
        <wa-icon slot="icon" library="mdi" name="party-popper"></wa-icon>
        <p class="welcome-banner-title">
          ${this._localize("device.welcome_banner_title", {
            name: this.board.name,
          })}
        </p>
        <p class="welcome-banner-text">${this._localize("device.welcome_banner_body")}</p>
        <button
          type="button"
          class="welcome-banner-close"
          aria-label=${this._localize("device.welcome_banner_dismiss")}
          @click=${this._onDismissWelcome}
        >
          <wa-icon library="mdi" name="close"></wa-icon>
        </button>
      </wa-callout>
    `;
  }

  private _onDismissWelcome() {
    this.dispatchEvent(
      new CustomEvent("just-created-dismiss", {
        bubbles: true,
        composed: true,
      })
    );
  }

  private _boardImageUrl(board: BoardCatalogEntry): string {
    if (board.images.length > 0) return board.images[0];
    return withBase("/assets/board/default.svg");
  }

  private _onImageError(e: Event) {
    const img = e.target as HTMLImageElement;
    const fallback = withBase("/assets/board/default.svg");
    if (img.src !== window.location.origin + fallback && !img.src.endsWith(fallback)) {
      img.src = fallback;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-board-info": ESPHomeDeviceBoardInfo;
  }
}
