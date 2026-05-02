import { describe, expect, it } from "vitest";
import {
  getEncryptionState,
  getEncryptionVisual,
} from "../../src/util/encryption-state.js";
import type { EncryptionInputs } from "../../src/util/encryption-state.js";

function inputs(overrides: Partial<EncryptionInputs> = {}): EncryptionInputs {
  return {
    api_enabled: true,
    api_encrypted: true,
    api_encryption_active: null,
    has_pending_changes: false,
    ...overrides,
  };
}

describe("getEncryptionState", () => {
  it("returns 'none' when API is disabled, regardless of other fields", () => {
    expect(getEncryptionState(inputs({ api_enabled: false }))).toBe("none");
    expect(
      getEncryptionState(
        inputs({ api_enabled: false, api_encrypted: true, api_encryption_active: "Noise_..." }),
      ),
    ).toBe("none");
  });

  it("returns 'plaintext' when YAML disables encryption", () => {
    expect(getEncryptionState(inputs({ api_encrypted: false }))).toBe("plaintext");
  });

  it("returns 'active' when YAML encrypted, in sync, and mDNS not seen yet", () => {
    expect(getEncryptionState(inputs({ api_encryption_active: null }))).toBe("active");
  });

  it("treats undefined the same as null (older backend / cached payload)", () => {
    /* Cast through ``as unknown`` so we can simulate an older WS
       payload that omits the field entirely; ``EncryptionInputs``
       declares it required to keep call-site coverage tight. */
    const stale = { ...inputs(), api_encryption_active: undefined } as unknown as EncryptionInputs;
    expect(getEncryptionState(stale)).toBe("active");
  });

  it("returns 'active' when YAML encrypted and mDNS confirms encryption", () => {
    expect(
      getEncryptionState(
        inputs({ api_encryption_active: "Noise_NNpsk0_25519_ChaChaPoly_SHA256" }),
      ),
    ).toBe("active");
  });

  it("returns 'pending' on pending changes regardless of mDNS state", () => {
    /* Take Control adds ``api: encryption: …`` to the YAML before
       the user has flashed. The running firmware is still the
       vendor image with no encryption, so the indicator must read
       "pending" — even when mDNS hasn't observed the device yet
       (the previous behaviour fell through to "active" via the
       null/undefined path and showed a green lock for an
       unencrypted device). All three mDNS states collapse to
       "pending" once ``has_pending_changes`` is set. */
    for (const observed of [null, "", "Noise_NNpsk0_25519_ChaChaPoly_SHA256"]) {
      expect(
        getEncryptionState(
          inputs({ api_encryption_active: observed, has_pending_changes: true }),
        ),
      ).toBe("pending");
    }
  });

  it("returns 'mismatch' when YAML encrypted, mDNS reports plaintext, no pending changes", () => {
    expect(
      getEncryptionState(
        inputs({ api_encryption_active: "", has_pending_changes: false }),
      ),
    ).toBe("mismatch");
  });
});

describe("getEncryptionVisual", () => {
  it("returns null for the 'none' state", () => {
    expect(getEncryptionVisual("none")).toBeNull();
  });

  it("provides distinct icons and CSS classes for each non-none state", () => {
    const states = ["active", "plaintext", "pending", "mismatch"] as const;
    const seen = new Set<string>();
    for (const s of states) {
      const v = getEncryptionVisual(s);
      expect(v).not.toBeNull();
      expect(seen.has(v!.iconName)).toBe(false);
      seen.add(v!.iconName);
      expect(v!.cssClass).toBeTruthy();
      expect(v!.tooltipKey).toMatch(/^dashboard\./);
    }
  });
});
