import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { ReachabilityStateEvent } from "../../src/api/types/reachability.js";
import { captureReachabilitySnapshot } from "../../src/util/reachability-snapshot.js";

const EVENT = {
  active_source: "mdns",
  mdns_last_seen_seconds_ago: 300,
  mdns_ptr_ttl_seconds: 4500,
} as unknown as ReachabilityStateEvent;

describe("captureReachabilitySnapshot", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves the first event and unsubscribes", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const api = {
      // The event lands before the subscribe call resolves.
      subscribeDeviceReachability: vi.fn(
        async (_name: string, cb: (state: ReachabilityStateEvent) => void) => {
          cb(EVENT);
          return { unsubscribe };
        }
      ),
    } as unknown as ESPHomeAPI;
    expect(await captureReachabilitySnapshot(api, "garage")).toBe(EVENT);
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
  });

  it("resolves null on timeout and still unsubscribes", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const api = {
      subscribeDeviceReachability: vi.fn(async () => ({ unsubscribe })),
    } as unknown as ESPHomeAPI;
    const result = captureReachabilitySnapshot(api, "garage");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBeNull();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("resolves null when the subscribe call rejects", async () => {
    const api = {
      subscribeDeviceReachability: vi
        .fn()
        .mockRejectedValue(new Error("WebSocket not connected")),
    } as unknown as ESPHomeAPI;
    expect(await captureReachabilitySnapshot(api, "garage")).toBeNull();
  });
});
