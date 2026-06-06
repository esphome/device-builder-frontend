/**
 * Error thrown by the WebSocket client when the backend responds with
 * an ErrorMessage. Carries the structured ``error_code`` + ``details``
 * fields so callers can distinguish e.g. ``not_authenticated`` from
 * ``rate_limited`` without string-matching the formatted message.
 *
 * The ``message`` is intentionally kept identical to the prior
 * ``new Error(`${code}: ${details}`)`` shape so existing string-match
 * tests / log scrapers continue to work.
 */
export class APIError extends Error {
  errorCode: string;
  details: string;

  constructor(errorCode: string, details: string | undefined) {
    super(`${errorCode}: ${details ?? ""}`);
    this.name = "APIError";
    this.errorCode = errorCode;
    this.details = details ?? "";
  }
}

/** The user-facing detail carried by a thrown APIError, or "" if none.
 *  Reads the structured 'details' field directly so callers don't parse
 *  the formatted '<code>: <details>' message string back apart. */
export function apiErrorDetails(err: unknown): string {
  return err instanceof APIError && err.details.trim() ? err.details.trim() : "";
}
