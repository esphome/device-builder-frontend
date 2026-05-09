/**
 * Client-side bearer mint for remote-build receiver tokens.
 *
 * Phase 3b3 of issue #106 moved bearer generation from the
 * backend to the frontend so the cleartext never crosses the wire
 * to the dashboard. This closes the leak that would otherwise
 * occur on plain-HTTP standalone deployments where the main port
 * (default 6052) carries the WS API in cleartext.
 *
 * Wire format the receiver expects:
 *
 *   Authorization: Bearer {token_id}.{secret}
 *
 * where ``token_id`` is the textual form of 8 random bytes after
 * base64url encoding (exactly 11 chars; the receiver pins the
 * length so the 64-bit collision math at the 100-token cap stays
 * load-bearing) and ``secret`` is 32 random bytes after base64url
 * encoding (43 chars, 256 bits of entropy — infeasible to
 * brute-force).
 *
 * The frontend POSTs only ``{label, token_id, secret_sha256}`` to
 * ``remote_build/add_token``; the cleartext stays in local state
 * long enough for the user to copy it into the offloader and is
 * then discarded.
 *
 * RNG: ``crypto.getRandomValues`` is the ONLY acceptable source.
 * A fallback to ``Math.random`` (or any other non-CSPRNG) is a
 * security regression: the backend can verify only the hash's
 * shape, not its entropy, so a weak source would produce
 * predictable bearers that the backend silently accepts. The
 * function throws if ``crypto.getRandomValues`` is missing rather
 * than substituting a weaker source.
 *
 * Hash: ``js-sha256`` rather than ``crypto.subtle.digest``
 * because ``crypto.subtle`` requires a "secure context" per the
 * spec, which the dashboard often isn't (HA-addon direct port,
 * container deployments on plain HTTP at non-localhost LAN IPs).
 * ``crypto.getRandomValues`` has no such restriction and works
 * everywhere.
 */

import { sha256 } from "js-sha256";

/** Wire-format constraints from the backend's ``_validate_token_id``. */
export const REMOTE_BUILD_TOKEN_ID_BYTES = 8;
export const REMOTE_BUILD_TOKEN_ID_CHARS = 11;
export const REMOTE_BUILD_SECRET_BYTES = 32;
export const REMOTE_BUILD_SECRET_CHARS = 43;
export const REMOTE_BUILD_SECRET_SHA256_CHARS = 64;

/**
 * Result of {@link mintRemoteBuildBearer}.
 *
 * ``token_id`` and ``secret_sha256`` are what we POST to the
 * backend via ``add_token``; ``secret`` is the cleartext half
 * the caller shows to the user once for copy-into-offloader.
 * The caller composes the wire bearer as
 * ``${token_id}.${secret}`` themselves at display time —
 * carrying a pre-composed ``bearer`` field here would put the
 * cleartext in two places and offers no compose-time safety
 * (JS has no zeroize), so we keep it on the caller.
 */
export interface MintedBearer {
  token_id: string;
  secret: string;
  secret_sha256: string;
}

/**
 * Mint a fresh ``(token_id, secret, secret_sha256)`` tuple.
 *
 * Throws if ``crypto.getRandomValues`` is unavailable. The
 * backend has no path to verify entropy, so falling back to a
 * weaker source would silently produce predictable bearers
 * that the backend would accept — refusing here surfaces the
 * environment problem instead. In practice
 * ``crypto.getRandomValues`` is available in every browser the
 * dashboard supports (it predates ``crypto.subtle`` and works
 * outside secure contexts), so the throw is a guard-rail
 * against a misconfigured test runner / Node polyfill, not a
 * realistic production failure mode.
 */
export function mintRemoteBuildBearer(): MintedBearer {
  const rng = globalThis.crypto;
  if (!rng?.getRandomValues) {
    throw new Error(
      "remote_build: crypto.getRandomValues is unavailable; refusing to mint a bearer with a weaker RNG"
    );
  }
  const idBytes = new Uint8Array(REMOTE_BUILD_TOKEN_ID_BYTES);
  const secretBytes = new Uint8Array(REMOTE_BUILD_SECRET_BYTES);
  rng.getRandomValues(idBytes);
  rng.getRandomValues(secretBytes);
  const token_id = base64UrlEncode(idBytes);
  const secret = base64UrlEncode(secretBytes);
  return { token_id, secret, secret_sha256: sha256(secret) };
}

/**
 * Encode bytes as base64url (RFC 4648 §5) without padding.
 *
 * Mirrors Python's ``secrets.token_urlsafe`` / Node's
 * ``Buffer.from(b).toString("base64url")``: ``+`` → ``-``,
 * ``/`` → ``_``, no trailing ``=``. Native ``btoa`` handles
 * standard base64 only; we patch the URL-safe alphabet and
 * trim padding ourselves so the output matches what the
 * backend's ``_validate_token_id`` expects.
 *
 * TODO: switch to
 * ``Uint8Array.prototype.toBase64({alphabet: "base64url", omitPadding: true})``
 * once the TC39 Uint8Array-base64 proposal ships in every
 * browser the dashboard supports. As of now (early 2026) it's
 * available in current Chrome / Safari / Firefox but not
 * broadly enough to drop the ``btoa`` fallback.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  // ``String.fromCharCode(...bytes)`` is fine for the small
  // inputs this helper handles (8 or 32 bytes); the call-stack
  // limit on argument count would only matter at much larger
  // sizes.
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
