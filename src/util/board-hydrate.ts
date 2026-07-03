import type {
  BoardCatalogEntry,
  BoardEsphomeConfig,
  BoardHardware,
  BoardPin,
  FeaturedBundle,
  FeaturedComponent,
  FieldPreset,
  PagedBoardsResponse,
  SlimBoard,
} from "../api/types/boards.js";

/**
 * Re-default fields the backend stripped from the wire payload.
 *
 * The board-catalog dataclasses on the backend use mashumaro's
 * `omit_default = True` + `omit_none = True` config; ~40k empty
 * `suggestions: null` / `locked: false` rows per response stop
 * arriving (~36% off the catalog bytes, more once JS parses).
 * Default values mirror the Python dataclass declarations in
 * `models/boards.py` and `models/common.py` exactly — diverging
 * means a fresh fetch silently disagrees with what `from_dict`
 * round-trips on the backend.
 *
 * Each helper spreads the input before overriding defaults, so
 * a forward-compat field added to the wire shape carries through
 * the hydrator instead of being silently dropped.
 */
/** Hydrate the slim index fields shared by every board shape. */
export function hydrateSlimBoard(entry: SlimBoard): SlimBoard {
  return {
    ...entry,
    esphome: _hydrateEsphome(entry.esphome),
    hardware: _hydrateHardware(entry.hardware),
    images: entry.images ?? [],
    tags: entry.tags ?? [],
    pins: (entry.pins ?? []).map(_hydratePin),
    docs_url: entry.docs_url ?? "",
    product_url: entry.product_url ?? "",
    featured: entry.featured ?? false,
    is_generic: entry.is_generic ?? false,
  };
}

export function hydrateBoard(entry: BoardCatalogEntry): BoardCatalogEntry {
  return {
    ...hydrateSlimBoard(entry),
    full_config: entry.full_config ?? false,
    featured_components: (entry.featured_components ?? []).map(_hydrateFeaturedComponent),
    featured_bundles: (entry.featured_bundles ?? []).map(_hydrateFeaturedBundle),
    requires_wifi: entry.requires_wifi ?? false,
  };
}

export function hydratePagedBoardsResponse(
  response: PagedBoardsResponse
): PagedBoardsResponse {
  // Defensive: PagedResponse on the backend doesn't strip today,
  // but adding omit_default later would strip an empty page's
  // boards: [] outright and crash the .map. Re-default symmetric
  // with the nested hydration so the contract is robust.
  return {
    ...response,
    total: response.total ?? 0,
    offset: response.offset ?? 0,
    limit: response.limit ?? 50,
    boards: (response.boards ?? []).map(hydrateSlimBoard),
  };
}

function _hydrateEsphome(esphome: BoardEsphomeConfig): BoardEsphomeConfig {
  return {
    ...esphome,
    variant: esphome.variant ?? null,
    framework: esphome.framework ?? null,
    mcu: esphome.mcu ?? null,
  };
}

function _hydrateHardware(hardware: BoardHardware | null | undefined): BoardHardware {
  return {
    ...hardware,
    flash_size: hardware?.flash_size ?? null,
    ram_size: hardware?.ram_size ?? null,
    cpu_frequency: hardware?.cpu_frequency ?? null,
    connectivity: hardware?.connectivity ?? [],
  };
}

function _hydratePin(pin: BoardPin): BoardPin {
  return {
    ...pin,
    label: pin.label ?? "",
    features: pin.features ?? [],
    available: pin.available ?? null,
    occupied_by: pin.occupied_by ?? null,
    notes: pin.notes ?? null,
  };
}

function _hydrateFeaturedComponent(fc: FeaturedComponent): FeaturedComponent {
  return {
    ...fc,
    name: fc.name ?? null,
    description: fc.description ?? null,
    fields: Object.fromEntries(
      Object.entries(fc.fields ?? {}).map(([k, v]) => [k, _hydrateFieldPreset(v)])
    ),
  };
}

function _hydrateFeaturedBundle(fb: FeaturedBundle): FeaturedBundle {
  return {
    ...fb,
    description: fb.description ?? "",
    component_ids: fb.component_ids ?? [],
  };
}

function _hydrateFieldPreset(preset: FieldPreset): FieldPreset {
  return {
    ...preset,
    value: preset.value ?? null,
    locked: preset.locked ?? false,
    suggestions: preset.suggestions ?? null,
  };
}
