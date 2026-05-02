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
  INTERNAL_ERROR = "internal_error",
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
  board_id: string;
  target_platform: string;
  /** mDNS hostname from StorageJSON (e.g. "my_device.local"). */
  address: string;
  /** Resolved IPv4 address from mDNS — empty until the device is seen online. */
  ip: string;
  web_port: number | null;
  current_version: string;
  deployed_version: string;
  loaded_integrations: string[];
  state: DeviceState;
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
  /** When True the field accepts a list of values. */
  multi_value: boolean;
  /** When True accepts either a literal value OR a !lambda block. */
  templatable: boolean;

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
}

export interface BulkDeleteResult {
  configuration: string;
  success: boolean;
  error?: string;
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
  JOB_QUEUED = "job_queued",
  JOB_STARTED = "job_started",
  JOB_OUTPUT = "job_output",
  JOB_COMPLETED = "job_completed",
  JOB_FAILED = "job_failed",
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

/** Callback for event subscription push events. */
export type EventSubscriptionCallback = (event: string, data: unknown) => void;

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
