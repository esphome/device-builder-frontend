import { consume } from "@lit/context";
import {
  mdiArrowLeft,
  mdiClose,
  mdiOpenInNew,
  mdiPartyPopper,
  mdiPlusCircleOutline,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { boardImageUrl, onBoardImageError } from "../../util/board-image.js";
import { renderMarkdown } from "../../util/markdown.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import type { ESPHomeAddAutomationDialog } from "./add-automation-dialog.js";
import type { ESPHomeAddComponentDialog } from "./add-component-dialog.js";
import type { ESPHomeAddConfigDialog } from "./add-config-dialog.js";
import type { ESPHomeApiActionEditor } from "./automation-editor/api-action-editor.js";
import type { ESPHomeAutomationEditor } from "./automation-editor/automation-editor.js";
import type { ESPHomeScriptEditor } from "./automation-editor/script-editor.js";
import type { ESPHomeChangeBoardDialog } from "./change-board-dialog.js";
import { isEmptyToPopulatedYamlChange } from "./device-board-info-helpers.js";
import { deviceBoardInfoStyles } from "./device-board-info.styles.js";
import type { ESPHomeDeviceSectionConfig } from "./device-section-config.js";
import { SECTION_ICON } from "./section-icons.js";

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
import "./change-board-dialog.js";
import "./device-section-config.js";

registerMdiIcons({
  "open-in-new": mdiOpenInNew,
  "arrow-left": mdiArrowLeft,
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

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  /** Interchangeable boards (same PlatformIO target), current board
   *  excluded; empty keeps the "Change board" link hidden. */
  @state()
  private _alternateBoards: BoardCatalogEntry[] = [];

  /** Board id `_alternateBoards` was fetched for; guards a stale response. */
  private _alternatesForBoardId: string | null = null;

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

  /** Instance-relative field path to scroll into view, from the YAML cursor. */
  @property({ attribute: false })
  focusFieldPath?: string[];

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

  @query("esphome-change-board-dialog")
  private _changeBoardDialog!: ESPHomeChangeBoardDialog;

  private _reloadTimer: ReturnType<typeof setTimeout> | null = null;

  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("board")) {
      this._refreshAlternateBoards();
    }
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

  /**
   * Fetch the current board's interchangeable alternates (excluding
   * itself); guards against a stale response for a previous board.
   */
  private async _refreshAlternateBoards() {
    const board = this.board;
    if (!board) {
      this._alternatesForBoardId = null;
      this._alternateBoards = [];
      return;
    }
    if (board.id === this._alternatesForBoardId) return;
    this._alternatesForBoardId = board.id;
    this._alternateBoards = [];
    try {
      const all = await this._api.getCompatibleBoards(board.id);
      if (this._alternatesForBoardId !== board.id) return;
      this._alternateBoards = all.filter((b) => b.id !== board.id);
    } catch (e) {
      console.error("Failed to load compatible boards:", e);
      // Clear the marker so a later re-assignment of the same board id
      // retries, rather than the link staying hidden after one transient
      // miss (the guard above would otherwise short-circuit forever).
      if (this._alternatesForBoardId === board.id) {
        this._alternatesForBoardId = null;
        this._alternateBoards = [];
      }
    }
  }

  private _openChangeBoard = () => {
    this._changeBoardDialog?.open();
  };

  /** Re-emit the picker's selection as a page-level `change-board`. */
  private _onSelectBoard = (e: CustomEvent<{ boardId: string }>) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("change-board", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      })
    );
  };

  static styles = [espHomeStyles, deviceBoardInfoStyles];

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
                  ${this._alternateBoards.length > 0
                    ? html`<button
                        type="button"
                        class="board-change-link"
                        @click=${this._openChangeBoard}
                      >
                        ${this._localize("device.change_board_link")}
                      </button>`
                    : nothing}
                </div>
                <p class="board-description">${renderMarkdown(board.description)}</p>
              </div>
              <div class="board-image">
                <img
                  src=${boardImageUrl(board)}
                  alt=${board.name}
                  referrerpolicy="no-referrer"
                  @error=${onBoardImageError}
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
              icon: SECTION_ICON.core,
              action: this._localize("device.show_core_configuration"),
              section: "core",
            })}
            ${this._renderStepSection({
              title: this._localize("device.step_components"),
              desc: this._localize("device.step_components_desc"),
              icon: SECTION_ICON.components,
              action: this._localize("device.show_components"),
              section: "components",
            })}
            ${this._renderStepSection({
              title: this._localize("device.step_automations"),
              desc: this._localize("device.step_automations_desc"),
              icon: SECTION_ICON.automations,
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
      <esphome-change-board-dialog
        .currentBoard=${board}
        .boards=${this._alternateBoards}
        @select-board=${this._onSelectBoard}
      ></esphome-change-board-dialog>
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
      .focusFieldPath=${this.focusFieldPath}
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
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-board-info": ESPHomeDeviceBoardInfo;
  }
}
