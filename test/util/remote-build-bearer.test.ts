import { describe, expect, it, vi } from "vitest";
import { sha256 } from "js-sha256";
import {
  REMOTE_BUILD_SECRET_CHARS,
  REMOTE_BUILD_SECRET_SHA256_CHARS,
  REMOTE_BUILD_TOKEN_ID_CHARS,
  mintRemoteBuildBearer,
} from "../../src/util/remote-build-bearer.js";

describe("mintRemoteBuildBearer", () => {
  it("returns a token_id of exactly 11 base64url chars", () => {
    const minted = mintRemoteBuildBearer();
    expect(minted.token_id.length).toBe(REMOTE_BUILD_TOKEN_ID_CHARS);
    // Backend's _validate_token_id pins this length so the
    // 64-bit collision math at the 100-token cap stays
    // load-bearing. A drift here would silently widen the
    // namespace.
    expect(minted.token_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it("returns a secret of exactly 43 base64url chars", () => {
    const minted = mintRemoteBuildBearer();
    expect(minted.secret.length).toBe(REMOTE_BUILD_SECRET_CHARS);
    expect(minted.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns secret_sha256 = sha256(secret) as 64 lowercase hex chars", () => {
    const minted = mintRemoteBuildBearer();
    expect(minted.secret_sha256.length).toBe(REMOTE_BUILD_SECRET_SHA256_CHARS);
    expect(minted.secret_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Pin the relationship: backend stores secret_sha256 and
    // verifies via hmac.compare_digest(stored, sha256(presented))
    // — if the frontend's hash diverges from this formula, every
    // ``add_token`` produces an unverifiable token.
    expect(minted.secret_sha256).toBe(sha256(minted.secret));
  });

  it("returns bearer in the canonical {token_id}.{secret} wire form", () => {
    const minted = mintRemoteBuildBearer();
    expect(minted.bearer).toBe(`${minted.token_id}.${minted.secret}`);
  });

  it("produces distinct outputs across calls", () => {
    // Birthday-bound assertion: with 64+256 bits of entropy the
    // odds of two consecutive calls colliding are astronomical.
    // Run a small batch to catch a refactor that accidentally
    // reuses the random buffer.
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      seen.add(mintRemoteBuildBearer().bearer);
    }
    expect(seen.size).toBe(64);
  });

  it("base64url alphabet only — no '+' / '/' / padding", () => {
    // Run a few iterations to exercise different random bytes.
    for (let i = 0; i < 16; i++) {
      const minted = mintRemoteBuildBearer();
      expect(minted.token_id).not.toMatch(/[+/=]/);
      expect(minted.secret).not.toMatch(/[+/=]/);
    }
  });

  it("throws if crypto.getRandomValues is unavailable", () => {
    // The backend can verify only the hash's shape, not its
    // entropy, so falling back to ``Math.random`` would silently
    // produce predictable bearers the backend would accept.
    // Refusing here surfaces the environment problem instead.
    const original = globalThis.crypto;
    try {
      vi.stubGlobal("crypto", undefined);
      expect(() => mintRemoteBuildBearer()).toThrow(
        /crypto\.getRandomValues is unavailable/
      );
    } finally {
      vi.stubGlobal("crypto", original);
    }
  });
});
