import { APIError } from "../api/api-error.js";
import { ErrorCode, type OffloaderPinMismatchAlert } from "../api/types.js";

/** Args shape of {@link ESPHomeAPI.requestRemoteBuildPair}.
 *  Mirrored locally rather than imported because the API
 *  method declares the shape inline; pinning it here keeps
 *  the security-contract test honest if the API ever evolves. */
export interface ReauthPairRequestArgs {
  hostname: string;
  port: number;
  pin_sha256: string;
  receiver_label: string;
  offloader_label: string;
}

/**
 * Pure helpers for the reauth wizard dialog.
 *
 * Extracted to a sibling module so the security-critical
 * binding contract -- 'request_pair is called with the same
 * pin_sha256 value the operator OOB-verified at step 1' --
 * is unit-testable without standing up the wizard's lit
 * element + dom + context consumers. The wizard's
 * '_onConfirm' method composes these helpers; tests pin the
 * pure outputs.
 */

/**
 * Build the request_pair arguments for a re-pair after
 * OOB-verification at the wizard's step 1.
 *
 * The pin_sha256 field MUST be 'alert.observed_pin' -- that
 * is the cryptographic identity the operator confirmed in
 * the wizard, and the backend's TOCTOU defense at
 * controller.py:3055-3062 compares its live handshake
 * pubkey against this value to reject any in-flight host
 * substitution. A regression that passed a different value
 * (or re-observed via a separate preview_pair call) would
 * silently unbind the operator's verification from the
 * eventual pinned identity, reopening the
 * rotation-impersonation attack chain PR #310 was filed to
 * close.
 *
 * offloader_label is informational on the re-pair path:
 * controller.py:4690-4700 returns IntentResponse.APPROVED
 * without touching the StoredPeer row when the offloader
 * pubkey still matches (which it does -- only the receiver
 * rotated, not the offloader). The label here just goes out
 * on the wire and gets ignored. We send the same pre-fill
 * the fresh-pair dialog uses for consistency.
 */
export function buildReauthPairRequest(
  alert: OffloaderPinMismatchAlert,
  offloaderLabel: string
): ReauthPairRequestArgs {
  return {
    hostname: alert.receiver_hostname,
    port: alert.receiver_port,
    pin_sha256: alert.observed_pin,
    receiver_label: alert.receiver_label,
    offloader_label: offloaderLabel,
  };
}

/**
 * The wizard's terminal-vs-retryable classification of a
 * request_pair failure.
 *
 * PRECONDITION_FAILED is the load-bearing case: the
 * receiver's live pubkey differs from the value the
 * operator just verified, so the verification is stale and
 * the operator must restart from the alert (which re-fires
 * preview_pair and resurfaces the wizard with a fresh
 * observation to verify). Retrying inline would silently
 * rebind the verification to a pin the operator never
 * actually saw.
 *
 * NO_PAIRING_WINDOW and UNAVAILABLE keep the verification
 * valid -- the request never reached the binding stage --
 * so the wizard stays open on step 3 with an inline error
 * block and a 'Try again' CTA that re-fires the same call.
 *
 * Anything else falls into the generic retryable bucket so
 * unexpected errors are recoverable without forcing a
 * re-OOB. (A subtle future regression where the backend
 * starts returning some other ErrorCode for a stale-pin
 * case would slip through here -- but that's the
 * 'fail-open on unknown error code' trade vs the
 * 'fail-closed on every transient' alternative, and the
 * load-bearing assertion is the PRECONDITION_FAILED branch
 * above.)
 */
export type ReauthErrorOutcome =
  | { kind: "terminal_pin_changed" }
  | { kind: "retryable"; errorKey: string };

export function classifyReauthError(err: unknown): ReauthErrorOutcome {
  if (err instanceof APIError) {
    if (err.errorCode === ErrorCode.PRECONDITION_FAILED) {
      return { kind: "terminal_pin_changed" };
    }
    if (err.errorCode === ErrorCode.NO_PAIRING_WINDOW) {
      return {
        kind: "retryable",
        errorKey: "settings.reauth_repair_no_window",
      };
    }
    if (err.errorCode === ErrorCode.UNAVAILABLE) {
      return {
        kind: "retryable",
        errorKey: "settings.reauth_repair_unreachable",
      };
    }
  }
  return { kind: "retryable", errorKey: "settings.reauth_repair_failed" };
}
