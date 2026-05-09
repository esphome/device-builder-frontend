/**
 * Types for the ESPHome Device Builder API.
 *
 * Matches the WebSocket-only backend at /ws.
 * All communication uses a single multiplexed WebSocket with
 * command/message_id/args → result/error/event protocol.
 */

// ─── WebSocket Protocol ──────────────────────────────────────

/** Client → Server: a command request. */
export interface CommandMessage {
  command: string;
  message_id: string;
  args?: Record<string, unknown>;
}

/** Server → Client: successful command result. */
export interface ResultMessage {
  message_id: string;
  result: unknown;
}

/** Server → Client: command error. */
export interface ErrorMessage {
  message_id: string;
  error_code: ErrorCode;
  details?: string;
}

/** Server → Client: streaming event (output lines, push events). */
export interface EventMessage {
  message_id: string;
  event: string;
  data: unknown;
}

/** Server → Client: sent immediately on connection. */
export interface ServerInfoMessage {
  server_version: string;
  esphome_version: string;
  port: number;
  ha_addon: boolean;
  requires_auth: boolean;
}

export type ServerMessage = ResultMessage | ErrorMessage | EventMessage;

export enum ErrorCode {
  INVALID_MESSAGE = "invalid_message",
  UNKNOWN_COMMAND = "unknown_command",
  INVALID_ARGS = "invalid_args",
  NOT_FOUND = "not_found",
  ALREADY_EXISTS = "already_exists",
  INTERNAL_ERROR = "internal_error",
  NOT_AUTHENTICATED = "not_authenticated",
  RATE_LIMITED = "rate_limited",
}

// ─── Paged Responses ─────────────────────────────────────────

export interface PagedResponse {
  total: number;
  offset: number;
  limit: number;
}

// ─── Devices ─────────────────────────────────────────────────

export enum DeviceState {
  UNKNOWN = "unknown",
  ONLINE = "online",
  OFFLINE = "offline",
}

/** A configured ESPHome device. */
export interface ConfiguredDevice {
  name: string;
  friendly_name: string;
  configuration: string;
  comment: string | null;
  /** Optional ``esphome.area`` from the YAML — a free-form
   *  room / location label (the same key Home Assistant uses as
   *  a device-area hint). Empty string when the YAML doesn't
   *  declare one. Surfaced in the drawer and as an opt-in table
   *  column. */
  area: string;
  board_id: string;
  target_platform: string;
  /** mDNS hostname from StorageJSON (e.g. "my_device.local"). */
  address: string;
  /** Primary resolved IP from mDNS — empty until the device is seen online.
   *  Prefers IPv4 when both are available. Used for OTA cache args, and as
   *  the Visit-web-UI fallback when ``address`` (mDNS hostname) is empty. */
  ip: string;
  /** All resolved addresses from mDNS (IPv4 + IPv6) — empty array until
   *  the device is seen online. ``ip_addresses[0]`` matches ``ip`` when
   *  populated. */
  ip_addresses: string[];
  web_port: number | null;
  current_version: string;
  deployed_version: string;
  loaded_integrations: string[];
  /**
   * Subset of ``loaded_integrations`` the user directly wrote in
   * YAML — top-level keys (``api:``, ``wifi:``, ``sensor:``) plus
   * the platform stems from ``- platform: <name>`` references
   * (``gpio`` under ``binary_sensor``, ``homeassistant`` /
   * ``sntp`` under ``time``, ``esphome`` under ``ota``). The
   * complement against ``loaded_integrations`` is the auto-loaded
   * dependency chain (``md5`` from WPA2 password hashing,
   * ``mdns`` from ``api``, ``web_server_base`` from ``web_server``,
   * ``voltage_sampler`` from ADC sensors).
   *
   * Optional on the wire: older backends (pre-#425) don't emit
   * the field at all, and a backend whose resolved-YAML parse
   * failed mid-edit emits an empty array. Both are the
   * graceful-degrade signal — the drawer falls back to rendering
   * ``loaded_integrations`` as a flat list. ``splitIntegrations``
   * accepts ``null`` / ``undefined`` / ``[]`` interchangeably.
   */
  directly_referenced_integrations?: string[];
  state: DeviceState;
  /**
   * 8-char hex hash of the YAML as last successfully compiled,
   * persisted in the device-builder metadata sidecar. Matches the
   * runtime ``CORE.config_hash`` ESPHome bakes into the firmware
   * (esphome/esphome#16145), so a comparison against
   * ``deployed_config_hash`` answers "is the running firmware the
   * latest compile?". Empty string when the device has never been
   * compiled — the drawer renders an em-dash for that.
   */
  expected_config_hash: string;
  /**
   * 8-char hex hash the running firmware reports via the
   * ``config_hash`` TXT record on its ``_esphomelib._tcp`` mDNS
   * broadcast. Drives ``has_pending_changes`` together with
   * ``expected_config_hash``. Empty string when the device hasn't
   * announced yet, or runs firmware older than the broadcast
   * (esphome/esphome#16145) — the dashboard then falls back to
   * mtime-based change detection.
   */
  deployed_config_hash: string;
  /** True until successfully compiled + deployed */
  has_pending_changes: boolean;
  /** True if compiled with older ESPHome version */
  update_available: boolean;
  /**
   * True when the resolved YAML carries a top-level ``api:`` block
   * (the device exposes the Native API at all). Gates the lock-icon
   * indicator next to the device name in the table + card views and
   * the encryption pill in the detail drawer. Devices without an
   * api block — MQTT-only / sensor-bridge configs — get no indicator
   * at all, since "insecure" doesn't apply to a surface that's
   * turned off.
   */
  api_enabled: boolean;
  /**
   * True when the YAML (after !include / packages / !secret
   * resolution) declares an ``api: encryption:`` block. Flips the
   * indicator variant (filled lock vs open lock) when ``api_enabled``
   * is set. The actual key value is fetched on demand via
   * ``devices/get_api_key``.
   */
  api_encrypted: boolean;
  /**
   * Encryption state observed from the device's
   * ``_esphomelib._tcp.local.`` mDNS broadcast.
   *
   * - ``null`` — mDNS not seen yet. Trust ``api_encrypted`` verbatim
   *   (assume the device matches the YAML).
   * - ``""`` — mDNS seen, ``api_encryption`` TXT absent. The device
   *   is broadcasting plaintext API.
   * - non-empty (e.g. ``"Noise_NNpsk0_25519_ChaChaPoly_SHA256"``) —
   *   encryption is confirmed live on the device.
   *
   * Drives the four-state lock indicator: active / pending-flash /
   * mismatch / plaintext.
   */
  api_encryption_active: string | null;
  /** Canonical ``XX:XX:XX:XX:XX:XX`` MAC observed in the device's
   *  ``_esphomelib._tcp.local.`` ``mac`` TXT record (e.g.
   *  ``"94:C9:60:1F:8C:F1"``). Empty string when mDNS hasn't surfaced
   *  one yet. The backend normalizes at ingest so this field always
   *  carries the colon-separated uppercase form regardless of which
   *  case / separator style the firmware happens to broadcast — the
   *  frontend renders it directly without any per-display formatting.
   */
  mac_address: string;
  /** Derived ethernet MAC for devices whose YAML loads the
   *  ``ethernet`` integration, in the same canonical
   *  ``XX:XX:XX:XX:XX:XX`` form as ``mac_address``. Empty string
   *  when no ethernet integration is loaded or no primary MAC has
   *  been observed yet. On ESP32 this is the base MAC + 3 to the
   *  last octet; on RP2040 / RP2350 it equals ``mac_address``
   *  (single-MAC platforms — the drawer hides the redundant row).
   */
  ethernet_mac: string;
  /** Derived Bluetooth MAC for ESP32 devices whose YAML loads any
   *  ``esp32_ble*`` / ``bluetooth_*`` integration. Same canonical
   *  form. Empty string when no bluetooth integration is loaded
   *  or the platform doesn't follow the ESP-IDF MAC offset scheme
   *  (e.g. RP2040 — Pico W bluetooth lives on a separate radio
   *  chip with its own allocation).
   */
  bluetooth_mac: string;
  /** Cached total size in bytes of the per-device build directory
   *  (``.esphome/build/<name>/``). ``0`` until the device has been
   *  compiled and the backend has walked its build tree. The walk
   *  is heavy I/O — backend caches the value keyed off the build
   *  directory's mtime, so a steady-state poll never re-walks. */
  build_size_bytes: number;
  /** Opaque label IDs assigned to this device (uuid hex strings
   *  from the global catalog at ``.device-builder.json``'s
   *  ``_labels`` key). Resolved against ``labels/list`` to render
   *  colored chips; the catalog entry is the source of truth for
   *  name + color, so a rename / recolor doesn't require a
   *  per-device write. */
  labels: string[];
}

// ─── Labels ──────────────────────────────────────────────────

/** A user-defined label that can be assigned to devices. The
 *  catalog is global; ``ConfiguredDevice.labels`` carries an opaque
 *  list of ids referencing entries here. */
export interface Label {
  /** Server-generated ``uuid.uuid4().hex``. Stable across name /
   *  color edits — devices reference labels by id. */
  id: string;
  /** Display name. Trimmed before save; uniqueness is enforced
   *  case-insensitively on the backend. 1-50 chars. */
  name: string;
  /** ``#rrggbb`` (lowercase). ``null`` means "no explicit color"
   *  — frontend falls back to a neutral chip palette. */
  color: string | null;
}

/** An adoptable/importable ESPHome device. */
export interface AdoptableDevice {
  name: string;
  friendly_name: string;
  package_import_url: string;
  project_name: string;
  project_version: string;
  network: string;
  ignored: boolean;
  /** Pre-built URL when the device also advertises an
   *  ``_http._tcp.local.`` mDNS service. Empty string hides the
   *  Visit-web-UI link on the discovered card. */
  web_url: string;
}

/** Response from devices/list. */
export interface DevicesResponse {
  configured: ConfiguredDevice[];
  importable: AdoptableDevice[];
}

/** A single matching line within a YAML file.
 *
 *  ``before`` / ``after`` carry up to ``MAX_CONTEXT_LINES`` (10)
 *  lines on each side of the matched line, sliced from the same
 *  capped scan window the backend walks. The frontend renders a
 *  code-snippet block that surfaces the surrounding key
 *  (``device:`` / ``platform:`` / list-anchor lines) so a hit
 *  deep inside a nested block reads as anchored config rather
 *  than a free-floating value. Both default to ``[]`` for
 *  matches at file edges.
 */
export interface YamlSearchMatch {
  line_number: number;
  line_text: string;
  /** Up to ``context_lines`` lines preceding the match (file order). */
  before: string[];
  /** Up to ``context_lines`` lines following the match (file order). */
  after: string[];
}

/**
 * One entry in the response from `yaml/search`.
 *
 * Each entry represents a device that has at least one matching
 * line. Matches are capped per-file (5 by default on the backend)
 * so a chatty match doesn't crowd out hits in other devices, and
 * the total number of entries is capped by `max_results`.
 */
export interface YamlSearchHit {
  configuration: string;
  device_name: string;
  friendly_name: string;
  matches: YamlSearchMatch[];
}

/** Response from devices/create. */
export interface WizardResponse {
  configuration: string;
}

/** Response from devices/update. */
export interface UpdateDeviceResponse {
  name: string;
  friendly_name: string;
  comment: string | null;
  board_id: string | null;
}

/** Response from devices/add_component. */
export interface AddComponentResponse {
  yaml: string;
}

// ─── Boards ──────────────────────────────────────────────────

export interface BoardEsphomeConfig {
  platform: string;
  board: string;
  variant: string | null;
  framework: string | null;
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
}

export interface BoardCatalogEntry {
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
  /** Components recommended for this board. */
  featured_components: FeaturedComponent[];
  /** Logical groups of featured components added together. */
  featured_bundles: FeaturedBundle[];
}

export interface PagedBoardsResponse extends PagedResponse {
  boards: BoardCatalogEntry[];
}

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
  /** The component's configuration schema. May contain `nested` entries
   *  (`type === "nested"`) whose `config_entries` recurse. */
  config_entries: ConfigEntry[];
}

export interface PagedComponentsResponse extends PagedResponse {
  components: ComponentCatalogEntry[];
  categories: Array<{ id: string; name: string; count: number }>;
}

// ─── Config Entries ──────────────────────────────────────────

/** Primitive value type for config entries. */
export type ConfigPrimitive = string | number | boolean;

export interface ConfigValueOption {
  label: string;
  value: string;
}

/** Known GPIO pin features/capabilities (matches backend PinFeature enum). */
export enum PinFeature {
  ADC = "adc",
  DAC = "dac",
  TOUCH = "touch",
  PWM = "pwm",
  I2C_SDA = "i2c_sda",
  I2C_SCL = "i2c_scl",
  SPI_MOSI = "spi_mosi",
  SPI_MISO = "spi_miso",
  SPI_CLK = "spi_clk",
  SPI_CS = "spi_cs",
  UART_TX = "uart_tx",
  UART_RX = "uart_rx",
  USB_DP = "usb_dp",
  USB_DM = "usb_dm",
  RGB_LED = "rgb_led",
  JTAG = "jtag",
  STRAPPING = "strapping",
  INPUT_ONLY = "input_only",
  BOOT_BUTTON = "boot_button",
}

/** Direction a GPIO pin will be used in (matches backend PinMode enum). */
export enum PinMode {
  INPUT = "input",
  OUTPUT = "output",
  INPUT_OUTPUT = "input_output",
}

export interface ConfigEntry {
  // === core ===
  /** YAML key name. */
  key: string;
  /** Primitive type drives the UI control. */
  type: ConfigEntryType;
  /** Short human-readable label shown next to the input. */
  label: string;
  /** Longer help text shown as a tooltip or below the input. */
  description: string | null;
  /** When True the YAML is invalid without this field set. */
  required: boolean;
  /**
   * Default value. For multi_value entries this is the default list.
   * The backend pre-resolves `cv.SplitDefault` fields against the
   * device's target platform, so this is always the effective default
   * for the current device — the frontend doesn't need to know about
   * per-platform variants.
   */
  default_value: ConfigPrimitive | ConfigPrimitive[] | null;

  // === value constraints ===
  /** Constrains the value to a fixed set of choices. */
  options: ConfigValueOption[] | null;
  /**
   * When `true`, `options` are treated as suggestions rather than the
   * exhaustive set of allowed values — the frontend should render a
   * combobox/autocomplete that lets the user pick a suggested value
   * or type a custom one. Has no effect when `options` is empty.
   */
  allow_custom_value: boolean;
  /** Min/max bounds for INTEGER / FLOAT entries. */
  range: [number, number] | null;
  /**
   * Display-formatting hint for INTEGER entries.
   *
   * Currently only `"hex"` is defined. The backend sets it for
   * fields whose upstream validator is one of the `cv.hex_uint*_t`
   * family (`i2c_address` is the canonical case). Frontend renders
   * `<input type="text">` with a hex-aware parser/formatter so
   * users can type either `0x76` or `118` and the value
   * round-trips as `0x76`. `null` (the default for plain
   * `cv.int_range` integers) → decimal display.
   */
  display_format: "hex" | null;
  /**
   * Unit choices for `FLOAT_WITH_UNIT` entries. The frontend renders
   * a unit picker populated from this list; each option's string is
   * what the YAML serialization appends after the numeric value
   * (e.g. `["Hz", "kHz", "MHz", "GHz"]` for `cv.frequency`). The
   * first entry is the canonical unit — range bounds and any
   * user-typed bare number default to it. Null for non-FLOAT_WITH_UNIT
   * entries.
   */
  unit_options: string[] | null;
  /** When True the field accepts a list of values. */
  multi_value: boolean;
  /** When True accepts either a literal value OR a !lambda block. */
  templatable: boolean;

  // === featured-component overlays ===
  /**
   * Backend-baked, only populated on materialised featured-component
   * entries (id starts with `featured.`). When `true` the frontend
   * disables the input — the value comes from a board-side preset and
   * the backend rejects deviating user input on add.
   */
  locked: boolean;
  /**
   * Backend-baked, only populated on materialised featured-component
   * entries. When non-null, restricts the input to this short list of
   * allowed values — used most often for PIN entries on addon modules
   * whose pin can land on one of a few GPIOs.
   */
  suggestions: ConfigPrimitive[] | null;

  // === conditional visibility ===
  /** Key of another entry this one depends on. */
  depends_on: string | null;
  /** Show only when dependency value equals this. */
  depends_on_value: ConfigPrimitive | null;
  /** Show only when dependency value does NOT equal this. */
  depends_on_value_not: ConfigPrimitive | null;
  /**
   * Hide this entry unless the named component is configured on the
   * same device (e.g. `qos` only matters when an `mqtt:` block exists).
   * null = always visible.
   */
  depends_on_component: string | null;
  /**
   * For `type === "id"` entries: identifies the component domain the
   * value must reference. The frontend should render a dropdown of
   * existing components of that domain in the device's YAML — e.g.
   * `rtttl.output` → "output", many sensors reference "i2c" / "spi" /
   * "uart" buses. null = free-form ID input.
   */
  references_component: string | null;
  /**
   * Target chips this field is valid on. Empty list (or omitted) =
   * no restriction (the common case); non-empty = the field is
   * restricted to the listed chips. Same wire shape as
   * `ComponentCatalogEntry.supported_platforms`, but at the
   * single-field grain — a component may run on every platform
   * while one of its fields (`sensor.debug.psram` is the canonical
   * case, ESP32-only) does not. Form renderer hides the entry when
   * the device's target platform isn't in this list.
   *
   * Recovered by the backend's sync script from upstream's
   * declarative `cv.only_on` validators.
   */
  supported_platforms?: string[];

  // === pin selection (only meaningful when type == PIN) ===
  /** Pin capabilities required for this field. */
  pin_features: PinFeature[];
  /** Direction the pin will be used in. */
  pin_mode: PinMode | null;

  // === UI / i18n ===
  /** When True frontend collapses this entry under an "Advanced" section. */
  advanced: boolean;
  /** When True frontend hides the entry entirely. */
  hidden: boolean;
  /** Optional URL pointing to documentation specific to this field. */
  help_link: string | null;
  /** i18n override key. */
  translation_key: string | null;
  /** Substitution params for the translation string. */
  translation_params: Record<string, unknown> | null;

  // === nested groups (only meaningful when type === "nested") ===
  /**
   * Inner schema when this entry is a nested group. Recursive — these
   * entries can themselves be `nested`. Always null for non-nested types.
   */
  config_entries: ConfigEntry[] | null;
  /**
   * When the nested group represents an ESPHome entity sub-reading
   * (e.g. a DHT sensor's "temperature" / "humidity" outputs), this is
   * the platform type ("sensor", "binary_sensor", ...) so the frontend
   * can apply the standard platform-base fields (name, icon,
   * device_class, ...) on top of `config_entries`. null = plain
   * nested form, render only the inner fields.
   */
  platform_type: string | null;
}

export enum ConfigEntryType {
  // Single-line text input
  STRING = "string",
  // Single-line text input that masks the value (passwords, API keys)
  SECURE_STRING = "secure_string",
  // Whole-number spinner / numeric input
  INTEGER = "integer",
  // Decimal-number spinner / numeric input
  FLOAT = "float",
  // Toggle / checkbox
  BOOLEAN = "boolean",
  // GPIO pin picker
  PIN = "pin",
  // Duration like "30s", "5min"
  TIME_PERIOD = "time_period",
  // Numeric value carrying a unit: frequency ("50kHz"), data size
  // ("500KB"), framerate ("10 fps"), voltage ("3.3V"), distance
  // ("2m"), temperature ("4°C"). ESPHome's coercer multiplies by
  // the unit at compile time, but the YAML shape is a string —
  // frontend renders a number input + unit picker, round-trips the
  // value as `<value><unit>`. Unit choices come from `unit_options`
  // on the entry. TIME_PERIOD stays separate because its grammar
  // (`1h30s`) is richer than this generic widget can express.
  FLOAT_WITH_UNIT = "float_with_unit",
  // Material Design icon picker (mdi:foo)
  ICON = "icon",
  // Component ID reference
  ID = "id",
  // Automation trigger reference
  TRIGGER = "trigger",
  // Color picker — accepts hex (#RRGGBB) or named color
  COLOR = "color",
  // MAC address input
  MAC_ADDRESS = "mac_address",
  // Multi-line code editor for raw `!lambda |- C++` blocks
  LAMBDA = "lambda",
  // Multi-line JSON editor
  JSON = "json",
  // Layout / decoration entries (no value)
  LABEL = "label",
  DIVIDER = "divider",
  ALERT = "alert",
  // Nested configuration group — entry has its own `config_entries`
  // array (recursive) and an optional `platform_type` indicating which
  // ESPHome platform's base entity fields should be applied on top.
  NESTED = "nested",
  // Free-form map of (string key) → (typed value). The user names the
  // keys themselves; `config_entries[0]` describes what each value
  // looks like. Used for things like `logger.logs:`,
  // `substitutions:`, `globals:`, `api.actions:`, etc. — places where
  // the schema would otherwise need to enumerate every possible key.
  MAP = "map",
  // Fallback for fields whose type couldn't be determined
  UNKNOWN = "unknown",
  /** @deprecated Backend signals dropdown via populated `options` instead. Kept for legacy callers. */
  SELECT = "select",
}

// ─── Config / System ─────────────────────────────────────────

export interface SerialPort {
  port: string;
  desc: string;
}

export enum DashboardView {
  CARDS = "cards",
  TABLE = "table",
}

export enum Theme {
  LIGHT = "light",
  DARK = "dark",
  SYSTEM = "system",
}

export enum SortDirection {
  ASC = "asc",
  DESC = "desc",
}

export interface UserPreferences {
  dashboard_view: DashboardView;
  theme: Theme;
  navigator_visible: boolean;
  yaml_diff_button: boolean;
  table_page_size: number;
  table_column_visibility: Record<string, boolean>;
  table_sort_column: string | null;
  table_sort_direction: SortDirection | null;
  /** Highest onboarding-flow version the user has acknowledged.
   *  ``0`` ⇒ never gone through onboarding. The dashboard surfaces
   *  the wizard whenever this is below the server's
   *  ``OnboardingState.current_version``. */
  onboarding_completed_version: number;
}

/**
 * Stable identifiers for onboarding steps. Keep in lockstep with
 * the backend's ``OnboardingStepId`` enum — these strings flow
 * through the wire as-is.
 */
export enum OnboardingStepId {
  WIFI_CREDENTIALS = "wifi_credentials",
}

export enum OnboardingStepStatus {
  PENDING = "pending",
  DONE = "done",
}

export interface OnboardingStep {
  id: OnboardingStepId;
  status: OnboardingStepStatus;
}

/**
 * Snapshot of the dashboard onboarding flow.
 *
 * ``current_version`` is the version of onboarding the server
 * knows about; ``completed_version`` is what the user last
 * acknowledged. The wizard auto-pops when ALL of the following
 * are true: ``completed_version < current_version`` (user is
 * behind a newer onboarding version), at least one
 * ``steps[].status`` is ``pending`` (there's actually
 * something to do), and the user hasn't frontend-side
 * session-dismissed it. A version bump alone isn't enough —
 * pre-wizard installs all started at ``completed_version = 0``
 * and asking a user with already-configured secrets to re-enter
 * them is friction with no payoff. The exact gate lives in
 * ``src/util/onboarding-gate.ts`` (``shouldAutoShowOnboarding``)
 * with unit-test coverage of every branch.
 *
 * Manual entry via the ``Set up Wi-Fi…`` kebab item bypasses
 * both the version-bump gate and the session-dismiss flag —
 * the click IS the explicit "I want to do this now" signal —
 * but is itself only visible when ``isOnboardingPending`` is
 * true (so the user never sees the entry when there's nothing
 * to do).
 *
 * Step status also drives the kebab entry's visibility
 * directly. It's computed from live on-disk state on every
 * server-side ``get_state`` call — never persisted — and the
 * dashboard re-fetches on (re)connect AND on every
 * ``secrets-saved`` event, so an in-app save (wizard or
 * Secrets editor) updates the entry in real time and an
 * out-of-band ``secrets.yaml`` edit clears it no later than
 * the next WS reconnect.
 */
export interface OnboardingState {
  current_version: number;
  completed_version: number;
  steps: OnboardingStep[];
}

/**
 * Per-device result from any bulk WS command (``devices/delete_bulk``,
 * ``devices/archive_bulk``). Shape is ``{configuration, success, error?}``;
 * the backend's ``_run_bulk_per_device`` helper produces this for both.
 */
export interface BulkActionResult {
  configuration: string;
  success: boolean;
  error?: string;
}

/**
 * Soft-deleted device row returned by ``devices/list_archived``.
 *
 * Shape mirrors a stripped-down ``ConfiguredDevice``: just enough
 * metadata for the dashboard's archived-devices dialog (opened
 * from the header kebab) to render a row + Unarchive /
 * Delete-permanently controls. The full YAML / metadata stays on
 * disk under ``<config_dir>/archive/`` and is fetched on demand.
 */
export interface ArchivedDevice {
  configuration: string;
  name: string;
  friendly_name: string;
  comment: string | null;
}

// ─── Firmware Jobs ──────────────────────────────────────────

export enum JobStatus {
  QUEUED = "queued",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export enum JobType {
  COMPILE = "compile",
  UPLOAD = "upload",
  INSTALL = "install",
  CLEAN = "clean",
  RESET_BUILD_ENV = "reset_build_env",
  RENAME = "rename",
}

export interface FirmwareJob {
  job_id: string;
  configuration: string;
  job_type: JobType;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  exit_code: number | null;
  output: string[];
  error: string | null;
  port: string;
  /** New device name. Carried only by ``rename`` jobs; the backend
   *  dataclass defaults to ``""`` for every other job type so the
   *  field is always present on the wire — required here matches. */
  new_name: string;
  /** 0–100 progress, monotonically non-decreasing while the job runs.
   *  `null` until the underlying tooling (PlatformIO/esptool) emits a
   *  percentage we can latch onto. */
  progress: number | null;
}

export interface FirmwareBinary {
  title: string;
  file: string;
}

export interface FirmwareDownload {
  filename: string;
  data: string;
  size: number;
  compressed: boolean;
}

// ─── Event Subscription ─────────────────────────────────────

/** Result from subscribe_events command. */
export interface SubscribeEventsResult {
  subscribed: boolean;
}

/** Event types pushed by the backend after subscribe_events. */
export enum DeviceEventType {
  INITIAL_STATE = "initial_state",
  DEVICE_ADDED = "device_added",
  DEVICE_REMOVED = "device_removed",
  DEVICE_UPDATED = "device_updated",
  DEVICE_STATE_CHANGED = "device_state_changed",
  IMPORTABLE_DEVICE_ADDED = "importable_device_added",
  IMPORTABLE_DEVICE_REMOVED = "importable_device_removed",
  // Label catalog mutations. Per-device label assignment changes
  // ride the existing ``DEVICE_UPDATED`` event.
  LABEL_CREATED = "label_created",
  LABEL_UPDATED = "label_updated",
  LABEL_DELETED = "label_deleted",
  JOB_QUEUED = "job_queued",
  JOB_STARTED = "job_started",
  JOB_OUTPUT = "job_output",
  JOB_COMPLETED = "job_completed",
  JOB_FAILED = "job_failed",
  // Remote-build receiver-side events.
  REMOTE_BUILD_BINDING_MISMATCH = "remote_build_binding_mismatch",
  REMOTE_BUILD_IDENTITY_ROTATED = "remote_build_identity_rotated",
}

/** Data payload for job lifecycle events (queued, started, completed, failed). */
export interface JobEventData {
  job: FirmwareJob;
}

/** Data payload for job_output event. */
export interface JobOutputEventData {
  job_id: string;
  line: string;
}

/** Data payload for initial_state event. */
export interface InitialStateEventData {
  devices: ConfiguredDevice[];
  /** Discovered factory-firmware devices the dashboard knew about
   *  before this client subscribed. The backend follows up with
   *  ``IMPORTABLE_DEVICE_ADDED`` / ``_REMOVED`` events for changes
   *  after subscription. */
  importable: AdoptableDevice[];
}

/** Data payload for device_added / device_updated / device_removed events. */
export interface DeviceEventData {
  device: ConfiguredDevice;
}

/** Data payload for device_state_changed event. */
export interface DeviceStateChangedEventData {
  configuration: string;
  state: DeviceState;
}

/** Data payload for importable_device_added events. */
export interface ImportableDeviceAddedEventData {
  device: AdoptableDevice;
}

/** Data payload for importable_device_removed events.
 *
 *  Removal carries only the device name — by the time the event
 *  fires the original ``AdoptableDevice`` is gone from the backend's
 *  ``import_result`` cache, and the frontend doesn't need anything
 *  beyond the name to evict its own copy. */
export interface ImportableDeviceRemovedEventData {
  name: string;
}

/** Data payload for label_created / label_updated events. */
export interface LabelEventData {
  label: Label;
}

/** Data payload for label_deleted events. The catalog entry is
 *  already gone by the time this fires; per-device assignments
 *  cascade through the existing ``device_updated`` events. */
export interface LabelDeletedEventData {
  label_id: string;
}

/** Callback for event subscription push events. */
export type EventSubscriptionCallback = (event: string, data: unknown) => void;

// ─── Per-device reachability subscription ─────────────────

/** Channel a reachability observation came in on. Mirrors the
 *  backend's source-priority enum — the device drawer renders one
 *  row per source the device has been observed on. */
export type ReachabilitySource = "mdns" | "ping" | "mqtt" | "unknown";

/**
 * Wire shape pushed by ``devices/subscribe_reachability`` events.
 *
 * The drawer subscribes per-device while open so every connected
 * client doesn't get a periodic freshness heartbeat. Each
 * ``*_last_seen_seconds_ago`` field is ``null`` when that signal
 * has never been observed for this device — the drawer hides
 * those rows. ``active_source`` is the channel currently driving
 * the device's online/offline state (mDNS > MQTT > Ping); it
 * gets the "active" badge in the UI but doesn't change which
 * rows are visible. ``ping_rtt_ms`` is paired with the Ping row
 * and is ``null`` until the first successful probe.
 */
export interface ReachabilityStateEvent {
  device: string;
  state: DeviceState;
  active_source: ReachabilitySource;
  ip: string;
  /** Seconds since the device's last ``_esphomelib._tcp.local.``
   *  SRV announce, read live from ``zeroconf.cache.created``.
   *  Truthful even when ``ServiceStateChange.Updated`` doesn't
   *  fire (zeroconf suppresses callbacks for same-content TTL
   *  refreshes); ``null`` when zeroconf isn't running or the
   *  device hasn't been heard from at all. */
  mdns_last_seen_seconds_ago: number | null;
  /** Seconds the cached SRV record has left before
   *  ``zeroconf`` evicts it without a refreshing announce.
   *  Surfaced beside the mDNS row as a TTL bar / countdown
   *  so the user can tell "due to re-announce" from "missed
   *  several windows already". ``null`` when ``mdns_last_seen``
   *  is null. */
  mdns_ttl_remaining_seconds: number | null;
  /** Decoded TXT key/value pairs from the device's
   *  ``_esphomelib._tcp.local.`` TXT record — same payload the
   *  dashboard already mines for ``version`` / ``config_hash`` /
   *  ``mac`` / ``api_encryption``. The drawer renders these
   *  inside a chevron-collapsible under the mDNS row so users
   *  can debug "is the device actually broadcasting what I
   *  expect?" without dropping to ``avahi-browse`` /
   *  ``dns-sd``. ``null`` when no TXT record is cached (drawer
   *  hides the section entirely); empty mapping is normalised
   *  to ``null`` upstream. Empty-string values are meaningful —
   *  zeroconf collapses bare keys and ``key=`` empty-value
   *  entries to the same shape, so the backend surfaces both as
   *  ``""`` (the ``api_encryption=`` "device confirmed
   *  plaintext" tri-state signal lives here). Optional because
   *  older backend builds don't emit the field — the drawer
   *  treats undefined the same as ``null``. */
  mdns_txt_records?: Record<string, string> | null;
  ping_last_seen_seconds_ago: number | null;
  mqtt_last_seen_seconds_ago: number | null;
  ping_rtt_ms: number | null;
}

/** Result from devices/subscribe_reachability — same shape as
 *  subscribe_events: a one-shot ack that the listener is live. */
export interface SubscribeReachabilityResult {
  subscribed: boolean;
}

/** Handle returned by ``ESPHomeAPI.subscribeDeviceReachability``.
 *  Call ``unsubscribe()`` when the drawer closes — best-effort,
 *  network failures are swallowed since the per-stream task is
 *  also cancelled by the WS disconnect anyway. */
export interface ReachabilitySubscription {
  unsubscribe: () => Promise<void>;
}

// ─── Streaming Commands ──────────────────────────────────────

/** Callbacks for streaming commands (validate, logs). */
export interface StreamCallbacks {
  onOutput?: (line: string) => void;
  onResult?: (data: { success: boolean; code: number }) => void;
  onError?: (error: string) => void;
}

// ─── Editor (live YAML validation) ──────────────────────────

/** Range emitted by the upstream `esphome vscode --ace` validator. 0-indexed. */
export interface EditorRange {
  start_line: number;
  start_col: number;
  end_line: number;
  end_col: number;
}

export interface EditorYamlError {
  message: string;
}

export interface EditorValidationError {
  message: string;
  range: EditorRange;
}

export interface EditorValidateResponse {
  yaml_errors: EditorYamlError[];
  validation_errors: EditorValidationError[];
}

// Remote-build feature (issue #106).
// Phase 2: peer dashboard discovery + receiver-side master switch.
// Phase 2b: user-supplied manual hosts for cross-subnet / non-mDNS LANs.
// Phase 3b1+: receiver-issued bearer tokens.
// Phase 3c1: receiver dashboard identity + cert rotation.

export type RemoteBuildPeerSource = "mdns" | "manual";

export interface ManualHost {
  hostname: string;
  port: number;
}

/**
 * Public-facing token row from ``remote_build/list_tokens``.
 *
 * Mirrors the backend's ``TokenSummary`` (drops the on-disk
 * ``secret_sha256`` so a leaked frontend snapshot can't be
 * matched against candidate cleartext bearers). The cleartext
 * bearer is generated client-side at ``add_token`` time and
 * never crosses the wire to the backend; this list is the
 * receiver's view of "which paired offloaders does this
 * dashboard recognise" — there's no path to recover the
 * cleartext from anywhere server-side.
 *
 * ``bound_dashboard_id`` starts ``null`` and is filled in by
 * phase 3b3's first-use binding the first time an authenticated
 * request lands carrying the offloader's ``X-Dashboard-ID``.
 * The Settings UI renders a "not yet bound" badge while ``null``
 * and a "bound to <id>" badge once set.
 */
export interface TokenSummary {
  token_id: string;
  label: string;
  created_at: number;
  bound_dashboard_id: string | null;
}

export interface RemoteBuildSettings {
  enabled: boolean;
  manual_hosts: ManualHost[];
  tokens: TokenSummary[];
}

export interface RemoteBuildPeer {
  name: string;
  hostname: string;
  port: number;
  source: RemoteBuildPeerSource;
  addresses: string[];
  server_version: string;
  esphome_version: string;
}

/**
 * Receiver's stable identity, returned from
 * ``remote_build/get_identity`` and ``remote_build/rotate_identity``.
 *
 * The cert + key PEMs are intentionally NOT included — only the
 * SPKI fingerprint (``pin_sha256``, lowercase hex SHA-256 of the
 * SubjectPublicKeyInfo) is safe to ship, and it's what an
 * offloader pins against anyway. ``listener_bound`` reports
 * whether the ``/remote-build/v1/*`` HTTPS site is currently
 * serving traffic; lets the Settings UI distinguish "rotation
 * succeeded AND the listener is back up" from "rotation
 * succeeded but the rebuild fail-softed; check logs".
 */
export interface IdentityView {
  dashboard_id: string;
  pin_sha256: string;
  server_version: string;
  esphome_version: string;
  listener_bound: boolean;
}

/**
 * Args for ``remote_build/add_token``.
 *
 * **The cleartext bearer is generated client-side** (see
 * ``mintRemoteBuildBearer``). The frontend POSTs only the
 * SHA-256 hash of the secret half; the cleartext never crosses
 * the wire to the backend. This closes the leak that would
 * otherwise occur on plain-HTTP standalone deployments where
 * the main port carries the WS API in cleartext.
 *
 * Type alias rather than ``interface`` so it satisfies
 * ``Record<string, unknown>`` at the ``sendCommand`` call site;
 * named interfaces lose the index-signature compatibility a
 * structurally-typed object literal has, which would otherwise
 * force a defensive ``{ ...args }`` spread that no other
 * remote-build wrapper uses.
 */
export type AddRemoteBuildTokenArgs = {
  /** Display label, 1-128 chars. Duplicates allowed; ``token_id`` is the unique key. */
  label: string;
  /** Client-generated, exactly 11 base64url chars (8 random bytes encoded). */
  token_id: string;
  /** Lowercase hex SHA-256 of the cleartext secret half (64 chars). */
  secret_sha256: string;
};

/**
 * Data payload for the ``remote_build_binding_mismatch`` event.
 *
 * Fires when an authenticated ``/remote-build/v1/*`` request's
 * ``X-Dashboard-ID`` doesn't match the token's bound value.
 * ``race_loss`` distinguishes a concurrent first-use bind that
 * lost the race (likely an operator pasted the cleartext into
 * two offloaders by mistake; soften the wording) from a hit on
 * an already-bound token (more suspicious — stolen bearer or
 * paste-into-wrong-machine; loud wording with an inline revoke
 * CTA).
 */
export interface RemoteBuildBindingMismatchEventData {
  token_id: string;
  presented_dashboard_id: string;
  bound_dashboard_id: string;
  peer_ip: string;
  race_loss: boolean;
}

/**
 * Data payload for the ``remote_build_identity_rotated`` event.
 *
 * Fires when the operator triggers ``rotate_identity``. Lets the
 * Settings UI refresh its cached pin without polling
 * ``get_identity`` (the dashboard might've been rotated from
 * another tab, or via the WS API directly). Only the rotated
 * fields are carried; ``server_version`` and
 * ``esphome_version`` don't change on rotation, and the
 * ``listener_bound`` state is best read via a fresh
 * ``get_identity`` call on the receiving tab.
 */
export interface RemoteBuildIdentityRotatedEventData {
  dashboard_id: string;
  pin_sha256: string;
}
