import { APIError } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";

/**
 * Human-readable message for a caught error. An APIError's ``Error.message`` is
 * the wire form (``"INVALID_ARGS: …"``) and would leak an internal code into a
 * dialog, so prefer its structured ``details``; fall back to a native Error's
 * ``message``, then to the caller-supplied localization key (callers pass a key
 * matching the failing operation so the copy fits the actual failure).
 */
export function formatApiError(
  err: unknown,
  localize: LocalizeFunc,
  fallbackKey: string
): string {
  if (err instanceof APIError) return err.details || localize(fallbackKey);
  if (err instanceof Error) return err.message;
  return localize(fallbackKey);
}
