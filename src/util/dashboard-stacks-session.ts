/**
 * Session-scoped choice of which dashboard stack is expanded (the remote
 * compute panel or the device builder — an accordion, exactly one open).
 * Survives in-app navigation and reloads, then resets when the tab closes so
 * every fresh visit starts from the preference-driven default (remote compute
 * dashboard on → remote, otherwise builder). Storage access is guarded so a
 * throw (private mode / sandboxed iframe / quota) falls back to the default.
 */

export const STORAGE_KEY = "esphome-dashboard-stacks";

export type DashboardStack = "remote" | "builder";

/** Read the session's expanded-stack choice; null = no (valid) choice yet. */
export function loadExpandedStack(): DashboardStack | null {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return value === "remote" || value === "builder" ? value : null;
  } catch {
    return null;
  }
}

/** Persist the expanded-stack choice; drops the write if storage is unavailable. */
export function saveExpandedStack(stack: DashboardStack): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, stack);
  } catch {
    // Drop the write; the swap still works for this render.
  }
}
