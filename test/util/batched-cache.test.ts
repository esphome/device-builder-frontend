import { describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { BatchedCache } from "../../src/util/batched-cache.js";

interface Ctx {
  platform: string;
}

const makeApi = () => ({ getComponentBodies: vi.fn() }) as unknown as ESPHomeAPI;

describe("BatchedCache", () => {
  it("does not collide when keys or bucket-keys contain the | delimiter", async () => {
    // Two callers whose flat ``${key}|${bucketKey}`` composition
    // would collide (``a|b`` + ``c`` and ``a`` + ``b|c``) MUST stay
    // distinct under the nested-map keying.
    const fetcher = vi.fn(
      (_api: ESPHomeAPI, keys: string[], ctx: Ctx): Promise<Record<string, string>> => {
        const result: Record<string, string> = {};
        for (const k of keys) result[k] = `${k}@${ctx.platform}`;
        return Promise.resolve(result);
      }
    );
    const cache = new BatchedCache<string, Ctx>({
      name: "test",
      bucketKey: (ctx) => ctx.platform,
      fetch: fetcher,
    });
    const api = makeApi();

    const [a, b] = await Promise.all([
      cache.fetch(api, "a|b", { platform: "c" }),
      cache.fetch(api, "a", { platform: "b|c" }),
    ]);

    expect(a).toBe("a|b@c");
    expect(b).toBe("a@b|c");
    expect(cache.getCached("a|b", { platform: "c" })).toBe("a|b@c");
    expect(cache.getCached("a", { platform: "b|c" })).toBe("a@b|c");
    // Different buckets → distinct fetcher invocations.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
