import { withBase } from "./base-path.js";

export type LeaveGuard = () => Promise<boolean>;

let activeGuard: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard | null): void {
  activeGuard = guard;
}

// history.state survives a reload while module state doesn't, so the
// counter alone can't tell a fresh push from a pre-reload entry whose
// number happens to collide; the token scopes the stamp to this document.
const DOC_TOKEN = Math.random().toString(36).slice(2);
let pushCounter = 0;

export async function navigate(url: string): Promise<void> {
  if (!(await runLeaveGuard())) return;
  window.history.pushState({ d: DOC_TOKEN, n: ++pushCounter }, "", withBase(url));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Run the active page-leave guard. Resolves ``true`` when it's safe to leave
 * (no guard, or the guard resolved "proceed"). Used by ``navigate`` and by
 * back-navigations that bypass it but still must honour the guard — the header
 * back arrow's ``history.back()``, whose raw popstate the router commits before
 * the device editor's own popstate guard can veto it. A guard that throws
 * resolves ``false``: navigating through unsaved state on a broken guard
 * would lose it silently, so staying put is the fail-safe.
 */
export async function runLeaveGuard(): Promise<boolean> {
  if (!activeGuard) return true;
  try {
    return await activeGuard();
  } catch (err) {
    console.error("Leave guard failed; staying on the page:", err);
    return false;
  }
}

/** True when the current entry carries a non-null object state (a
 *  ``navigate()`` stamp or a guard's re-push) rather than a fresh page
 *  load, so there is a same-session entry to pop back to. */
export function hasPushedHistoryEntry(): boolean {
  return window.history.state !== null && typeof window.history.state === "object";
}

/** True when the current entry was pushed by this document's
 *  ``navigate()`` — false after a reload, whose entry keeps the stamp of
 *  the document that made it. */
export function isSameDocumentPush(): boolean {
  const state = window.history.state as { d?: string } | null;
  return state?.d === DOC_TOKEN;
}

/** True when the current entry is this document's latest ``navigate()``
 *  push — just pushed by the click being handled, so undoing it is safe.
 *  False for an entry reached via Back/Forward, a reload, or a fresh
 *  page load. */
export function isFreshNavigatePush(): boolean {
  const state = window.history.state as { d?: string; n?: number } | null;
  return state?.d === DOC_TOKEN && state.n === pushCounter;
}

let popGuardSuppressed = false;

/** Pop a ``navigate()``-pushed entry without re-running page popstate
 *  guards — the user already answered them for the failed navigation. */
export function popPushedEntrySilently(): void {
  popGuardSuppressed = true;
  // The rollback's own popstate clears the arming even when no guarded
  // page is mounted to consume it (dashboard), so it can't strand and
  // skip a later real leave prompt. Page guards register on connect, so
  // they run first and still consume it in time.
  window.addEventListener("popstate", () => void consumePopGuardSuppression(), {
    capture: true,
    once: true,
  });
  window.history.back();
}

/** One-shot check page popstate guards consume before intercepting. */
export function consumePopGuardSuppression(): boolean {
  const suppressed = popGuardSuppressed;
  popGuardSuppressed = false;
  return suppressed;
}

/**
 * Leave the current page the way the header back arrow does. Prefer popping
 * the history stack so the previous URL — and therefore the dashboard's
 * filter / search state encoded in its query string — is restored verbatim.
 * ``history.state`` is stamped by ``navigate()`` on every pushState;
 * ``null`` means a fresh page load (deep link / refresh) so there's nothing
 * useful to pop and we fall back to ``navigate("/")`` to stay inside the SPA.
 */
export async function goBackOrHome(): Promise<void> {
  if (hasPushedHistoryEntry()) {
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
