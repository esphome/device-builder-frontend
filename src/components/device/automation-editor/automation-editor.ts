/**
 * Top-level automation editor.
 *
 * Public surface (per the design plan):
 *
 * - ``configuration`` — the device's YAML filename, used as the
 *   first argument to every ``automations/*`` WS command.
 * - ``platform`` / ``board`` — forwarded to the catalog fetches and
 *   into ``<esphome-config-entry-form>`` for pin / id pickers.
 * - ``value`` — the current ``AutomationTree`` (``null`` in add
 *   mode).
 * - ``location`` — the ``AutomationLocation`` the editor saves to.
 *
 * Events:
 *
 * - ``automation-change`` (``detail: { value, location }``) — fires
 *   on every internal mutation so the parent (the page or the
 *   add-dialog) can mirror state.
 * - ``automation-save`` — fires when the upsert succeeds; detail
 *   carries the returned ``YamlDiff`` so the parent applies the
 *   splice to its in-memory YAML.
 * - ``automation-delete`` — fires when the delete succeeds.
 *
 * Save/delete are optimistic + revert-on-failure per CLAUDE.md.
 * The in-flight write guard mirrors ``_remoteBuildSetInFlight`` so
 * the post-reconnect re-parse path can short-circuit while a write
 * is outstanding.
 */
import { consume } from "@lit/context";
import toast from "sonner-js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  mdiArrowDecisionOutline,
  mdiDelete,
  mdiOpenInNew,
} from "@mdi/js";

import type { ESPHomeAPI } from "../../../api/index.js";
import type {
  AutomationLocation,
  AutomationTree,
  AutomationTrigger,
  AvailableAutomations,
  AvailableComponentInstance,
  AvailableScript,
  BoardCatalogEntry,
  ComponentCatalogEntry,
  ConfigEntry,
  YamlDiff,
} from "../../../api/types.js";
import type { LocalizeFunc } from "../../../common/localize.js";
import { apiContext, localizeContext } from "../../../context/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { inputStyles } from "../../../styles/inputs.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { renderMarkdown } from "../../../util/markdown.js";
import { anyAdvancedEntry } from "../../../util/config-entry-tree.js";
import {
  fetchComponent,
  getCachedComponent,
} from "../../../util/component-name-cache.js";
import { automationEditorStyles } from "./automation-editor.styles.js";
import {
  applyYamlDiff,
  emptyAutomationTree,
  sectionKeyFromLocation,
} from "./serialise.js";
import "../config-entry-form.js";
import "./automation-target-picker.js";
import "./automation-trigger-picker.js";
import "./automation-action-list.js";
import type { ESPHomeAutomationActionList } from "./automation-action-list.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";

registerMdiIcons({
  "arrow-decision-outline": mdiArrowDecisionOutline,
  delete: mdiDelete,
  "open-in-new": mdiOpenInNew,
});

@customElement("esphome-automation-editor")
export class ESPHomeAutomationEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property() configuration = "";

  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  @property() platform = "";

  @property({ attribute: false })
  value: AutomationTree | null = null;

  @property({ attribute: false })
  location: AutomationLocation | null = null;

  /**
   * True when the editor is mounted from the "+ Add automation" /
   * "+ Add script" entry point. Add-mode lets the user pick / edit
   * the target (kind + component / script id); edit-mode locks the
   * target picker (changing it would move the YAML splice to a
   * different range, which we don't support inline).
   *
   * The add-dialog passes a seed ``location`` (so the editor knows
   * which target kind to render) AND sets ``addMode``, which is
   * what we'd otherwise have to infer racily.
   */
  @property({ type: Boolean, attribute: "add-mode" })
  addMode = false;

  @property() yaml = "";

  /** Action-list reference — used by the header-positioned Add
   *  button to open the catalog picker dialog that lives inside
   *  the action-list component. */
  @query("esphome-automation-action-list")
  private _actionList?: ESPHomeAutomationActionList;

  /** Scoped catalog response. Trigger / action / condition lists
   *  come from here (the backend filters to what's actually in the
   *  device's YAML) so the dropdowns only show what's usable. */
  @state() private _available: AvailableAutomations | null = null;

  /** Component catalog entry for the ``interval`` component, lazily
   *  fetched the first time we render an interval automation. Drives
   *  the header (name / description / docs / image) and the inline
   *  config-entry form (the ``interval:`` time field that used to
   *  live in a dead "Target #N" readonly box). */
  @state() private _intervalComponent: ComponentCatalogEntry | null = null;

  @state() private _loading = true;
  @state() private _deleting = false;
  @state() private _error = "";

  /** "Show advanced settings" toggle state for the params form.
   *  Mirrors ``device-section-config``'s same-named state but
   *  scoped to this editor instance — switching away and back
   *  resets to collapsed, matching the component-editor UX. */
  @state() private _showAdvanced = false;

  /**
   * Debounce timer for auto-apply. Each value change schedules a
   * round-trip to ``automations/upsert``; the timer coalesces
   * bursts (typing into a templatable string param, dragging an
   * action up/down repeatedly) into one call.
   */
  private _applyTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * In-flight guard for the auto-apply path. Multiple value
   * changes can land while a previous upsert is still resolving;
   * we drop the in-flight ones and re-schedule on resolve so the
   * latest value wins.
   */
  private _applyInFlight = false;
  private _applyDirty = false;

  /**
   * Brief-window dirty flag covering the 200ms debounce gap
   * between the user's keystroke and the auto-apply committing
   * the change into the page's YAML buffer. The page reads
   * ``dirty`` from the mounted section so the unsaved-changes
   * guard and the save button activate the moment the user
   * starts typing, not when the debounced upsert finally
   * returns.
   */
  @state() private _dirty = false;

  public get dirty(): boolean {
    return this._dirty;
  }

  private _setDirty(value: boolean): void {
    if (this._dirty === value) return;
    this._dirty = value;
    this.dispatchEvent(
      new CustomEvent("dirty-change", {
        detail: { dirty: value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Derived: edit-mode = not add-mode. Snapshot taken in
   * ``connectedCallback`` so hydrate doesn't flip it back.
   */
  @state() private _editMode = false;

  /** In-flight write guard — parents that re-fetch on reconnect
   *  should consult this to skip clobbering an optimistic update. */
  public get inFlightWrite(): boolean {
    return this._deleting || this._applyInFlight;
  }

  static styles = [espHomeStyles, inputStyles, automationEditorStyles];

  connectedCallback(): void {
    super.connectedCallback();
    // Snapshot the add-vs-edit context once at mount so subsequent
    // property changes (the hydrate-from-backend cycle fills value
    // and re-pins location) don't accidentally unlock the picker
    // after it should stay locked.
    this._editMode = !this.addMode;
    void this._loadCatalogs();
    // Announce so the page-level save guard (device.ts) can hold a
    // direct ref and call flushPending() before its global save.
    // Mirrors device-section-config's section-mount event.
    this.dispatchEvent(
      new CustomEvent("section-mount", {
        detail: { node: this },
        bubbles: true,
        composed: true,
      }),
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._applyTimer) {
      clearTimeout(this._applyTimer);
      this._applyTimer = null;
    }
    this.dispatchEvent(
      new CustomEvent("section-unmount", {
        detail: { node: this },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("configuration")) {
      void this._loadAvailable();
    }
    // Navigator-driven location swap: when the parent passes in a
    // different ``location`` (user clicked a sibling automation),
    // the editor element is reused — its previous ``value`` is
    // stale. Invalidate it so the hydrate path below re-fetches
    // the matching ParsedAutomation. Without this guard the
    // trigger / actions panels keep showing the old automation's
    // content while the location-derived metadata fields update.
    if (changed.has("location") && !this.addMode) {
      const prev = changed.get("location") as
        | AutomationLocation
        | null
        | undefined;
      if (
        prev &&
        this.location &&
        sectionKeyFromLocation(prev) !==
          sectionKeyFromLocation(this.location)
      ) {
        this.value = null;
      }
    }
    // Hydrate from the backend in edit-mode: when the editor was
    // mounted with a known location but no value, we look up the
    // matching ParsedAutomation and populate value/location from
    // it. Triggering on ``_loading`` covers the common case where
    // the editor was mounted with the location already set — the
    // first ``location`` change fires while ``_loading=true``, so
    // we re-check after catalogs finish loading rather than waiting
    // for another location mutation that may never come.
    if (
      !this.addMode &&
      (changed.has("location") ||
        changed.has("configuration") ||
        changed.has("_loading")) &&
      this.location &&
      this.value === null &&
      !this._loading
    ) {
      void this._hydrateFromBackend();
    }
    // Interval automations need the ``interval`` component schema
    // so the header can show its description + docs link + image
    // and the form can render its config_entries (the actual
    // ``interval: 5s`` time field). Fetch lazily — only when we
    // actually land on an interval.
    if (
      (changed.has("location") || changed.has("platform")) &&
      this.location?.kind === "interval"
    ) {
      void this._loadIntervalComponent();
    }
  }

  /** Lazy fetch of the ``interval`` component catalog entry.
   *  Reuses the shared component-name cache so the navigator's
   *  pre-fetch (for the label) doubles as the editor's source. */
  private async _loadIntervalComponent() {
    if (!this._api) return;
    const platform = this.platform || undefined;
    const boardId = this.board?.id;
    const cached = getCachedComponent(`interval`, platform, boardId);
    if (cached) {
      this._intervalComponent = cached;
      return;
    }
    try {
      const entry = await fetchComponent(
        this._api,
        `interval`,
        platform,
        boardId,
      );
      if (entry) this._intervalComponent = entry;
    } catch {
      /* swallow — the editor falls back to the static label when no
         catalog entry is available; transient backend hiccups
         shouldn't surface as an error here. */
    }
  }

  /**
   * When the editor is mounted in edit mode (a navigator click
   * landed us here with a ``location`` but no ``value``), pull the
   * parsed automation list and match by stable section key. This
   * keeps the editor self-contained — the parent only needs to
   * pass the section key's location.
   */
  private async _hydrateFromBackend() {
    if (!this._api || !this.configuration || !this.location) return;
    try {
      // Pass ``this.yaml`` so the parser sees the user's current
      // draft buffer — without it the post-add hydrate would read
      // the on-disk YAML, miss the just-inserted automation, and
      // leave the form empty even though the YAML pane shows the
      // user's input.
      const parsed = await this._api.parseDeviceAutomations(
        this.configuration,
        this.yaml,
      );
      const wantKey = sectionKeyFromLocation(this.location);
      const match = parsed.find(
        (p) => sectionKeyFromLocation(p.location) === wantKey,
      );
      if (match) {
        this.value = match.automation;
        // Re-pin location so the writer round-trips with the parser's
        // canonical form (script id matched, light_effect index
        // resolved against the actual YAML, …).
        this.location = match.location;
      }
    } catch (err) {
      this._error =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_parse_error");
    }
  }

  private async _loadCatalogs() {
    if (!this._api) return;
    this._loading = true;
    this._error = "";
    try {
      if (this.configuration) await this._loadAvailable();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private async _loadAvailable() {
    if (!this._api || !this.configuration) return;
    try {
      this._available = await this._api.getAvailableAutomations(this.configuration);
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    }
  }

  protected render() {
    if (this._loading) {
      return html`<div class="ae-empty">
        <wa-spinner></wa-spinner>
        ${this._localize("device.loading_automation_catalog")}
      </div>`;
    }
    const automation = this.value ?? emptyAutomationTree();
    const target = this.location;
    const devices = this._available?.devices ?? [];
    const scripts = this._available?.scripts ?? [];
    // Catalog dropdowns read from the scoped lists so they only
    // surface what this device's YAML can actually use (per the
    // backend's filtering — see ``catalog.triggers_for_domains``
    // etc.). When ``_available`` hasn't loaded yet the dropdowns
    // are empty rather than showing the unfiltered universe.
    const triggers = this._available?.triggers ?? [];
    const actions = this._available?.actions ?? [];
    const conditions = this._available?.conditions ?? [];
    const disabled = this._deleting;
    // For ``device_on`` and ``component_on`` the trigger lives in the
    // location alongside the YAML splice destination. Mirror it into
    // the editor's effective trigger id so the picker shows the right
    // selection on first paint without a manual sync step.
    //
    // ``trigger_id`` is the catalog-qualified id
    // (``"switch.on_turn_on"``). ``location.trigger`` is the bare
    // YAML key (``"on_turn_on"``) the writer splices under the
    // component. For ``device_on`` the two coincide because
    // device-level catalog ids carry no domain prefix.
    const effectiveTriggerId =
      automation.trigger_id ??
      (target?.kind === "device_on"
        ? target.trigger || null
        : target?.kind === "component_on"
          ? this._catalogIdFor(target) || null
          : null);
    const activeTrigger = effectiveTriggerId
      ? triggers.find((t) => t.id === effectiveTriggerId) ?? null
      : null;
    return html`
      ${this._renderHeader(activeTrigger)}
      ${this.addMode
        ? this._renderAddModePickers(
            target,
            triggers,
            devices,
            scripts,
            effectiveTriggerId,
            automation,
            disabled,
          )
        : html`${this._renderIdentityFields(activeTrigger)}${this._renderTriggerParamsForm(
            activeTrigger,
            automation,
            disabled,
          )}`}
      <div class="field">
        <div class="ae-actions-header">
          <label class="field-label">
            ${this._localize("device.automation_action")}
          </label>
          <button
            type="button"
            class="ae-section-add"
            ?disabled=${disabled || actions.length === 0}
            @click=${() => this._actionList?.openPicker()}
          >
            <wa-icon library="mdi" name="plus"></wa-icon>
            ${this._localize("device.add_action")}
          </button>
        </div>
        <p class="field-description">
          ${renderMarkdown(
            this._localize("device.automation_actions_description"),
          )}
        </p>
        <esphome-automation-action-list
          no-header
          hide-add
          .actions=${automation.actions}
          .catalog=${actions}
          .conditionCatalog=${conditions}
          .scripts=${scripts}
          .devices=${devices}
          .board=${this.board}
          .yaml=${this.yaml}
          ?disabled=${disabled}
          @actions-change=${this._onActionsChange}
        ></esphome-automation-action-list>
      </div>
      ${this._error
        ? html`<p class="ae-error" role="alert">${this._error}</p>`
        : nothing}
      ${this.location && this.value && !this.addMode
        ? html`<div class="ae-actions">
            <button
              type="button"
              class="ae-danger"
              ?disabled=${disabled}
              @click=${this._onDelete}
            >
              <wa-icon library="mdi" name="delete"></wa-icon>
              ${this._localize("device.delete_automation")}
            </button>
          </div>`
        : nothing}
    `;
  }

  /**
   * Trigger param form for edit-mode. The target / trigger
   * dropdowns are gone — those become read-only metadata in the
   * header. Only the trigger's ``config_entries`` need a form,
   * since those ARE editable on an existing automation (e.g.
   * tweaking ``min_length`` on an ``on_click`` trigger after the
   * fact).
   *
   * ``interval`` automations special-case: the trigger
   * (``interval.then``) carries no config_entries, but the parent
   * ``interval`` *component* does — ``interval:`` (time), ``id:``,
   * ``startup_delay:`` etc. all live in ``trigger_params`` in the
   * AutomationTree, so render them from the component schema
   * (filtered to drop ``then:``, which is the actions block).
   */
  private _renderTriggerParamsForm(
    activeTrigger: AutomationTrigger | null,
    automation: AutomationTree,
    disabled: boolean,
  ) {
    const entries = this._paramFormEntries(activeTrigger);
    if (entries.length === 0) return nothing;
    const hasAdvanced = anyAdvancedEntry(entries);
    // No outer wrapper / no synthetic group label: the form renders
    // each entry with its own catalog-derived label + description,
    // and a section header above that ("Interval" / "Trigger
    // options") would just duplicate the first field's name. Sit as
    // a sibling of the header and the action-list so the :host gap
    // alone handles vertical rhythm.
    return html`
      <esphome-config-entry-form
        .entries=${entries}
        .values=${automation.trigger_params}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${disabled}
        ?show-advanced=${this._showAdvanced}
        @value-change=${this._onTriggerParamsValueChange}
      ></esphome-config-entry-form>
      ${hasAdvanced
        ? html`<div class="advanced-toggle-row">
            <wa-switch
              .checked=${this._showAdvanced}
              @change=${(e: Event) => {
                this._showAdvanced = (
                  e.target as HTMLInputElement & { checked: boolean }
                ).checked;
              }}
            >
              ${this._localize("device.show_advanced")}
            </wa-switch>
          </div>`
        : nothing}
    `;
  }

  /** Resolve the config_entries list that drives the trigger-params
   *  form. Interval pulls from the component schema (since
   *  ``interval.then``'s own config_entries is empty); everything
   *  else stays on the trigger's own config_entries. */
  private _paramFormEntries(
    activeTrigger: AutomationTrigger | null,
  ): ConfigEntry[] {
    if (this.location?.kind === "interval") {
      const comp = this._intervalComponent;
      if (!comp) return [];
      // ``then:`` is the actions block — we render it via the
      // action-list, not the form.
      return comp.config_entries.filter((e) => e.key !== "then");
    }
    return activeTrigger?.config_entries ?? [];
  }

  /**
   * Legacy add-mode pickers. The "+ Add automation" wizard now
   * collects target / trigger before mounting the editor, so this
   * path isn't normally reached from the navigator — kept for
   * back-compat if a parent ever instantiates the editor in
   * add-mode directly.
   */
  private _renderAddModePickers(
    target: AutomationLocation | null,
    triggers: AutomationTrigger[],
    devices: AvailableComponentInstance[],
    scripts: AvailableScript[],
    effectiveTriggerId: string | null,
    automation: AutomationTree,
    disabled: boolean,
  ) {
    return html`
      <esphome-automation-target-picker
        .value=${target}
        .devices=${devices}
        .scripts=${scripts}
        ?disabled=${disabled}
        @target-change=${this._onTargetChange}
      ></esphome-automation-target-picker>
      <esphome-automation-trigger-picker
        .target=${target}
        .triggers=${triggers}
        .devices=${devices}
        .triggerId=${effectiveTriggerId}
        .triggerParams=${automation.trigger_params}
        .board=${this.board}
        .yaml=${this.yaml}
        ?disabled=${disabled}
        @trigger-change=${this._onTriggerChange}
        @trigger-params-change=${this._onTriggerParamsChange}
      ></esphome-automation-trigger-picker>
    `;
  }

  private _onTriggerParamsValueChange = (
    e: CustomEvent<{ path: string[]; value: unknown }>,
  ) => {
    e.stopPropagation();
    // Form's value-change events carry path-based updates; merge
    // into the trigger_params dict.
    const { path, value } = e.detail;
    const automation = this.value ?? emptyAutomationTree();
    const next = this._applyParamPatch(automation.trigger_params, path, value);
    this._withValue({ trigger_params: next });
  };

  /** Apply a single value-change patch into a params dict. */
  private _applyParamPatch(
    params: Record<string, unknown>,
    path: string[],
    value: unknown,
  ): Record<string, unknown> {
    if (path.length === 0) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return { ...(value as Record<string, unknown>) };
      }
      return {};
    }
    const [head, ...rest] = path;
    if (rest.length === 0) {
      if (value === undefined || value === "") {
        const next = { ...params };
        delete next[head];
        return next;
      }
      return { ...params, [head]: value };
    }
    const child =
      params[head] &&
      typeof params[head] === "object" &&
      !Array.isArray(params[head])
        ? (params[head] as Record<string, unknown>)
        : {};
    return {
      ...params,
      [head]: this._applyParamPatch(child, rest, value),
    };
  }

  /**
   * Component-style header card. Title is the catalog-resolved
   * domain + trigger name (``Switch → Turn on``) so it matches the
   * navigator's primary label and gives the user the same eye-line
   * cue they get from clicking a regular component.
   *
   * For ``interval`` automations we reach further and pull the
   * ``interval`` component catalog entry so the user gets the same
   * name / description / docs / image they'd see in a regular
   * component editor — no more bland generic "Automation".
   *
   * Title decomposes to the kind label (``Automation``) when we
   * don't have enough metadata yet — fresh add-mode (no trigger
   * picked) or script / light_effect locations.
   */
  private _renderHeader(activeTrigger: AutomationTrigger | null) {
    const loc = this.location;
    const intervalComp =
      loc?.kind === "interval" ? this._intervalComponent : null;
    const title = intervalComp?.name ?? this._headerTitle(activeTrigger);
    const docsUrl = intervalComp?.docs_url ?? activeTrigger?.docs_url ?? "";
    const descText =
      intervalComp?.description ??
      activeTrigger?.description ??
      this._localize("device.automation_header_description");
    const imageUrl = intervalComp?.image_url ?? "";
    return html`<div class="ae-header">
      <div class="ae-header-text">
        <h2 class="ae-header-title">${title}</h2>
        ${docsUrl
          ? html`<a
              class="ae-header-docs"
              href=${docsUrl}
              target="_blank"
              rel="noreferrer"
            >
              ${this._localize("device.docs")}
              <wa-icon library="mdi" name="open-in-new"></wa-icon>
            </a>`
          : nothing}
        <p class="ae-header-desc">${renderMarkdown(descText)}</p>
      </div>
      <div class="ae-header-icon">
        ${imageUrl
          ? html`<img alt="" src=${imageUrl} />`
          : html`<wa-icon
              library="mdi"
              name="arrow-decision-outline"
            ></wa-icon>`}
      </div>
    </div>`;
  }

  /**
   * Compose the header title:
   *
   *   device_on / component_on (trigger picked)  → catalog's
   *     ``trigger.name`` ("Switch → On Turn On") — already domain-
   *     qualified, no extra prefix.
   *   interval                                   → catalog component
   *     name (handled by ``_renderHeader``); this is the fallback
   *     when the component hasn't loaded yet.
   *   anything else / fallback                   → static "Automation"
   */
  private _headerTitle(trigger: AutomationTrigger | null): string {
    const loc = this.location;
    if (loc?.kind === "interval") {
      return this._localize("device.automation_interval_label");
    }
    if (trigger && (loc?.kind === "device_on" || loc?.kind === "component_on")) {
      return trigger.name;
    }
    return this._localize("device.automation_header_title_static");
  }

  /**
   * Read-only target field — the only identity field we still
   * surface, and only for ``component_on``: the catalog name
   * (``Switch → On Turn On``) already sits as the editor's header
   * title so a separate "Trigger" row underneath was just a copy
   * of it, and ``device_on`` / ``interval`` have no meaningful
   * target to display either ("the device itself" / "Interval #1"
   * read as filler). Leaves only "which component instance is
   * this automation bound to" — the one piece of identity the
   * header can't carry.
   */
  private _renderIdentityFields(_activeTrigger: AutomationTrigger | null) {
    const loc = this.location;
    if (!loc) return nothing;
    if (loc.kind !== "component_on") return nothing;
    const targetValue = this._targetMetadataValue(loc);
    return html`<div class="field">
      <label class="field-label">
        ${this._localize("device.automation_target")}
      </label>
      <input type="text" readonly .value=${targetValue} />
    </div>`;
  }

  /**
   * Compose the single TARGET row value. For component_on this is
   * the bound device's display name + catalog id (e.g.
   * "Warmtepomp (switch.gpio)") — no separate "Which component?"
   * row. For device_on it's "The device itself"; for interval
   * it's "Interval #N"; for script / light_effect we fall back
   * to the kind label (those land in their own editors anyway).
   */
  private _targetMetadataValue(loc: AutomationLocation): string {
    switch (loc.kind) {
      case "device_on":
        return this._localize("device.automation_target_device");
      case "component_on": {
        const device = this._available?.devices.find(
          (d) => d.id === loc.component_id,
        );
        if (!device) return loc.component_id;
        const label = device.name ?? device.id;
        return `${label} (${device.component_id})`;
      }
      case "interval":
        return this._localize("device.automation_target_interval_n", {
          index: loc.index + 1,
        });
      case "script":
        return loc.id;
      case "api_action":
        return loc.action_name;
      case "light_effect":
        return loc.component_id;
    }
  }

  // ─── State mutations ─────────────────────────────────────────

  private _withValue(patch: Partial<AutomationTree>) {
    const value: AutomationTree = { ...(this.value ?? emptyAutomationTree()), ...patch };
    this.value = value;
    this.dispatchEvent(
      new CustomEvent("automation-change", {
        detail: { value, location: this.location },
        bubbles: true,
        composed: true,
      }),
    );
    this._scheduleAutoApply();
  }

  /**
   * Schedule a debounced upsert. The global save button is the
   * only place that actually writes to disk; this auto-apply
   * keeps the page's YAML buffer in sync with the editor state
   * so the YAML pane updates live and the save button activates.
   */
  private _scheduleAutoApply() {
    // Don't auto-apply in add-mode — the editor's add-mode
    // surface isn't currently reached from the navigator (wizard
    // owns the add flow); leaving this off avoids accidentally
    // upserting partially-filled trees if someone instantiates
    // the editor in add-mode directly.
    if (this.addMode) return;
    this._setDirty(true);
    if (this._applyTimer) clearTimeout(this._applyTimer);
    this._applyTimer = setTimeout(() => {
      this._applyTimer = null;
      void this._autoApply();
    }, 200);
  }

  /**
   * Push the current ``value`` through ``automations/upsert``,
   * apply the returned diff to the page's YAML buffer, and
   * dispatch ``yaml-draft`` so the page picks it up. Only one
   * upsert runs at a time; if a value-change lands while we're
   * in flight, the dirty flag re-runs us on resolve.
   */
  private async _autoApply(): Promise<void> {
    if (!this._api || !this.location || !this.value) return;
    if (this._applyInFlight) {
      this._applyDirty = true;
      return;
    }
    this._applyInFlight = true;
    this._applyDirty = false;
    try {
      // Pass ``this.yaml`` so the backend computes the diff against
      // the current draft buffer rather than the on-disk YAML —
      // otherwise repeated auto-applies (the user typing into the
      // same field) would each re-insert the automation on top of
      // the previous draft's insertion. See backend's
      // ``automations/upsert`` for the matching parameter.
      const { yaml_diff } = await this._api.upsertAutomation(
        this.configuration,
        this.value,
        this.location,
        this.yaml,
      );
      const newYaml = applyYamlDiff(this.yaml, yaml_diff);
      this.dispatchEvent(
        new CustomEvent<{ yaml: string }>("yaml-draft", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_save_error");
      this._error = msg;
      toast.error(this._localize("device.automation_save_error"), {
        description: msg,
        richColors: true,
      });
    } finally {
      this._applyInFlight = false;
      if (this._applyDirty) {
        // A value-change landed while we were running. Re-run
        // with the latest value so we don't drop the user's last
        // edit on the floor.
        this._applyDirty = false;
        void this._autoApply();
      } else {
        // No further pending change — the page's YAML is now in
        // sync with our state. Clear the section-dirty flag; the
        // page still tracks _isYamlDirty separately (_yaml vs
        // _savedYaml) so the global save button stays armed.
        this._setDirty(false);
      }
    }
  }

  /**
   * Force a pending debounced auto-apply to flush immediately.
   * The device page calls this on the active section before its
   * global save so the YAML buffer is fully caught up with the
   * editor state.
   */
  public async flushPending(): Promise<void> {
    if (this._applyTimer) {
      clearTimeout(this._applyTimer);
      this._applyTimer = null;
      await this._autoApply();
    } else if (this._applyInFlight) {
      // Wait for the in-flight call to settle.
      while (this._applyInFlight) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
  }

  private _onTargetChange = (
    e: CustomEvent<{ target: AutomationLocation | null }>,
  ) => {
    e.stopPropagation();
    this.location = e.detail.target;
    // Reset trigger when switching target kinds — the previous
    // trigger id wouldn't apply to the new target's domain.
    this._withValue({ trigger_id: null, trigger_params: {} });
  };

  private _onTriggerChange = (
    e: CustomEvent<{ triggerId: string; params: Record<string, unknown> }>,
  ) => {
    e.stopPropagation();
    this._withValue({
      trigger_id: e.detail.triggerId,
      trigger_params: e.detail.params,
    });
    // For device-level and component-level automations the trigger
    // name is part of the YAML splice destination (it's the
    // ``on_*:`` key the writer renders under). Mirror the new
    // trigger id into the location so save/delete target the right
    // range. ``interval`` / ``script`` / ``light_effect`` carry no
    // ``trigger`` field.
    //
    // Wire-shape detail: ``AutomationTree.trigger_id`` is the
    // catalog-qualified id (``"switch.on_turn_on"`` — what
    // ``catalog.trigger_by_id`` returns a hit for).
    // ``location.component_on.trigger`` is the BARE YAML key
    // (``"on_turn_on"``) the writer splices under the component;
    // the backend reconstructs the catalog id by combining the
    // component's domain with the bare key. Device-level catalog
    // ids carry no domain prefix so the two coincide for
    // ``device_on``.
    if (this.location?.kind === "device_on") {
      this.location = { ...this.location, trigger: e.detail.triggerId };
    } else if (this.location?.kind === "component_on") {
      const bare = this._bareTriggerKey(e.detail.triggerId);
      this.location = { ...this.location, trigger: bare };
    }
  };

  /**
   * Drop the ``<domain>.`` prefix from a catalog trigger id to get
   * the bare YAML key. ``"switch.on_turn_on"`` → ``"on_turn_on"``.
   * Ids that already lack a domain are passed through.
   */
  private _bareTriggerKey(catalogId: string): string {
    const dotIdx = catalogId.indexOf(".");
    return dotIdx >= 0 ? catalogId.slice(dotIdx + 1) : catalogId;
  }

  /**
   * Build the catalog-qualified trigger id for a ``component_on``
   * location, using the bound device's domain. Returns ``null``
   * when the device isn't yet loaded or the location has no
   * trigger picked.
   */
  private _catalogIdFor(loc: AutomationLocation): string | null {
    if (loc.kind !== "component_on" || !loc.trigger) return null;
    const device = this._available?.devices.find((d) => d.id === loc.component_id);
    const domain = device?.component_id.split(".")[0] ?? null;
    return domain ? `${domain}.${loc.trigger}` : loc.trigger;
  }

  private _onTriggerParamsChange = (
    e: CustomEvent<{ params: Record<string, unknown> }>,
  ) => {
    e.stopPropagation();
    this._withValue({ trigger_params: e.detail.params });
  };

  private _onActionsChange = (
    e: CustomEvent<{ actions: AutomationTree["actions"] }>,
  ) => {
    e.stopPropagation();
    this._withValue({ actions: e.detail.actions });
  };

  // ─── Delete ──────────────────────────────────────────────────

  /**
   * Delete writes to disk directly (matches the component-editor
   * delete pattern in ``device-section-config/draft-and-delete``):
   * compute the new YAML via the backend's delete diff, write it
   * via ``api.updateConfig``, then dispatch ``yaml-updated``
   * (which advances both ``_yaml`` AND ``_savedYaml`` on the
   * page — a clean state). Navigate away from the deleted
   * section after.
   */
  private _onDelete = async () => {
    if (!this._api || !this.location || this._deleting) return;
    // Cancel any pending auto-apply — we're about to delete.
    if (this._applyTimer) {
      clearTimeout(this._applyTimer);
      this._applyTimer = null;
    }
    this._deleting = true;
    this._error = "";
    try {
      const { yaml_diff } = await this._api.deleteAutomation(
        this.configuration,
        this.location,
        this.yaml,
      );
      const newYaml = applyYamlDiff(this.yaml, yaml_diff);
      await this._api.updateConfig(this.configuration, newYaml);
      this.dispatchEvent(
        new CustomEvent<{ yaml: string }>("yaml-updated", {
          detail: { yaml: newYaml },
          bubbles: true,
          composed: true,
        }),
      );
      this.dispatchEvent(
        new CustomEvent<{ sectionKey: string | null }>("section-select", {
          detail: { sectionKey: null },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : this._localize("device.automation_save_error");
      this._error = msg;
      toast.error(this._localize("device.automation_save_error"), {
        description: msg,
        richColors: true,
      });
    } finally {
      this._deleting = false;
    }
  };

  /** Filter declaration for the action buttons (referenced from
   *  the inline styles to keep the editor.styles file generic). */
  static get _actionStyles() {
    return null;
  }

  /**
   * Devices forwarded to sub-pickers — exposed for tests.
   * @internal
   */
  public get _devicesForTest(): AvailableComponentInstance[] {
    return this._available?.devices ?? [];
  }

  /** Scripts forwarded to sub-pickers — exposed for tests. @internal */
  public get _scriptsForTest(): AvailableScript[] {
    return this._available?.scripts ?? [];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-automation-editor": ESPHomeAutomationEditor;
  }
}
