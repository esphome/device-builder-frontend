/**
 * Streaming command callbacks.
 *
 * Part of the src/api/types.ts barrel split.
 */

// ─── Streaming Commands ──────────────────────────────────────

/** Callbacks for streaming commands (validate, logs, follow_job).
 *  The result frame's shape is per-command; validate/logs use the default. */
export interface StreamCallbacks<TResult = { success: boolean; code: number }> {
  onOutput?: (line: string) => void;
  onResult?: (data: TResult) => void;
  onError?: (error: string) => void;
  /** The WS itself dropped (or the send was refused). Fired instead of
   *  onError when provided, so consumers can tell a connection-level
   *  stop from a command error without parsing the message. */
  onConnectionLost?: () => void;
}

/** Sentinel port for the network / OTA path (vs. a server serial device path
 *  like ``/dev/cu.usbserial-110``), carried by ``firmware/install*`` and the
 *  ``devices/logs`` stream. */
export const OTA_PORT = "OTA";
