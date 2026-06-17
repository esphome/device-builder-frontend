/**
 * Configured/adoptable devices, labels, device responses, YAML search.
 *
 * Part of the src/api/types.ts barrel split.
 */

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
  /** Resolved `logger: baud_rate` for the Web Serial log port. `null` means
   *  unset (open at the 115200 default); `0` means UART logging is disabled;
   *  a positive value is the baud to open at. */
  logger_baud_rate: number | null;
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

/** Response from devices/import_bundle.
 *
 * 'conflicts' means nothing was written: `conflicts` lists the bundle
 * files that already exist on disk, so the user picks which to overwrite
 * and re-submits the same bytes with those paths in `overwrite`.
 * 'imported' means the tree landed; `written`/`kept` report which files
 * were placed vs left untouched (a non-empty `kept` is a partial import).
 * secrets.yaml is always merged. */
export interface ImportBundleResponse {
  status: "imported" | "conflicts";
  configuration: string;
  conflicts: string[];
  written: string[];
  kept: string[];
  has_secrets: boolean;
  esphome_version: string;
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
