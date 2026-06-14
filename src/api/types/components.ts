/**
 * Component categories and component catalog.
 *
 * Part of the src/api/types.ts barrel split.
 */
import type { ConfigEntry } from "./config-entries.js";
import type { PagedResponse } from "./protocol.js";

// ─── Components ──────────────────────────────────────────────

/** Component categories (matches backend ComponentCategory enum). */
export enum ComponentCategory {
  SENSOR = "sensor",
  BINARY_SENSOR = "binary_sensor",
  SWITCH = "switch",
  LIGHT = "light",
  FAN = "fan",
  COVER = "cover",
  CLIMATE = "climate",
  BUTTON = "button",
  NUMBER = "number",
  SELECT = "select",
  TEXT = "text",
  TEXT_SENSOR = "text_sensor",
  LOCK = "lock",
  VALVE = "valve",
  MEDIA_PLAYER = "media_player",
  SPEAKER = "speaker",
  MICROPHONE = "microphone",
  CAMERA = "camera",
  DISPLAY = "display",
  TOUCHSCREEN = "touchscreen",
  OUTPUT = "output",
  DATETIME = "datetime",
  EVENT = "event",
  UPDATE = "update",
  ALARM = "alarm_control_panel",
  CORE = "core",
  BUS = "bus",
  AUTOMATION = "automation",
  // Platform-domain umbrellas — `ota.*` / `time.*` components carry
  // these as their category. The regular component selector hides
  // them since the OTA / time / update blocks belong in the core
  // dialog (see CORE_CATEGORIES below).
  OTA = "ota",
  TIME = "time",
  // Other platform domains tagged from the schema by the sync
  // script. Listed so frontend code can reference them by enum.
  AUDIO_ADC = "audio_adc",
  AUDIO_DAC = "audio_dac",
  CANBUS = "canbus",
  INFRARED = "infrared",
  MEDIA_SOURCE = "media_source",
  ONE_WIRE = "one_wire",
  PACKET_TRANSPORT = "packet_transport",
  STEPPER = "stepper",
  WATER_HEATER = "water_heater",
  MISC = "misc",
  // Synthetic category for components surfaced as board recommendations.
  // Featured entries are materialised on the fly from the board catalog
  // and only appear in API results when ``category=featured`` is the
  // explicit filter and ``board_id`` is set.
  FEATURED = "featured",
}

/**
 * Categories considered "core configuration" — these belong to the
 * dedicated "Add core configuration" dialog and are filtered OUT of
 * the regular component selector. Includes:
 *
 * - `core` — backend-tagged core infrastructure (api, wifi, logger,
 *   target platforms, substitutions, …).
 * - `ota` / `update` — platform-domain umbrellas whose top-level
 *   YAML blocks (`ota:`, `update:`) ship firmware-management
 *   functionality every device needs. The catalog has no standalone
 *   entry for these domains, only platform variants (`ota.esphome`,
 *   `update.http_request`, …) which all carry the umbrella as their
 *   category.
 *
 * `time` is intentionally NOT here — most devices get the time via
 * the API connection to Home Assistant automatically, so an explicit
 * `time:` block is the exception. It lives in the regular component
 * selector under its own "Time" category.
 *
 * The frontend's CORE_KEYS in `util/yaml-sections.ts` is the
 * YAML-key-level counterpart (which umbrella keys are categorized
 * as "Core" in the navigator) and stays aligned with this list.
 */
export const CORE_CATEGORIES: ComponentCategory[] = [
  ComponentCategory.CORE,
  ComponentCategory.OTA,
  ComponentCategory.UPDATE,
];

export interface ComponentCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: ComponentCategory;
  docs_url: string;
  image_url: string;
  /** Other components this one requires to be configured. */
  dependencies: string[];
  /** Whether the same component can be added multiple times. */
  multi_conf: boolean;
  /** Empty list = works on every target platform. Non-empty = restricted to those. */
  supported_platforms: string[];
  /** Interfaces this component can be referenced *as* beyond its own domain
   *  (an `adc` sensor provides `voltage_sampler`). */
  provides?: string[];
  /** For a provided interface whose id is nested rather than the component's
   *  own top-level id (usb_uart exposes a uart via channels[].id), the YAML
   *  key-paths to descend, keyed by interface (one per nested location).
   *  Absent for own-id providers. */
  provides_id_paths?: Record<string, string[][]>;
  /** Requirements this component imposes on the bus it attaches to, keyed
   *  by bus id ('i2c' / 'spi' / 'uart'): exact-match values (baud_rate,
   *  parity, ...), range bounds (min/max_frequency in Hz) and required
   *  pins (require_tx / require_mosi / ...). Drives dep-add prefill. */
  bus_constraints?: Record<string, Record<string, unknown>>;
  /** The component's configuration schema. May contain `nested` entries
   *  (`type === "nested"`) whose `config_entries` recurse. */
  config_entries: ConfigEntry[];
}

export interface PagedComponentsResponse extends PagedResponse {
  components: ComponentCatalogEntry[];
  categories: Array<{ id: string; name: string; count: number }>;
}
