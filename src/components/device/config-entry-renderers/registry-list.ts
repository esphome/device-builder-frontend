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
import { apiContext } from "../../../context/index.js";
import {
  fetchFilters,
  fetchLightEffects,
  getCachedFilters,
  getCachedLightEffects,
  subscribeAutomationCatalogCache,
} from "../../../util/automation-catalog-cache.js";
import {
  effectiveDisabled,
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

  connectedCallback(): void {
    super.connectedCallback();
    const ops = this._ops();
    if (ops === null) return; // Unknown registry, surfaced in render().
    const cached = ops.cache();
    if (cached !== undefined) {
      this._catalog = cached;
    } else {
      this._kickFetch(ops);
    }
    this._unsubscribe = subscribeAutomationCatalogCache(() => {
      // The cache module retains subscribers across the element's
      // lifetime; guard against firing on a disconnected instance so
      // a slow fetch resolving after navigation doesn't trigger a
      // re-render on a dead element.
      if (!this.isConnected) return;
      const live = this._ops();
      if (live === null) return;
      const next = live.cache();
      if (next !== undefined) {
        this._catalog = next;
        this._fetchError = false;
      }
    });
  }

  updated(): void {
    // The API context can resolve after connectedCallback (Lit guarantees
    // a microtask between mount and first paint but not before the
    // provider's value lands). Without this catch-up, a registry-list
    // mounted before its provider would stay stuck on "Loading catalog…"
    // forever with no retry affordance.
    if (this._catalog !== null || this._fetchError || !this._api) return;
    const ops = this._ops();
    if (ops === null || ops.cache() !== undefined) return;
    this._kickFetch(ops);
  }

  private _kickFetch(ops: RegistryOps): void {
    if (!this._api) return;
    ops.fetch(this._api).catch((err) => {
      // Distinct from "still loading": flag the failure so render
      // surfaces an error + retry affordance instead of a permanent
      // loading message. Log so a real WS / schema / parse error is
      // diagnosable in devtools beyond the generic UI message.
      console.error("Failed to fetch registry catalog", err);
      // Async resolution may race past disconnect; skip the state
      // assignment so Lit doesn't warn about updating a dead element.
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
    // Drop the reference along with the subscription so the dead
    // element doesn't keep the cache-module closure (and anything it
    // captures) reachable until GC.
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  static styles = css`
    :host {
      display: block;
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
    .registry-list-fallback {
      color: var(--wa-color-neutral-fill-loud);
      font-size: 0.9rem;
    }
  `;

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
    const rawList = asList(this.ctx.getAt(this.path));
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
          <button type="button" class="multi-btn" @click=${this._retryFetch}>
            ${this.ctx.localize("device.registry_list_retry")}
          </button>
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
    const knownInCatalog = catalog.some((e) => e.id === currentId);
    return html`
      <div class="registry-list-row" data-row-index=${index}>
        <wa-select
          .value=${currentId}
          ?disabled=${disabled}
          placeholder=${this.ctx.localize("device.registry_list_select")}
          @change=${(e: Event) => {
            // wa-select exposes a structural ``value`` but isn't an
            // ``HTMLSelectElement``; cast to the only field we read.
            const next = (e.target as unknown as { value: string }).value;
            this._renameRow(index, next);
          }}
        >
          ${!knownInCatalog && currentId
            ? html`<wa-option value=${currentId} selected
                >${formatRegistryId(currentId)}</wa-option
              >`
            : nothing}
          ${catalog
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
      const target = items[index];
      if (!target) return items;
      const oldId = itemId(target);
      if (oldId === nextId) return items;
      // Preserve the old key's params (the user's existing config)
      // when the picker swaps types — the params shape may not be
      // valid for the new type but a lossless rename keeps the YAML
      // pane in sync with the visual editor.
      const params = oldId ? target[oldId] : null;
      return items.map((it, i) => (i === index ? { [nextId]: params ?? null } : it));
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
