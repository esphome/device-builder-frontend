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
  /** Receiver reachable, but the operation can't proceed in the
   *  current state — pin mismatch on ``request_pair`` (TOCTOU
   *  between preview and confirm), receiver-side ``REJECTED``,
   *  etc. Distinct from ``UNAVAILABLE`` (transport failure). */
  PRECONDITION_FAILED = "precondition_failed",
  /** Transport / handshake / decode failure on a peer-link
   *  round-trip. The receiver was unreachable or the Noise
   *  handshake didn't complete cleanly — distinct from
   *  ``PRECONDITION_FAILED`` where the receiver explicitly
   *  rejected the operation. */
  UNAVAILABLE = "unavailable",
  /** Receiver-side pairing window is closed.
   *  ``request_pair`` raises this when the receiver admin
   *  hasn't opened the Pairing requests screen — UI should
   *  prompt the user to coordinate with the receiver admin. */
  NO_PAIRING_WINDOW = "no_pairing_window",
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
  /**
   * When True frontend collapses this entry under an "Advanced" section.
   *
   * Sourced from upstream ESPHome's `Visibility.ADVANCED` schema
   * kwarg (esphome/esphome#16267) when the field author marked
   * it explicitly, or pushed down by the catalog generator's
   * cascade pass when an ancestor is `Visibility.ADVANCED` or
   * stricter. The device-builder catalog's name-based heuristic
   * is the fallback for fields the schema doesn't yet annotate;
   * as upstream adoption grows, the heuristic shrinks toward
   * zero.
   */
  advanced: boolean;
  /**
   * When True frontend hides the entry entirely.
   *
   * Sourced from upstream ESPHome's `Visibility.YAML_ONLY`
   * schema kwarg (esphome/esphome#16267). Marks fields the user
   * shouldn't edit through a visual editor; e.g.
   * `setup_priority` on every component, where casual UI-driven
   * tweaks can break boot. The YAML escape hatch stays
   * available for the rare power-user override. Also pushed down
   * by the catalog generator's cascade pass when an ancestor is
   * `Visibility.YAML_ONLY`: a hidden parent takes its
   * descendants with it (otherwise the editor would render an
   * unrooted control with no surrounding context).
   */
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

// ─── Automations ─────────────────────────────────────────────
//
// Automation catalog and round-trip shape. Every trigger / action /
// condition / light-effect carries its parameter schema as
// ``ConfigEntry[]`` — exactly the same shape the component form
// renderer already speaks — so the automation editor reuses the
// existing form pipeline (id pickers, pin pickers, depends-on
// cascades, advanced toggle, validation) without inventing parallel
// machinery.
//
// The backend owns YAML parse/write; the frontend exchanges
// ``AutomationTree`` blobs and applies a ``YamlDiff`` to the editor
// pane on each save.

/** A trigger that can start an automation. */
export interface AutomationTrigger {
  id: string;                  // "on_press", "binary_sensor.on_click", "on_boot"
  name: string;                // "On Press"
  description: string;
  docs_url: string;
  /** Platform types this trigger applies to (``["binary_sensor"]``).
   *  Empty list = device-level (``on_boot``, ``on_loop``,
   *  ``on_shutdown``) — always available regardless of which
   *  components are configured. */
  applies_to: string[];
  is_device_level: boolean;
  /** Parameter schema (e.g. ``on_click`` has ``min_length`` /
   *  ``max_length`` time-period fields). */
  config_entries: ConfigEntry[];
}

/** An action that can run inside an automation. */
export interface AutomationAction {
  id: string;                  // "light.turn_on", "delay", "if", "lambda"
  name: string;
  description: string;
  docs_url: string;
  domain: string;              // "light", "core" for built-ins
  config_entries: ConfigEntry[];
  /** True for ``if`` / ``while`` / ``repeat`` / ``wait_until`` —
   *  the action embeds nested action lists addressed by the keys in
   *  ``accepts_action_list``. */
  is_control_flow: boolean;
  has_else_branch: boolean;
  /** Names of fields whose value is itself a list of actions
   *  (``["then"]`` for ``while``, ``["then", "else"]`` for ``if``).
   *  These are stripped from ``config_entries`` server-side so the
   *  frontend renders them as recursive action lists, not as form
   *  fields. */
  accepts_action_list: string[];
}

/** A condition usable inside an automation's ``if`` / ``while`` /
 *  ``wait_until`` action, or as a trigger gate. */
export interface AutomationCondition {
  id: string;                  // "binary_sensor.is_on", "and", "lambda"
  name: string;
  description: string;
  docs_url: string;
  domain: string;              // "binary_sensor", "core"
  config_entries: ConfigEntry[];
  /** True for ``and`` / ``or`` / ``all`` / ``any`` / ``not`` /
   *  ``xor`` — the condition embeds a recursive list of child
   *  conditions. */
  accepts_condition_list: boolean;
}

/** A light effect (``pulse``, ``flicker``, ``addressable_lambda``…).
 *  Each effect is itself a registry entry with its own parameter
 *  schema. Surfaced through a separate editor surface because the
 *  list ergonomics differ from actions (effects compose into a list
 *  on a single ``light`` block; actions form a tree). */
export interface LightEffect {
  id: string;                  // "pulse", "flicker", "addressable_lambda"
  name: string;
  config_entries: ConfigEntry[];
  /** Light platform types this effect is valid on
   *  (``["light.binary"]``, ``["light.addressable_rgb"]``…). */
  applies_to: string[];
}

/** Tagged-union locator for an automation inside a device YAML.
 *  Mirrors the backend's ``AutomationLocation`` Python dataclass.
 *  ``parse`` returns these and ``upsert`` / ``delete`` consume them
 *  so the writer knows exactly which YAML range to splice. */
export type AutomationLocation =
  | { kind: "script"; id: string }
  | { kind: "interval"; index: number }
  | { kind: "component_on"; component_id: string; trigger: string }
  | { kind: "device_on"; trigger: string }
  | { kind: "light_effect"; component_id: string; index: number }
  | { kind: "api_action"; action_name: string };

/** A single action inside an automation tree. ``children`` carries
 *  nested action lists for control-flow actions, keyed by the
 *  action's ``accepts_action_list`` entries (e.g.
 *  ``{ then: [...], else: [...] }`` for ``if``). ``conditions`` is
 *  populated only for ``if`` (the boolean gate) — other control-flow
 *  actions have their gate elsewhere. */
export interface ActionNode {
  action_id: string;
  params: Record<string, unknown>;
  children?: Record<string, ActionNode[]>;
  conditions?: ConditionNode[];
}

/** A single condition inside an ``if`` / ``while`` / ``wait_until``.
 *  ``children`` is populated only when the condition's ``accepts_-
 *  condition_list`` is true (``and`` / ``or`` / ``not`` / ...). */
export interface ConditionNode {
  condition_id: string;
  params: Record<string, unknown>;
  children?: ConditionNode[];
}

/** The full structured form of one automation. ``trigger_id`` is
 *  ``null`` for top-level ``script:`` / ``interval:`` blocks (which
 *  carry no trigger key in YAML — the block kind is implied by the
 *  ``AutomationLocation``).
 *
 *  Note: ESPHome triggers don't carry a top-level boolean gate.
 *  Conditional execution is expressed inline as an ``if`` action
 *  (or ``while`` / ``wait_until``) inside ``actions`` — those nodes
 *  carry their own ``conditions`` field. There is intentionally no
 *  ``conditions`` field at this level. */
export interface AutomationTree {
  trigger_id: string | null;
  trigger_params: Record<string, unknown>;
  actions: ActionNode[];
}

/** What ``automations/parse`` returns for each existing automation
 *  detected in the device YAML. ``raw_yaml`` is retained so the
 *  editor can fall back to a read-only YAML view when an automation
 *  references a non-catalog action id. */
export interface ParsedAutomation {
  location: AutomationLocation;
  /** Display label for the navigator (e.g. ``"Living room button →
   *  on_press"`` or ``"Script: morning_alarm"``). */
  label: string;
  automation: AutomationTree;
  /** 1-indexed CodeMirror line ranges so the navigator can map a
   *  click to the right YAML window without re-parsing. */
  from_line: number;
  to_line: number;
  /** Verbatim YAML the parse came from — used for the round-trip
   *  safety check and as a read-only fallback when the structured
   *  form is unrecoverable. */
  raw_yaml: string;
}

/** Splice instruction returned by ``automations/upsert`` and
 *  ``automations/delete``. Identical shape to the diffs the existing
 *  component flow uses, so the device-editor's optimistic-update
 *  path applies them through the same machinery. */
export interface YamlDiff {
  fromLine: number;
  toLine: number;
  replacement: string;
}

/** Marker shape stored in ``params`` values to distinguish a
 *  ``!lambda |- ...`` block from a literal string. Used wherever a
 *  ``ConfigEntry`` has ``templatable: true`` and the user picked the
 *  lambda branch of the literal/lambda toggle. The backend writer
 *  emits this as a ruamel ``LiteralScalarString`` with ``|-`` style;
 *  the parser inverts. */
export interface LambdaValue {
  _lambda: string;
}

/** Type guard for ``LambdaValue``. */
export function isLambdaValue(v: unknown): v is LambdaValue {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)._lambda === "string"
  );
}

/** Return shape of ``automations/get_available`` — context-aware
 *  catalog scoped to a single device's YAML. ``triggers`` is
 *  filtered to component types present in the config + device-level
 *  triggers; ``actions`` / ``conditions`` are returned in full
 *  (id-pickers filter on the frontend). ``scripts`` and ``devices``
 *  feed action-parameter dropdowns: ``script.execute`` needs the
 *  declared script ids (plus their ``parameters:``), and
 *  ``switch.turn_on`` / ``light.turn_on`` / etc. need the configured
 *  component instance ids of the right domain. */
export interface AvailableAutomations {
  triggers: AutomationTrigger[];
  actions: AutomationAction[];
  conditions: AutomationCondition[];
  scripts: AvailableScript[];
  devices: AvailableComponentInstance[];
}

export interface AvailableScript {
  id: string;
  /** Declared script parameters (``parameters: pin: int``) so
   *  ``script.execute`` can render a dynamic param form for the
   *  selected script. */
  parameters: AvailableScriptParameter[];
}

export interface AvailableScriptParameter {
  name: string;
  /** ESPHome parameter type (``int``, ``float``, ``bool``,
   *  ``string``). Treated as opaque on the frontend — the action
   *  form just renders the matching primitive input. */
  type: string;
}

export interface AvailableComponentInstance {
  /** Catalog component id (``switch.gpio``, ``light.binary``). */
  component_id: string;
  /** The configured ``id:`` value from YAML. */
  id: string;
  /** The configured ``name:`` value, if any (purely for display). */
  name?: string;
}

// ─── Config / System ─────────────────────────────────────────

export interface SerialPort {
  port: string;
  desc: string;
}

/**
 * Result of ``config/detect_chip`` — backend ran esptool against a
 * server-side serial port and identified what's connected. Mirrors
 * what the WebSerial path returns from ``detectChip`` +
 * ``readDeviceManifest`` so the wizard can route both branches
 * the same way.
 *
 * ``chip_family`` is the human-readable family string and matches
 * one of the ``WIZARD_BOARD_PLATFORMS.label`` values — callers
 * hand it straight to ``_selectedFilter`` to narrow the board
 * picker.
 *
 * ``board_id`` comes from ``esp_app_desc_t.project_name`` (the
 * CMake project name baked in at build time). Present only when
 * the device is running an IDF app whose descriptor parses
 * cleanly; routes the wizard to a specific catalogue board.
 */
export interface DetectChipResult {
  chip_family: string;
  variant: string;
  platform: string;
  board_id?: string;
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

/** Output stream discriminator on a single line of build output. */
export enum JobStream {
  STDOUT = "stdout",
  STDERR = "stderr",
}

/** Subset of {@link JobType} the remote-build submit_job WS arg accepts. */
export type RemoteBuildSubmitTarget = JobType.COMPILE | JobType.UPLOAD;

/** Where the bytes for a firmware build come from.
 *
 *  Mirrors the backend's ``JobSource`` StrEnum (7a-2a). ``LOCAL`` is
 *  a build this dashboard's CPU ran; ``REMOTE`` is a build a paired
 *  receiver ran and the offloader fetched the artifacts from. The
 *  install dialog reads ``FirmwareJob.source_label`` to render a
 *  "Building on {receiver_label}" sub-line when ``source ===
 *  REMOTE``. */
export enum JobSource {
  LOCAL = "local",
  REMOTE = "remote",
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
  /** Where the build's bytes come from (7a-2a). Defaults to LOCAL
   *  for jobs from before this field landed; jobs the install
   *  handler routed to a paired receiver via ``pick_build_path``
   *  (7a-3) carry ``REMOTE``. */
  source: JobSource;
  /** Machine-readable handle on the receiver that compiled the job
   *  when ``source === REMOTE`` — matches the StoredPairing's
   *  ``pin_sha256``. Empty string for LOCAL jobs. The runner uses
   *  this to route ``cancel_job`` / ``download_artifacts`` against
   *  the right peer-link client. */
  source_pin_sha256: string;
  /** Display label for the paired receiver that compiled the job,
   *  when ``source === REMOTE``. Empty string for LOCAL jobs.
   *  Snapshot of the pairing's label at job-creation time — doesn't
   *  track later renames (the install dialog should show what the
   *  user saw when they clicked Install). */
  source_label: string;
  /** Receiver's bundled ``esphome`` version at job-creation time,
   *  snapshotted from the pairing's last-known
   *  ``esphome_version``. Empty for LOCAL jobs and for REMOTE jobs
   *  whose pairing hadn't yet completed a peer-link session. The
   *  install dialog renders this next to ``source_label`` so the
   *  operator can spot a version skew between the offloader and
   *  the receiver actually compiling the firmware. */
  source_esphome_version: string;
  /** Offloader's ``dashboard_id`` when this job came in via the
   *  peer-link ``submit_job`` flow. Empty for locally-submitted
   *  jobs. Receiver-side rendering surfaces this as a "from
   *  <peer>" sub-line on the firmware-tasks dialog so a
   *  build-server admin can distinguish their own work from
   *  delegated builds. */
  remote_peer: string;
  /** Display label for the offloader, snapshotted from the
   *  receiver's ``_approved_peers[dashboard_id].label`` at submit
   *  time. Empty for locally-submitted jobs and for jobs from
   *  before this field landed; the receiver-side renderer falls
   *  back to the raw ``remote_peer`` dashboard_id when empty.
   *  Symmetric to ``source_label`` on the offloader side. */
  remote_peer_label: string;
  /** The submitting device's ``esphome.name`` (machine handle),
   *  sent by the offloader on the ``submit_job`` header. Empty
   *  for locally-submitted jobs and for jobs whose offloader
   *  didn't set the NotRequired wire field. The receiver-side
   *  title surface uses this when ``remote_peer !== ""`` since
   *  the receiver has no Device list of its own to look the
   *  friendly name up against. */
  device_name: string;
  /** The submitting device's ``esphome.friendly_name`` (display
   *  string), sent by the offloader on the ``submit_job`` header.
   *  Empty for locally-submitted jobs, for jobs whose offloader
   *  didn't set the NotRequired wire field, or for YAMLs that
   *  don't define ``esphome.friendly_name``. The receiver-side
   *  title surface prefers this over ``device_name`` when set. */
  device_friendly_name: string;
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
  // Remote-build events.
  REMOTE_BUILD_IDENTITY_ROTATED = "remote_build_identity_rotated",
  REMOTE_BUILD_PAIR_REQUEST_RECEIVED = "remote_build_pair_request_received",
  REMOTE_BUILD_PAIR_STATUS_CHANGED = "remote_build_pair_status_changed",
  REMOTE_BUILD_PAIRING_WINDOW_CHANGED = "remote_build_pairing_window_changed",
  // Offloader-side counterpart to ``REMOTE_BUILD_PAIR_STATUS_CHANGED``;
  // fires from the offloader's pair-status listener task and from
  // ``remote_build/unpair``.
  OFFLOADER_PAIR_STATUS_CHANGED = "offloader_pair_status_changed",
  // Receiver-side peer-link session lifecycle. Fired by the
  // receiver's ``register_peer_link_session`` /
  // ``unregister_peer_link_session`` hooks when a 5a-2 offloader
  // client connects / disconnects. Drives the
  // ``PeerSummary.connected`` indicator on the receiver-side
  // Paired senders list. Payload is just the ``dashboard_id``;
  // the matching row is found by lookup against
  // ``_buildServerPeers``.
  RECEIVER_PEER_LINK_SESSION_OPENED = "receiver_peer_link_session_opened",
  RECEIVER_PEER_LINK_SESSION_CLOSED = "receiver_peer_link_session_closed",
  // Offloader-side peer-link session lifecycle. Fired by the
  // offloader's long-lived PeerLinkClient when its Noise WS
  // to the receiver enters / leaves the post-handshake parked
  // state. Drives the PairingSummary.connected indicator on
  // the offloader-side Paired-build-servers list. Both events
  // share the same OffloaderPeerLinkSessionEventData shape;
  // the discriminator is the event type itself.
  OFFLOADER_PEER_LINK_OPENED = "offloader_peer_link_opened",
  OFFLOADER_PEER_LINK_CLOSED = "offloader_peer_link_closed",
  // Offloader-side remote-build job lifecycle. Fired by the
  // offloader's PeerLinkClient receive loop when an inbound
  // job_state_changed / job_output frame lands from the
  // paired receiver this dashboard submitted the job to. The
  // offloader doesn't own a FirmwareJob row for these (the
  // receiver runs the build); it just fans the wire frames
  // onto its local bus so subscribe_events re-broadcasts to
  // frontend tabs. Settings dialog's Send-builds section
  // consumes both to render the live progress drawer per
  // in-flight remote job: STATE_CHANGED drives the lifecycle
  // pill (queued / running / completed / failed / cancelled),
  // OUTPUT appends each per-line stdout / stderr chunk to the
  // ansi-log buffer. Phase 5c-3 wired the backend.
  OFFLOADER_JOB_STATE_CHANGED = "offloader_job_state_changed",
  OFFLOADER_JOB_OUTPUT = "offloader_job_output",
  // mDNS-discovered peer dashboards. Replaces the deleted
  // ``remote_build/list_hosts`` WS command — the controller fires
  // these events as its mDNS browser callback resolves /
  // forgets entries, and the ``subscribe_events`` initial-state
  // push carries the current set under ``hosts`` so a fresh tab
  // paints without a round-trip.
  REMOTE_BUILD_HOST_ADDED = "remote_build_host_added",
  REMOTE_BUILD_HOST_REMOVED = "remote_build_host_removed",
  // Offloader-side pair alerts. Backend's pair-status listener
  // fires PIN_MISMATCH (the receiver's static X25519 pubkey
  // hash drifted from the stored ``StoredPairing.pin_sha256``)
  // or PEER_REVOKED (the receiver returned ``rejected``) when
  // a pair-status round-trip resolves a broken pairing. ALERT
  // _DISMISSED fires when the alert clears via re-pair (auto-
  // resolved by ``request_pair`` succeeding for the same
  // ``${hostname}:${port}``) or ``unpair``. There is no
  // operator-driven dismiss — clicking "OK got it" without
  // acting would just hide a broken pairing the next peer-
  // link session would still fail against. Late-subscribers
  // pick up missed alerts via
  // ``subscribe_events.initial_state.offloader_alerts``.
  OFFLOADER_PAIR_PIN_MISMATCH = "offloader_pair_pin_mismatch",
  OFFLOADER_PAIR_PEER_REVOKED = "offloader_pair_peer_revoked",
  OFFLOADER_PAIR_ALERT_DISMISSED = "offloader_pair_alert_dismissed",
  // 7b — offloader Settings UI toggles for the transparent
  // install flow. ``OFFLOADER_REMOTE_BUILDS_TOGGLED`` fires when
  // the dashboard-wide "Remote builds enabled" master switch
  // flips; ``OFFLOADER_PAIRING_ENABLED_CHANGED`` fires when one
  // pairing's per-row enable switch flips. Both are emitted by
  // the matching WS setters (``remote_build/set_offloader_settings``
  // and ``remote_build/set_pairing_enabled``) so other open tabs
  // sync their switch state without polling.
  OFFLOADER_REMOTE_BUILDS_TOGGLED = "offloader_remote_builds_toggled",
  OFFLOADER_PAIRING_ENABLED_CHANGED = "offloader_pairing_enabled_changed",
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
  /** Offloader-side pairings snapshot the backend pushes once at
   *  subscribe time so the Send-builds initial paint matches what
   *  ``OFFLOADER_PAIR_STATUS_CHANGED`` events will subsequently
   *  mutate against. Carries both PENDING and APPROVED rows from
   *  the controller's in-RAM ``_pairings`` dict (sync read; no
   *  wire calls, no disk I/O). Optional because not every
   *  dashboard has a remote-build controller wired up — when
   *  the controller is absent the field is omitted entirely
   *  rather than sent as an empty list. */
  pairings?: PairingSummary[];
  /** Receiver-side peers snapshot. Carries both PENDING (in the
   *  receiver's in-memory ``_pending_peers`` dict, awaiting
   *  Accept / Reject) and APPROVED (persisted) rows. Live updates
   *  flow through the same ``subscribe_events`` stream as
   *  ``REMOTE_BUILD_PAIR_REQUEST_RECEIVED`` (upsert),
   *  ``REMOTE_BUILD_PAIR_STATUS_CHANGED`` (status flip / row
   *  drop) events. Optional for the same reason as
   *  ``pairings`` — absent controller, omitted field. */
  peers?: PeerSummary[];
  /** Receiver-side mDNS-discovered hosts snapshot. RAM-only on
   *  the backend; a sibling-of-RAM map populated by the
   *  ``_esphomebuilder._tcp.local.`` browser callback. Replaces
   *  the deleted ``remote_build/list_hosts`` command. Live
   *  updates flow through ``REMOTE_BUILD_HOST_ADDED`` (upsert
   *  by ``name``) and ``REMOTE_BUILD_HOST_REMOVED`` (drop by
   *  ``name``). Optional for the same reason as ``pairings`` /
   *  ``peers`` — absent controller, omitted field. */
  hosts?: RemoteBuildPeer[];
  /** Offloader-side pair alerts snapshot. RAM-only on the
   *  backend; populated when ``OFFLOADER_PAIR_PIN_MISMATCH`` /
   *  ``OFFLOADER_PAIR_PEER_REVOKED`` fires and cleared when
   *  ``OFFLOADER_PAIR_ALERT_DISMISSED`` fires. The two
   *  resolution paths (re-pair / unpair) auto-fire the
   *  dismissed event; there is no operator-driven dismiss
   *  surface. Late-subscribing clients pick up alerts that
   *  fired before they connected via this snapshot. Optional
   *  for the same reason as ``pairings`` / ``peers`` —
   *  absent controller, omitted field. */
  offloader_alerts?: OffloaderAlertSnapshotEntry[];
  /** Offloader-side in-flight remote-build jobs snapshot.
   *  RAM-only on the backend; populated as
   *  ``OFFLOADER_JOB_STATE_CHANGED`` events upsert rows by
   *  ``job_id`` and dropped when a terminal event (completed /
   *  failed / cancelled) fires. Lets a tab subscribing AFTER
   *  a ``running`` transition (page reload mid-build, second
   *  tab opened after dispatch) repaint the live build
   *  without waiting for the next event. Output buffer isn't
   *  in the snapshot — the receiver doesn't replay; the next
   *  ``OFFLOADER_JOB_OUTPUT`` line repopulates from the
   *  point-of-subscribe forward. Display fields
   *  (configuration / target / receiver_label) aren't carried
   *  either — the receiver doesn't echo them, so reload-time
   *  rows show empty strings until terminal (the dialog's
   *  re-attach view tolerates them). Optional for the same
   *  reason as ``pairings`` / ``peers`` — absent controller,
   *  omitted field. */
  remote_jobs?: OffloaderRemoteJobSnapshotEntry[];
  /** Offloader-side master "Remote builds enabled" toggle (7b).
   *  When `false`, the backend's ``pick_build_path`` short-
   *  circuits every install to LOCAL; paired peer-link
   *  sessions stay open and the Send-builds power-user dialog
   *  still works — only the implicit auto-route is gated.
   *  Live updates flow through
   *  ``OFFLOADER_REMOTE_BUILDS_TOGGLED`` events. Optional for
   *  the same reason as ``pairings`` / ``peers`` — absent
   *  controller, omitted field. Defaults to `true` on a fresh
   *  install (matches the pre-7b semantic where any APPROVED
   *  + connected + idle pairing was eligible). */
  remote_builds_enabled?: boolean;
}

/**
 * Snapshot row in the offloader-side in-flight remote-build
 * jobs cache. Mirror of the backend's
 * :class:`OffloaderRemoteJobSnapshotEntry` TypedDict (see
 * ``models/remote_build.py``). Carries enough to render the
 * lifecycle pill on a late-subscribing tab; display fields
 * (configuration / target / receiver_label) and the output
 * buffer are deliberately absent — the receiver doesn't echo
 * the display fields back through the wire, and the output
 * buffer would balloon the snapshot for any in-flight build.
 */
export interface OffloaderRemoteJobSnapshotEntry {
  receiver_hostname: string;
  receiver_port: number;
  pin_sha256: string;
  job_id: string;
  status: JobStatus;
  error_message: string;
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
// Phase 3c1: receiver dashboard identity + X25519 keypair rotation.
// Phase 4a: Noise XX peer-link replaces the bearer-token surface;
//           offloader-side pair flow + receiver-side pairing inbox.

/**
 * Origin of a discovered :class:`RemoteBuildPeer`. Collapsed to a
 * single ``"mdns"`` value after the manual-hosts surface was
 * deleted (the offloader-side pair flow accepts a typed hostname
 * + port directly without an intermediate "save" step). The
 * single-value union is kept rather than removed because the
 * backend's ``RemoteBuildPeer.source`` field still discriminates
 * for forward-compat (e.g. a future "configured" / "static"
 * source).
 */
export type RemoteBuildPeerSource = "mdns";

/**
 * Lifecycle position of a paired (or pending) peer / pairing.
 *
 * Mirrors the backend's ``PeerStatus`` StrEnum. ``pending`` rows
 * land via the pair_request flow and live in-memory only on the
 * receiver (admin hasn't accepted yet); ``approved`` rows are
 * persisted and grant full peer-link access. There is no
 * explicit ``rejected`` terminal state — Reject deletes the row.
 */
export type PeerStatus = "pending" | "approved";

/**
 * Receiver-side wire view of a paired offloader (``StoredPeer``).
 *
 * Drops the raw 32-byte X25519 pubkey; ``pin_sha256`` is the
 * wire-friendly form (lowercase-hex SHA-256 of the pubkey)
 * that UIs render for OOB-verification. ``status`` is supplied
 * by the controller because the receiver-side ``StoredPeer``
 * itself doesn't carry one (PENDING peers live in the
 * controller's in-memory dict; persisted peers are implicitly
 * APPROVED). ``peer_ip`` is the source IP observed at
 * pair_request time and persisted on ``StoredPeer``; the
 * receiver Settings inbox renders it next to the pin so the
 * operator can clone-risk-sanity-check the source against
 * expectations. Empty string for legacy on-disk rows from
 * receivers that pre-date the persisted ``peer_ip`` field —
 * the renderer hides the row line in that case.
 */
export interface PeerSummary {
  dashboard_id: string;
  pin_sha256: string;
  label: string;
  paired_at: number;
  status: PeerStatus;
  peer_ip: string;
  /**
   * Whether the receiver currently has an active 5a-2 peer-link
   * session for this peer (``dashboard_id`` membership in the
   * receiver's ``_peer_link_sessions`` registry). Legacy
   * backends that pre-date the field may omit it; in that case,
   * the renderer treats the missing value as falsy and shows
   * "Disconnected" rather than crashing.
   *
   * Live updates flow through
   * ``RECEIVER_PEER_LINK_SESSION_OPENED`` /
   * ``RECEIVER_PEER_LINK_SESSION_CLOSED`` bus events on the
   * ``subscribe_events`` stream; the snapshot
   * (``initial_state.peers``) carries the current value at
   * subscribe time so a reconnecting tab paints the right
   * state without waiting for the next event.
   *
   * Always ``false`` for PENDING rows: peer-link is gated on
   * APPROVED status server-side via ``lookup_peer_for_session``,
   * so a PENDING peer can never legitimately have a registered
   * session.
   */
  connected: boolean;
}

/**
 * Offloader-side wire view of a pinned receiver
 * (``StoredPairing``).
 *
 * Mirror of ``PeerSummary`` for the offloader side: drops the
 * raw X25519 pubkey, keys on the receiver coordinates the user
 * entered (rather than the receiver's ``dashboard_id``, which
 * the offloader doesn't track). ``status`` reflects the
 * row's lifecycle in the unified ``_pairings`` dict on the
 * controller; the disk filter strips PENDING rows at serialise
 * time so APPROVED is the on-disk shape.
 */
export interface PairingSummary {
  receiver_hostname: string;
  receiver_port: number;
  pin_sha256: string;
  label: string;
  paired_at: number;
  status: PeerStatus;
  /**
   * Whether the offloader currently has an open 5a-2 peer-link
   * session to the receiver (pin_sha256 membership in the
   * controller's _open_peer_links set). Live updates flow
   * through OFFLOADER_PEER_LINK_OPENED /
   * OFFLOADER_PEER_LINK_CLOSED bus events on the
   * subscribe_events stream; the snapshot
   * (initial_state.pairings) carries the current value at
   * subscribe time so a reconnecting tab paints the right state
   * without waiting for the next event.
   *
   * Always false for PENDING rows: the offloader doesn't spawn
   * a peer-link client until the receiver flips the row to
   * APPROVED.
   */
  connected: boolean;
  /**
   * Whether the offloader's per-pairing peer-link client task
   * is alive but has no open session right now. Covers the
   * very first connect attempt and every subsequent reconnect
   * cycle inside the run loop's backoff window. Goes false on
   * `connected` (post-handshake open) and on the orphan paths
   * (pin mismatch / superseded) where the run loop won't retry
   * — operator's recovery there is re-pair / unpair, not
   * "wait for reconnect," so both `connected` and `connecting`
   * report false on those states.
   *
   * UI uses the tri-state to render Connected / Connecting… /
   * Disconnected; pair an empty `last_connect_error` with
   * `connecting=true` and the row is the steady-state
   * reconnect cycle, while a non-empty error there + both
   * flags false is the orphaned terminal case.
   */
  connecting: boolean;
  /**
   * One-line description of the most recent connection failure
   * (`"<ExceptionType>: <message>"` for transport / Noise
   * errors, `"auth rejected"`, `"pin mismatch"`). Cleared when
   * a session reaches the post-handshake open state so a
   * stale message can't outlive a successful reconnect.
   *
   * Live updates ride on `OFFLOADER_PEER_LINK_CLOSED.error_detail`;
   * the snapshot here is the post-load value for tabs that
   * subscribe after an in-flight failure.
   */
  last_connect_error: string;
  /**
   * Receiver-advertised `esphome.const.__version__` captured
   * at handshake time and refreshed on every peer-link
   * session-open. Empty string before the first successful
   * handshake (PENDING row, or APPROVED row that has never
   * connected). Used by Settings → Build server → paired
   * build servers to surface a per-row version-mismatch
   * sub-line ahead of the scheduler's
   * allow-major-version-mismatch toggle landing in 7a-3 +
   * 7b. Both sides are wire-typed `string`; comparison is
   * structural (year+month vs patch) per
   * `util/version-mismatch.ts`.
   */
  esphome_version: string;
  /**
   * Whether this pairing is eligible for the transparent
   * install flow's auto-route to remote build (7b). When
   * `false`, the backend's `pick_build_path` walks past
   * this row and looks for the next eligible APPROVED +
   * connected + idle pairing; if none exist the install
   * falls back to LOCAL. The peer-link session stays open
   * regardless and the Send-builds power-user dialog still
   * works against this receiver — only the implicit
   * auto-route is gated. Live updates flow through
   * `OFFLOADER_PAIRING_ENABLED_CHANGED` events.
   *
   * Defaults to `true` for back-compat with pre-7b
   * sidecars (any APPROVED + connected + idle pairing was
   * eligible).
   */
  enabled: boolean;
}

/**
 * Receiver-side pairing-window state.
 *
 * Returned from ``remote_build/set_pairing_window`` and
 * delivered as the ``remote_build_pairing_window_changed``
 * event payload. The window narrows when ``intent="pair_request"``
 * Noise frames are accepted: only while the receiver's Pairing
 * requests screen is mounted. ``expires_in_seconds`` is
 * ``null`` when ``open`` is ``false``; otherwise it's the
 * remaining lifetime against the latest activity-driven extend
 * (frontend renders the live countdown from this value and ticks
 * locally between events).
 */
export interface PairingWindowState {
  open: boolean;
  expires_in_seconds: number | null;
}

/**
 * Wire view returned from ``remote_build/get_offloader_settings``
 * and ``remote_build/set_offloader_settings`` (7b).
 *
 * Bundles the master ``remote_builds_enabled`` toggle with the
 * pairings list so the offloader Settings UI's first paint
 * reads everything it needs from one round-trip. Subsequent
 * live updates flow through ``OFFLOADER_REMOTE_BUILDS_TOGGLED``
 * / ``OFFLOADER_PAIRING_ENABLED_CHANGED`` /
 * ``OFFLOADER_PAIR_STATUS_CHANGED`` events on the global
 * ``subscribe_events`` stream.
 */
export interface OffloaderRemoteBuildSettings {
  remote_builds_enabled: boolean;
  pairings: PairingSummary[];
}

export interface RemoteBuildSettings {
  enabled: boolean;
  /**
   * 6c cleanup-sweep cold-subtree threshold (seconds). Backend
   * defaults to 24h and clamps writes to [1h, 30d] via the
   * `remote_build/set_settings` validator. The UI renders this
   * as hours; the conversion lives at the input boundary so
   * the wire shape stays a single primitive.
   */
  cleanup_ttl_seconds: number;
  /** Receiver-side pinned offloaders. Includes both PENDING (in
   *  the receiver's ``_pending_peers`` dict) and APPROVED
   *  (persisted) rows, projected through ``PeerSummary``. */
  peers: PeerSummary[];
}

/**
 * Bounds for {@link RemoteBuildSettings.cleanup_ttl_seconds}.
 * Mirror the backend's `MIN_CLEANUP_TTL_SECONDS` /
 * `MAX_CLEANUP_TTL_SECONDS` constants so the UI input clamps to
 * the same range and the operator gets a client-side validation
 * hint before the WS round-trip.
 */
export const CLEANUP_TTL_MIN_SECONDS = 60 * 60;
export const CLEANUP_TTL_MAX_SECONDS = 30 * 24 * 60 * 60;
export const CLEANUP_TTL_DEFAULT_SECONDS = 24 * 60 * 60;

export interface RemoteBuildPeer {
  name: string;
  hostname: string;
  port: number;
  source: RemoteBuildPeerSource;
  addresses: string[];
  server_version: string;
  esphome_version: string;
  /**
   * SHA-256 of the receiver's static X25519 peer-link pubkey,
   * lowercase hex, parsed off the mDNS TXT record. Empty string
   * for receivers that haven't bound the peer-link listener at
   * announce time (default-off mode). The offloader's mDNS
   * auto-rebind path matches this against persisted pairings;
   * the discovered-row Pair button doesn't read it (the wizard
   * runs `preview_pair` against the chosen endpoint and OOBs
   * the live fingerprint).
   */
  pin_sha256: string;
  /**
   * Receiver's peer-link Noise WS port from the TXT
   * `remote_build_port` key, NOT the SRV-advertised dashboard
   * HTTP port (`port` above). The discovered-row Pair button
   * pre-fills this into the wizard so operators on a non-default
   * `--remote-build-port` don't have to retype it on every pair.
   * `0` for receivers that haven't bound the peer-link listener
   * yet; the wizard falls back to its 6055 default in that case.
   */
  remote_build_port: number;
}

/**
 * Receiver's stable identity, returned from
 * 'remote_build/get_identity' and 'remote_build/rotate_identity'.
 *
 * The X25519 private key is intentionally NOT included -- only
 * the public-key fingerprint ('pin_sha256', lowercase-hex
 * SHA-256 of the X25519 public key) is safe to ship, and it's
 * what a peer pins against during the Noise XX handshake.
 * 'listener_bound' reports whether the peer-link Noise WS is
 * currently serving traffic; lets the Settings UI distinguish
 * "rotation succeeded AND the listener is back up" from
 * "rotation succeeded but the rebuild fail-softed; check
 * logs".
 */
export interface IdentityView {
  dashboard_id: string;
  pin_sha256: string;
  server_version: string;
  esphome_version: string;
  listener_bound: boolean;
}

/**
 * Data payload for the ``remote_build_pair_request_received`` event.
 *
 * Fires on the receiver-side bus when a fresh
 * ``intent="pair_request"`` Noise frame lands inside an open
 * pairing window. The Settings UI surfaces the row in the
 * Pairing requests inbox; ``peer_ip`` lets the operator
 * sanity-check the source against expectations before
 * OOB-confirming the pin.
 *
 * ``paired_at`` carries the receiver-clock timestamp the row
 * was created at — same value the receiver writes to
 * ``StoredPeer.paired_at``. Sent on the event so the frontend
 * can construct a complete ``PeerSummary``-equivalent row from
 * the event alone (no follow-up read).
 */
export interface RemoteBuildPairRequestReceivedEventData {
  dashboard_id: string;
  pin_sha256: string;
  label: string;
  peer_ip: string;
  paired_at: number;
}

/**
 * Data payload for the ``remote_build_pair_status_changed`` event.
 *
 * Receiver-side. Fires from three paths: ``approve_peer``
 * promoting a PENDING dict entry to APPROVED
 * (``status="approved"``); ``remove_peer`` dropping either a
 * PENDING dict entry or an APPROVED list row
 * (``status="removed"``); pairing-window-close clearing the
 * in-memory PENDING dict (``status="removed"`` per cleared
 * entry). The ``status="removed"`` event is what wakes any
 * in-flight ``intent="pair_status"`` long-poll on a paired
 * offloader so its listener task drops the offloader's local
 * state.
 */
export interface RemoteBuildPairStatusChangedEventData {
  dashboard_id: string;
  status: "approved" | "removed";
}

/**
 * Data payload for the ``remote_build_pairing_window_changed``
 * event.
 *
 * Receiver-side. Fires whenever the in-process pairing window
 * opens, extends, or closes. Same shape as
 * ``PairingWindowState``; the Settings UI re-syncs its local
 * countdown against ``expires_in_seconds`` on every event tick.
 */
export type RemoteBuildPairingWindowChangedEventData = PairingWindowState;

/**
 * Data payload for the ``offloader_pair_status_changed`` event.
 *
 * Offloader-side counterpart to
 * ``RemoteBuildPairStatusChangedEventData``. Fired by the
 * offloader's per-row pair-status listener task
 * (``_apply_pair_status_result`` → ``_fire_offloader_pair_status_changed``)
 * and by ``remote_build/unpair`` when the user removes a row.
 * Keys on the receiver coordinates (``hostname`` /
 * ``port``) the user dialled because the offloader's
 * ``StoredPairing`` doesn't store the receiver's
 * ``dashboard_id``.
 */
export interface OffloaderPairStatusChangedEventData {
  receiver_hostname: string;
  receiver_port: number;
  /**
   * Stable cryptographic identifier the offloader-side
   * controller keys ``_pairings`` on (4a-o part 6 — re-keyed
   * offloader state from ``(host, port)`` to ``pin_sha256``);
   * frontend handlers should look up the matching
   * ``PairingSummary`` row by pin rather than by host/port to
   * stay correct across receiver hostname changes.
   */
  pin_sha256: string;
  status: "approved" | "removed";
}

/**
 * Data payload for the ``offloader_remote_builds_toggled`` event
 * (7b).
 *
 * Fires when the offloader's master "Remote builds enabled"
 * switch flips through ``remote_build/set_offloader_settings``.
 * Carries the new value so subscribing tabs can update their
 * switch render without re-fetching settings.
 */
export interface OffloaderRemoteBuildsToggledEventData {
  remote_builds_enabled: boolean;
}

/**
 * Data payload for the ``offloader_pairing_enabled_changed``
 * event (7b).
 *
 * Fires when one pairing's per-row enable switch flips
 * through ``remote_build/set_pairing_enabled``. App-shell
 * looks up the matching ``PairingSummary`` row in
 * ``_buildOffloadPairings`` keyed on ``pin_sha256`` and flips
 * ``enabled`` so other open tabs render the new switch state.
 */
export interface OffloaderPairingEnabledChangedEventData {
  pin_sha256: string;
  enabled: boolean;
}

/**
 * Data payload for ``receiver_peer_link_session_opened`` and
 * ``receiver_peer_link_session_closed``.
 *
 * Fires on the receiver-side bus whenever an APPROVED peer's
 * 5a-2 ``PeerLinkClient`` connects or disconnects. Drives the
 * ``PeerSummary.connected`` indicator: app-shell flips the
 * matching row's ``connected`` flag in the local
 * ``_buildServerPeers`` list. Both events share the same shape
 * (just the ``dashboard_id``); the discriminator is the event
 * type itself.
 */
export interface ReceiverPeerLinkSessionEventData {
  dashboard_id: string;
}

/**
 * Data payload for offloader_peer_link_opened.
 *
 * Fires on the offloader-side bus when the long-lived
 * PeerLinkClient enters its post-handshake parked state.
 * Drives the PairingSummary.connected indicator: app-shell
 * flips the matching row's connected flag in the local
 * _buildOffloadPairings map keyed by pin_sha256. Receiver
 * coords are carried as display fields the renderer can use
 * without a follow-up lookup, but they're ignored when keying
 * the map (4a-o part 6; pin_sha256 is the canonical row
 * identity).
 */
export interface OffloaderPeerLinkSessionEventData {
  receiver_hostname: string;
  receiver_port: number;
  pin_sha256: string;
}

/**
 * Close-reason category for `OFFLOADER_PEER_LINK_CLOSED`.
 *
 * Mirrors the backend's union of receiver-driven
 * `TerminateReason` enum values (`superseded` /
 * `server_shutting_down` / `heartbeat_timeout` /
 * `malformed_frame` — the wire form of a structured `terminate`
 * frame) and the offloader-side reasons (`transport_error` /
 * `client_stopped` / `peer_hung_up` / `auth_rejected` /
 * `pin_mismatch` — what `PeerLinkClient` infers when our side
 * detects the close before the wire does). Two reasons in this
 * union are *orphan* close reasons where the run loop won't
 * reconnect: `superseded` and `pin_mismatch`. App-shell branches
 * on the literal — keeping it as a union (rather than `string`)
 * lets TypeScript catch typos before they land as silently-broken
 * UI state.
 */
export type PeerLinkCloseReason =
  | "superseded"
  | "server_shutting_down"
  | "heartbeat_timeout"
  | "malformed_frame"
  | "transport_error"
  | "client_stopped"
  | "peer_hung_up"
  | "auth_rejected"
  | "pin_mismatch";

/**
 * Data payload for offloader_peer_link_closed.
 *
 * Same identity fields as OffloaderPeerLinkSessionEventData
 * (the OPENED counterpart) plus the close-classification:
 *
 * - `reason`: category code, see `PeerLinkCloseReason`.
 * - `error_detail`: one-line human-readable description for
 *   the categories that have one (transport / Noise exception
 *   text, `"auth rejected"`, `"pin mismatch"`). Empty for
 *   clean closes where the category itself is the explanation
 *   (`client_stopped`, `superseded`, receiver-driven
 *   `terminate`).
 *
 * App-shell uses both fields to update the matching row's
 * `last_connect_error` (set to `error_detail`) and `connecting`
 * (true on non-orphan reasons; false on `pin_mismatch` /
 * `superseded` where the run loop won't retry).
 */
export interface OffloaderPeerLinkClosedEventData
  extends OffloaderPeerLinkSessionEventData {
  reason: PeerLinkCloseReason;
  error_detail: string;
}

/**
 * Data payload for offloader_job_state_changed.
 *
 * Fired on the offloader's bus per inbound job_state_changed
 * frame from the paired receiver this dashboard submitted
 * job_id to. status mirrors the wire literal exactly
 * (queued / running / completed / failed / cancelled);
 * error_message is empty on non-terminal states and on
 * completed, populated on failed / cancelled.
 *
 * Receiver coords + pin_sha256 are carried so subscribers
 * routing across multiple paired receivers can disambiguate;
 * the in-flight jobs map keys on job_id (which is unique per
 * peer-link session, so collisions across receivers don't
 * happen in practice).
 */
export interface OffloaderJobStateChangedEventData {
  receiver_hostname: string;
  receiver_port: number;
  pin_sha256: string;
  job_id: string;
  status: JobStatus;
  error_message: string;
}

/**
 * Data payload for offloader_job_output.
 *
 * Fired per inbound job_output frame. line preserves its
 * trailing terminator (\n / \r / \r\n) so the existing
 * ansi-log renderer's carriage-return-overwrite contract
 * works byte-identical to local JOB_OUTPUT events.
 *
 * High-rate path during an active build (one frame per line
 * of compiler / linker output). Subscribers should batch
 * downstream rendering rather than re-render per event.
 */
export interface OffloaderJobOutputEventData {
  receiver_hostname: string;
  receiver_port: number;
  pin_sha256: string;
  job_id: string;
  stream: JobStream;
  line: string;
}

/**
 * Data payload for the ``offloader_pair_pin_mismatch`` event.
 *
 * Fires alongside ``offloader_pair_status_changed
 * status="removed"`` when the offloader's pair-status
 * listener observes APPROVED + drifted pin (the receiver's
 * static X25519 pubkey hash differs from
 * ``StoredPairing.pin_sha256`` recorded at pair time). The
 * receiver's identity rotated under us. Carries the
 * diagnostic detail (``expected_pin`` / ``observed_pin``)
 * the status-changed event doesn't, plus the offloader-side
 * ``receiver_label`` so the alert can name the row even
 * after the pairings list has dropped it.
 *
 * No receiver-side counterpart event; the receiver never
 * sees its own pin drift, and the symmetric "offloader
 * rotated" case lands as a fresh PENDING row on the
 * receiver's inbox via
 * ``REMOTE_BUILD_PAIR_REQUEST_RECEIVED``.
 */
export interface OffloaderPairPinMismatchEventData {
  receiver_hostname: string;
  receiver_port: number;
  receiver_label: string;
  /**
   * The **stored** pin the row was keyed on (same value as
   * ``expected_pin``); duplicated as a separate field so a
   * pin-keyed lookup doesn't have to parse ``expected_pin``.
   * 4a-o part 6.
   */
  pin_sha256: string;
  expected_pin: string;
  observed_pin: string;
}

/**
 * Data payload for the ``offloader_pair_peer_revoked`` event.
 *
 * Fires alongside ``offloader_pair_status_changed
 * status="removed"`` when the offloader's pair-status
 * listener gets ``IntentResponse.REJECTED`` for a row the
 * offloader had as PENDING / APPROVED. From the offloader's
 * POV all four causes (admin Reject, window close, identity
 * rotation, row never existed) collapse to "the receiver
 * isn't going to talk to us"; the alert copy stays generic
 * ("the receiver removed us; reach out to that admin if it
 * was a mistake").
 *
 * The ``receiver_label`` is carried so the alert can name
 * the row even after the pairings list has dropped it.
 */
export interface OffloaderPairPeerRevokedEventData {
  receiver_hostname: string;
  receiver_port: number;
  receiver_label: string;
  /**
   * Stable cryptographic identifier the alert row keys on
   * (4a-o part 6).
   */
  pin_sha256: string;
}

/**
 * Data payload for the ``offloader_pair_alert_dismissed``
 * event.
 *
 * Fires when an entry leaves the controller's RAM-only
 * offloader-alerts dict via one of the two resolution paths:
 * a successful ``request_pair`` against the same
 * ``${hostname}:${port}`` (re-pair auto-resolved the alert),
 * or ``unpair`` removed the row outright. There is no
 * operator-driven dismiss — clicking "OK got it" without
 * acting would just hide a broken pairing the next peer-
 * link session would still fail against. Lets other tabs /
 * clients on the global ``subscribe_events`` stream sync
 * their local alerts list without re-fetching the snapshot.
 */
export interface OffloaderPairAlertDismissedEventData {
  receiver_hostname: string;
  receiver_port: number;
  /**
   * Stable cryptographic identifier the dismissed alert row
   * keyed on (4a-o part 6 — alerts dict re-keyed on pin).
   */
  pin_sha256: string;
}

/**
 * Snapshot row in the offloader-side alerts list (``pin_mismatch`` kind).
 *
 * Mirror of ``OffloaderPairPinMismatchEventData`` (the live
 * event) plus a ``kind`` discriminator so a single alerts
 * list can carry both pin-mismatch and peer-revoked entries
 * on the wire. Frontend subscribers branch on ``kind`` to
 * pick the alert copy + CTA.
 *
 * ``fired_at`` is the wall-clock unix timestamp the alert
 * was added to the dict. Snapshot order is dict insertion
 * order; frontends that want "newest first" sort on
 * ``fired_at`` themselves.
 */
export interface OffloaderPinMismatchAlert {
  kind: "pin_mismatch";
  receiver_hostname: string;
  receiver_port: number;
  /** Stable cryptographic identifier (4a-o part 6). */
  pin_sha256: string;
  receiver_label: string;
  expected_pin: string;
  observed_pin: string;
  fired_at: number;
}

/**
 * Snapshot row in the offloader-side alerts list (``peer_revoked`` kind).
 */
export interface OffloaderPeerRevokedAlert {
  kind: "peer_revoked";
  receiver_hostname: string;
  receiver_port: number;
  /** Stable cryptographic identifier (4a-o part 6). */
  pin_sha256: string;
  receiver_label: string;
  fired_at: number;
}

/**
 * Sum type the snapshot list carries. Each entry is one of
 * the two alert kinds above; the ``kind`` discriminator
 * narrows field access at the consumer.
 */
export type OffloaderAlertSnapshotEntry =
  | OffloaderPinMismatchAlert
  | OffloaderPeerRevokedAlert;

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

/**
 * Data payload for ``REMOTE_BUILD_HOST_ADDED`` event.
 *
 * Aliases :type:`RemoteBuildPeer` directly (the backend fires
 * ``peer.to_dict()`` from ``_upsert_host``, identical to what
 * ``hosts_snapshot`` projects into
 * ``subscribe_events.initial_state.hosts``). Aliasing rather
 * than duplicating the field list keeps the event payload from
 * drifting out of shape when ``RemoteBuildPeer`` gains a field.
 * Fires from the controller's mDNS browse-callback cache-hit
 * branch and from the async resolve-success path. Upsert
 * semantics: subscribers key on ``name`` and replace an
 * existing row with the same key.
 */
export type RemoteBuildHostAddedEventData = RemoteBuildPeer;

/**
 * Data payload for ``REMOTE_BUILD_HOST_REMOVED`` event.
 *
 * Fires when zeroconf delivers a ``Removed`` callback (TTL
 * expiry without renewal, or an explicit goodbye). ``name``
 * matches the corresponding ``REMOTE_BUILD_HOST_ADDED`` event's
 * ``name`` field.
 */
export interface RemoteBuildHostRemovedEventData {
  name: string;
}
