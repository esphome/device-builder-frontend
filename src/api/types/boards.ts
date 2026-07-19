/**
 * Board catalog, hardware, pins, featured components/bundles.
 *
 * Part of the src/api/types.ts barrel split.
 */
import type { ConfigPrimitive } from "./config-entries.js";
import type { PagedResponse } from "./protocol.js";

// ─── Boards ──────────────────────────────────────────────────

export interface BoardEsphomeConfig {
  platform: string;
  board: string;
  variant: string | null;
  framework: string | null;
  // rp2040-only chip series ('rp2040' / 'rp2350'); null on other platforms.
  mcu: string | null;
}

export interface BoardHardware {
  flash_size: string | null;
  ram_size: number | null;
  cpu_frequency: string | null;
  connectivity: string[];
}

export interface BoardPin {
  gpio: number;
  label: string;
  features: string[];
  available: boolean | null;
  occupied_by: string | null;
  notes: string | null;
  /** Named forms a config may refer to this pin by (``RX``, ``D1``); the
   *  catalog omits the key when there are none. */
  aliases?: string[];
}

/**
 * Pre-filled value for a single config-entry on a featured component.
 *
 * Three modes, expressed by which fields are populated:
 *
 * - `value` only: pre-filled default, user can change it.
 * - `value` + `locked: true`: fixed value. Frontend disables the input;
 *   backend rejects deviating user input on add.
 * - `suggestions`: short list of allowed values (frontend renders a
 *   picker). `value` (if also set) is the initial selection.
 *
 * `locked` and `suggestions` are mutually exclusive.
 */
export interface FieldPreset {
  value: ConfigPrimitive | unknown[] | Record<string, unknown> | null;
  locked: boolean;
  suggestions: ConfigPrimitive[] | null;
}

/**
 * A component recommended for a board.
 *
 * Surfaced through the catalog API as `featured.<board_id>.<id>` under
 * category `featured`. `component_id` points at the underlying
 * catalog entry the user is actually adding (e.g. `switch.gpio`); the
 * featured entry contributes name/description overrides plus per-field
 * presets keyed by `ConfigEntry.key`.
 */
export interface FeaturedComponent {
  /** Local id, unique within this board (e.g. "relay", "pir-motion"). */
  id: string;
  component_id: string;
  name: string | null;
  description: string | null;
  fields: Record<string, FieldPreset>;
  /** Underlying component's multi_conf; absent means multi-conf (omit_default). */
  multi_conf?: boolean;
  /**
   * Backend-computed canonical occupied-pin identity per locked pin field. A
   * board GPIO is a number (`{scl: 0, sda: 1}`); a pin on an I/O expander is a
   * `provider:hub_id:channel` token (`{pin: 'pcf8574:hub_in_1:0'}`) so it never
   * aliases a board GPIO of the same number. The catalog hides this card when an
   * existing same-domain instance already occupies these exact pins. Absent for
   * components with no locked pins (omit_default).
   */
  locked_pins?: Record<string, number | string>;
  /**
   * Local ids of other featured_components on this board that must be added
   * first, in order (e.g. an i2c bus then the pcf8574 hub a pin sits on). The
   * add flow adds any missing prerequisite before this component.
   */
  requires?: string[];
}

/**
 * A logical group of featured components added together — e.g. a
 * status LED that needs `output.gpio` + `light.binary`. `component_ids`
 * references the local id of entries in `featured_components` on the
 * same board; the frontend triggers sequential `devices/add_component`
 * calls for each.
 */
export interface FeaturedBundle {
  id: string;
  name: string;
  description: string;
  component_ids: string[];
  // Photo of the physical module this bundle maps to; rendered on the
  // bundle card in place of the box icon when set.
  image_url?: string;
}

/**
 * Slim board index entry from ``boards/get_boards`` /
 * ``boards/get_compatible_boards``. The picker, change-board dialog, and
 * compatible-board lists get this shape; it deliberately omits the body-only
 * fields on :class:`BoardCatalogEntry` so reading e.g. ``requires_wifi`` off a
 * slim entry (where it would silently hydrate to ``false``) is a type error —
 * callers must upgrade via ``boards/get_board`` first.
 */
export interface SlimBoard {
  id: string;
  name: string;
  description: string;
  manufacturer: string;
  esphome: BoardEsphomeConfig;
  hardware: BoardHardware;
  images: string[];
  tags: string[];
  pins: BoardPin[];
  docs_url: string;
  product_url: string;
  featured: boolean;
  is_generic: boolean;
}

/**
 * Full board body from ``boards/get_board`` — the slim index plus the fields
 * the backend derives or carries only on the full body.
 */
export interface BoardCatalogEntry extends SlimBoard {
  /**
   * The featured components are a complete onboard config (a devices.esphome.io
   * import or a hand-curated product opting in), not optional add-ons. Drives
   * the create wizard's "set up with everything" default. Body-only.
   */
  full_config?: boolean;
  /**
   * Remote-package board: devices/create writes a thin packages: reference
   * to this upstream config instead of expanding components; the wizard
   * shows the ready-made note in place of the full-setup checkbox. Body-only.
   */
  package_import_url?: string;
  /** Components recommended for this board. */
  featured_components: FeaturedComponent[];
  /** Logical groups of featured components added together. */
  featured_bundles: FeaturedBundle[];
  /**
   * Derived (full body only): Wi-Fi is the board's only built-in network, so a
   * generated config needs it — the wizard makes Wi-Fi mandatory (no skip).
   */
  requires_wifi?: boolean;
}

export interface PagedBoardsResponse extends PagedResponse {
  boards: SlimBoard[];
}
