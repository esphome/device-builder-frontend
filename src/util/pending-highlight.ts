/**
 * One-shot "highlight this configuration on the dashboard's next mount"
 * signal.
 *
 * The wizard navigates to ``/device/<configuration>`` after creating a
 * device so the user lands in the editor. When they close the editor
 * (back button / Esc / browser nav) the router re-mounts the
 * dashboard, and we want the just-created card / row to light up the
 * same way the discovery / adopt flow lights up.
 *
 * The signal lives in ``sessionStorage`` so it survives the popstate
 * route change but stays scoped to the active tab — a different tab
 * landing on the dashboard shouldn't see a stranger's import flash.
 */

const KEY = "esphome.pending-dashboard-highlight";

/** Mark *configuration* to be highlighted on the dashboard's next mount.
 *
 * Safe to call right before navigating away — the storage write
 * survives the route change. Calling repeatedly overwrites; only
 * the most recent target lights up.
 */
export function markPendingHighlight(configuration: string): void {
  try {
    sessionStorage.setItem(KEY, configuration);
  } catch {
    // sessionStorage can fail in private mode / sandboxed iframes —
    // not worth blowing up the wizard over a missing flash.
  }
}

/** Atomically read + clear the flag. Returns the stored configuration
 *  string, or ``null`` when nothing's pending. */
export function consumePendingHighlight(): string | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored !== null) {
      sessionStorage.removeItem(KEY);
      return stored;
    }
  } catch {
    // Ignore — see comment in markPendingHighlight.
  }
  return null;
}
