import type { ReactiveController, ReactiveControllerHost } from "lit";
import { withBase } from "./base-path.js";

export type LeaveGuard = () => Promise<boolean>;

let activeGuard: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard | null): void {
  activeGuard = guard;
}

/** Clear only while *guard* is still the active one — a departing page
 *  must not disarm a successor that already registered. */
function clearLeaveGuard(guard: LeaveGuard): void {
  if (activeGuard === guard) activeGuard = null;
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
 * the header back arrow's ``history.back()``, which prompts before the pop
 * rather than leaving it to the popstate interceptor's after-the-pop
 * re-push. A guard that throws resolves ``false``: navigating through
 * unsaved state on a broken guard would lose it silently, so staying put
 * is the fail-safe.
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
function hasPushedHistoryEntry(): boolean {
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

/** One-shot check the pop-guard controller consumes before intercepting.
 *  Exported for tests; production consumers live in this module. */
export function consumePopGuardSuppression(): boolean {
  const suppressed = popGuardSuppressed;
  popGuardSuppressed = false;
  return suppressed;
}

export interface PopLeaveGuardOptions {
  /** The page's confirm-dialog flow; also registered as the active leave
   *  guard for ``navigate()`` / ``goBackOrHome()``. */
  confirmLeave: () => Promise<boolean>;
  /** Read at popstate time, after the suppression and allow checks; may
   *  have side effects (the device page kicks its section flush here). */
  isDirty: () => boolean;
  /** Un-based path re-asserted while the prompt is open. */
  url: () => string;
}

let activeLeaveGuardController: PopLeaveGuardController | null = null;
let interceptorInstalled = false;

function claimPopstateDelivery(controller: PopLeaveGuardController): void {
  activeLeaveGuardController = controller;
}

/** Release only while *controller* still holds delivery — a departing
 *  page must not disarm a successor that already claimed it. */
function releasePopstateDelivery(controller: PopLeaveGuardController): void {
  if (activeLeaveGuardController === controller) activeLeaveGuardController = null;
}

/**
 * Install the single popstate listener that delivers to the active
 * ``PopLeaveGuardController``. Must run before the router is constructed:
 * popstate targets ``window``, where listeners fire in registration order
 * (the capture flag confers no priority), so registering ahead of the
 * router's listener is the only way an interception can veto the
 * router's route commit (#1520). Idempotent.
 */
export function installLeaveGuardInterceptor(): void {
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  window.addEventListener(
    "popstate",
    (e) => activeLeaveGuardController?.handlePopState(e),
    { capture: true }
  );
}

/**
 * Owns a page's popstate leave-guard: intercepts a dirty Back/Forward,
 * re-asserts the page URL, runs the confirm flow, and replays the pop on
 * proceed. Registers the confirm flow as the active leave guard for the
 * host's connected lifetime; popstate delivery arrives through the
 * module's single interceptor, which registers ahead of the router so
 * ``stopImmediatePropagation`` genuinely blocks the route commit.
 */
export class PopLeaveGuardController implements ReactiveController {
  /* The allow flag is flipped inside the wrapped guard BEFORE its caller
   * resumes, so the callers' own popstates fall through instead of being
   * re-intercepted while the buffer is still dirty (Discard doesn't
   * revert it):
   *
   *   - ``navigate()`` on ``canLeave=true`` does ``pushState +
   *     dispatchEvent(popstate)`` synchronously after the guard resolves.
   *   - The intercepted-pop replay below calls ``history.back()``.
   *
   * Microtasks run to completion, so no popstate task can interleave
   * between the confirm resolving and the flag write. */
  private _allowingLeave = false;

  private readonly _guard: LeaveGuard;

  constructor(
    host: ReactiveControllerHost,
    private readonly _opts: PopLeaveGuardOptions
  ) {
    this._guard = async () => {
      const ok = await this._opts.confirmLeave();
      if (ok) this._allowingLeave = true;
      return ok;
    };
    host.addController(this);
  }

  hostConnected(): void {
    setLeaveGuard(this._guard);
    claimPopstateDelivery(this);
  }

  hostDisconnected(): void {
    clearLeaveGuard(this._guard);
    releasePopstateDelivery(this);
    this._allowingLeave = false;
  }

  readonly handlePopState = (e: PopStateEvent) => {
    // A failed route chunk rolling back its own push is a return to the
    // page, not a leave.
    if (consumePopGuardSuppression()) return;
    if (this._allowingLeave) {
      this._allowingLeave = false;
      return;
    }
    // Only now: the dirty check may side-effect (section-flush kick).
    if (!this._opts.isDirty()) return;
    e.stopImmediatePropagation();
    // Synchronous by contract: the popped entry is re-pushed in the same
    // task. Plain ``{}`` state — a navigate() stamp here would let the
    // router's rollback treat a guard re-push as a fresh push.
    window.history.pushState({}, "", withBase(this._opts.url()));
    this._guard()
      .then((canLeave) => {
        if (canLeave) window.history.back();
      })
      // The entry was already re-pushed, so staying put is the fail-safe
      // on an unexpected guard failure.
      .catch((err) => console.error("Leave confirmation failed:", err));
  };
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
    // Prompt before popping: the user answers while the URL still shows
    // their page. The popstate interceptor would catch a raw back too,
    // but only after the pop, via re-push; and the allow flag the guard
    // sets lets this pop fall through it. navigate("/") runs the guard
    // itself, so the fallback isn't double-prompted.
    if (!(await runLeaveGuard())) return;
    window.history.back();
    return;
  }
  await navigate("/");
}
