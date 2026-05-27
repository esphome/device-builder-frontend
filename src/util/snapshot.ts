/**
 * Helpers for seeding context-backed Maps from
 * ``subscribe_events.initial_state`` rows.
 *
 * The dashboard's ``INITIAL_STATE`` handler in
 * ``app-shell.ts`` rebuilds several context-backed Maps from
 * optional arrays the backend includes on the snapshot. Each
 * field is optional because the backend omits it entirely
 * when the relevant controller isn't wired up (e.g. no
 * remote-build controller → no ``pairings`` / ``hosts`` /
 * ``offloader_alerts`` fields on the snapshot). The
 * absent-vs-empty-list distinction matters: ``undefined``
 * means "controller absent, leave the local Map null /
 * still-loading", ``[]`` means "controller present, no
 * rows."
 */

/**
 * Build a Map<K, T> from *rows* keyed by *keyFn*, or return
 * ``null`` when *rows* is ``undefined``.
 *
 * Mirrors the absent-vs-empty-list semantics the
 * ``initial_state`` snapshot uses across its optional
 * remote-build fields (``hosts`` / ``pairings`` /
 * ``offloader_alerts``): an absent field collapses to
 * ``null`` so the host context stays in its still-loading /
 * not-applicable state, an empty list collapses to an empty
 * Map so the host renders the loaded-but-empty UI.
 */
export function seededMap<T, K>(
  rows: readonly T[] | undefined,
  keyFn: (row: T) => K
): Map<K, T> | null {
  if (rows === undefined) return null;
  return new Map(rows.map((row) => [keyFn(row), row]));
}
