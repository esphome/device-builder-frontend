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

/** A configured ESPHome device. */
export interface ConfiguredDevice {
  name: string;
  friendly_name: string;
  configuration: string;
  path: string;
  comment: string | null;
  address: string;
  web_port: number | null;
  target_platform: string;
  current_version: string;
  deployed_version: string;
  loaded_integrations: string[];
  board_id: string;
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

export interface ComponentSubEntity {
  key: string;
  platform_type: string;
  config_entries: ConfigEntry[];
}

export interface ComponentCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  docs_url: string;
  image_url: string;
  dependencies: string[];
  auto_load: string[];
  multi_conf: boolean;
  config_entries: ConfigEntry[];
  sub_entities: ComponentSubEntity[];
}

export interface PagedComponentsResponse extends PagedResponse {
  components: ComponentCatalogEntry[];
  categories: Array<{ id: string; name: string; count: number }>;
}

// ─── Config Entries ──────────────────────────────────────────

export interface ConfigValueOption {
  label: string;
  value: string;
}

export interface ConfigEntry {
  key: string;
  type: ConfigEntryType;
  label: string;
  default_value: number | string | boolean | null;
  required: boolean;
  description: string | null;
  options: ConfigValueOption[] | null;
  range: [number, number] | null;
  help_link: string | null;
  multi_value: boolean;
  hidden: boolean;
  advanced: boolean;
  translation_key: string | null;
  translation_params: string[] | null;
  value: number | string | boolean | string[] | null;
}

export enum ConfigEntryType {
  STRING = "string",
  SECURE_STRING = "secure_string",
  INTEGER = "integer",
  FLOAT = "float",
  BOOLEAN = "boolean",
  SELECT = "select",
  PIN = "pin",
  TIME_PERIOD = "time_period",
  ICON = "icon",
  ID = "id",
  TRIGGER = "trigger",
  LABEL = "label",
  DIVIDER = "divider",
  ALERT = "alert",
  UNKNOWN = "unknown",
}

// ─── Config / System ─────────────────────────────────────────

export interface SerialPort {
  port: string;
  desc: string;
}

export interface UserPreferences {
  editor_layout?: "both" | "left" | "right";
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
}

/** Data payload for initial_state event. */
export interface InitialStateEventData {
  devices: ConfiguredDevice[];
}

/** Data payload for device_added / device_updated / device_removed events. */
export interface DeviceEventData {
  device: ConfiguredDevice;
}

/** Data payload for device_state_changed event. */
export interface DeviceStateChangedEventData {
  configuration: string;
  online: boolean;
}

/** Data payload for importable_device_added / importable_device_removed events. */
export interface ImportableDeviceEventData {
  device: AdoptableDevice;
}

/** Callback for event subscription push events. */
export type EventSubscriptionCallback = (event: string, data: unknown) => void;

// ─── Streaming Commands ──────────────────────────────────────

/** Callbacks for streaming commands (compile, upload, logs, validate, clean). */
export interface StreamCallbacks {
  onOutput?: (line: string) => void;
  onResult?: (data: { success: boolean; code: number }) => void;
  onError?: (error: string) => void;
}
