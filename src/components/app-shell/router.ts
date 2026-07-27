import { Router } from "@lit-labs/router";
import { html, type ReactiveControllerHost } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { withBase } from "../../util/base-path.js";
import {
  isFreshNavigatePush,
  isSameDocumentPush,
  popPushedEntrySilently,
} from "../../util/navigation.js";
import { notifyError } from "../../util/notify.js";
import { sleep } from "../../util/sleep.js";

// Decode the :id path param, falling back to the raw value on URIError so a
// malformed % sequence doesn't crash the whole router — the device page's
// "not found" empty state is the right UX for a broken URL.
function decodeIdParam(id: string | undefined): string {
  if (!id) return "";
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export interface RouterHooks {
  /** Flips true when the first slow chunk load crosses the feedback delay,
   *  false when the last one settles either way. */
  onPending(pending: boolean): void;
  /** Read at failure time — the shell's localize loads async after mount. */
  localize(): LocalizeFunc;
  /** Pre-auth exhaustion stays silent and leaves the URL alone; the shell
   *  re-resolves it after sign-in, giving the chunk a fresh try. */
  isAuthed(): boolean;
}

const PENDING_FEEDBACK_DELAY_MS = 200;
// Two attempts total, since output.chunkLoadTimeout already bounds each.
const CHUNK_LOAD_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

// Slow loads in flight at once; the pending hook fires on the 0↔1 edges so
// overlapping navigations can't hide each other's progress bar.
let pendingLoads = 0;

/**
 * Await a lazy route chunk with pending feedback and retries.
 *
 * On exhaustion the navigation is cancelled with a toast so the click
 * never silently does nothing (rspack re-requests a failed chunk on the
 * next import() call, so a later click retries from scratch). A chunk
 * that lands after the user has navigated elsewhere resolves false —
 * @lit-labs/router has no in-flight guard, so returning true here would
 * commit the stale route over the one the URL now shows.
 */
export async function lazyEnter(
  importThunk: () => Promise<unknown>,
  hooks: RouterHooks
): Promise<boolean> {
  const target = window.location.pathname;
  let counted = false;
  const release = () => {
    if (!counted) return;
    counted = false;
    window.removeEventListener("popstate", onNavigatedAway);
    if (--pendingLoads === 0) hooks.onPending(false);
  };
  // An import can't be cancelled, so a navigation away mid-load would
  // otherwise keep the bar up on the new page until the stale chunk
  // settles (up to chunkLoadTimeout).
  const onNavigatedAway = () => {
    if (window.location.pathname !== target) release();
  };
  const pendingTimer = setTimeout(() => {
    // This fires even for a navigation the user has already walked away
    // from; don't advertise progress for it.
    if (window.location.pathname !== target) return;
    counted = true;
    if (++pendingLoads === 1) hooks.onPending(true);
    window.addEventListener("popstate", onNavigatedAway);
  }, PENDING_FEEDBACK_DELAY_MS);
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await importThunk();
        return window.location.pathname === target;
      } catch (err) {
        if (window.location.pathname !== target) return false;
        if (attempt >= CHUNK_LOAD_ATTEMPTS) {
          console.error("Failed to load route chunk:", err);
          // Behind the login screen there is nothing to see or undo, and
          // rewriting the URL here would lose the deep link the user is
          // about to authenticate into.
          if (!hooks.isAuthed()) return false;
          notifyError(hooks.localize()("layout.page_load_failed"));
          // A fresh navigate() push is undone so the address bar doesn't
          // describe a page that never mounted — silently, or the still-
          // mounted page's popstate guard re-prompts over a leave the user
          // already answered. A same-document Back/Forward entry is left
          // alone (popping would move the user a second step back). Any
          // other entry — cold deep link, reload — has nothing rendered
          // behind it, so it becomes the dashboard rather than an empty
          // outlet. Replaced, not pushed: a push would leave the broken
          // URL underneath as a Back-button fail loop.
          if (isFreshNavigatePush()) popPushedEntrySilently();
          else if (!isSameDocumentPush()) {
            window.history.replaceState(null, "", withBase("/"));
            window.dispatchEvent(new PopStateEvent("popstate"));
          }
          return false;
        }
        await sleep(RETRY_DELAY_MS);
      }
    }
  } finally {
    clearTimeout(pendingTimer);
    // release() also detaches the listener; when never counted, none
    // was attached.
    release();
  }
}

export function createRouter(
  host: ReactiveControllerHost & HTMLElement,
  hooks: RouterHooks
): Router {
  return new Router(host, [
    {
      path: withBase("/"),
      render: () => html`<esphome-page-dashboard></esphome-page-dashboard>`,
    },
    {
      path: withBase("/secrets"),
      enter: () =>
        lazyEnter(
          () => import(/* webpackPrefetch: true */ "../../pages/secrets.js"),
          hooks
        ),
      render: () => html`<esphome-page-secrets></esphome-page-secrets>`,
    },
    {
      path: withBase("/device/:id"),
      enter: () =>
        lazyEnter(
          () => import(/* webpackPrefetch: true */ "../../pages/device.js"),
          hooks
        ),
      render: ({ id }) =>
        html`<esphome-page-device .id=${decodeIdParam(id)}></esphome-page-device>`,
    },
  ]);
}
