import { APIError } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/index.js";
import { sleep } from "./sleep.js";

const RETRY_DELAY_MS = 1500;

export interface LoadConfigOptions {
  /** True once the result is no longer wanted (unmounted, id moved on). */
  abandoned?: () => boolean;
  /** Transport attempts before the failure surfaces. */
  attempts: number;
  /** Overrides the command default, which is short for a large config. */
  timeoutMs?: number;
}

/**
 * Read a YAML config for a page the user is waiting on, surviving a flaky
 * link.
 *
 * A transport fault (socket closed mid-request, command timeout) retries
 * after a backoff rather than surfacing: the request is one the user is
 * waiting on, and the socket auto-reconnects. An ``APIError`` means the
 * server answered, so it is final and rethrown. Waiting on ``api.ready``
 * parks for the whole outage, so attempts are only spent while the socket
 * is up. Returns ``null`` once ``abandoned()`` goes true, including for a
 * reply that lands after the caller moved on.
 */
export async function loadConfigWithRecovery(
  api: ESPHomeAPI,
  configuration: string,
  opts: LoadConfigOptions
): Promise<string | null> {
  for (let attempt = 1; ; attempt++) {
    if (opts.abandoned?.()) return null;
    await api.ready;
    if (opts.abandoned?.()) return null;
    try {
      const yaml = await api.getConfig(configuration, opts.timeoutMs);
      return opts.abandoned?.() ? null : yaml;
    } catch (err) {
      if (err instanceof APIError || attempt >= opts.attempts) throw err;
      if (opts.abandoned?.()) return null;
      console.warn(`Load failed (attempt ${attempt}); retrying:`, err);
      await sleep(RETRY_DELAY_MS);
    }
  }
}
