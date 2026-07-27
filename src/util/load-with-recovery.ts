import { APIError } from "../api/api-error.js";
import { sleep } from "./sleep.js";

export interface LoadWithRecoveryOptions<T> {
  /** Parks while the socket is down, so an outage costs no attempts. */
  ready: () => Promise<void>;
  load: () => Promise<T>;
  /** True once the result is no longer wanted (unmounted, id moved on). */
  abandoned?: () => boolean;
  /** Transport attempts before the failure is surfaced; default unlimited. */
  attempts?: number;
  retryDelayMs?: number;
}

/** Thrown when ``abandoned()`` goes true; callers drop it silently. */
export class LoadAbandonedError extends Error {
  constructor() {
    super("Load abandoned");
    this.name = "LoadAbandonedError";
  }
}

const DEFAULT_RETRY_DELAY_MS = 1500;

/**
 * Run a fetch that survives a flaky link.
 *
 * A transport fault (socket closed mid-request, command timeout) retries
 * after a backoff rather than surfacing: the request is one the user is
 * waiting on, and the socket auto-reconnects. An ``APIError`` means the
 * server answered, so it is final and rethrown immediately.
 */
export async function loadWithRecovery<T>(opts: LoadWithRecoveryOptions<T>): Promise<T> {
  const limit = opts.attempts ?? Infinity;
  for (let attempt = 1; ; attempt++) {
    await opts.ready();
    if (opts.abandoned?.()) throw new LoadAbandonedError();
    try {
      return await opts.load();
    } catch (err) {
      if (err instanceof APIError || attempt >= limit) throw err;
      console.warn(`Load failed (attempt ${attempt}); retrying:`, err);
      await sleep(opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
      if (opts.abandoned?.()) throw new LoadAbandonedError();
    }
  }
}
