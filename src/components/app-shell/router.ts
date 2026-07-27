import { Router } from "@lit-labs/router";
import { html, type ReactiveControllerHost } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { withBase } from "../../util/base-path.js";
import { hasPushedHistoryEntry, popPushedEntrySilently } from "../../util/navigation.js";
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
}

const PENDING_FEEDBACK_DELAY_MS = 200;
// One retry, since output.chunkLoadTimeout already bounds each attempt.
const RETRY_DELAYS_MS = [500];

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
  const pendingTimer = setTimeout(() => {
    // An import can't be cancelled, so this fires even for a navigation the
    // user has already walked away from; don't advertise progress for it.
    if (window.location.pathname !== target) return;
    counted = true;
    if (++pendingLoads === 1) hooks.onPending(true);
  }, PENDING_FEEDBACK_DELAY_MS);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await importThunk();
        return window.location.pathname === target;
      } catch (err) {
        if (window.location.pathname !== target) return false;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          console.error("Failed to load route chunk:", err);
          notifyError(hooks.localize()("layout.page_load_failed"));
          // navigate() pushed this URL before the router ran enter, and a
          // false return leaves the old page rendered; undo the push so the
          // address bar doesn't describe a page that never mounted. Silent,
          // or the still-mounted page's popstate guard re-prompts over a
          // leave the user already answered at navigate() time.
          if (hasPushedHistoryEntry()) popPushedEntrySilently();
          return false;
        }
        await sleep(delay);
      }
    }
  } finally {
    clearTimeout(pendingTimer);
    if (counted && --pendingLoads === 0) hooks.onPending(false);
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
