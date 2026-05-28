import type {
  BoardCatalogEntry,
  BoardEsphomeConfig,
  BoardHardware,
  BoardPin,
  FeaturedBundle,
  FeaturedComponent,
  FieldPreset,
  PagedBoardsResponse,
} from "../api/types.js";

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
export function hydrateBoard(entry: BoardCatalogEntry): BoardCatalogEntry {
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
    featured_components: (entry.featured_components ?? []).map(_hydrateFeaturedComponent),
    featured_bundles: (entry.featured_bundles ?? []).map(_hydrateFeaturedBundle),
  };
}

export function hydratePagedBoardsResponse(
  response: PagedBoardsResponse
): PagedBoardsResponse {
  return { ...response, boards: response.boards.map(hydrateBoard) };
}

function _hydrateEsphome(esphome: BoardEsphomeConfig): BoardEsphomeConfig {
  return {
    ...esphome,
    variant: esphome.variant ?? null,
    framework: esphome.framework ?? null,
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
  const fields = fc.fields ?? {};
  const hydratedFields: Record<string, FieldPreset> = {};
  for (const [key, preset] of Object.entries(fields)) {
    hydratedFields[key] = _hydrateFieldPreset(preset);
  }
  return {
    ...fc,
    name: fc.name ?? null,
    description: fc.description ?? null,
    fields: hydratedFields,
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
