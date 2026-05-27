import { APIError } from "../../api/index.js";
import { ErrorCode } from "../../api/types.js";
import type { ESPHomeApp } from "../app-shell.js";

// Parse the "try again in Xs" hint out of the backend's rate-limit details.
export function parseRateLimitSeconds(details: string): number {
  const match = /in\s+(\d+)\s*s/.exec(details);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function onLoginSubmit(
  host: ESPHomeApp,
  e: CustomEvent<{ username: string; password: string }>
): Promise<void> {
  if (host._authState === "authing") return;
  host._authState = "authing";
  host._authError = null;
  try {
    await host._api.login(e.detail);
    // api.login resolved api.ready — the onConnected.then chain in init
    // picks it up and calls _afterAuthenticated which flips to "authed".
  } catch (err) {
    host._authState = "needs-login";
    if (!host._apiConnected) {
      // Socket dropped mid-login. The form already shows "Reconnecting…"
      // via the disconnected prop; surfacing a stale "sign-in failed"
      // toast on top would just be noise — the user can retry on reconnect.
      host._authError = null;
      host._rateLimitedUntil = 0;
      return;
    }
    if (err instanceof APIError) {
      if (err.errorCode === ErrorCode.NOT_AUTHENTICATED) {
        host._authError = host._localize("auth.invalid_credentials");
        host._rateLimitedUntil = 0;
        return;
      }
      if (err.errorCode === ErrorCode.RATE_LIMITED) {
        const seconds = parseRateLimitSeconds(err.details);
        if (seconds > 0) {
          host._rateLimitedUntil = Date.now() + seconds * 1000;
          host._authError = host._localize("auth.rate_limited", { seconds });
        } else {
          host._rateLimitedUntil = 0;
          host._authError = host._localize("auth.rate_limited_generic");
        }
        return;
      }
    }
    console.error("Unexpected sign-in error:", err);
    host._authError = host._localize("auth.unexpected_error");
    host._rateLimitedUntil = 0;
  }
}
