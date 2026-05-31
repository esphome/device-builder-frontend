/**
 * Streaming command callbacks.
 *
 * Part of the src/api/types.ts barrel split.
 */

// ─── Streaming Commands ──────────────────────────────────────

/** Callbacks for streaming commands (validate, logs). */
export interface StreamCallbacks {
  onOutput?: (line: string) => void;
  onResult?: (data: { success: boolean; code: number }) => void;
  onError?: (error: string) => void;
}
