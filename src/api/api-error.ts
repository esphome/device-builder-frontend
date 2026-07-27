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

/** True when *err* is an ``APIError`` carrying exactly *code*. */
export function isApiErrorCode(err: unknown, code: string): err is APIError {
  return err instanceof APIError && err.errorCode === code;
}

/**
 * A command that never got a reply within its timeout. Distinct from
 * ``APIError`` (the server answered) and from a bare transport ``Error``,
 * so callers can tell "we gave up waiting" from "there is nothing there".
 */
export class CommandTimeoutError extends Error {
  command: string;
  timeoutMs: number;

  constructor(command: string, timeoutMs: number) {
    super(`Command "${command}" timed out after ${timeoutMs}ms`);
    this.name = "CommandTimeoutError";
    this.command = command;
    this.timeoutMs = timeoutMs;
  }
}
