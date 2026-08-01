import type { ESPHomeAPI } from "../api/index.js";
import type { ReachabilityStateEvent } from "../api/types/reachability.js";

/**
 * One-shot reachability snapshot: the per-device subscription pushes its
 * initial state immediately, so subscribe, take the first event, and
 * unsubscribe. Bounded by *timeoutMs* and resolves null on timeout or
 * error — a report prefill must not stall on a reachability hiccup.
 */
export async function captureReachabilitySnapshot(
  api: ESPHomeAPI,
  deviceName: string,
  timeoutMs = 3000
): Promise<ReachabilityStateEvent | null> {
  let first!: (state: ReachabilityStateEvent) => void;
  const firstEvent = new Promise<ReachabilityStateEvent>((resolve) => {
    first = resolve;
  });
  const subscribed = api.subscribeDeviceReachability(deviceName, (state) => first(state));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      // The event can land before the subscribe call resolves; racing
      // the chained copy as well surfaces a subscribe rejection.
      firstEvent,
      subscribed.then(() => firstEvent),
      new Promise<null>((resolve) => {
        timer = setTimeout(resolve, timeoutMs, null);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    void subscribed.then((sub) => sub.unsubscribe()).catch(() => undefined);
  }
}
