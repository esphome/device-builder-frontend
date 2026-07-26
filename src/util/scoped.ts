/**
 * Scope-bound release for manually paired acquire/release state:
 * ``using _x = acquire(release)`` runs *release* on every exit path.
 */
// Older engines lack the well-known symbol; TS's downlevel emit uses
// the same Symbol.for fallback, so runtime and emit agree.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Symbol as any).dispose ??= Symbol.for("Symbol.dispose");

export function acquire(release: () => void): Disposable {
  return { [Symbol.dispose]: release };
}
