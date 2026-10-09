/**
 * A vendor file fetched at flash time from one pinned URL and accepted only
 * when its SHA-256 is the pinned one: the loaders the LN882H and RTL8720D
 * flashers put on a chip, which are not ours to ship. Fetched once per
 * page; a failed fetch is forgotten so that Retry fetches again.
 */
import { toHex } from "./bytes.js";
import { getErrorMessage } from "./error-message.js";

export interface PinnedFetch {
  load(): Promise<Uint8Array<ArrayBuffer>>;
  /** Forget the fetched copy; for tests. */
  reset(): void;
}

/**
 * ``fail`` makes the error for a download that failed (``detail`` is why)
 * or a file whose digest is not ``sha256`` (``detail`` is the digest found).
 */
export function pinnedFetch(
  url: string,
  sha256: string,
  fail: (kind: "unavailable" | "mismatch", detail: string) => Error
): PinnedFetch {
  let cached: Promise<Uint8Array<ArrayBuffer>> | undefined;
  const fetchOnce = async (): Promise<Uint8Array<ArrayBuffer>> => {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      throw fail("unavailable", getErrorMessage(err));
    }
    const digest = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
    if (digest !== sha256) throw fail("mismatch", digest);
    return bytes;
  };
  return {
    load: () => {
      cached ??= fetchOnce().catch((err: unknown) => {
        cached = undefined;
        throw err;
      });
      return cached;
    },
    reset: () => {
      cached = undefined;
    },
  };
}
