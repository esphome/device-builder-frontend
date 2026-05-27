import { describe, expect, it } from "vitest";

import { APIError } from "../../src/api/api-error.js";
import { ErrorCode, type OffloaderPinMismatchAlert } from "../../src/api/types.js";
import {
  buildReauthPairRequest,
  classifyReauthError,
} from "../../src/components/reauth-wizard-dialog-helpers.js";

/**
 * The wizard's binding contract: the pin the operator
 * OOB-verified at step 1 (alert.observed_pin) is what gets
 * passed to request_pair as pin_sha256. The backend's TOCTOU
 * defense at controller.py:3055-3062 then compares its live
 * handshake against this value -- making the operator's
 * verification cryptographically bind to the eventual
 * pinned identity.
 *
 * If this contract ever regresses (the helper passes a
 * different pin, or re-observes via a separate preview_pair
 * call), the operator's verification stops binding and the
 * rotation-impersonation attack chain reopens. These tests
 * pin the contract so a future refactor can't silently
 * unbind it.
 */

function fixtureAlert(
  overrides: Partial<OffloaderPinMismatchAlert> = {}
): OffloaderPinMismatchAlert {
  return {
    kind: "pin_mismatch",
    receiver_hostname: "mac.koston.org",
    receiver_port: 6055,
    pin_sha256: "a".repeat(64),
    receiver_label: "mac.koston.org",
    expected_pin: "b".repeat(64),
    observed_pin: "c".repeat(64),
    fired_at: 1715600000,
    ...overrides,
  };
}

describe("buildReauthPairRequest", () => {
  it("passes alert.observed_pin as pin_sha256 (load-bearing security contract)", () => {
    const alert = fixtureAlert({ observed_pin: "deadbeef".repeat(8) });
    const args = buildReauthPairRequest(alert, "alexander.koston.org");
    // The pin in the request_pair args MUST be the value the
    // operator verified, not the alert's expected_pin (the
    // previously-confirmed value) or the alert's pin_sha256
    // (which is the row-keying field). A regression that
    // wired up the wrong field here would silently unbind
    // the wizard's verification from the eventual stored
    // pairing. See the security audit notes in
    // reauth-wizard-dialog-helpers.ts.
    expect(args.pin_sha256).toBe(alert.observed_pin);
  });

  it("does NOT pass alert.expected_pin (the stale-old pin)", () => {
    const alert = fixtureAlert();
    const args = buildReauthPairRequest(alert, "offloader");
    expect(args.pin_sha256).not.toBe(alert.expected_pin);
  });

  it("threads hostname / port / receiver_label from the alert", () => {
    const alert = fixtureAlert({
      receiver_hostname: "build.example.local",
      receiver_port: 7700,
      receiver_label: "Production builder",
    });
    const args = buildReauthPairRequest(alert, "offloader");
    expect(args.hostname).toBe("build.example.local");
    expect(args.port).toBe(7700);
    expect(args.receiver_label).toBe("Production builder");
  });

  it("threads offloader_label from the caller verbatim", () => {
    const alert = fixtureAlert();
    const args = buildReauthPairRequest(alert, "alexander.koston.org");
    expect(args.offloader_label).toBe("alexander.koston.org");
  });
});

describe("classifyReauthError", () => {
  it("treats PRECONDITION_FAILED as terminal (force re-OOB)", () => {
    // The load-bearing case: receiver's live pubkey differs
    // from the verified observed_pin RIGHT NOW. The
    // operator's step-1 verification is stale, so retrying
    // inline would silently rebind verification to a pin the
    // operator never saw. The wizard MUST close on this
    // outcome and force a restart from the alert.
    const err = new APIError(ErrorCode.PRECONDITION_FAILED, "pin changed");
    expect(classifyReauthError(err)).toEqual({ kind: "terminal_pin_changed" });
  });

  it("treats NO_PAIRING_WINDOW as retryable inline", () => {
    // Receiver-side admin hasn't opened the pairing window
    // yet. The operator's verification is still valid; just
    // wait for the admin and retry. Keep wizard open on
    // step 3.
    const err = new APIError(ErrorCode.NO_PAIRING_WINDOW, "");
    expect(classifyReauthError(err)).toEqual({
      kind: "retryable",
      errorKey: "settings.reauth_repair_no_window",
    });
  });

  it("treats UNAVAILABLE as retryable inline", () => {
    // Transport / network blip. Operator's verification
    // still valid; retry will pick up when the receiver
    // comes back. Keep wizard open on step 3.
    const err = new APIError(ErrorCode.UNAVAILABLE, "");
    expect(classifyReauthError(err)).toEqual({
      kind: "retryable",
      errorKey: "settings.reauth_repair_unreachable",
    });
  });

  it("treats unknown APIError codes as retryable with generic key", () => {
    const err = new APIError(ErrorCode.INTERNAL_ERROR, "");
    expect(classifyReauthError(err)).toEqual({
      kind: "retryable",
      errorKey: "settings.reauth_repair_failed",
    });
  });

  it("treats non-APIError throws as retryable with generic key", () => {
    expect(classifyReauthError(new Error("boom"))).toEqual({
      kind: "retryable",
      errorKey: "settings.reauth_repair_failed",
    });
    expect(classifyReauthError("string error")).toEqual({
      kind: "retryable",
      errorKey: "settings.reauth_repair_failed",
    });
    expect(classifyReauthError(null)).toEqual({
      kind: "retryable",
      errorKey: "settings.reauth_repair_failed",
    });
  });
});
