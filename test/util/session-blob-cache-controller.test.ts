import { describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import { SessionBlobCacheController } from "../../src/util/session-blob-cache-controller.js";
import { createSessionBlobCache } from "../../src/util/session-blob-cache.js";
import { flush } from "../_dom.js";
import { fakeHost } from "../_fake-host.js";

const fakeApi = (): ESPHomeAPI => ({}) as unknown as ESPHomeAPI;

/** A no-arg session-blob cache over a fetcher that resolves to ``payload``,
 *  exposed as the {@link SessionBlobCacheBinding} a controller consumes. */
const bindingFor = (payload: string[], fetcher = vi.fn(async () => payload)) => {
  const cache = createSessionBlobCache<string[]>({ name: "test", fetch: fetcher });
  return {
    binding: {
      getCached: () => cache.getCached(),
      subscribe: (cb: () => void) => cache.subscribe(cb),
      fetch: (api: ESPHomeAPI) => cache.fetch(api),
    },
    fetcher,
  };
};

describe("SessionBlobCacheController", () => {
  it("registers itself on the host at construction", () => {
    const host = fakeHost();
    const c = new SessionBlobCacheController(host, bindingFor([]).binding, () =>
      fakeApi()
    );
    expect(host.addController).toHaveBeenCalledWith(c);
  });

  it("exposes undefined until the first fetch resolves, then the cached value", async () => {
    const { binding } = bindingFor(["a", "b"]);
    const c = new SessionBlobCacheController(fakeHost(), binding, () => fakeApi());
    expect(c.value).toBeUndefined();
    c.hostUpdated();
    await flush();
    expect(c.value).toEqual(["a", "b"]);
  });

  it("kicks the fetch exactly once across many updates once the api lands", async () => {
    const { binding, fetcher } = bindingFor(["x"]);
    const c = new SessionBlobCacheController(fakeHost(), binding, () => fakeApi());
    c.hostUpdated();
    c.hostUpdated();
    c.hostUpdated();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not fetch while the api is absent, then fetches once it arrives", async () => {
    const { binding, fetcher } = bindingFor(["x"]);
    let api: ESPHomeAPI | undefined;
    const c = new SessionBlobCacheController(fakeHost(), binding, () => api);
    c.hostUpdated();
    expect(fetcher).not.toHaveBeenCalled();
    api = fakeApi();
    c.hostUpdated();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("repaints the host when the cache notifies while connected", async () => {
    const host = fakeHost();
    const { binding } = bindingFor(["x"]);
    const c = new SessionBlobCacheController(host, binding, () => fakeApi());
    c.hostConnected();
    c.hostUpdated();
    await flush();
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it("stops repainting after disconnect", async () => {
    const host = fakeHost();
    // Drive notifications by hand so the assertion is about the unsubscribe,
    // not fetch timing.
    const cache = createSessionBlobCache<string[]>({
      name: "test",
      fetch: async () => [],
    });
    const binding = {
      getCached: () => cache.getCached(),
      subscribe: (cb: () => void) => cache.subscribe(cb),
      fetch: (api: ESPHomeAPI) => cache.fetch(api),
    };
    const c = new SessionBlobCacheController(host, binding, () => fakeApi());
    c.hostConnected();
    cache.update(["one"]);
    const callsWhileConnected = (host.requestUpdate as ReturnType<typeof vi.fn>).mock
      .calls.length;
    expect(callsWhileConnected).toBeGreaterThan(0);
    c.hostDisconnected();
    cache.update(["two"]);
    expect((host.requestUpdate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsWhileConnected
    );
  });
});
