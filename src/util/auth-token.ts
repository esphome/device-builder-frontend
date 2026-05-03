/**
 * Persistent storage for the dashboard auth token.
 *
 * The backend hands out an opaque token after a successful
 * username/password login (``auth/login``). Storing it in localStorage
 * lets a returning browser skip the password form and re-authenticate
 * silently — the API client sends the stored token on (re)connect, and
 * only falls back to the login UI when the server rejects with
 * ``not_authenticated``.
 *
 * ``expires_at`` is kept for diagnostic purposes only. The backend
 * auto-refreshes the expiry on every authenticated message (sliding
 * 30-day window), so client-side expiry checks are unreliable thanks
 * to clock skew — we always send the stored token if present and let
 * the server reject if it's actually invalid.
 */

const KEY = "esphome.auth-token";

interface StoredAuthToken {
  token: string;
  expires_at: number;
}

/** Read the stored token, or null when no usable token is present. */
export function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuthToken;
    if (typeof parsed?.token !== "string" || !parsed.token) return null;
    return parsed.token;
  } catch {
    // Private mode / sandboxed iframes / corrupted JSON — treat as
    // no stored token, the user can sign in again.
    return null;
  }
}

/** Persist a freshly-issued token + its expires_at (unix seconds). */
export function setStoredToken(token: string, expiresAt: number): void {
  try {
    const value: StoredAuthToken = { token, expires_at: expiresAt };
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // No-op — see comment in getStoredToken. The session still
    // works for this tab via the in-memory token on the API client.
  }
}

/** Drop the stored token (logout, or after the server rejects it). */
export function clearStoredToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore — see comment in getStoredToken.
  }
}
