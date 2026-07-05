/**
 * WebSocket protocol envelope, error codes, paged responses.
 *
 * Part of the src/api/types.ts barrel split.
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
  /** True only when served through HA Supervisor ingress (the panel
   * iframe). Distinct from ha_addon, which is also true when the add-on
   * is reached directly on its exposed port. Drives the slim header. */
  ha_ingress: boolean;
  requires_auth: boolean;
  /** ESPHome Desktop wrapper version, from ESPHOME_DESKTOP_VERSION on the
   * backend; absent or "" when not running under the desktop app. */
  desktop_version?: string;
  /** True when the desktop app (0.14.0+) exposes its update `api` via
   * ESPHOME_DESKTOP_BIN; gates the "Check for updates" menu item. Older
   * desktop apps set desktop_version but not this. */
  desktop_update_capable?: boolean;
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
  /** The offloader's ``version_match_policy="exact_required"``
   *  filtered every paired peer and the install refused to
   *  fall back to LOCAL. UI surfaces this as a toast on the
   *  install flow with a hint to relax the policy in Settings
   *  → Build server. */
  NO_COMPATIBLE_PEER = "no_compatible_peer",
}

// ─── Paged Responses ─────────────────────────────────────────

export interface PagedResponse {
  total: number;
  offset: number;
  limit: number;
}
