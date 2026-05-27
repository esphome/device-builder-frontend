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
import type { ConfigEntry, Filter, LightEffect } from "../../../api/types.js";
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
 *  the user picks a type. */
function itemId(item: Record<string, unknown>): string {
  const keys = Object.keys(item);
  return keys.length > 0 ? keys[0] : "";
}

/** Coerce ``ctx.getAt`` output to a mutable list of polymorphic items.
 *  Anything that isn't already an array (a freshly-mounted form with
 *  no value, a parser fallback to YamlRawValue) renders as an empty
 *  list — the user can click Add to start. */
function asPolymorphicList(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (it): it is Record<string, unknown> =>
      it !== null && typeof it === "object" && !Array.isArray(it)
  );
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

  // Catalog entries share a structural shape (``id``, ``name``,
  // ``config_entries``, ``applies_to``) across LightEffect and
  // Filter; the renderer only reads those fields so a single
  // ``RegistryCatalogEntry`` covers both.
  @state() private _catalog: (LightEffect | Filter)[] | null = null;

  private _unsubscribe?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    const registry = this.entry?.registry ?? null;
    const cached = this._readCache(registry);
    if (cached !== undefined) {
      this._catalog = cached;
    } else if (this._api) {
      this._kickFetch(registry).catch(() => {
        // Cache layer suppresses the rejection broadcast; render a
        // placeholder via ``_catalog === null`` until either the
        // user retries or a successful fetch refreshes the cache.
      });
    }
    this._unsubscribe = subscribeAutomationCatalogCache(() => {
      const next = this._readCache(this.entry?.registry ?? null);
      if (next !== undefined) this._catalog = next;
    });
  }

  private _readCache(registry: string | null): (LightEffect | Filter)[] | undefined {
    if (registry === "filter") return getCachedFilters();
    return getCachedLightEffects();
  }

  private _kickFetch(registry: string | null): Promise<unknown> {
    if (registry === "filter") return fetchFilters(this._api);
    return fetchLightEffects(this._api);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.();
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
    const items = asPolymorphicList(this.ctx.getAt(this.path));
    const disabled = effectiveDisabled(this.entry, this.ctx);
    const catalog = this._catalog ?? [];
    const fallback = catalog.length === 0;
    return html`
      <div class="field" data-field-key=${this.path.join(".")}>
        ${renderLabel(this.entry, this.ctx)} ${renderListEmptyHint(items, this.ctx)}
        ${fallback && items.length === 0
          ? html`<p class="registry-list-fallback">
              ${this.ctx.localize("device.registry_list_loading")}
            </p>`
          : nothing}
        ${items.map((item, i) => this._renderRow(item, i, catalog, disabled))}
        ${renderListAddButton(this.ctx, disabled, () => this._addItem(catalog))}
        ${renderFieldError(this.path, this.ctx)}
      </div>
    `;
  }

  private _renderRow(
    item: Record<string, unknown>,
    index: number,
    catalog: (LightEffect | Filter)[],
    disabled: boolean
  ) {
    const currentId = itemId(item);
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
          @change=${(e: Event) => {
            const next = (e.target as HTMLSelectElement).value;
            this._renameRow(index, next);
          }}
        >
          ${!knownInCatalog && currentId
            ? html`<wa-option value=${currentId} selected>${currentId}</wa-option>`
            : nothing}
          ${catalog.map(
            (effect) =>
              html`<wa-option value=${effect.id} ?selected=${effect.id === currentId}
                >${effect.name || effect.id}</wa-option
              >`
          )}
        </wa-select>
        ${renderListRemoveButton(this.ctx, disabled, () => this._removeAt(index))}
      </div>
    `;
  }

  private _addItem(catalog: (LightEffect | Filter)[]) {
    const items = asPolymorphicList(this.ctx.getAt(this.path));
    const seedId = catalog[0]?.id ?? "";
    const next = [...items, seedId ? { [seedId]: null } : {}];
    this.ctx.emitChange(this.path, next);
  }

  private _removeAt(index: number) {
    const items = asPolymorphicList(this.ctx.getAt(this.path));
    this.ctx.emitChange(
      this.path,
      items.filter((_, i) => i !== index)
    );
  }

  private _renameRow(index: number, nextId: string) {
    const items = asPolymorphicList(this.ctx.getAt(this.path));
    const target = items[index];
    if (!target) return;
    const oldId = itemId(target);
    if (oldId === nextId) return;
    // Preserve the old key's params (the user's existing config) when
    // the picker swaps effect types — the params shape might not be
    // valid for the new effect, but the user's intent is to morph
    // the row, and a lossless rename keeps the YAML editor in sync.
    const params = oldId ? target[oldId] : null;
    const next = items.map((it, i) => (i === index ? { [nextId]: params ?? null } : it));
    this.ctx.emitChange(this.path, next);
  }
}

export function renderRegistryListField(
  entry: ConfigEntry,
  path: string[],
  ctx: RenderCtx
) {
  // Currently the only registry plumbed end-to-end is ``light_effects``;
  // the element imports the cache directly. A future second registry
  // would add a switch in the element on ``entry.registry``.
  return html`<esphome-registry-list
    .entry=${entry}
    .path=${path}
    .ctx=${ctx}
  ></esphome-registry-list>`;
}
