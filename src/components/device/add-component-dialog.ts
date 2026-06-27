import { consume } from "@lit/context";
import { mdiArrowLeft, mdiClose, mdiPackageVariantClosed } from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry, FeaturedBundle } from "../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../api/types/components.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { primaryHeaderDialogStyles } from "../../styles/dialog-chrome.js";
import { fullscreenMobileDialog } from "../../styles/dialog-mobile.js";
import { espHomeStyles } from "../../styles/shared.js";
import type { BusPrefill } from "../../util/bus-constraint-prefill.js";
import { collectExistingIds } from "../../util/default-component-id.js";
import { buildFeaturedId, isFeaturedId } from "../../util/featured-id.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { findAddedSection } from "../../util/yaml-sections.js";
import { parseTopLevelComponents } from "../../util/yaml-serialize.js";
import { findMissingDependencies } from "./add-component-deps.js";
import { chooseExcludeCategories } from "./add-component-dialog-categories.js";
import {
  matchesDepDomain,
  navigateToDep,
  type DepNavHost,
} from "./add-component-dialog-dep-nav.js";
import {
  hydrateForSelection,
  type SelectionHost,
} from "./add-component-dialog-selection.js";
import { addComponentDialogStyles } from "./add-component-dialog.styles.js";
import { coerceFields } from "./add-component-form-coerce.js";
import { addFormPaintsAnything } from "./add-component-form-filter.js";
import { buildInitialValues } from "./add-component-form-seed.js";
import { componentDialogTitle } from "./component-card-category-label.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../base-dialog.js";
import "./add-component-form.js";
import type { ESPHomeAddComponentForm } from "./add-component-form.js";
import "./component-catalog.js";
import type { ESPHomeComponentCatalog } from "./component-catalog.js";

registerMdiIcons({
  close: mdiClose,
  "arrow-left": mdiArrowLeft,
  "package-variant-closed": mdiPackageVariantClosed,
});

@customElement("esphome-add-component-dialog")
export class ESPHomeAddComponentDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property()
  boardName = "";

  @property()
  configuration = "";

  /** Device's target platform — forwarded to the catalog for default resolution. */
  @property()
  platform = "";

  /** Board metadata. Forwarded to the form so the embedded shared
   * config-entry-form can render the GPIO pin selector with proper
   * filtering and conflict detection. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  /** Current device YAML. Forwarded to the form so it can resolve
   * `depends_on_component` predicates, the component-level
   * `dependencies` list, and ID-reference dropdowns. */
  @property()
  yaml = "";

  /** When non-empty, the dialog locks the catalog to those
   *  categories, hides the category sidebar, and switches its title
   *  to the core-config localization keys. The "Add core
   *  configuration" entry point sets `lockedCategories=CORE_CATEGORIES`
   *  so the same dialog handles both the regular and core flows.
   *
   *  When empty, the dialog tells the catalog to *exclude*
   *  `CORE_CATEGORIES` — those components belong to the dedicated
   *  core dialog, not the regular component selector. */
  @property({ attribute: false })
  lockedCategories: string[] = [];

  @state()
  private _open = false;

  @query("esphome-component-catalog")
  private _catalog!: ESPHomeComponentCatalog;

  @query("esphome-add-component-form")
  private _form?: ESPHomeAddComponentForm;

  /** Snapshot of the form's in-progress values, captured when a "+ Add <dep>"
   *  detour starts and restored when the original form re-mounts, so a field
   *  the user already filled survives the round-trip. */
  @state()
  private _returnValues: Record<string, unknown> | null = null;

  /** Restored values for the mounted form: only the *original* component on
   *  return (`_returnTo` cleared) gets them; the dep's own form during the
   *  detour (`_returnTo` set) must not, or the dep would inherit the original's
   *  id and collide. */
  private get _restoredValuesForMount(): Record<string, unknown> | null {
    return this._returnTo ? null : this._returnValues;
  }

  @state()
  private _selected: ComponentCatalogEntry | null = null;

  @state()
  private _submitting = false;

  @state()
  private _submitError = "";

  /**
   * Component the user was originally adding when they clicked
   * "+ Add <dep>" inside the form. After they finish adding the
   * dependency, we restore this component so they don't have to
   * re-navigate the catalog and re-fill what they had.
   */
  @state()
  private _returnTo: ComponentCatalogEntry | null = null;

  /** Domain the dep detour was started for (e.g. "output"). Used to
   * locate the matching `references_component` field on the original
   * form so we can pre-fill it with the just-created component's id. */
  @state()
  private _depDomain: string | null = null;

  /** Pre-fill payload handed to the restored form on its next mount.
   *  Cleared after the form mounts so it doesn't apply to subsequent
   *  selections. */
  @state()
  private _prefillReference: { domain: string; id: string } | null = null;

  /** Bus-form prefill + forced fields for the dep detour, derived from
   *  the requesting component's `bus_constraints`. */
  @state()
  private _depPrefill: BusPrefill | null = null;

  /**
   * Featured-component ids waiting to be added as part of the current
   * bundle, excluding the one currently in `_selected`. Each id is
   * already in the full `featured.<board>.<local>` shape so we can
   * fetch + send it without re-derivation. Empty when no bundle is in
   * flight.
   */
  @state()
  private _bundleQueue: string[] = [];

  /**
   * Progress shown in the form view while a bundle is being added.
   * `current` is the 1-based index of the component currently shown
   * in the form; `total` is the bundle's full length. Null when no
   * bundle is in flight.
   */
  @state()
  private _bundleProgress: {
    current: number;
    total: number;
    bundleName: string;
  } | null = null;

  /** Monotonic token guarding async selection against stale responses.
   *  Bumped by `_resetDetourState` and by `hydrateForSelection`; a
   *  hydrate whose captured token doesn't match `_selectionSeq` at
   *  resolve time discards its result. */
  private _selectionSeq = 0;

  // Full-screen on mobile (overrides base-dialog's centered default): the
  // catalog is a wide, content-heavy view that needs the whole viewport on a
  // phone rather than being boxed into a centered column.
  static styles = [
    espHomeStyles,
    fullscreenMobileDialog("esphome-base-dialog"),
    // Shared primary header + back button (also used by create-config) —
    // see dialog-chrome.ts.
    primaryHeaderDialogStyles,
    addComponentDialogStyles,
  ];

  public open() {
    this._resetDetourState();
    this._selected = null;
    this._submitError = "";
    this._submitting = false;
    this._open = true;
    this.updateComplete.then(() => this._catalog?.load());
  }

  /**
   * Open the dialog directly into the catalog filtered to a domain
   * (e.g. "output"). Used when the section editor's ID-reference
   * dropdown asks "+ Add new output" — we land the user one click
   * away from the right component instead of in the unfiltered
   * catalog.
   */
  public openWithSearch(domain: string) {
    this._resetDetourState();
    this._selected = null;
    this._submitError = "";
    this._submitting = false;
    this._open = true;
    this.updateComplete.then(() => this._catalog?.filterByDomain(domain));
  }

  /** See ``navigateToDep`` for the seq-counter contract. */
  private _depNavSeq = 0;

  /** Null every in-flight dep-detour field. Shared with `_onBundleSelected`,
   *  which abandons the detour but must NOT bump the selection seqs (its
   *  hydrate already validated against the current token). */
  private _clearDetourFields() {
    this._returnTo = null;
    this._depDomain = null;
    this._prefillReference = null;
    this._depPrefill = null;
    this._returnValues = null;
  }

  private _resetDetourState() {
    this._clearDetourFields();
    this._bundleQueue = [];
    this._bundleProgress = null;
    this._depNavSeq++;
    // Bumping here couples bundle/detour teardown to the selection
    // token so an in-flight hydrate can't resurrect cleared state.
    this._selectionSeq++;
  }

  protected render() {
    const isForm = this._selected !== null;
    // The same dialog drives both the regular catalog flow and the
    // "Add core configuration" flow — a non-empty
    // `lockedCategories` flips the title text and tells the catalog
    // to lock its filter to that set.
    const isCore = this.lockedCategories.length > 0;
    const headerKey = isCore
      ? this.boardName
        ? "device.add_config_dialog_title"
        : "device.add_config"
      : this.boardName
        ? "device.add_component_dialog_title"
        : "device.add_component";
    // Keep the catalog mounted permanently so its state (search query, scroll
    // position, expanded card) survives the round trip into the form view —
    // hide it with `hidden` rather than swapping it out of the DOM. The form
    // is fine to mount/unmount on demand since each selection starts fresh.
    const title = isForm
      ? componentDialogTitle(this._selected!.name, this._selected!.category, {
          core: isCore,
        })
      : this.boardName
        ? this._localize(headerKey, { name: this.boardName })
        : this._localize(headerKey);
    return html`
      <esphome-base-dialog
        class=${isForm ? "form-view" : ""}
        ?open=${this._open}
        ?busy=${this._submitting}
        .label=${title}
        @request-close=${this._onRequestClose}
        @add-component=${this._onComponentSelected}
        @add-bundle=${this._onBundleSelected}
        @form-cancel=${this._onBack}
        @form-submit=${this._onFormSubmit}
        @navigate-to-dep=${this._onNavigateToDep}
        @request-add-component=${this._onNavigateToDep}
      >
        ${isForm
          ? html`<button
              slot="header-prefix"
              class="back-button"
              title=${this._localize("layout.back")}
              aria-label=${this._localize("layout.back")}
              @click=${this._onBack}
            >
              <wa-icon library="mdi" name="arrow-left"></wa-icon>
            </button>`
          : nothing}
        ${this._returnTo
          ? html`<div class="return-banner">
              ${this._localize("device.return_to_after_dep_prefix")}
              <strong>${this._returnTo.name}</strong>
              ${this._localize("device.return_to_after_dep_suffix")}
            </div>`
          : nothing}
        ${isForm && this._bundleProgress
          ? html`<div class="bundle-banner">
              <wa-icon library="mdi" name="package-variant-closed"></wa-icon>
              <span
                >${this._localize("device.bundle_step_progress", {
                  current: this._bundleProgress.current,
                  total: this._bundleProgress.total,
                  name: this._bundleProgress.bundleName,
                })}</span
              >
            </div>`
          : nothing}
        ${!isForm && this._submitError
          ? html`<div class="catalog-error" role="alert">${this._submitError}</div>`
          : nothing}
        <esphome-component-catalog
          ?hidden=${isForm}
          .platform=${this.platform}
          .boardId=${this.board?.id ?? ""}
          .board=${this.board}
          .yaml=${this.yaml}
          .lockedCategories=${this.lockedCategories}
          .excludeCategories=${chooseExcludeCategories({
            isCoreLocked: isCore,
            isInDepDetour: this._returnTo !== null,
          })}
        ></esphome-component-catalog>
        ${isForm
          ? html`<esphome-add-component-form
              .component=${this._selected!}
              .board=${this.board}
              .yaml=${this.yaml}
              .prefillReference=${this._prefillReference}
              .prefillFields=${this._depPrefill?.fields ?? null}
              .restoredValues=${this._restoredValuesForMount}
              .extraRequired=${this._depPrefill?.required ?? null}
              .optionOverrides=${this._depPrefill?.optionOverrides ?? null}
              .submitting=${this._submitting}
              .submitError=${this._submitError}
            ></esphome-add-component-form>`
          : nothing}
      </esphome-base-dialog>
    `;
  }

  // esphome-base-dialog never flips its own open on a user-driven close
  // (Escape / X / outside-click); the host owns _open here. The busy gate
  // (?busy=_submitting) blocks dismissal while an add is in flight.
  private _onRequestClose = () => {
    this._open = false;
  };

  private async _onComponentSelected(
    e: CustomEvent<{ component: ComponentCatalogEntry }>
  ) {
    e.stopPropagation();
    // The catalog list endpoint returns slim index entries (no
    // `config_entries`); the form needs the full body. Hydration
    // goes through `hydrateForSelection` so the cached + batched
    // fetch path runs and the helper's seq guard discards a
    // slower earlier click that returns after a faster later one.
    const result = await hydrateForSelection(
      this as unknown as SelectionHost,
      e.detail.component.id
    );
    if (result.kind === "stale") return;
    if (result.kind === "error") {
      this._submitError = result.message;
      return;
    }
    // A featured component can require hub(s)/a bus to exist first (a gpio pin
    // on a pcf8574 needs the pcf8574 + i2c). Add the missing prerequisites
    // ahead of it through the same sequential queue bundles use.
    const prereqs = this._missingRequiredPrereqs(result.entry);
    if (prereqs && prereqs.unresolved.length > 0) {
      // A declared prerequisite isn't in the catalog (a same-release catalog
      // bug). Refuse rather than add the component without its hub/bus and ship
      // the broken config this flow exists to prevent.
      this._submitError = this._localize("device.prereq_unresolved", {
        name: result.entry.name,
        ids: prereqs.unresolved.join(", "),
      });
      return;
    }
    if (prereqs && prereqs.missing.length > 0) {
      // The intermediate steps are the prerequisites (bus, hub), not the picked
      // component, so frame the banner as "Adding prerequisites for <name>".
      await this._startFeaturedSequence(
        [...prereqs.missing, result.entry.id],
        prereqs.boardId,
        this._localize("device.adding_prerequisites_for", { name: result.entry.name })
      );
      return;
    }
    this._selected = result.entry;
    this._submitError = "";
    const fields = this._fastPathFields(result.entry);
    if (fields) await this._submitComponent(fields, /* notify */ true);
  }

  /**
   * The featured prerequisites a just-selected featured component still needs:
   * its `requires` local ids (bus then hub), resolved to full featured ids,
   * keeping only those whose locked id isn't already in the YAML. Returns null
   * for a non-featured entry or one with no requires.
   *
   * Invariant: `requires` must be the fully-flattened, ordered prerequisite set
   * — only the selected component's direct `requires` is resolved here, and the
   * queued items (added via `_startFeaturedSequence`) do NOT re-resolve their
   * own `requires`. The backend (esphome/device-builder#1717) emits the complete
   * chain (e.g. a gpio lists `[bus, hub]`, not just the hub).
   */
  private _missingRequiredPrereqs(
    entry: ComponentCatalogEntry
  ): { boardId: string; missing: string[]; unresolved: string[] } | null {
    const board = this.board;
    if (!board || !isFeaturedId(entry.id)) return null;
    const featured = board.featured_components ?? [];
    const fc = featured.find((c) => buildFeaturedId(board.id, c.id) === entry.id);
    if (!fc?.requires?.length) return null;
    const existingIds = collectExistingIds(this.yaml);
    const missing: string[] = [];
    const unresolved: string[] = [];
    for (const reqLocal of fc.requires) {
      const prereq = featured.find((c) => c.id === reqLocal);
      if (!prereq) {
        // A requires id with no matching featured component is a catalog bug in
        // this same (lockstep) release, not version drift: adding the component
        // without its prereq ships the broken hub-referencing config this flow
        // exists to prevent. Record it so the caller refuses the add (and warn
        // with the precise id for a developer).
        console.warn(
          `Featured component '${entry.id}' requires '${reqLocal}', which is not in the board catalog.`
        );
        unresolved.push(reqLocal);
        continue;
      }
      const presetId = prereq.fields.id?.value;
      if (typeof presetId === "string" && existingIds.has(presetId)) continue;
      missing.push(buildFeaturedId(board.id, reqLocal));
    }
    return { boardId: board.id, missing, unresolved };
  }

  /**
   * Open the form on the first of *fullIds* and queue the rest, so the
   * dashboard adds a sequence of featured components one by one. Shared by the
   * bundle picker and the `requires` prerequisite flow.
   */
  private async _startFeaturedSequence(
    fullIds: string[],
    boardId: string,
    progressName: string
  ) {
    const [first, ...rest] = fullIds;
    const result = await hydrateForSelection(
      this as unknown as SelectionHost,
      first,
      boardId
    );
    if (result.kind === "stale") return;
    if (result.kind === "error") {
      this._submitError = result.message;
      return;
    }
    // Fresh sequence — abandon any in-flight dep-detour state.
    this._clearDetourFields();
    this._bundleQueue = rest;
    this._bundleProgress = {
      current: 1,
      total: fullIds.length,
      bundleName: progressName,
    };
    this._selected = result.entry;
    this._submitError = "";
  }

  /**
   * Coerced fields to add *entry* directly, skipping the form, or null when
   * the form should open. Fast-paths only when the add-form would paint
   * nothing (`addFormPaintsAnything` reads the same `buildFormRenderPlan`
   * `render()` does, so the gate can't drift from what the user sees) and the
   * payload matches the form's Add. The payload is `buildInitialValues` +
   * `coerceFields`, exactly the form's seed/submit, so a seeded `id`/pin (and
   * a featured entry's `seedAll`-seeded locked presets) isn't dropped; the one
   * thing skipped is the form's `validateEntries` bail, so a contradictory
   * required+advanced+no-default schema (unfillable in the form anyway)
   * surfaces a backend-error toast instead of a client-side block.
   */
  private _fastPathFields(entry: ComponentCatalogEntry): Record<string, unknown> | null {
    // A prefilled/detour selection carries overlays the `{}`-seeded probe
    // can't predict; show the form. (Detour/restore set `_selected` directly
    // and bypass this handler, so this is null today — a forward guard.)
    if (this._prefillReference !== null || this._depPrefill !== null) return null;
    const present = parseTopLevelComponents(this.yaml);
    // `findMissingDependencies` (dotted deps, platform stems) over a plain
    // top-level-block check, so a stem-satisfied dep doesn't keep a blank
    // form. The form's async `provides` subtraction isn't replicated — this
    // stays stricter, only keeping the form a touch more often.
    if (findMissingDependencies(entry.dependencies ?? [], this.yaml, present).length > 0)
      return null;
    const seeded = buildInitialValues({
      entries: entry.config_entries,
      component: entry,
      board: this.board,
      yaml: this.yaml,
      prefillReference: null,
      prefillFields: null,
      restoredValues: null,
      localize: this._localize,
    });
    if (
      addFormPaintsAnything(
        entry.config_entries,
        seeded,
        entry.required_groups ?? [],
        this.board,
        present
      )
    )
      return null;
    return coerceFields(entry.config_entries, seeded);
  }

  /**
   * Picking a bundle queues the bundle's components and opens the
   * form view on the first one. Each successful submit advances the
   * queue (`_onFormSubmit`); cancelling clears state but keeps any
   * already-added components in the YAML — no rollback, consistent
   * with the regular flow.
   */
  private async _onBundleSelected(
    e: CustomEvent<{ bundle: FeaturedBundle; boardId: string }>
  ) {
    e.stopPropagation();
    if (this._submitting) return;
    const { bundle, boardId } = e.detail;
    if (!boardId || bundle.component_ids.length === 0) return;
    const fullIds = bundle.component_ids.map((localId) =>
      buildFeaturedId(boardId, localId)
    );
    await this._startFeaturedSequence(fullIds, boardId, bundle.name);
  }

  private _onBack() {
    if (this._submitting) return;
    // If the user is in the middle of a "go add a dependency" detour
    // and they hit back, treat it as cancelling the detour: drop them
    // back at the original component they were filling in, instead of
    // sending them to the catalog and losing context.
    if (this._returnTo) {
      const restore = this._returnTo;
      // Back out of the detour like a submit-return: keep the snapshot across
      // the reset so the user's in-progress values survive on the original
      // form (the binding reads `_returnValues` with `_returnTo` now null).
      const snapshot = this._returnValues;
      this._resetDetourState();
      this._returnValues = snapshot;
      this._selected = restore;
      this._submitError = "";
      return;
    }
    // Returning to the catalog (mid-bundle cancel or otherwise) —
    // drop all detour state so a leftover `_prefillReference` from an
    // abandoned bundle step can't leak into the next component the
    // user selects. Already-added bundle components stay in the YAML;
    // we don't roll them back (consistent with the regular flow's
    // no-rollback behaviour on errors).
    this._resetDetourState();
    this._selected = null;
    this._submitError = "";
  }

  private _onNavigateToDep(e: CustomEvent<{ domain: string }>) {
    e.stopPropagation();
    // Snapshot what the user has filled before `navigateToDep` swaps
    // `_selected` and unmounts the form, so it's restored on return.
    this._returnValues = this._form?.currentValues ?? null;
    return navigateToDep(this as unknown as DepNavHost, e.detail.domain);
  }

  private _onFormSubmit(e: CustomEvent<{ fields: Record<string, unknown> }>) {
    e.stopPropagation();
    return this._submitComponent(e.detail.fields);
  }

  /**
   * Add the selected component with ``fields`` and run the post-add
   * routing (dep-detour restore, bundle advance, or navigate-and-close).
   * Shared by the form-submit and configless direct-add paths.
   *
   * ``notify`` toasts on a successful close — the configless path has no
   * form Add-click to confirm the add otherwise.
   */
  private async _submitComponent(fields: Record<string, unknown>, notify = false) {
    if (!this._selected || !this.configuration || this._submitting) return;
    this._submitting = true;
    this._submitError = "";
    // Invalidate any in-flight dep-nav lookup — a late resolve must
    // not retarget the form to a dep after the user submitted.
    this._depNavSeq++;
    try {
      // Merge into the editor's current draft so unsaved edits survive;
      // the backend returns the merged YAML without persisting (it saves
      // via the normal Save flow). Only send the draft when it's actually
      // loaded — `yaml` defaults to "" before the config arrives, and
      // merging into "" would drop the on-disk config, so an empty draft
      // omits the arg and the backend falls back to the on-disk YAML.
      const { yaml } = await this._api.addComponent(
        this.configuration,
        {
          component_id: this._selected.id,
          fields,
        },
        this.yaml || undefined
      );

      // Surface the merged YAML as an unsaved draft. We dispatch this
      // BEFORE deciding whether to close — when restoring `_returnTo`
      // the dialog stays open, but the device still needs the new YAML
      // (so the dependency we just added shows up in the original
      // component's dropdown). `yaml-draft` advances only the working
      // buffer, leaving the dirty flag on so the user saves explicitly.
      this.dispatchEvent(
        new CustomEvent("yaml-draft", {
          detail: { yaml },
          bubbles: true,
          composed: true,
        })
      );

      if (this._returnTo) {
        // Just finished adding a dependency — restore the original
        // component's form so the user can continue where they left
        // off. The form re-mounts fresh and re-reads `this.yaml`,
        // which now contains the dep, so the ID-reference dropdown
        // will be populated.
        //
        // This branch wins over the bundle-advance branch below: if
        // the user is mid-bundle and detours to add a missing dep,
        // submitting the dep should return them to the bundle step
        // they were on, not skip ahead to the next bundle component.
        // The bundle queue stays intact so the bundle step's own
        // submit (the next time around) will fall through to the
        // bundle-advance branch and continue.
        const restore = this._returnTo;
        const depDomain = this._depDomain;
        // Pre-fill the restored form's reference field with the new
        // id when the just-added component matches what the dep-nav
        // asked for (defends against the user picking off-domain in
        // the catalog fallback).
        const newId = fields["id"];
        if (
          depDomain &&
          typeof newId === "string" &&
          matchesDepDomain(this._selected, depDomain)
        ) {
          this._prefillReference = { domain: depDomain, id: newId };
        } else {
          this._prefillReference = null;
        }
        this._returnTo = null;
        this._depDomain = null;
        this._depPrefill = null;
        this._selected = restore;
      } else if (this._bundleQueue.length > 0 && this._bundleProgress) {
        // Bundle in flight — pop the next featured id and refresh the
        // form for it. The just-updated `this.yaml` (carried in via
        // the `yaml-draft` event) is still authoritative for the
        // next step's ID-reference dropdown, since the host re-binds
        // it on re-render.
        const nextId = this._bundleQueue[0];
        const remaining = this._bundleQueue.slice(1);
        // The stale-return path is safe to leave the local
        // `remaining` snapshot dangling because
        // `_resetDetourState` bumps the seq AND wipes the queue
        // in one synchronous block.
        const nextResult = await hydrateForSelection(
          this as unknown as SelectionHost,
          nextId
        );
        if (nextResult.kind === "stale") return;
        if (nextResult.kind === "error") {
          this._submitError = nextResult.message;
          return;
        }
        const nextComponent = nextResult.entry;
        // Hand the just-added component's id to the next step's matching
        // `references_component` field. Bundles are designed to chain —
        // e.g. `Status LED (full setup)` adds an `output.gpio`, then a
        // `light.binary` whose `output:` field has to point at it — and
        // without this prefill the user has to re-pick the id they just
        // typed in the previous step from a dropdown.
        const justAddedId = fields["id"];
        const justAddedDomain = this._selected.category;
        if (typeof justAddedId === "string" && justAddedDomain) {
          this._prefillReference = {
            domain: justAddedDomain,
            id: justAddedId,
          };
        } else {
          this._prefillReference = null;
        }
        this._bundleQueue = remaining;
        this._bundleProgress = {
          ...this._bundleProgress,
          current: this._bundleProgress.current + 1,
        };
        // The next bundle step is a fresh component; drop the snapshot from a
        // detour the prior step took so it can't bleed onto this one.
        this._returnValues = null;
        this._selected = nextComponent;
      } else {
        // Auto-select the just-added component so the navigator
        // highlights it and the section editor jumps to its block.
        // Falls through silently if we can't find it — better to
        // leave the previous selection alone than navigate somewhere
        // wrong.
        const componentId = this._selected.id;
        const componentName = this._selected.name;
        const newId = fields["id"];
        const target = findAddedSection(
          yaml,
          componentId,
          typeof newId === "string" ? newId : undefined
        );
        if (target) {
          this.dispatchEvent(
            new CustomEvent("section-select", {
              detail: target,
              bubbles: true,
              composed: true,
            })
          );
        }
        this._open = false;
        this._selected = null;
        this._resetDetourState();
        // Configless add skipped the form, so the close is the only
        // signal the add happened — toast to confirm.
        if (notify) {
          toast.success(
            this._localize("device.component_added", { name: componentName }),
            { richColors: true }
          );
        }
      }
    } catch (err) {
      this._submitError =
        err instanceof Error ? err.message : this._localize("device.add_component_error");
      // The configless path (notify) has no form fields, so `_submitError`
      // would land in an otherwise-empty form view where it's easy to
      // miss — toast it too so the failure can't read as a silent no-op.
      if (notify) {
        toast.error(this._submitError, { richColors: true });
      }
    } finally {
      this._submitting = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-add-component-dialog": ESPHomeAddComponentDialog;
  }
}
