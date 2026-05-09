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

  it("produces distinct outputs across calls", () => {
    // Birthday-bound assertion: with 64+256 bits of entropy the
    // odds of two consecutive calls colliding are astronomical.
    // Run a small batch to catch a refactor that accidentally
    // reuses the random buffer. Hashing the (id, secret) pair
    // — rather than just one half — catches a bug where one
    // buffer is randomised and the other is reused stale.
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      const m = mintRemoteBuildBearer();
      seen.add(`${m.token_id}.${m.secret}`);
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

  it("encodes known bytes to the canonical base64url form", () => {
    // Pin the encoder against a deterministic input so a bug in
    // the alphabet replacement (e.g. only patching ``+`` and
    // forgetting ``/``) or in the padding strip can't pass by
    // luck on random bytes that happened not to trigger the
    // buggy path. The 8-byte id and 32-byte secret here are
    // chosen so the standard base64 output contains BOTH ``+``
    // and ``/`` and a trailing ``=``; the base64url form
    // transforms all three.
    //
    // Standard base64(0xfb,0xff,0xbf,0xfe,0xff,0xbf,0xfe,0xff)
    //                        = "+/+//v+//v8="
    // base64url (RFC 4648 §5) of the same:
    //                        = "-_-__v-__v8"  (12 → 11 chars, padding stripped)
    const idBytes = new Uint8Array([0xfb, 0xff, 0xbf, 0xfe, 0xff, 0xbf, 0xfe, 0xff]);
    // For the secret, just repeat a non-trivial pattern long
    // enough to fill 32 bytes; the goal is to exercise the
    // encoder over the longer length, not to pin the exact
    // string.
    const secretBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) secretBytes[i] = (i * 37) & 0xff;

    let call = 0;
    const fakeCrypto = {
      getRandomValues: <T extends ArrayBufferView>(view: T): T => {
        const target = view as unknown as Uint8Array;
        const src = call === 0 ? idBytes : secretBytes;
        target.set(src);
        call += 1;
        return view;
      },
    };
    vi.stubGlobal("crypto", fakeCrypto);
    try {
      const minted = mintRemoteBuildBearer();
      expect(minted.token_id).toBe("-_-__v-__v8");
      expect(minted.token_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      // No '+', '/', or '=' in either half.
      expect(minted.secret).not.toMatch(/[+/=]/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws if crypto.getRandomValues is unavailable", () => {
    // The backend can verify only the hash's shape, not its
    // entropy, so falling back to ``Math.random`` would silently
    // produce predictable bearers the backend would accept.
    // Refusing here surfaces the environment problem instead.
    //
    // Cleanup uses ``vi.unstubAllGlobals()`` rather than
    // re-stubbing with the original — Vitest tracks stubs in an
    // internal stack, and a second ``stubGlobal`` push leaves
    // stack state dirty and can fail to restore the original
    // property descriptor on globals that were defined as
    // non-configurable. Same pattern as the
    // ``encodes known bytes`` test above.
    try {
      vi.stubGlobal("crypto", undefined);
      expect(() => mintRemoteBuildBearer()).toThrow(
        /crypto\.getRandomValues is unavailable/
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
