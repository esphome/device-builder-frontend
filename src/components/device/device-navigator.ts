import { consume } from "@lit/context";
import {
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight,
  mdiChevronUp,
  mdiCog,
  mdiHomeOutline,
  mdiPlusCircleOutline,
  mdiScriptTextOutline,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { subscribeAutomationCatalogCache } from "../../util/automation-catalog-cache.js";
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
import { CacheTickController } from "./cache-tick-controller.js";
import { deviceNavigatorStyles } from "./device-navigator.styles.js";
import { navItemMatches } from "./navigator-search-match.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./add-automation-dialog.js";
import type { ESPHomeAddAutomationDialog } from "./add-automation-dialog.js";
import "./add-component-dialog.js";
import type { ESPHomeAddComponentDialog } from "./add-component-dialog.js";
import "./add-config-dialog.js";
import type { ESPHomeAddConfigDialog } from "./add-config-dialog.js";
import "./add-script-dialog.js";
import type { ESPHomeAddScriptDialog } from "./add-script-dialog.js";
import "./device-navigator-search.js";
import { SECTION_ICON } from "./section-icons.js";
import { TriggerCatalogController } from "./trigger-catalog-controller.js";

registerMdiIcons({
  "chevron-down": mdiChevronDown,
  "chevron-left": mdiChevronLeft,
  "chevron-up": mdiChevronUp,
  "chevron-right": mdiChevronRight,
  cog: mdiCog,
  "home-outline": mdiHomeOutline,
  "plus-circle-outline": mdiPlusCircleOutline,
  "script-text-outline": mdiScriptTextOutline,
});

/** A nav row paired with its resolved display labels. */
interface NavRow {
  item: YamlSection;
  labels: { primary: string; secondary?: string };
}

@customElement("esphome-device-navigator")
export class ESPHomeDeviceNavigator extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

  /**
   * Re-renders when the component-name or automation-trigger cache fills
   * in (so resolved labels appear); ``tick`` is the invalidation key for
   * ``_resolveLabels``.
   */
  private readonly _caches = new CacheTickController(this, [
    subscribeComponentCache,
    subscribeAutomationCatalogCache,
  ]);

  // Resolves automation rows' pretty trigger names; shared with the
  // component automations list in device-section-config.
  private readonly _triggerCatalog = new TriggerCatalogController(this, () => ({
    api: this._api,
    platform: this.platform || undefined,
    boardId: this.board?.id,
  }));

  @property({ attribute: false })
  openSections: Set<number> = new Set();

  @property({ attribute: false })
  yaml = "";

  /** Derive the three navigator buckets (core, components,
   *  automations) from the YAML string. Memoised on the YAML
   *  source so the parse + categorize + filter + sort pipeline
   *  runs once per YAML edit, not per render. Two parser passes
   *  and three list traversals collapse into a single cached
   *  result. The render path destructures from this object. */
  private _deriveBuckets = memoizeOne((yaml: string) => {
    const {
      core,
      components,
      automations: topLevelAutomations,
    } = categorizeSections(parseYamlTopLevelSections(yaml));
    // ``parseYamlAutomations`` enumerates individual ``script:`` /
    // ``interval:`` list items as stable-keyed entries; drop the
    // bare top-level blocks so each automation shows up exactly
    // once.
    const detailed = parseYamlAutomations(yaml);
    const filteredTopLevel = topLevelAutomations.filter(
      (s) => s.key !== "script" && s.key !== "interval"
    );
    // Drop ``light_effect`` (managed via the parent light's section
    // editor) and ``unscoped`` entries (inline ``on_*:`` handlers
    // on id-less components that the structured editor can't
    // address).
    const automations = [...filteredTopLevel, ...detailed]
      .filter(
        (s) =>
          !s.key.startsWith("automation:light_effect:") &&
          !s.key.startsWith("automation:unscoped:")
      )
      .sort((a, b) => a.fromLine - b.fromLine);
    return { core, components, automations };
  });

  /** Resolve every row's labels, indexed [core, components, automations]
   *  to match the section order. Memoised on the parsed buckets plus the
   *  inputs labels depend on (catalog ticks, platform, device name,
   *  locale), so typing a query reuses the cached labels and only the
   *  cheap ``navItemMatches`` predicate runs per keystroke. The trailing
   *  args exist solely to invalidate the memo. */
  private _resolveLabels = memoizeOne(
    (
      buckets: {
        core: YamlSection[];
        components: YamlSection[];
        automations: YamlSection[];
      },
      _tick: number,
      _platform: string,
      _deviceName: string,
      _localize: LocalizeFunc
    ): NavRow[][] => [
      buckets.core.map((item) => ({ item, labels: this._navItemLabels(item, "core") })),
      buckets.components.map((item) => ({
        item,
        labels: this._navItemLabels(item, "component"),
      })),
      buckets.automations.map((item) => ({
        item,
        labels: this._navItemLabels(item, "automation"),
      })),
    ]
  );

  /** Optional board metadata; forwarded to the add-component dialog so
   * the embedded form can render GPIO pin selectors. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property()
  boardName = "";

  @property()
  configuration = "";

  /** Backend-resolved node name (esphome.name with substitutions
   *  expanded). Preferred over the raw YAML scalar for the esphome
   *  core section's subtitle so a `name: $devicename` doesn't leak
   *  the unexpanded `$devicename` into the navigator. */
  @property()
  deviceName = "";

  /** Device's target platform — forwarded to add-component / add-config
   * dialogs so the backend can resolve per-platform default values. */
  @property()
  platform = "";

  /** ``true`` once the parent's platform resolution settles.
   *  Without this gate the kickoff would routinely fire twice
   *  (yaml-edge with ``platform=""``, then platform-edge with the
   *  real value), landing in different ``BatchedCache`` buckets
   *  so the first round-trip is orphaned. */
  @property({ type: Boolean })
  platformReady = false;

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

  /** Active navigator search query; empty string means "not filtering". */
  @state()
  private _query = "";

  static styles = [espHomeStyles, deviceNavigatorStyles];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    // Fire on the edge that satisfies the gate — typically just
    // the last of (yaml, platformReady) to land. A subsequent
    // ``platform`` change (post-mount reconnect, etc.) refires.
    if (
      (changedProperties.has("yaml") ||
        changedProperties.has("platform") ||
        changedProperties.has("platformReady")) &&
      this.yaml &&
      this.platformReady
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
          : undefined) ?? allSections.find((s) => sectionKeyOf(s) === this.selectedKey);
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
    const buckets = this._deriveBuckets(this.yaml);
    const { core, components, automations } = buckets;

    interface NavAction {
      label: string;
      icon: string;
      onClick: () => void;
    }
    interface NavSection {
      label: string;
      desc: string;
      /** Leading section icon — mirrors the overview pane's step
       *  buttons (cog / chip / automation) so the two surfaces agree. */
      icon: string;
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
        icon: SECTION_ICON.core,
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
        icon: SECTION_ICON.components,
        items: components,
        category: "component",
        actions: [
          {
            label: this._localize("device.add_component"),
            icon: SECTION_ICON.components,
            onClick: () => this._addComponentDialog.open(),
          },
        ],
      },
      {
        label: this._localize("device.section_automations"),
        desc: this._localize("device.section_automations_desc"),
        icon: SECTION_ICON.automations,
        items: automations,
        category: "automation",
        actions: [
          {
            label: this._localize("device.add_automation"),
            icon: SECTION_ICON.automations,
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

    // Labels resolve once per (yaml, catalog tick, platform, name, locale)
    // via the memo, so typing only re-runs the cheap match predicate.
    const resolved = this._resolveLabels(
      buckets,
      this._caches.tick,
      this.platform,
      this.deviceName,
      this._localize
    );
    const q = this._query.trim();
    const filtering = q.length > 0;
    const matches = filtering
      ? resolved.map((rows) =>
          rows.filter(({ item, labels }) =>
            navItemMatches(q, labels.primary, labels.secondary, item.id, item.name)
          )
        )
      : null;
    const totalItems = sections.reduce((n, s) => n + s.items.length, 0);
    const matchCount = matches ? matches.reduce((n, m) => n + m.length, 0) : 0;
    // Stay silent on zero matches; the "No matches" empty state speaks.
    const resultLabel =
      filtering && matchCount > 0
        ? this._localize("device.navigator_search_count", {
            count: matchCount,
            total: totalItems,
          })
        : "";

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
          <h2 class="card-title">
            <button
              type="button"
              class="card-title-btn"
              @click=${this._goToOverview}
              title=${this._localize("device.navigator_home")}
            >
              <wa-icon library="mdi" name="home-outline"></wa-icon>
              <span>${this._localize("device.navigator_title")}</span>
            </button>
          </h2>
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
          <esphome-navigator-search
            .value=${this._query}
            .resultLabel=${resultLabel}
            @navigator-search=${this._onSearchChange}
          ></esphome-navigator-search>
          ${filtering
            ? nothing
            : html`<p class="italic">${this._localize("device.navigator_desc")}</p>`}
          <div class="separator"></div>
          ${filtering && matchCount === 0
            ? html`<p class="nav-empty" role="status">
                ${this._localize("device.navigator_search_none")}
              </p>`
            : sections.map(({ label, desc, icon, actions }, i) => {
                const open = filtering ? true : this.openSections.has(i);
                // Filtered rows come from the pre-pass; otherwise the
                // section's full (memoised) row set.
                const rows = matches?.[i] ?? resolved[i];
                // While filtering, drop sections with no matches entirely.
                if (filtering && rows.length === 0) return nothing;
                return html`
                  <div
                    class="nav-content"
                    @click=${() => {
                      if (!filtering) this._toggleSection(i);
                    }}
                  >
                    <div class="nav-content-label">
                      <wa-icon library="mdi" name=${icon}></wa-icon>
                      <p>${label}</p>
                    </div>
                    ${filtering
                      ? nothing
                      : html`<wa-icon
                          class="nav-content-chevron"
                          library="mdi"
                          name=${open ? "chevron-up" : "chevron-down"}
                        ></wa-icon>`}
                  </div>
                  ${open
                    ? html`
                        <div class="separator"></div>
                        ${filtering ? nothing : html`<p class="italic">${desc}</p>`}
                        ${rows.length > 0
                          ? html`<div class="nav-items">
                              ${rows.map(({ item, labels }) =>
                                this._renderNavItem(item, labels)
                              )}
                            </div>`
                          : nothing}
                        ${filtering
                          ? nothing
                          : html`<div class="nav-items">
                              ${actions.map((action) => this._renderActionItem(action))}
                            </div>`}
                      `
                    : nothing}
                  <div class="separator"></div>
                `;
              })}
        </div>
      </section>
    `;
  }

  /** One navigator row; shared by the filtered and unfiltered paths. */
  private _renderNavItem(
    item: YamlSection,
    labels: { primary: string; secondary?: string }
  ) {
    const { primary, secondary } = labels;
    return html`
      <div
        class="nav-item ${this._selectedLine === item.fromLine
          ? "nav-item--selected"
          : ""} ${this._hoveredLine === item.fromLine ? "nav-item--hovered" : ""}"
        @mouseenter=${() => this._onItemHover(item.fromLine, item.fromLine, item.toLine)}
        @mouseleave=${() => this._onItemLeave()}
        @click=${() => this._onItemClick(item)}
      >
        <div class="nav-item-content">
          <p>${primary}</p>
          ${secondary
            ? html`<span class="nav-item-subtitle">${secondary}</span>`
            : nothing}
        </div>
        <wa-icon library="mdi" name="chevron-right"></wa-icon>
      </div>
    `;
  }

  /** One "+ Add X" affordance at the foot of a section. */
  private _renderActionItem(action: {
    label: string;
    icon: string;
    onClick: () => void;
  }) {
    return html`<div class="action-item" @click=${() => action.onClick()}>
      <div>
        <wa-icon library="mdi" name=${action.icon}></wa-icon>
        <p>${action.label}</p>
      </div>
      <wa-icon library="mdi" name="plus-circle-outline"></wa-icon>
    </div>`;
  }

  private _onSearchChange = (e: CustomEvent<{ value: string }>) => {
    this._query = e.detail.value;
  };

  private _toggleSection(index: number) {
    this.dispatchEvent(
      new CustomEvent("section-toggle", {
        detail: { index },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** Clear the current section selection so the editor pane returns to
   *  the device overview (board image + "Change board"). Mirrors the
   *  deselect branch of ``_onItemClick`` without a row to toggle. */
  private _goToOverview = () => {
    this.selectedKey = null;
    this._selectedLine = null;
    this._selectedRange = null;
    this._hoveredLine = null;
    this._emitHighlight(null, false);
    this._emitSectionSelect(null, undefined);
  };

  /** Ask the page to hide the navigator. The page decides between
   *  desktop (set ``_navCollapsed`` + persist) and mobile (close the
   *  drawer) — we just say "I'd like to disappear". */
  private _onCollapseClick = () => {
    this.dispatchEvent(
      new CustomEvent("nav-collapse", {
        bubbles: true,
        composed: true,
      })
    );
  };

  /**
   * Fire-and-forget catalog lookups for any sections whose name we
   * haven't cached yet. Resolved entries land in the shared cache;
   * `_caches` re-renders the host when a fetch lands. Automations are
   * skipped — their keys are free-form strings (`<component> →
   * on_press`), not catalog ids.
   */
  private _kickoffNameResolves(): void {
    if (!this._api) return;
    const sections = parseYamlTopLevelSections(this.yaml);
    const { core, components } = categorizeSections(sections);
    const platform = this.platform || undefined;
    for (const item of [...core, ...components]) {
      const id = sectionKeyOf(item);
      if (getCachedComponent(id, platform) !== undefined) continue;
      void fetchComponent(this._api, id, platform).catch(() => {
        // Swallow — the navigator falls back to the raw id when no
        // catalog entry is available, so a transient backend hiccup
        // shouldn't surface as an error here.
      });
    }
    // Trigger catalog: lets automation entries render as
    // "Switch → On Turn On" instead of the raw YAML key. The
    // controller re-renders the host when the fetch lands.
    this._triggerCatalog.ensure();
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
    category: "core" | "component" | "automation"
  ): { primary: string; secondary?: string } {
    const raw = sectionKeyOf(item);

    if (category === "automation") {
      return this._automationLabels(item, raw);
    }

    let primary = raw;
    const cached = getCachedComponent(raw, this.platform || undefined);
    if (cached?.name) primary = cached.name;

    // Prefer the backend-resolved node name for the esphome core
    // section so a `name: $devicename` substitution shows the
    // expanded hostname, not the raw scalar. Falls back to the raw
    // YAML value for a new/unsaved device not yet in the devices list.
    const named =
      category === "core" && item.key === "esphome" && this.deviceName
        ? this.deviceName
        : item.name || item.id;
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
    raw: string
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
      const primary = this._triggerCatalog.resolveName(
        "esphome",
        item.eventKey,
        `${this._prettyDomain("esphome")} → ${item.eventKey}`
      );
      return { primary };
    }
    // Component-bound (``Switch → On Turn On`` resolved from the
    // catalog; "Warmtepomp" on line 2).
    if (item.parentKey && item.eventKey) {
      const fallback = `${this._prettyDomain(item.parentKey)} → ${item.eventKey}`;
      const primary = this._triggerCatalog.resolveName(
        item.parentKey,
        item.eventKey,
        fallback
      );
      const named = item.name || item.id;
      const secondary = named && named !== primary ? named : undefined;
      return { primary, secondary };
    }
    // Unscoped / unrecognised — fall back to displayLabel.
    return { primary: item.displayLabel || raw };
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
      this._emitHighlight(
        this._hoveredLine === fromLine ? { fromLine, toLine } : null,
        false
      );
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
  private _onAutomationAdded = (e: CustomEvent<{ sectionKey: string }>) => {
    e.stopPropagation();
    this._emitSectionSelect(e.detail.sectionKey, undefined);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-navigator": ESPHomeDeviceNavigator;
  }
}
