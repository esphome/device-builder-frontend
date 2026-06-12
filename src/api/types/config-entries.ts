/**
 * Config entries, GPIO pin features/modes, config primitives.
 *
 * Part of the src/api/types.ts barrel split.
 */

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
   * Catalog name for `REGISTRY_LIST` entries. Currently
   * ``"light_effects"`` (light.effects) and ``"filter"``
   * (sensor / binary_sensor / text_sensor filters) are wired; new
   * registries plug into the frontend's REGISTRY_OPS table. Null
   * on every other entry type.
   */
  registry: string | null;
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
  /**
   * Sibling entries sharing a non-null value are mutually exclusive:
   * exactly one may be set (e.g. a remote_receiver binary_sensor's
   * protocol). The form renders them as one pick-one dropdown.
   */
  exclusive_group?: string | null;

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
  /** Show only when dependency value is in this list. */
  depends_on_value_any: ConfigPrimitive[] | null;
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
  // Polymorphic list of single-key items drawn from a named registry.
  // Each item is `{ <registry_id>: <params> | null }`. Frontend
  // renders a list of rows with a per-row type picker pulled from the
  // catalog named by ``entry.registry``. Used for fields like
  // ``light.effects`` (``registry: "light_effects"``) and
  // ``sensor.filters`` (``registry: "filter"``). #941.
  REGISTRY_LIST = "registry_list",
  // Fallback for fields whose type couldn't be determined
  UNKNOWN = "unknown",
  /** @deprecated Backend signals dropdown via populated `options` instead. Kept for legacy callers. */
  SELECT = "select",
}
