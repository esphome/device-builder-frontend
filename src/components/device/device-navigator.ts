import { consume } from "@lit/context";
import {
  mdiArrowDecisionOutline,
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight,
  mdiChevronUp,
  mdiCog,
  mdiMemory,
  mdiPlusCircleOutline,
  mdiScriptTextOutline,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  fetchAutomationTriggers,
  getCachedAutomationTriggers,
} from "../../util/automation-catalog-cache.js";
import {
  fetchComponent,
  getCachedComponent,
  subscribeComponentCache,
} from "../../util/component-name-cache.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  type YamlSection,
  categorizeSections,
  parseYamlAutomations,
  parseYamlTopLevelSections,
  sectionKeyOf,
} from "../../util/yaml-sections.js";
import type { HighlightRange } from "../yaml-editor.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./add-automation-dialog.js";
import type { ESPHomeAddAutomationDialog } from "./add-automation-dialog.js";
import "./add-component-dialog.js";
import type { ESPHomeAddComponentDialog } from "./add-component-dialog.js";
import "./add-config-dialog.js";
import type { ESPHomeAddConfigDialog } from "./add-config-dialog.js";
import "./add-script-dialog.js";
import type { ESPHomeAddScriptDialog } from "./add-script-dialog.js";

registerMdiIcons({
  "chevron-down": mdiChevronDown,
  "chevron-left": mdiChevronLeft,
  "chevron-up": mdiChevronUp,
  "chevron-right": mdiChevronRight,
  cog: mdiCog,
  "arrow-decision-outline": mdiArrowDecisionOutline,
  memory: mdiMemory,
  "plus-circle-outline": mdiPlusCircleOutline,
  "script-text-outline": mdiScriptTextOutline,
});

@customElement("esphome-device-navigator")
export class ESPHomeDeviceNavigator extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

  /**
   * Bumped whenever a fresh entry lands in the component-name cache,
   * which forces a re-render so resolved labels appear without
   * needing the user to interact with the navigator.
   */
  @state()
  private _cacheTick = 0;

  private _unsubscribeCache?: () => void;

  @property({ attribute: false })
  openSections: Set<number> = new Set();

  @property({ attribute: false })
  yaml = "";

  /** Optional board metadata; forwarded to the add-component dialog so
   * the embedded form can render GPIO pin selectors. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property()
  boardName = "";

  @property()
  configuration = "";

  /** Device's target platform — forwarded to add-component / add-config
   * dialogs so the backend can resolve per-platform default values. */
  @property()
  platform = "";

  @query("esphome-add-config-dialog")
  private _addConfigDialog!: ESPHomeAddConfigDialog;

  @query("esphome-add-component-dialog")
  private _addComponentDialog!: ESPHomeAddComponentDialog;

  @query("esphome-add-automation-dialog")
  private _addAutomationDialog!: ESPHomeAddAutomationDialog;

  @query("esphome-add-script-dialog")
  private _addScriptDialog!: ESPHomeAddScriptDialog;

  @property({ attribute: false })
  selectedKey: string | null = null;

  @property({ attribute: false })
  selectedFromLine?: number;

  @state()
  private _selectedLine: number | null = null;

  @state()
  private _selectedRange: HighlightRange | null = null;

  @state()
  private _hoveredLine: number | null = null;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: contents;
      }

      .card {
        background: var(--wa-color-surface-default);
        border-radius: var(--navigator-border-radius, var(--wa-border-radius-l));
        border: var(--navigator-border, var(--wa-border-width-s) solid var(--wa-color-surface-border));
        box-shadow: var(--wa-elevation-02);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-s);
        padding: var(--wa-space-s) var(--wa-space-m);
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        flex-shrink: 0;
      }

      .card-title {
        margin: 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .collapse-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: var(--esphome-on-primary);
        cursor: pointer;
        padding: 2px 4px;
        border-radius: var(--wa-border-radius-s);
      }

      .collapse-btn:hover {
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
      }

      .collapse-btn wa-icon {
        font-size: 18px;
      }

      .card-body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }

      .italic {
        font-style: italic;
        font-size: var(--wa-font-size-2xs);
        padding: 0 var(--wa-space-m);
        margin: var(--wa-space-xs) 0;
        flex-shrink: 0;
      }

      .separator {
        height: 1px;
        background: var(--wa-color-surface-border);
        margin: var(--wa-space-2xs) 0;
        flex-shrink: 0;
      }

      .nav-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 var(--wa-space-m);
        cursor: pointer;
        user-select: none;
        flex-shrink: 0;
      }

      .nav-content:hover p {
        color: var(--esphome-primary);
      }

      .nav-content p {
        margin: var(--wa-space-xs) 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .nav-content wa-icon {
        font-size: var(--wa-font-size-xl);
        color: var(--esphome-primary);
      }

      .nav-items {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        padding: var(--wa-space-xs) var(--wa-space-m);
      }

      .nav-item {
        padding: 0 var(--wa-space-2xs);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        user-select: none;
        transition:
          background 0.1s,
          border-color 0.1s;
      }

      .nav-item:hover,
      .nav-item--hovered {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        border-color: var(--esphome-primary);
      }

      .nav-item--selected {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        border-color: var(--esphome-primary);
      }

      .nav-item-content {
        display: flex;
        flex-direction: column;
        min-width: 0;
        padding: var(--wa-space-xs) 0;
      }

      .nav-item-content p {
        margin: 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      .nav-item-subtitle {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        font-weight: normal;
        margin: 0;
        line-height: 1.2;
      }

      .nav-item wa-icon {
        font-size: var(--wa-font-size-xl);
        color: var(--esphome-primary);
      }

      .action-item {
        padding: 0 var(--wa-space-2xs);
        border-radius: var(--wa-border-radius-m);
        display: flex;
        align-items: center;
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        justify-content: space-between;
        cursor: pointer;
        user-select: none;
        transition:
          background 0.1s,
          border-color 0.1s;
      }

      .action-item:hover,
      .action-item--hovered {
        opacity: 0.9;
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
        flex-direction: wrap;
        align-items: center;
        gap: var(--wa-space-2xs);
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    // Re-render when any other navigator (or this one on a previous
    // mount) fills in a catalog entry we're showing — keeps labels
    // live across device switches without a manual refresh.
    this._unsubscribeCache = subscribeComponentCache(() => {
      this._cacheTick++;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribeCache?.();
    this._unsubscribeCache = undefined;
  }

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (
      (changedProperties.has("yaml") || changedProperties.has("platform")) &&
      this.yaml
    ) {
      this._kickoffNameResolves();
    }

    // Sync `_selectedLine`/`_selectedRange` whenever the externally-
    // controlled selection changes (URL restore, "go to component"
    // events from the dialog, YAML edits that shift line numbers).
    // We don't gate on `_selectedLine === null` here — that used to
    // be a guard against re-sync loops, but it also meant external
    // updates couldn't move the highlight off whatever was previously
    // selected.
    if (
      (changedProperties.has("selectedKey") ||
        changedProperties.has("yaml") ||
        changedProperties.has("selectedFromLine")) &&
      this.yaml
    ) {
      if (!this.selectedKey) {
        // Cleared externally — drop the local highlight.
        this._selectedLine = null;
        this._selectedRange = null;
        return;
      }
      const allSections = [
        ...parseYamlTopLevelSections(this.yaml),
        ...parseYamlAutomations(this.yaml),
      ];
      // Try fromLine first (exact match), fall back to key/platform
      // match (handles the case where the YAML shifted under us, e.g.
      // the user just added a component before the selected one).
      const match =
        (this.selectedFromLine !== undefined
          ? allSections.find((s) => s.fromLine === this.selectedFromLine)
          : undefined) ??
        allSections.find((s) => sectionKeyOf(s) === this.selectedKey);
      if (match) {
        this._selectedLine = match.fromLine;
        this._selectedRange = {
          fromLine: match.fromLine,
          toLine: match.toLine,
        };
      }
    }
  }

  protected render() {
    const {
      core,
      components,
      automations: topLevelAutomations,
    } = categorizeSections(parseYamlTopLevelSections(this.yaml));
    // ``parseYamlAutomations`` now enumerates individual ``script:``
    // / ``interval:`` list items as stable-keyed entries
    // (``automation:script:<id>``, ``automation:interval:<index>``),
    // so the bare ``script:`` / ``interval:`` top-level blocks
    // returned by the top-level parser would duplicate them. Drop
    // those bare keys here so each automation shows up exactly once.
    const detailed = parseYamlAutomations(this.yaml);
    const filteredTopLevel = topLevelAutomations.filter(
      (s) => s.key !== "script" && s.key !== "interval",
    );
    // Light effects belong to their parent light component now, not
    // the automations surface — clicking one in the navigator
    // routed to the automation editor in a confusing standalone
    // mode. Effects are managed through the light's own section
    // editor; drop them here so they don't appear orphaned in the
    // automations group.
    //
    // ``automation:unscoped:*`` entries are inline ``on_*:`` handlers
    // on components that have no ``id:`` set. The structured editor
    // can't address them (locationFromSectionKey returns null), so
    // routing one through the navigator would surface as a failing
    // ``fetchComponent`` and a blank section editor. Drop them too;
    // the user fixes by adding an ``id:`` to the host component.
    const automations = [...filteredTopLevel, ...detailed]
      .filter(
        (s) =>
          !s.key.startsWith("automation:light_effect:") &&
          !s.key.startsWith("automation:unscoped:"),
      )
      .sort((a, b) => a.fromLine - b.fromLine);

    interface NavAction {
      label: string;
      icon: string;
      onClick: () => void;
    }
    interface NavSection {
      label: string;
      desc: string;
      items: YamlSection[];
      category: "core" | "component" | "automation";
      /** A section can carry multiple "+ Add X" affordances —
       *  Automations has both "+ Add automation" and "+ Add script",
       *  the others have one. */
      actions: NavAction[];
    }
    const sections: NavSection[] = [
      {
        label: this._localize("device.section_core"),
        desc: this._localize("device.section_core_desc"),
        items: core,
        category: "core",
        actions: [
          {
            label: this._localize("device.add_config"),
            icon: "cog",
            onClick: () => this._addConfigDialog.open(),
          },
        ],
      },
      {
        label: this._localize("device.section_components"),
        desc: this._localize("device.section_components_desc"),
        items: components,
        category: "component",
        actions: [
          {
            label: this._localize("device.add_component"),
            icon: "memory",
            onClick: () => this._addComponentDialog.open(),
          },
        ],
      },
      {
        label: this._localize("device.section_automations"),
        desc: this._localize("device.section_automations_desc"),
        items: automations,
        category: "automation",
        actions: [
          {
            label: this._localize("device.add_automation"),
            icon: "arrow-decision-outline",
            onClick: () => this._addAutomationDialog.open(),
          },
          {
            label: this._localize("device.add_script"),
            icon: "script-text-outline",
            onClick: () => this._addScriptDialog.open(),
          },
        ],
      },
    ];

    return html`
      <section class="card">
        <esphome-add-config-dialog
          .boardName=${this.boardName}
          .configuration=${this.configuration}
          .platform=${this.platform}
          .board=${this.board}
          .yaml=${this.yaml}
        ></esphome-add-config-dialog>
        <esphome-add-component-dialog
          .boardName=${this.boardName}
          .configuration=${this.configuration}
          .platform=${this.platform}
          .board=${this.board}
          .yaml=${this.yaml}
        ></esphome-add-component-dialog>
        <esphome-add-automation-dialog
          .boardName=${this.boardName}
          .configuration=${this.configuration}
          .board=${this.board}
          .yaml=${this.yaml}
          @automation-added=${this._onAutomationAdded}
        ></esphome-add-automation-dialog>
        <esphome-add-script-dialog
          .boardName=${this.boardName}
          .configuration=${this.configuration}
          .board=${this.board}
          .yaml=${this.yaml}
          @automation-added=${this._onAutomationAdded}
        ></esphome-add-script-dialog>
        <header class="card-header">
          <h2 class="card-title">${this._localize("device.navigator_title")}</h2>
          <button
            type="button"
            class="collapse-btn"
            @click=${this._onCollapseClick}
            title=${this._localize("device.hide_navigator")}
            aria-label=${this._localize("device.hide_navigator")}
          >
            <wa-icon library="mdi" name="chevron-left"></wa-icon>
          </button>
        </header>
        <div class="card-body">
          <p class="italic">${this._localize("device.navigator_desc")}</p>
          <div class="separator"></div>
          ${sections.map(({ label, desc, items, category, actions }, i) => {
            const open = this.openSections.has(i);
            return html`
              <div class="nav-content" @click=${() => this._toggleSection(i)}>
                <p>${label}</p>
                <wa-icon
                  library="mdi"
                  name=${open ? "chevron-up" : "chevron-down"}
                ></wa-icon>
              </div>
              ${open
                ? html`
                    <div class="separator"></div>
                    <p class="italic">${desc}</p>
                    ${items.length > 0
                      ? html`
                          <div class="nav-items">
                            ${items.map((item) => {
                              const { primary, secondary } =
                                this._navItemLabels(item, category);
                              return html`
                                <div
                                  class="nav-item ${this._selectedLine === item.fromLine
                                    ? "nav-item--selected"
                                    : ""} ${this._hoveredLine === item.fromLine
                                    ? "nav-item--hovered"
                                    : ""}"
                                  @mouseenter=${() =>
                                    this._onItemHover(item.fromLine, item.fromLine, item.toLine)}
                                  @mouseleave=${() => this._onItemLeave()}
                                  @click=${() => this._onItemClick(item)}
                                >
                                  <div class="nav-item-content">
                                    <p>${primary}</p>
                                    ${secondary
                                      ? html`<span class="nav-item-subtitle"
                                          >${secondary}</span
                                        >`
                                      : nothing}
                                  </div>
                                  <wa-icon library="mdi" name="chevron-right"></wa-icon>
                                </div>
                              `;
                            })}
                          </div>
                        `
                      : nothing}
                    <div class="nav-items">
                      ${actions.map(
                        (action) => html`<div
                          class="action-item"
                          @click=${() => action.onClick()}
                        >
                          <div>
                            <wa-icon library="mdi" name=${action.icon}></wa-icon>
                            <p>${action.label}</p>
                          </div>
                          <wa-icon library="mdi" name="plus-circle-outline"></wa-icon>
                        </div>`,
                      )}
                    </div>
                  `
                : nothing}
              <div class="separator"></div>
            `;
          })}
        </div>
      </section>
    `;
  }

  private _toggleSection(index: number) {
    this.dispatchEvent(
      new CustomEvent("section-toggle", {
        detail: { index },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Ask the page to hide the navigator. The page decides between
   *  desktop (set ``_navCollapsed`` + persist) and mobile (close the
   *  drawer) — we just say "I'd like to disappear". */
  private _onCollapseClick = () => {
    this.dispatchEvent(
      new CustomEvent("nav-collapse", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * Fire-and-forget catalog lookups for any sections whose name we
   * haven't cached yet. Resolved entries land in the shared cache;
   * the subscription bumps `_cacheTick` to trigger a re-render.
   * Automations are skipped — their keys are free-form strings
   * (`<component> → on_press`), not catalog ids.
   */
  private _kickoffNameResolves(): void {
    if (!this._api) return;
    const sections = parseYamlTopLevelSections(this.yaml);
    const { core, components } = categorizeSections(sections);
    const platform = this.platform || undefined;
    const boardId = this.board?.id;
    for (const item of [...core, ...components]) {
      const id = sectionKeyOf(item);
      if (getCachedComponent(id, platform) !== undefined) continue;
      void fetchComponent(this._api, id, platform).catch(() => {
        // Swallow — the navigator falls back to the raw id when no
        // catalog entry is available, so a transient backend hiccup
        // shouldn't surface as an error here.
      });
    }
    // Trigger catalog: needed so automation entries can render as
    // "Switch → Turn on" (catalog-pretty domain + trigger name)
    // instead of "warmtepomp → on_turn_on" (raw YAML key). The cache
    // is process-wide and the subscription path re-renders when an
    // entry lands.
    if (getCachedAutomationTriggers(platform, boardId) === undefined) {
      void fetchAutomationTriggers(this._api, platform, boardId).then(
        () => {
          // Manual nudge — the subscription handler only fires for
          // ``component-name`` writes; the trigger cache has no
          // observer surface, so we force a re-render directly.
          this._cacheTick++;
        },
        () => {
          /* swallow — same rationale as the component fetch above. */
        },
      );
    }
  }

  /**
   * Decide what to show on the two lines of a nav item.
   *
   *   line 1 (primary)   the catalog's friendly name (e.g.
   *                      "GPIO Binary Sensor") once resolved.
   *                      Falls back to <domain>.<platform> (or just
   *                      the domain for core keys like `wifi`) until
   *                      the cache is populated, or when no catalog
   *                      entry exists (typically: automations).
   *   line 2 (secondary) the user-supplied `name:` if present, else
   *                      the `id:`. Hidden when neither is set or
   *                      when it's identical to the primary.
   */
  private _navItemLabels(
    item: YamlSection,
    category: "core" | "component" | "automation",
  ): { primary: string; secondary?: string } {
    const raw = sectionKeyOf(item);

    if (category === "automation") {
      return this._automationLabels(item, raw);
    }

    let primary = raw;
    const cached = getCachedComponent(raw, this.platform || undefined);
    if (cached?.name) primary = cached.name;

    const named = item.name || item.id;
    const secondary = named && named !== primary ? named : undefined;

    return { primary, secondary };
  }

  /**
   * Two-line layout for automation entries — keeps the navigator
   * consistent with how components render (catalog name on top,
   * instance name/id below):
   *
   *   on_*: under a component  →  "Switch → Turn on" / instance name+id
   *   script entry             →  "Script"           / id
   *   interval entry           →  "Interval"         / "Every 60s"
   *
   * The catalog-derived "Switch" / "Turn on" pair comes from the
   * automation triggers catalog. While the catalog is still loading
   * we render a graceful fallback ("Switch → on_turn_on") so the
   * navigator never blanks out on first paint.
   */
  private _automationLabels(
    item: YamlSection,
    raw: string,
  ): { primary: string; secondary?: string } {
    // Script: line 1 = "Script", line 2 = id.
    if (item.parentKey === "script") {
      const primary = this._localize("device.script_header_title_static");
      const secondary = item.id ?? raw;
      return { primary, secondary: secondary !== primary ? secondary : undefined };
    }
    // Interval: line 1 = "Interval", line 2 = the time if known.
    // Uses the bare "automation_interval_label" key (not the
    // longer-form "On an interval" used by the kind picker) so the
    // nav row stays scannable.
    if (item.parentKey === "interval") {
      const primary = this._localize("device.automation_interval_label");
      const every = item.meta?.every;
      const secondary = every
        ? this._localize("device.automation_interval_every_n", { time: every })
        : undefined;
      return { primary, secondary };
    }
    // Device-level (``esphome → on_boot``) — no instance to show on
    // line 2; keep line 2 empty since the trigger name already
    // identifies the automation uniquely.
    if (item.parentKey === "esphome" && item.eventKey) {
      const primary = this._resolveTriggerName(
        "esphome",
        item.eventKey,
        `${this._prettyDomain("esphome")} → ${item.eventKey}`,
      );
      return { primary };
    }
    // Component-bound (``Switch → On Turn On`` resolved from the
    // catalog; "Warmtepomp" on line 2).
    if (item.parentKey && item.eventKey) {
      const fallback = `${this._prettyDomain(item.parentKey)} → ${item.eventKey}`;
      const primary = this._resolveTriggerName(
        item.parentKey,
        item.eventKey,
        fallback,
      );
      const named = item.name || item.id;
      const secondary = named && named !== primary ? named : undefined;
      return { primary, secondary };
    }
    // Unscoped / unrecognised — fall back to displayLabel.
    return { primary: item.displayLabel || raw };
  }

  /** Resolve the catalog's pretty name for ``<domain>.<event>`` or
   *  return ``fallback`` (typically the raw event key) when the
   *  catalog hasn't loaded yet. The catalog's ``name`` field is the
   *  full display label including the domain prefix
   *  (``"Switch → On Turn On"``), so callers use the resolved value
   *  as-is — no separate domain prepend. */
  private _resolveTriggerName(
    domain: string,
    eventKey: string,
    fallback: string,
  ): string {
    const triggers = getCachedAutomationTriggers(
      this.platform || undefined,
      this.board?.id,
    );
    if (!triggers) return fallback;
    const catalogId =
      domain === "esphome" ? eventKey : `${domain}.${eventKey}`;
    const hit = triggers.find((t) => t.id === catalogId);
    return hit?.name || fallback;
  }

  /** Capitalize a YAML domain key for display (``binary_sensor`` →
   *  ``Binary sensor``). Used only for the pre-catalog fallback
   *  label so the navigator never shows a raw lowercase domain
   *  while the trigger fetch is still in flight. */
  private _prettyDomain(domain: string): string {
    const spaced = domain.replace(/_/g, " ");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  private _onItemHover(line: number, fromLine: number, toLine: number) {
    this._hoveredLine = line;
    this._emitHighlight({ fromLine, toLine }, false);
  }

  private _onItemLeave() {
    this._hoveredLine = null;
    this._emitHighlight(this._selectedRange, false);
  }

  private _onItemClick(item: YamlSection) {
    const { fromLine, toLine } = item;
    const sectionKey = sectionKeyOf(item);

    if (this._selectedLine === fromLine) {
      this.selectedKey = null;
      this._selectedLine = null;
      this._selectedRange = null;
      this._emitHighlight(this._hoveredLine === fromLine ? { fromLine, toLine } : null, false);
      this._emitSectionSelect(null, undefined);
    } else {
      this.selectedKey = sectionKey;
      this._selectedLine = fromLine;
      this._selectedRange = { fromLine, toLine };
      this._emitHighlight({ fromLine, toLine }, true);
      this._emitSectionSelect(sectionKey, fromLine);
    }
  }

  private _emitHighlight(range: HighlightRange | null, scroll: boolean) {
    this.dispatchEvent(
      new CustomEvent("yaml-highlight", {
        detail: { range, scroll },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _emitSectionSelect(sectionKey: string | null, fromLine: number | undefined) {
    this.dispatchEvent(
      new CustomEvent("section-select", {
        detail: { sectionKey, fromLine },
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * Bubble up from the add-automation / add-script wizards. After
   * a successful upsert we want the navigator to route to the new
   * section so the user lands in the inline edit pane to fill in
   * actions (and parameters, for scripts). The wizard emits with
   * a stable section key built via ``sectionKeyFromLocation`` —
   * the same key parseYamlAutomations will produce on the next
   * navigator render once the YAML refresh propagates.
   */
  private _onAutomationAdded = (
    e: CustomEvent<{ sectionKey: string }>,
  ) => {
    e.stopPropagation();
    this._emitSectionSelect(e.detail.sectionKey, undefined);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-navigator": ESPHomeDeviceNavigator;
  }
}
