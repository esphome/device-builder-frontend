import { consume } from "@lit/context";
import { mdiAlertCircleOutline } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../api/types/components.js";
import type { ConfigEntry } from "../../api/types/config-entries.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { ComponentNameResolverController } from "../../util/component-name-resolver-controller.js";
import { entryAtPath } from "../../util/config-entry-tree.js";
import {
  clearPathErrors,
  validateEntries,
  validateValueAt,
  type ValidationError,
} from "../../util/config-validation.js";
import { resolveFeaturedComponentId } from "../../util/featured-id.js";
import { fireEvent } from "../../util/fire-event.js";
import { renderMarkdown } from "../../util/markdown.js";
import { getIn, setIn } from "../../util/nested-values.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  parseTopLevelComponents,
  serializeYamlValues,
} from "../../util/yaml-serialize.js";
import { assessBusHostability, exclusiveBusTarget } from "../../util/bus-availability.js";
import { yamlHasExternalIdSources } from "../../util/config-entry-yaml-scan.js";
import { loadCatalog } from "../../util/yaml-completion-catalog.js";
import {
  depsSatisfiedByProvides,
  findMissingDependencies,
} from "./add-component-deps.js";
import { coerceFields } from "./add-component-form-coerce.js";
import { addFormRenderablePaths } from "./add-component-form-filter.js";
import { overlayOptions, overlayRequired } from "./add-component-form-overlays.js";
import { buildInitialValues, findReferencePath } from "./add-component-form-seed.js";
import { addComponentFormStyles } from "./add-component-form.styles.js";
import "./config-entry-form.js";
import type { ConfigEntryValueChange } from "./config-entry-form.js";
import { resolveEntryLabel } from "./config-entry-renderers-shared.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "alert-circle-outline": mdiAlertCircleOutline });

@customElement("esphome-add-component-form")
export class ESPHomeAddComponentForm extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

  @property({ attribute: false })
  component!: ComponentCatalogEntry;

  /** Board metadata; forwarded to the shared form for pin pickers. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  /** Current device YAML; forwarded to the shared form for ID
   * reference dropdowns and used here for the dependency check. */
  @property()
  yaml = "";

  /**
   * Optional initial value for an ID-reference field. Used by the
   * dialog after a "+ Add <domain>" detour finishes — we pre-fill the
   * just-created component's id into the original form's matching
   * `references_component: <domain>` field, so the user doesn't have
   * to pick from the dropdown again.
   */
  @property({ attribute: false })
  prefillReference: { domain: string; id: string } | null = null;

  /** Initial field values for a dep-added bus, derived from the
   *  requesting component's `bus_constraints` (ags10 -> i2c at 15kHz). */
  @property({ attribute: false })
  prefillFields: Record<string, unknown> | null = null;

  /** Bus fields the requesting component forces (require_tx -> tx_pin);
   *  overlaid as `required` so the form gates submit on them. */
  @property({ attribute: false })
  extraRequired: string[] | null = null;

  /** Values the user had entered before a "+ Add <dep>" detour; the dialog
   *  snapshots them at detour start and hands them back on return so a field
   *  they already filled (an SPI device's `cs_pin`) survives the round-trip. */
  @property({ attribute: false })
  restoredValues: Record<string, unknown> | null = null;

  /** Per-field dropdown narrowing the requester imposes via a list
   *  `bus_constraints` value (CN105 -> baud_rate [2400, 9600]); the
   *  matching entry's `options` are limited to these, defaulting first. */
  @property({ attribute: false })
  optionOverrides: Record<string, (string | number)[]> | null = null;

  @property({ type: Boolean })
  submitting = false;

  @property()
  submitError = "";

  @state()
  private _values: Record<string, unknown> = {};

  /** The in-progress form values, so the dialog can snapshot them before a
   *  "+ Add <dep>" detour unmounts this form. A shallow copy so the snapshot
   *  stays stable if the form keeps editing `_values`. */
  get currentValues(): Record<string, unknown> {
    return { ...this._values };
  }

  /** Keyboard-submit entry: same guarded path as the Add button. */
  requestSubmit(): void {
    if (this.submitting) return;
    this._onSubmit();
  }

  @state()
  private _errors: Map<string, ValidationError> = new Map();

  /** Surface text where ``_onSubmit`` blocks without visible field
   * errors (hidden-entry validation, missing deps) — routine via
   * ``requestSubmit`` (Enter), which bypasses the Add button's
   * disabled gate. The dialog's ``submitError`` is reserved for API
   * failures — this is the pre-API "the form refused to submit and
   * here's why" lane. */
  @state()
  private _localBlockMessage = "";

  @state()
  private _showYaml = false;

  /** Debounce for the live typed-value check: the renderers emit
   *  partial text per keystroke, so validation waits for a pause. */
  private static readonly LIVE_VALIDATE_DEBOUNCE_MS = 200;

  private _liveValidateTimer: ReturnType<typeof setTimeout> | undefined;

  /** Missing deps a present component already provides; resolved async,
   *  subtracted from the banner. See `depsSatisfiedByProvides`. */
  @state()
  private _providedDeps: ReadonlySet<string> = new Set();

  /** Bumps per resolution so a superseded `(component, yaml)` result can't
   *  overwrite a newer one. */
  private _providesSeq = 0;

  /** Bus dep present in the YAML but with no bus this component can attach
   *  to; folded into the missing-deps banner and submit gate so the user
   *  detours to a new bus. Resolved async like `_providedDeps`. */
  @state()
  private _busBlockedDep: string | null = null;

  /** Reference key forced visible when several buses qualify, so the user
   *  picks one instead of esphome failing on the ambiguity. */
  @state()
  private _busPickerKey: string | null = null;

  /** Guards `_resolveBusHostability` against out-of-order resolutions. */
  private _busAssessSeq = 0;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._liveValidateTimer);
  }

  /** Resolves dep ids (``i2c``) to their catalog name (``I²C Bus``)
   * for the missing-deps banner. Owns the cache subscription so a
   * fresh entry triggers a re-render without bookkeeping here. */
  private readonly _depResolver = new ComponentNameResolverController(
    this,
    () => this._api,
    () => this.board?.esphome.platform || undefined
  );

  static styles = [
    espHomeStyles,
    inputStyles,
    // Shared .btn base chrome; addComponentFormStyles layers this
    // form's deltas (inline-flex layout, all-variant :disabled) on top.
    dialogActionButtonStyles,
    addComponentFormStyles,
  ];

  // Memoized so the shared form's `.entries` identity is render-stable.
  private _overlayRequired = memoizeOne(overlayRequired);
  private _overlayOptions = memoizeOne(overlayOptions);
  private _mergedExtraRequired = memoizeOne(
    (extra: string[] | null, busKey: string | null): string[] | null =>
      busKey ? [...(extra ?? []), busKey] : extra
  );

  private get _entries(): ConfigEntry[] {
    return this._overlayOptions(
      this._overlayRequired(
        this.component.config_entries,
        this._mergedExtraRequired(this.extraRequired, this._busPickerKey)
      ),
      this.optionOverrides
    );
  }

  /** True once we've seeded `_values` for the current component. */
  private _initialized = false;

  willUpdate(changedProperties: Map<string, unknown>) {
    super.willUpdate(changedProperties);
    // Initialize the form values once we have both `component` and
    // (if applicable) `prefillReference` set. We can't do this in
    // `connectedCallback` because Lit applies property bindings as
    // part of the update lifecycle, so on first paint they're not
    // guaranteed to be set yet. Re-run when the component changes
    // (the same form instance can be retargeted to a different
    // component in the dep-flow detour).
    if (changedProperties.has("component") || !this._initialized) {
      if (this.component) {
        this._initialized = true;
        // A pending live check belongs to the previous component's
        // entries; validating across the retarget could mis-flag.
        clearTimeout(this._liveValidateTimer);
        // A stale bus verdict must not gate the next component while its
        // own assessment is in flight, and the previous picker key must
        // not shape the seed pass below.
        this._busBlockedDep = null;
        this._busPickerKey = null;
        this._initValues();
        // Reset block message on retarget — without this, a "submit
        // bailed" notice from the previous component (in the dep-flow
        // detour the form gets reused for) would leak into the next
        // component's form.
        this._localBlockMessage = "";
        this._depResolver.kickoff(this.component.dependencies ?? []);
      }
    }
    // Re-resolve when the present components shift (YAML) or the query scope
    // shifts (component deps, or a late/changed board platform/id).
    if (
      changedProperties.has("component") ||
      changedProperties.has("yaml") ||
      changedProperties.has("board")
    ) {
      void this._resolveProvidedDeps();
      void this._resolveBusHostability();
    }
  }

  /** Net-missing deps driving the banner and submit gate: the literal-name
   *  scan minus those a present component provides (`_providedDeps`), plus
   *  a bus dep present but with no attachable bus (`_busBlockedDep`). */
  private _missingDeps(present: ReadonlySet<string>): string[] {
    const missing = findMissingDependencies(
      this.component.dependencies ?? [],
      this.yaml,
      present
    ).filter((d) => !this._providedDeps.has(d));
    const blocked = this._busBlockedDep;
    return blocked && !missing.includes(blocked) ? [...missing, blocked] : missing;
  }

  /** Refresh `_providedDeps` for the current `(component, yaml)`, dropping
   *  superseded async results via `_providesSeq`. */
  private async _resolveProvidedDeps(): Promise<void> {
    // Bump first so every re-entry — even one that early-returns below —
    // invalidates an older in-flight lookup that would otherwise pass the
    // `seq === this._providesSeq` guard and write a stale result.
    const seq = ++this._providesSeq;
    // Drop the prior result up front so the submit gate fails closed while a
    // fresh lookup is in flight. Empty stays empty (no needless re-render).
    if (this._providedDeps.size) this._providedDeps = new Set();
    const api = this._api;
    const deps = this.component?.dependencies ?? [];
    // Common dep-free case: nothing to resolve, so skip the YAML parse too.
    if (!api || deps.length === 0) return;
    const present = parseTopLevelComponents(this.yaml);
    const missing = findMissingDependencies(deps, this.yaml, present);
    if (missing.length === 0) return;
    try {
      const satisfied = await depsSatisfiedByProvides(api, missing, present, {
        platform: this.board?.esphome.platform ?? null,
        boardId: this.board?.id ?? null,
      });
      // Skip an empty-over-empty assignment: on the common "nothing provides"
      // path it would only flip Set identity and force an identical re-render.
      if (seq === this._providesSeq && (satisfied.size || this._providedDeps.size)) {
        this._providedDeps = satisfied;
      }
    } catch (err) {
      // Fail closed: the up-front clear already left the deps flagged, so the
      // banner still guides the user. Warn (not swallow) so a provides-lookup
      // failure is observable rather than silently re-showing the original
      // false banner — mirrors config-entry-form's provider fetch.
      console.warn("[add-component-form] provides lookup failed", err);
    }
  }

  /**
   * Refresh the bus verdict for the current `(component, yaml)`: no
   * attachable bus flags the dep missing, a sole compatible bus seeds the
   * reference field, several force the picker. Anything uncertain — a
   * catalog failure, a configured bus provider (a `usb_uart:` channel the
   * bus scan can't model), an include or anchor merge hiding ids — resolves
   * to no gating.
   */
  private async _resolveBusHostability(): Promise<void> {
    const seq = ++this._busAssessSeq;
    const api = this._api;
    const target = this.component ? exclusiveBusTarget(this.component) : null;
    let blocked: string | null = null;
    let picker: string | null = null;
    let reference: string | null = null;
    if (api && target && !yamlHasExternalIdSources(this.yaml)) {
      // `loadCatalog` resolves to an empty index on failure rather than
      // rejecting; an empty index records no claims, so bail with no
      // verdict instead of affirmatively seeding a bus it has no
      // evidence for.
      const catalog = await loadCatalog(api);
      if (seq !== this._busAssessSeq) return;
      if (catalog.byId.size > 0) {
        const { busCount, compatibleIds } = assessBusHostability(
          this.yaml,
          target.domain,
          target.constraints,
          (id) => catalog.byId.get(id)?.bus_constraints
        );
        // On a multi-bus config an un-idded compatible bus is unusable —
        // without an explicit reference esphome fails on the ambiguity —
        // so it falls through to the detour rather than shipping one.
        const usable =
          busCount > 1 ? compatibleIds.filter((id) => id !== null) : compatibleIds;
        if (busCount > 0 && usable.length === 0) {
          // The local verdict stands on parsed evidence; the provider
          // escape (a `usb_uart:` channel the bus scan can't model) only
          // clears it, and a failed provider lookup doesn't discard it.
          blocked = target.domain;
          try {
            const present = parseTopLevelComponents(this.yaml);
            const satisfied = await depsSatisfiedByProvides(
              api,
              [target.domain],
              present,
              {
                platform: this.board?.esphome.platform ?? null,
                boardId: this.board?.id ?? null,
              }
            );
            if (satisfied.has(target.domain)) blocked = null;
          } catch (err) {
            console.warn("[add-component-form] bus provider lookup failed", err);
          }
        } else if (usable.length === 1) {
          reference = usable[0];
        } else if (usable.length > 1) {
          // `overlayRequired` matches top-level keys only; a nested
          // reference (none exists today) just skips the forcing.
          const path = findReferencePath(
            this.component.config_entries,
            target.domain,
            []
          );
          if (path?.length === 1) picker = path[0];
        }
      }
    }
    if (seq !== this._busAssessSeq) return;
    if (this._busBlockedDep !== blocked) this._busBlockedDep = blocked;
    if (this._busPickerKey !== picker) this._busPickerKey = picker;
    if (reference !== null && target) {
      // Seed the sole compatible bus into a still-empty reference field so
      // the attachment is explicit; a detour-created bus or a value the
      // user typed already fills the field and wins.
      const path = findReferencePath(
        this.component.config_entries,
        target.domain,
        [],
        this._values
      );
      if (path) this._values = setIn(this._values, path, reference);
    }
  }

  /**
   * Seed `_values` for the current component. The seeding pipeline
   * itself is a pure function of the host's inputs — see
   * `add-component-form-seed.ts`.
   */
  private _initValues() {
    this._values = buildInitialValues({
      entries: this._entries,
      component: this.component,
      board: this.board,
      yaml: this.yaml,
      prefillReference: this.prefillReference,
      prefillFields: this.prefillFields,
      restoredValues: this.restoredValues,
      localize: this._localize,
    });
  }

  protected render() {
    const disabled = this.submitting;
    const presentComponents = parseTopLevelComponents(this.yaml);
    // Dependencies the catalog entry declares as required but the YAML
    // doesn't satisfy yet — a top-level block (`output:`, `i2c:`) or a
    // configured platform for hub-style deps (`atm90e32` under
    // `sensor:`). Surface these instead of letting the user submit a
    // config that won't validate.
    const missingDeps = this._missingDeps(presentComponents);

    // The shared form filters its own visibility — but we still need
    // to know whether everything required is filled in to enable the
    // submit button. Run validation against the current values; if
    // any required errors come back, the form is incomplete.
    const validation = validateEntries(
      this._entries,
      this._values,
      presentComponents,
      this.board?.esphome.platform ?? null
    );
    const isComplete = !this._hasRequiredErrors(validation);

    return html`
      <div class="form">
        <p class="form-desc">${renderMarkdown(this.component.description)}</p>
        ${missingDeps.length > 0 ? this._renderMissingDeps(missingDeps) : nothing}
        <esphome-config-entry-form
          .entries=${this._entries}
          .requiredGroups=${this.component.required_groups ?? []}
          .values=${this._values}
          .errors=${this._errors}
          .board=${this.board}
          .yaml=${this.yaml}
          .sectionKey=${this._sectionKey}
          .presentComponents=${presentComponents}
          ?disabled=${disabled}
          ?required-only=${true}
          @value-change=${this._onValueChange}
        ></esphome-config-entry-form>
        <button
          type="button"
          class="toggle-link"
          @click=${() => {
            this._showYaml = !this._showYaml;
          }}
        >
          ${
            this._showYaml
              ? this._localize("device.yaml_preview_toggle")
              : this._localize("device.yaml_preview")
          }
        </button>
        ${
          this._showYaml
            ? html`<pre class="yaml-preview">${this._generateYamlPreview()}</pre>`
            : nothing
        }
        ${this.submitError ? html`<p class="error">${this.submitError}</p>` : nothing}
        ${
          this._localBlockMessage
            ? html`<p class="error">${this._localBlockMessage}</p>`
            : nothing
        }
        <div class="actions">
          <button
            class="btn btn-secondary"
            ?disabled=${disabled}
            @click=${this._onCancel}
          >
            ${this._localize("wizard.back")}
          </button>
          <button
            class="btn btn-primary"
            ?disabled=${disabled || !isComplete || missingDeps.length > 0}
            @click=${this._onSubmit}
          >
            ${
              this.submitting
                ? this._localize("device.adding")
                : this._localize("device.add_component_action")
            }
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Banner shown when one or more entries from `component.dependencies`
   * aren't yet configured at the top level. The submit button is
   * disabled while this is showing. Each missing dep is rendered as a
   * button that takes the user back to the catalog filtered to that
   * domain — they pick one, add it, then come back to this component.
   *
   * The dep id is resolved to the catalog entry's friendly ``name`` so
   * the button reads ``Add I²C Bus`` instead of ``Add i2c``. Falls
   * back to the raw id until the cache lookup lands (kicked off in
   * ``willUpdate``).
   */
  /** True when the only outstanding dep is the bus-blocked one, so the
   *  banner and the Enter-key submit bail speak of an unavailable bus
   *  rather than a missing component. */
  private _allDepsBusBlocked(missing: string[]): boolean {
    const blocked = this._busBlockedDep;
    return blocked !== null && missing.length === 1 && missing[0] === blocked;
  }

  private _depsBlockTitle(missing: string[]): string {
    return this._localize(
      this._allDepsBusBlocked(missing)
        ? "device.bus_dependency_in_use_title"
        : "device.missing_dependencies_title",
      { name: this.component.name }
    );
  }

  private _renderMissingDeps(missing: string[]) {
    const allBlocked = this._allDepsBusBlocked(missing);
    return html`
      <div class="deps-warning" role="alert">
        <wa-icon library="mdi" name="alert-circle-outline"></wa-icon>
        <div class="deps-warning-body">
          <div class="deps-warning-title">${this._depsBlockTitle(missing)}</div>
          <div>
            ${
              allBlocked
                ? this._localize("device.bus_dependency_in_use_body")
                : this._localize("device.missing_dependencies_body")
            }
          </div>
          <div class="deps-warning-actions">
            ${missing.map(
              (d) =>
                html`<button
                  type="button"
                  class="dep-button"
                  @click=${() => this._onAddDep(d)}
                >
                  ${this._localize("device.missing_dependencies_add", {
                    domain: this._depResolver.resolve(d),
                  })}
                </button>`
            )}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Emit an event the parent dialog uses to switch back to the
   * catalog view, filtered to the requested dependency domain.
   */
  private _onAddDep(domain: string) {
    fireEvent(this, "navigate-to-dep", { domain });
  }

  /** True if any error in the map has the `validation.required` code. */
  private _hasRequiredErrors(errors: Map<string, ValidationError>): boolean {
    for (const e of errors.values()) {
      if (e.code === "validation.required") return true;
    }
    return false;
  }

  /**
   * User-facing label for an error key. Walks the schema following
   * each dotted segment of the key (``auth.password`` → walk into
   * the ``auth`` NESTED group, then find ``password``) and returns
   * the leaf entry's ``label``. Falls back to the raw key when the
   * schema lookup misses (defensive against MAP entries or future
   * structural shapes the walker doesn't model).
   *
   * The hidden-validation message lane is the bug-report flow, so
   * a precise leaf label speeds triage — ``Password: This field is
   * required`` is more useful than ``Auth: This field is required``.
   */
  private _labelForErrorKey(errKey: string): string {
    const entry = entryAtPath(this._entries, errKey.split("."));
    return entry ? resolveEntryLabel(entry, this._localize) : errKey;
  }

  /**
   * True when at least one error in the map lands on an entry the
   * shared ``esphome-config-entry-form`` actually renders. Built on
   * ``addFormRenderablePaths`` so the visibility check stays in
   * lockstep with the add-form's render filter — without that lockstep
   * an error on a hidden field would bail the submit silently.
   */
  private _anyErrorIsVisible(
    errors: Map<string, ValidationError>,
    presentComponents: Set<string>
  ): boolean {
    // The caller (``_onSubmit``) only enters this branch when
    // ``errors.size > 0``, but we keep the guard so the helper is
    // safe to call from anywhere.
    if (errors.size === 0) return false;
    const renderedPaths = addFormRenderablePaths(
      this._entries,
      this._values,
      this.board,
      presentComponents
    );
    for (const key of errors.keys()) {
      if (renderedPaths.has(key)) return true;
    }
    return false;
  }

  private _onValueChange(e: CustomEvent<ConfigEntryValueChange>) {
    const { path, value } = e.detail;
    this._values = setIn(this._values, path, value);
    // A wrong *typed* value flags once typing pauses (range/type/options
    // via validateValueAt); the renderers emit partial text per
    // keystroke ("0x", "1e"), so appearing immediately would flash
    // errors mid-entry. While typing, the display only ever improves in
    // place: cleared and corrected keys drop instantly, a key already
    // painted stays painted with its message kept current (clearing and
    // re-adding per keystroke made it blink; deferring the clear left
    // stale messages when a later edit cancelled the timer), and a
    // newly wrong key appears only at the pause. Required-empty stays a
    // submit-only signal, so untouched fields keep the no-nag behavior.
    clearTimeout(this._liveValidateTimer);
    const pathKey = path.join(".");
    const live = validateValueAt(this._entries, path, value);
    const shown = this._errors;
    const cleared = clearPathErrors(shown, pathKey);
    if (live.size === 0) {
      if (cleared) this._errors = cleared;
    } else {
      const next = cleared ?? new Map(shown);
      let changed = cleared !== null;
      for (const [key, err] of live) {
        if (shown.has(key)) {
          next.set(key, err);
          changed = true;
        }
      }
      if (changed) this._errors = next;
      this._liveValidateTimer = setTimeout(() => {
        const settled = validateValueAt(this._entries, path, getIn(this._values, path));
        const swept = clearPathErrors(this._errors, pathKey);
        if (!swept && !settled.size) return;
        const merged = swept ?? new Map(this._errors);
        for (const [key, err] of settled) merged.set(key, err);
        this._errors = merged;
      }, ESPHomeAddComponentForm.LIVE_VALIDATE_DEBOUNCE_MS);
    }
    // The hidden-validation block message: any user input is a fresh
    // signal that supersedes the previous bail; the next submit attempt
    // re-evaluates from scratch.
    if (this._localBlockMessage) this._localBlockMessage = "";
  }

  /** Section key the block resolves to — featured ids are synthetic
   *  (``featured.<board>.<local>``); the underlying component id keys the
   *  committed YAML and scopes the board's featured designations. */
  private get _sectionKey(): string {
    return resolveFeaturedComponentId(this.component.id, this.board);
  }

  private _generateYamlPreview(): string {
    const lines: string[] = [`${this._sectionKey}:`];
    lines.push(...serializeYamlValues(this._values, "  "));
    return lines.join("\n");
  }

  private _onCancel() {
    fireEvent(this, "form-cancel");
  }

  private _onSubmit() {
    // Submit computes the full error map itself; a pending live check
    // would only re-add a subset of it.
    clearTimeout(this._liveValidateTimer);
    // Reset the local block message at the top of every submit
    // attempt so a stale notice from a previous click can't render
    // alongside a fresh result. Both bail paths below set their
    // own message; the success path leaves it cleared.
    this._localBlockMessage = "";
    const presentComponents = parseTopLevelComponents(this.yaml);
    // Block submit when a declared dependency isn't satisfied. The Add
    // button is disabled in that case, but Enter (requestSubmit) still
    // lands here.
    const missingDeps = this._missingDeps(presentComponents);
    if (missingDeps.length > 0) {
      // Surface a visible message that names the missing domain(s) so
      // the user can act, instead of returning silently.
      this._localBlockMessage = `${this._depsBlockTitle(missingDeps)} (${missingDeps.join(", ")})`;
      return;
    }

    // Validate the entire schema. If anything fails, surface the
    // errors inline (the shared form will pick them up by path).
    const errors = validateEntries(
      this._entries,
      this._values,
      presentComponents,
      this.board?.esphome.platform ?? null
    );
    if (errors.size > 0) {
      this._errors = errors;
      const visible = this._anyErrorIsVisible(errors, presentComponents);
      if (!visible) {
        // Hidden-validation case: every error key lands on an entry
        // the user can't see in required-only mode (advanced or
        // optional leaf). Use a dedicated locale key — distinct from
        // the API-failure ``add_component_error`` so #issues triage
        // can tell client-side validation blocks from server-side
        // failures — and append a per-error breakdown using each
        // entry's user-facing label and the localized code reason
        // (e.g. ``Frequency: Must be a number``). Falls back to
        // ``key: code`` when the schema lookup misses (defensive
        // against nested paths the heuristic can't follow).
        const summary = [...errors.entries()]
          .map(
            ([key, err]) =>
              `${this._labelForErrorKey(key)}: ${this._localize(err.code, err.params)}`
          )
          .join("; ");
        this._localBlockMessage = `${this._localize(
          "device.add_component_hidden_validation_error"
        )} (${summary})`;
      }
      return;
    }
    this._errors = new Map();
    this._localBlockMessage = "";

    const fields = coerceFields(this._entries, this._values);

    fireEvent(this, "form-submit", { fields });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-component-form": ESPHomeAddComponentForm;
  }
}
