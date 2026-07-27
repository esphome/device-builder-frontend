import { Router } from "@lit-labs/router";
import { html, type ReactiveControllerHost } from "lit";
import type { LocalizeFunc } from "../../common/localize.js";
import { withBase } from "../../util/base-path.js";
import { notifyError } from "../../util/notify.js";

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
  /** Flips true when a lazy route chunk has been in flight long enough to
   *  deserve visible feedback, false when the load settles either way. */
  onPending(pending: boolean): void;
  /** Read at failure time — the shell's localize loads async after mount. */
  localize(): LocalizeFunc;
}

const PENDING_FEEDBACK_DELAY_MS = 200;
const RETRY_DELAYS_MS = [500, 1500];

/**
 * Await a lazy route chunk with pending feedback and retries.
 *
 * On exhaustion the navigation is cancelled with a toast so the click
 * never silently does nothing (rspack re-requests a failed chunk on the
 * next import() call, so a later click retries from scratch).
 */
export async function lazyEnter(
  importThunk: () => Promise<unknown>,
  hooks: RouterHooks
): Promise<boolean> {
  let pendingShown = false;
  const pendingTimer = setTimeout(() => {
    pendingShown = true;
    hooks.onPending(true);
  }, PENDING_FEEDBACK_DELAY_MS);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await importThunk();
        return true;
      } catch (err) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          console.error("Failed to load route chunk:", err);
          notifyError(hooks.localize()("layout.page_load_failed"));
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  } finally {
    clearTimeout(pendingTimer);
    if (pendingShown) hooks.onPending(false);
  }
}

let prefetched = false;

/**
 * Warm the lazy route chunks once the browser is idle so a later Edit
 * click doesn't pay the chunk download on a degraded connection.
 * Failures are swallowed — the click path retries on its own.
 */
export function prefetchLazyRoutes(): void {
  if (prefetched) return;
  prefetched = true;
  const warm = () => {
    import("../../pages/device.js").catch(() => {});
    import("../../pages/secrets.js").catch(() => {});
  };
  if ("requestIdleCallback" in window) {
    requestIdleCallback(warm, { timeout: 5000 });
  } else {
    setTimeout(warm, 2000);
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
      enter: () => lazyEnter(() => import("../../pages/secrets.js"), hooks),
      render: () => html`<esphome-page-secrets></esphome-page-secrets>`,
    },
    {
      path: withBase("/device/:id"),
      enter: () => lazyEnter(() => import("../../pages/device.js"), hooks),
      render: ({ id }) =>
        html`<esphome-page-device .id=${decodeIdParam(id)}></esphome-page-device>`,
    },
  ]);
}
