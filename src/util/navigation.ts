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

/**
 * Leave the current page the way the header back arrow does. Prefer popping
 * the history stack so the previous URL — and therefore the dashboard's
 * filter / search state encoded in its query string — is restored verbatim.
 * ``history.state`` is set to ``{}`` by ``navigate()`` on every pushState;
 * ``null`` means a fresh page load (deep link / refresh) so there's nothing
 * useful to pop and we fall back to ``navigate("/")`` to stay inside the SPA.
 */
export async function goBackOrHome(): Promise<void> {
  if (window.history.state !== null && typeof window.history.state === "object") {
    // history.back() fires a raw popstate the router commits (unmounting the
    // page) before the device editor's popstate guard can veto it, so honour
    // the leave guard here — same gate navigate() applies. navigate("/") runs
    // the guard itself, so the fallback isn't double-prompted.
    if (!(await runLeaveGuard())) return;
    window.history.back();
    return;
  }
  await navigate("/");
}
