/**
 * One-shot "this device was just created" signal between the wizard
 * and the device page. The wizard sets it right before navigating;
 * the device page reads + clears it on first mount so the welcome
 * banner shows exactly once and survives only the active browsing
 * session (sessionStorage clears on tab close).
 */

const KEY = "esphome.just-created";

/** Mark `configuration` as freshly created. Safe to call before
 *  navigating — survives the popstate route change. */
export function markJustCreated(configuration: string): void {
  try {
    sessionStorage.setItem(KEY, configuration);
  } catch {
    // sessionStorage can fail in private mode / sandboxed iframes —
    // not worth blowing up the wizard over a missing welcome banner.
  }
}

/** Atomically read + clear the flag. Returns true iff the stored
 *  value matches `configuration`. */
export function consumeJustCreated(configuration: string): boolean {
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored === configuration) {
      sessionStorage.removeItem(KEY);
      return true;
    }
  } catch {
    // Ignore — see comment in markJustCreated.
  }
  return false;
}

/** Drop any pending just-created flag.
 *
 * Called from flows that imply the user has already engaged with
 * the device (rename, archive, etc.) — at that point the welcome
 * banner is moot and the stored configuration string would be
 * stale anyway (rename changes the filename the device-page mount
 * would key off). Cheaper than tracking the rename and rewriting
 * the stored value.
 */
export function clearJustCreated(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Ignore — see comment in markJustCreated.
  }
}
