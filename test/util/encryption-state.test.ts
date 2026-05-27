import { describe, expect, it } from "vitest";
import {
  getCompactEncryptionVisual,
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
        inputs({
          api_enabled: false,
          api_encrypted: true,
          api_encryption_active: "Noise_...",
        })
      )
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
    const stale = {
      ...inputs(),
      api_encryption_active: undefined,
    } as unknown as EncryptionInputs;
    expect(getEncryptionState(stale)).toBe("active");
  });

  it("returns 'active' when YAML encrypted and mDNS confirms encryption", () => {
    expect(
      getEncryptionState(
        inputs({ api_encryption_active: "Noise_NNpsk0_25519_ChaChaPoly_SHA256" })
      )
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
          inputs({ api_encryption_active: observed, has_pending_changes: true })
        )
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
        })
      )
    ).toBe("active");
  });

  it("returns 'mismatch' when YAML encrypted, mDNS reports plaintext, no pending changes", () => {
    expect(
      getEncryptionState(
        inputs({ api_encryption_active: "", has_pending_changes: false })
      )
    ).toBe("mismatch");
  });

  it("returns 'active' when mDNS confirms encryption even if YAML detection missed it", () => {
    /* Dashboard issue #437: a config that wires encryption via
       ESPHome's Jinja-templated packages (``api: |\n  # set ns =
       ...  ${ns.cfg}``) lands at the dashboard's
       ``yaml_util.load_yaml`` as ``api`` = literal string, the
       package merge clobbers it with the dict-shaped ``api:
       actions:`` from another package, and the YAML signal
       comes back ``api_encrypted: false``. The device's mDNS
       broadcast still carries the live cipher string because
       the firmware really IS running encryption — ESPHome's
       compile path renders the Jinja that the dashboard
       doesn't.

       Honour the wire: a truthy ``api_encryption_active``
       (``"Noise_..."``) means encryption is live regardless of
       whether the YAML pass found the encryption block. The
       previous behaviour returned "plaintext" here and showed
       an open-lock indicator on a fully-encrypted device.

       Same fix covers the symmetric case the previous logic
       also missed: a device flashed elsewhere whose YAML doesn't
       reflect the encryption that's already running on the
       hardware (e.g. firmware sourced from a backup, a config
       restore that lost the secret). The wire signal is the
       authoritative one; surfacing "plaintext" there misled
       operators into reflashing devices that didn't need it. */
    expect(
      getEncryptionState(
        inputs({
          api_encrypted: false,
          api_encryption_active: "Noise_NNpsk0_25519_ChaChaPoly_SHA256",
        })
      )
    ).toBe("active");
  });

  it("stays 'plaintext' when YAML disables encryption AND mDNS confirms plaintext", () => {
    /* The mDNS empty-string is "TXT seen, key absent → device
       confirmed plaintext"; combined with YAML saying plaintext
       this is unambiguously a non-encrypted device. The truth-on-
       the-wire short-circuit must NOT promote this to "active"
       just because ``api_encryption_active`` is non-null —
       only truthy strings (the live cipher) flip the state. */
    expect(
      getEncryptionState(inputs({ api_encrypted: false, api_encryption_active: "" }))
    ).toBe("plaintext");
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

describe("getCompactEncryptionVisual", () => {
  it("hides the lock when mDNS has confirmed encryption", () => {
    // Truthy api_encryption_active + active state → noisy steady
    // state, hidden in compact views.
    expect(
      getCompactEncryptionVisual(
        inputs({ api_encryption_active: "Noise_NNpsk0_25519_ChaChaPoly_SHA256" })
      )
    ).toBeNull();
  });

  it("keeps the lock when YAML enables encryption but mDNS hasn't broadcast", () => {
    // active state with null api_encryption_active is the
    // "waiting / unknown" case the issue explicitly wants visible.
    const v = getCompactEncryptionVisual(inputs({ api_encryption_active: null }));
    expect(v).not.toBeNull();
    expect(v!.cssClass).toBe("secure");
  });

  it("keeps showing the icon for plaintext / pending / mismatch states", () => {
    const plaintext = getCompactEncryptionVisual(
      inputs({ api_encrypted: false, api_encryption_active: null })
    );
    expect(plaintext?.cssClass).toBe("insecure");

    const pending = getCompactEncryptionVisual(
      inputs({ api_encryption_active: "", has_pending_changes: true })
    );
    expect(pending?.cssClass).toBe("pending");

    const mismatch = getCompactEncryptionVisual(inputs({ api_encryption_active: "" }));
    expect(mismatch?.cssClass).toBe("mismatch");
  });

  it("returns null when the API is disabled (no indicator at all)", () => {
    expect(getCompactEncryptionVisual(inputs({ api_enabled: false }))).toBeNull();
  });
});
