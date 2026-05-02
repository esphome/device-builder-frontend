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

  it("returns 'pending' on pending changes when mDNS hasn't confirmed encryption", () => {
    /* Take Control adds ``api: encryption: …`` to the YAML before
       the user has flashed. The running firmware is still the
       vendor image with no encryption, so the indicator must read
       "pending" — both for the brand-new ``null`` case (mDNS
       hasn't observed the device yet) and the ``""`` case (mDNS
       confirms the device is broadcasting plaintext). The
       previous behaviour fell through to "active" via the null
       path and showed a green lock for an unencrypted device. */
    for (const observed of [null, ""]) {
      expect(
        getEncryptionState(
          inputs({ api_encryption_active: observed, has_pending_changes: true }),
        ),
      ).toBe("pending");
    }
  });

  it("stays 'active' when mDNS confirms encryption even with pending changes", () => {
    /* Comment / whitespace / unrelated YAML edit on a device that
       is already running encrypted firmware — the running
       firmware still answers Noise on the wire, so encryption is
       live. ``has_pending_changes`` here means "YAML differs from
       last compile", not "encryption is about to change". Truth
       on the wire wins. */
    expect(
      getEncryptionState(
        inputs({
          api_encryption_active: "Noise_NNpsk0_25519_ChaChaPoly_SHA256",
          has_pending_changes: true,
        }),
      ),
    ).toBe("active");
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
