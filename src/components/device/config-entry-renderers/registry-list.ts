/**
 * Renderer for ``ConfigEntryType.REGISTRY_LIST`` fields (light
 * ``effects:``, sensor ``filters:`` once wired). Each list item is a
 * single-key mapping ``{<registry_id>: null | params}``; this renderer
 * draws one row per item with a type picker pulled from the named
 * catalog (``entry.registry``).
 *
 * Per-effect parameter editing is intentionally out of scope for the
 * initial wiring (#941). The parser + serializer already round-trip
 * any params shape the user types in the YAML pane; this V1 lets the
 * user add / remove / rename rows visually, fixing the collapsed-text
 * input bug. Per-row sub-forms can layer on later by recursing
 * ``<esphome-config-entry-form>`` over the picked effect's
 * ``config_entries``.
 */
import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../../api/esphome-api.js";
import type { ConfigEntry, RegistryCatalogEntry } from "../../../api/types.js";
import { isLambdaValue } from "../../../api/types.js";
import { apiContext } from "../../../context/index.js";
import {
  fetchFilters,
  fetchLightEffects,
  getCachedFilters,
  getCachedLightEffects,
  subscribeAutomationCatalogCache,
} from "../../../util/automation-catalog-cache.js";
import { YamlRawValue } from "../../../util/yaml-serialize.js";
import "./lambda-editor.js";
import { lambdaBodyOf } from "./lambda.js";
import {
  effectiveDisabled,
  fieldRendererStyles,
  renderFieldError,
  renderLabel,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";
import {
  renderListAddButton,
  renderListEmptyHint,
  renderListRemoveButton,
} from "./lists.js";

/** Extract the single key from a polymorphic-list item. Items
 *  arriving from a freshly-pressed Add button can be ``{}`` until
 *  the user picks a type. Items with more than one key are
 *  malformed (the registry contract is one key per item); return
 *  the empty string and let the row render with a placeholder so
 *  the user notices and the next save doesn't silently truncate. */
function itemId(item: Record<string, unknown>): string {
  const keys = Object.keys(item);
  return keys.length === 1 ? keys[0] : "";
}

/** True when *item* looks like a registry-list item the renderer can
 *  edit: a plain object with zero or one key. Multi-key items or
 *  non-object entries are preserved verbatim through edits via
 *  ``preserveForeignEntries`` so a click in the visual editor never
 *  drops data the form doesn't understand. */
function isEditableItem(raw: unknown): raw is Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  return Object.keys(raw as Record<string, unknown>).length <= 1;
}

/** Per-row label for the type picker. The catalog stores names
 *  with a redundant ``Domain → Name`` prefix (useful in the
 *  cross-domain automation editor; noise in a single-domain
 *  picker). Titlecase the id directly so the row reads as the
 *  user typed it in YAML. Unknown ids (legacy configs) fall
 *  through to the raw id. */
function formatRegistryId(id: string): string {
  if (!id) return "";
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Cache + fetch pair for one named registry, plus the rule that
 *  scopes ``applies_to`` against the section being edited.
 *
 *  ``filter`` (sensor / binary_sensor / text_sensor filters)
 *  applies_to is the bare domain (``"sensor"`` etc.) so we match
 *  on the section's first dotted segment. ``light_effects``
 *  applies_to lists qualified component ids
 *  (``"light.esp32_rmt_led_strip"``), so we match on the whole
 *  section key. */
interface RegistryOps {
  cache: () => RegistryCatalogEntry[] | undefined;
  fetch: (api: ESPHomeAPI) => Promise<unknown>;
  /** Project a section key (``light.esp32_rmt_led_strip``) into the
   *  shape ``applies_to`` lists use for this registry. */
  parentToken: (sectionKey: string) => string;
  /** True when the picker should hide ids already chosen by other
   *  rows. Set for registries where the row's *type id* doubles as
   *  the entry's identifier on the compile side and a per-row
   *  ``name:`` override isn't available in the visual editor yet —
   *  ``light_effects`` is the only such case today (each effect's
   *  default ``name:`` is derived from the effect id, so two rows
   *  with the same id collide as ``Found the effect name 'X' twice``).
   *  For registries like ``filter`` where chained same-type entries
   *  with different params is a normal pattern (``- delta: 0.5`` +
   *  ``- delta: 1.0``), leave false so the visual editor matches
   *  YAML expressiveness. */
  dedupByTypeId: boolean;
}

const REGISTRY_OPS: Record<string, RegistryOps> = {
  light_effects: {
    cache: () => getCachedLightEffects(),
    fetch: (api) => fetchLightEffects(api),
    parentToken: (sectionKey) => sectionKey,
    dedupByTypeId: true,
  },
  filter: {
    cache: () => getCachedFilters(),
    fetch: (api) => fetchFilters(api),
    parentToken: (sectionKey) => sectionKey.split(".", 1)[0],
    dedupByTypeId: false,
  },
};

/** Coerce ``ctx.getAt`` output to the raw list of mixed entries.
 *  Anything that isn't already an array (a freshly-mounted form with
 *  no value, a parser fallback to YamlRawValue) renders as an empty
 *  list — the user can click Add to start. The renderer treats
 *  non-object / multi-key entries as foreign and preserves them
 *  verbatim through edits via :func:`spliceEditable`. */
function asList(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

/** Editable items + their positions in the original list. Foreign
 *  entries (non-object or multi-key) stay in the list but the
 *  picker doesn't render rows for them; ``spliceEditable`` glues
 *  the edited slice back into the original positions on save. */
function editableEntries(list: unknown[]): {
  items: Record<string, unknown>[];
  positions: number[];
} {
  const items: Record<string, unknown>[] = [];
  const positions: number[] = [];
  list.forEach((it, i) => {
    if (isEditableItem(it)) {
      items.push(it);
      positions.push(i);
    }
  });
  return { items, positions };
}

/** Re-emit *list* with the editable slice replaced by *next*. Foreign
 *  entries keep their original positions; new entries from Add land
 *  at the end of the editable slice (just before any trailing
 *  foreign entries). */
function spliceEditable(
  list: unknown[],
  positions: number[],
  next: Record<string, unknown>[]
): unknown[] {
  const out: unknown[] = [...list];
  // Replace each tracked editable slot, drop the trailing tail when
  // ``next`` is shorter (Remove), append when longer (Add).
  positions.forEach((pos, i) => {
    if (i < next.length) out[pos] = next[i];
  });
  if (next.length < positions.length) {
    // Remove the surplus tracked slots in descending order so earlier
    // indices stay valid as we splice.
    const removeAt = positions.slice(next.length).reverse();
    for (const pos of removeAt) out.splice(pos, 1);
  } else if (next.length > positions.length) {
    // Add: insert new entries immediately after the last editable
    // slot, preserving any foreign entries that came after.
    const insertAt =
      positions.length > 0 ? positions[positions.length - 1] + 1 : out.length;
    out.splice(insertAt, 0, ...next.slice(positions.length));
  }
  return out;
}

@customElement("esphome-registry-list")
export class ESPHomeRegistryList extends LitElement {
  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property({ attribute: false })
  entry!: ConfigEntry;

  @property({ attribute: false })
  path: string[] = [];

  @property({ attribute: false })
  ctx!: RenderCtx;

  // New registries plug in by adding a row to ``REGISTRY_OPS``
  // and a fetch / cache pair in the catalog cache module.
  @state() private _catalog: RegistryCatalogEntry[] | null = null;
  @state() private _fetchError = false;

  private _unsubscribe?: () => void;
  // Set once when a fetch has been kicked off so updated() doesn't
  // re-evaluate fetch conditions on every reactive update.
  private _kickedFetch = false;

  connectedCallback(): void {
    super.connectedCallback();
    const ops = this._ops();
    if (ops === null) return; // Unknown registry, surfaced in render().
    // Subscribe before kicking the fetch so a synchronous resolve
    // can't fire-before-subscribe.
    this._unsubscribe = subscribeAutomationCatalogCache(() => {
      if (!this.isConnected) return;
      const live = this._ops();
      if (live === null) return;
      const next = live.cache();
      if (next !== undefined) {
        this._catalog = next;
        this._fetchError = false;
      }
    });
    const cached = ops.cache();
    // Clear any stale error from a prior session before either taking
    // the cached value or kicking a fresh fetch — otherwise the error
    // block would render alongside an in-flight refetch and the Retry
    // button would no-op (the cache layer dedupes via _inflight).
    this._fetchError = false;
    if (cached !== undefined) {
      this._catalog = cached;
    } else {
      this._kickFetch(ops);
    }
  }

  updated(): void {
    // Catch up if _api landed after connectedCallback; otherwise the
    // element would be stuck on "Loading catalog…" with no retry.
    if (this._kickedFetch || this._catalog !== null || this._fetchError || !this._api) {
      return;
    }
    const ops = this._ops();
    if (ops === null || ops.cache() !== undefined) return;
    this._kickFetch(ops);
  }

  private _kickFetch(ops: RegistryOps): void {
    if (!this._api) return;
    this._kickedFetch = true;
    ops.fetch(this._api).catch((err) => {
      // Log so a real WS / schema / parse error is diagnosable beyond
      // the generic UI message; flip _fetchError to surface retry.
      console.error("Failed to fetch registry catalog", err);
      if (!this.isConnected) return;
      this._fetchError = true;
    });
  }

  /** Resolve the cache + fetcher for ``entry.registry``. Returns
   *  ``null`` for registries the frontend doesn't know about (typo,
   *  newly-added backend registry the frontend hasn't wired yet) so
   *  render can show an explicit error instead of silently
   *  substituting a stand-in catalog. */
  private _ops(): RegistryOps | null {
    const registry = this.entry?.registry ?? "";
    return REGISTRY_OPS[registry] ?? null;
  }

  private _retryFetch = () => {
    if (!this._api) return;
    const ops = this._ops();
    if (ops === null) return;
    this._fetchError = false;
    ops.fetch(this._api).catch((err) => {
      console.error("Failed to retry registry catalog fetch", err);
      if (!this.isConnected) return;
      this._fetchError = true;
    });
  };

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // Drop the reference too so the cache-module closure isn't pinned.
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    // Allow a fresh fetch on reconnect.
    this._kickedFetch = false;
  }

  static styles = [
    // ctx.renderEntry output uses .field / .time-period-inputs etc.
    // which live in the form's stylesheets; the shared bundle gives
    // them to anything hosting renderEntry output across shadow roots.
    ...fieldRendererStyles,
    css`
      :host {
        display: block;
      }
      .registry-list-item {
        margin-bottom: 1rem;
      }
      .registry-list-row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        margin-bottom: 0.5rem;
      }
      .registry-list-row wa-select {
        flex: 1;
      }
      .registry-list-sub-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-left: 1rem;
        padding-left: 1rem;
        border-left: 2px solid var(--wa-color-surface-border);
      }
      .registry-list-fallback {
        color: var(--wa-color-neutral-fill-loud);
        font-size: 0.9rem;
      }
    `,
  ];

  protected render() {
    const ops = this._ops();
    if (ops === null) {
      // Unknown registry name — explicit error so misconfigured
      // catalog values surface instead of silently substituting a
      // stand-in catalog.
      return html`
        <div class="field" data-field-key=${this.path.join(".")}>
          ${renderLabel(this.entry, this.ctx)}
          <p class="registry-list-fallback">
            ${this.ctx.localize("device.registry_list_unsupported")}
          </p>
          ${renderFieldError(this.path, this.ctx)}
        </div>
      `;
    }
    const raw = this.ctx.getAt(this.path);
    // YamlRawValue / non-array shape: the parser preserved a block that
    // doesn't fit the polymorphic-list contract (dotted keys, block-scalar
    // bodies, list-shaped nested content). Coercing to [] and offering
    // Add would clobber the preserved YAML on first save — render the
    // YAML-only notice instead, same pattern as renderNestedListField.
    if (raw instanceof YamlRawValue || (raw !== undefined && !Array.isArray(raw))) {
      return html`
        <div class="field" data-field-key=${this.path.join(".")}>
          ${renderLabel(this.entry, this.ctx)}
          <p class="field-description">
            ${this.ctx.localize("device.multi_value_yaml_only")}
          </p>
          ${renderFieldError(this.path, this.ctx)}
        </div>
      `;
    }
    const rawList = asList(raw);
    const { items } = editableEntries(rawList);
    const disabled = effectiveDisabled(this.entry, this.ctx);
    // Scope the catalog to entries valid for the parent section's
    // domain — sensor's picker should not offer binary_sensor's
    // ``delayed_on`` filter; a monochromatic light's picker should
    // not offer addressable-only effects. An empty ``applies_to``
    // on a catalog entry means "no platform restriction" and passes
    // through. Empty ``sectionKey`` (form mounted outside a section)
    // also passes through so the add-component preview still renders
    // the full catalog.
    const parentToken = this.ctx.sectionKey ? ops.parentToken(this.ctx.sectionKey) : "";
    const catalog = (this._catalog ?? []).filter(
      (entry) =>
        !parentToken ||
        entry.applies_to.length === 0 ||
        entry.applies_to.includes(parentToken)
    );
    // Four discriminated states for the picker affordance:
    //   - error: fetch rejected, retry button.
    //   - loading: catalog is null and no error → fetch in flight.
    //   - empty-catalog: backend registry is genuinely empty (most
    //     likely a misconfig). Distinct from loading so the user
    //     isn't told something's happening when it isn't.
    //   - no-applicable: registry has entries but ``applies_to``
    //     filtered them all out for this section. The common case
    //     (e.g. monochromatic light with only addressable effects
    //     in the registry); "no options for this registry" would
    //     be actively misleading here.
    const catalogIsEmpty = this._catalog !== null && this._catalog.length === 0;
    const statusHint: unknown = this._fetchError
      ? html`<p class="registry-list-fallback">
          ${this.ctx.localize("device.registry_list_error")}
          ${this._api
            ? html`<button type="button" class="multi-btn" @click=${this._retryFetch}>
                ${this.ctx.localize("device.registry_list_retry")}
              </button>`
            : nothing}
        </p>`
      : this._catalog === null
        ? html`<p class="registry-list-fallback">
            ${this.ctx.localize("device.registry_list_loading")}
          </p>`
        : catalogIsEmpty
          ? html`<p class="registry-list-fallback">
              ${this.ctx.localize("device.registry_list_empty_catalog")}
            </p>`
          : catalog.length === 0
            ? html`<p class="registry-list-fallback">
                ${this.ctx.localize("device.registry_list_no_applicable_options")}
              </p>`
            : nothing;
    // Add is gated on a populated catalog: clicking with no catalog
    // would push ``{}`` and the picker would render with no options,
    // leaving the row stuck.
    const addDisabled = disabled || catalog.length === 0;
    return html`
      <div class="field" data-field-key=${this.path.join(".")}>
        ${renderLabel(this.entry, this.ctx)} ${renderListEmptyHint(items, this.ctx)}
        ${statusHint}
        ${items.map((item, i) =>
          this._renderRow(item, i, catalog, items, disabled, ops.dedupByTypeId)
        )}
        ${renderListAddButton(this.ctx, addDisabled, () => this._addItem())}
        ${renderFieldError(this.path, this.ctx)}
      </div>
    `;
  }

  private _renderRow(
    item: Record<string, unknown>,
    index: number,
    catalog: RegistryCatalogEntry[],
    allItems: Record<string, unknown>[],
    disabled: boolean,
    dedupByTypeId: boolean
  ) {
    const currentId = itemId(item);
    // Ids chosen on OTHER rows, only collected when the registry
    // opts into ``dedupByTypeId``. For ``light_effects`` two rows
    // sharing an id collide on ESPHome's default ``name:`` derivation
    // and the compile fails with ``Found the effect name 'X' twice``;
    // for chained filters (``- delta: 0.5`` + ``- delta: 1.0``)
    // same-type duplicates are a normal pattern and we want the
    // picker to keep offering them. The current row's id is kept
    // unconditionally so the picker still renders the value.
    const takenIds = new Set<string>();
    if (dedupByTypeId) {
      allItems.forEach((it, i) => {
        if (i === index) return;
        const id = itemId(it);
        if (id) takenIds.add(id);
      });
    }
    // Always include the current id even when the catalog doesn't
    // (older configs may carry an effect the schema dropped) so the
    // value round-trips on the next save instead of silently
    // disappearing from the picker.
    const catalogEntry = catalog.find((e) => e.id === currentId);
    const knownInCatalog = catalogEntry !== undefined;
    // Sort by id so 39 sensor filters in the picker stay scannable.
    const sortedCatalog = [...catalog].sort((a, b) => a.id.localeCompare(b.id));
    // Skip the sub-form when params is a scalar: the catalog may encode
    // a mapping schema for an id ESPHome also accepts as a scalar
    // shorthand, and editing the mapping would clobber the scalar.
    const params = currentId ? item[currentId] : null;
    const paramsIsMapping =
      params !== null &&
      typeof params === "object" &&
      !Array.isArray(params) &&
      !isLambdaValue(params);
    // ``lambda`` filter / effect takes a C++ body as the whole value
    // (``- lambda: |- return x;``); the schema bundle exposes no
    // config_vars for it, so the catalog has 0 config_entries. Render
    // an inline lambda editor bound to the row's polymorphic value
    // position so users can fill in the body visually.
    const isLambdaForm = currentId === "lambda";
    // Render every child unconditionally — the user opted into this
    // filter/effect by picking it from the dropdown, so the outer
    // form's advanced / requiredOnly gates don't apply (many filters
    // mark their tuning fields ``advanced: true`` and would render as
    // an empty sub-form otherwise; exponential_moving_average is the
    // canonical case). No catalog filter/effect carries depends_on on
    // sub-fields today; revisit if that changes.
    const childEntries =
      (params === null || paramsIsMapping) && catalogEntry?.config_entries
        ? catalogEntry.config_entries
        : [];
    return html`
      <div class="registry-list-item" data-row-index=${index}>
        <div class="registry-list-row">
          <wa-select
            .value=${currentId}
            ?disabled=${disabled}
            placeholder=${this.ctx.localize("device.registry_list_select")}
            aria-label=${this.ctx.localize("device.registry_list_row_label", {
              index: String(index + 1),
            })}
            @change=${(e: Event) => {
              // wa-select isn't an HTMLSelectElement; cast to the read field.
              const next = (e.target as unknown as { value: string }).value;
              this._renameRow(index, next);
            }}
          >
            ${!knownInCatalog && currentId
              ? html`<wa-option value=${currentId} selected
                  >${formatRegistryId(currentId)}</wa-option
                >`
              : nothing}
            ${sortedCatalog
              .filter((effect) => effect.id === currentId || !takenIds.has(effect.id))
              .map(
                (effect) =>
                  html`<wa-option value=${effect.id} ?selected=${effect.id === currentId}
                    >${formatRegistryId(effect.id)}</wa-option
                  >`
              )}
          </wa-select>
          ${renderListRemoveButton(this.ctx, disabled, () => this._removeAt(index))}
        </div>
        ${isLambdaForm
          ? html`<div class="registry-list-sub-form">
              <esphome-lambda-editor
                .value=${lambdaBodyOf(params)}
                ?disabled=${disabled}
                @lambda-change=${(e: CustomEvent<{ value: string }>) =>
                  this._setLambdaBody(index, currentId, e.detail.value)}
              ></esphome-lambda-editor>
            </div>`
          : childEntries.length > 0
            ? html`<div class="registry-list-sub-form">
                ${childEntries.map((child) =>
                  this.ctx.renderEntry(child, [
                    ...this.path,
                    String(index),
                    currentId,
                    child.key,
                  ])
                )}
              </div>`
            : nothing}
      </div>
    `;
  }

  /** Shared mutator: read the on-disk list, run *transform* against
   *  the editable slice, splice the result back over the original
   *  list (preserving foreign / multi-key entries verbatim), and
   *  emit. Centralises the "asList → editableEntries → emit via
   *  spliceEditable" chain so Add / Remove / Rename can't drift on
   *  the foreign-entry preservation contract. */
  private _mutateEditable(
    transform: (editable: Record<string, unknown>[]) => Record<string, unknown>[]
  ): void {
    const list = asList(this.ctx.getAt(this.path));
    const { items, positions } = editableEntries(list);
    const next = transform(items);
    this.ctx.emitChange(this.path, spliceEditable(list, positions, next));
  }

  private _setLambdaBody(index: number, registryId: string, body: string) {
    this._mutateEditable((items) =>
      items.map((it, i) => (i === index ? { [registryId]: { _lambda: body } } : it))
    );
  }

  private _addItem() {
    // Emit an empty row rather than seeding the catalog's first id —
    // that "first id" is alphabetical (``adalight``) which is rarely
    // what the user wants AND it's invalid for many light platforms,
    // so the backend rejects it on save. The picker shows a
    // placeholder until the user chooses; bare-dash placeholders
    // round-trip cleanly through ``serializeListItem``.
    this._mutateEditable((items) => [...items, {}]);
  }

  private _removeAt(index: number) {
    this._mutateEditable((items) => items.filter((_, i) => i !== index));
  }

  private _renameRow(index: number, nextId: string) {
    this._mutateEditable((items) => {
      // Reject empty: an empty id would synthesize ``{ "": null }``
      // and collide with itemId()'s unselected-placeholder sentinel.
      if (!nextId) return items;
      const target = items[index];
      if (!target) return items;
      const oldId = itemId(target);
      if (oldId === nextId) return items;
      // Discard non-null params on type change: each entry type has
      // its own schema and carrying ``{delta: 0.5}`` over to ``throttle``
      // would silently produce a scalar where the new type expects a
      // time string. V1 has no sub-form to surface the mismatch, so
      // emit ``{nextId: null}`` and let the user reconfigure.
      return items.map((it, i) => (i === index ? { [nextId]: null } : it));
    });
  }
}

export function renderRegistryListField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx
) {
  return html`<esphome-registry-list
    .entry=${entry}
    .path=${path}
    .ctx=${ctx}
  ></esphome-registry-list>`;
}
