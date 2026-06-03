import { withBase } from "./base-path.js";

export type LeaveGuard = () => Promise<boolean>;

let activeGuard: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard | null): void {
  activeGuard = guard;
}

export async function navigate(url: string): Promise<void> {
  if (!(await runLeaveGuard())) return;
  window.history.pushState({}, "", withBase(url));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Run the active page-leave guard. Resolves ``true`` when it's safe to leave
 * (no guard, or the guard resolved "proceed"). Used by ``navigate`` and by
 * back-navigations that bypass it but still must honour the guard — the header
 * back arrow's ``history.back()``, whose raw popstate the router commits before
 * the device editor's own popstate guard can veto it.
 */
export async function runLeaveGuard(): Promise<boolean> {
  return activeGuard ? activeGuard() : true;
}
