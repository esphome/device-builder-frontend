/**
 * Session-scoped collapse state for the dashboard's two stacks (the remote
 * compute panel and the device builder below it). Survives in-app navigation
 * and reloads, then resets when the tab closes so every fresh visit starts
 * from the preference-driven defaults (remote compute dashboard on → remote
 * expanded, builder collapsed; paired-but-off → remote collapsed). Storage
 * access is guarded so a throw (private mode / sandboxed iframe / quota)
 * falls back to the defaults.
 */

export const STORAGE_KEY = "esphome-dashboard-stacks";

export type DashboardStack = "remote" | "builder";

/** Read a stack's saved collapse choice; null = no choice this session. */
export function loadStackCollapsed(stack: DashboardStack): boolean | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const value = (parsed as Record<string, unknown>)[stack];
    return typeof value === "boolean" ? value : null;
  } catch {
    return null;
  }
}

/** Persist a stack's collapse choice; drops the write if storage is unavailable. */
export function saveStackCollapsed(stack: DashboardStack, collapsed: boolean): void {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    const obj =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    obj[stack] = collapsed;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Drop the write; the toggle still works for this render.
  }
}
