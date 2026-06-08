/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * ``catch`` clauses are typed ``unknown``, so the recurring
 * ``err instanceof Error ? err.message : String(err)`` dance appears at
 * every catch site that surfaces the failure to the user (a toast, an
 * ``_error`` state field, an inline status line). This centralises that
 * narrowing: ``Error`` instances yield their ``message``; anything else
 * (a thrown string, a rejected non-Error) is stringified.
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
