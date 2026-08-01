import type { ESPHomeAPI } from "../api/index.js";
import type {
  ReachabilityStateEvent,
  ReachabilitySubscription,
} from "../api/types/reachability.js";

/**
 * One-shot reachability snapshot: the per-device subscription pushes its
 * initial state immediately, so subscribe, take the first event, and
 * unsubscribe. Bounded by *timeoutMs* and resolves null on timeout or
 * error — a report prefill must not stall on a reachability hiccup.
 */
export function captureReachabilitySnapshot(
  api: ESPHomeAPI,
  deviceName: string,
  timeoutMs = 3000
): Promise<ReachabilityStateEvent | null> {
  return new Promise((resolve) => {
    let subscription: ReachabilitySubscription | null = null;
    let done = false;
    const finish = (state: ReachabilityStateEvent | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void subscription?.unsubscribe().catch(() => undefined);
      resolve(state);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    api
      .subscribeDeviceReachability(deviceName, (state) => finish(state))
      .then((sub) => {
        subscription = sub;
        // The snapshot may have landed before the subscribe call resolved.
        if (done) void sub.unsubscribe().catch(() => undefined);
      })
      .catch(() => finish(null));
  });
}
