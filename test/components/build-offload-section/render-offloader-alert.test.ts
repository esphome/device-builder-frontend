/**
 * The alert's Unpair action is a text button and must use the padded
 * text style, never the pairing row's 32×32 icon-only ``btn-unpair``
 * (text overflowed the square and read as an unstyled button, #766).
 */
import { describe, expect, it, vi } from "vitest";
import type {
  OffloaderPeerRevokedAlert,
  OffloaderPinMismatchAlert,
} from "../../../src/api/types/remote-build-events.js";
import { renderOffloaderAlert } from "../../../src/components/settings-dialog/build-offload-alert.js";

const localize = (key: string) => key;

const pinMismatch: OffloaderPinMismatchAlert = {
  kind: "pin_mismatch",
  receiver_hostname: "macbook-pro.local",
  receiver_port: 6053,
  pin_sha256: "abc123",
  receiver_label: "macbook-pro",
  expected_pin: "111111",
  observed_pin: "222222",
  fired_at: 1_700_000_000,
};

const peerRevoked: OffloaderPeerRevokedAlert = {
  kind: "peer_revoked",
  receiver_hostname: "macbook-pro.local",
  receiver_port: 6053,
  pin_sha256: "abc123",
  receiver_label: "macbook-pro",
  fired_at: 1_700_000_000,
};

const ctx = () => ({ localize, onRepair: vi.fn(), onUnpair: vi.fn() });

describe("renderOffloaderAlert", () => {
  it("styles the pin-mismatch actions as a primary Re-pair and a text Unpair", () => {
    const markup = renderOffloaderAlert(pinMismatch, ctx()).strings.join("");
    expect(markup).toContain('class="btn-pair-build-server"');
    expect(markup).toContain('class="offloader-alert-unpair"');
    expect(markup).not.toContain('class="btn-unpair"');
  });

  it("styles the peer-revoked Unpair as a text button", () => {
    const markup = renderOffloaderAlert(peerRevoked, ctx()).strings.join("");
    expect(markup).toContain('class="offloader-alert-unpair"');
    expect(markup).not.toContain('class="btn-unpair"');
  });
});
