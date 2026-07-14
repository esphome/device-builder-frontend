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
}
