import { describe, expect, it } from "vitest";
import type { PairingSummary, PeerSummary } from "../../src/api/types/remote-build.js";
import {
  jobPeerDisplayName,
  pairingDisplayNameForPin,
  pairingDisplayName,
  peerDisplayName,
} from "../../src/util/pairing-display-name.js";

function pairing(overrides: Partial<PairingSummary> = {}): PairingSummary {
  return {
    receiver_hostname: "esphome-builder-xnnspgdv.local",
    receiver_port: 6056,
    pin_sha256: "a".repeat(64),
    label: "esphome-builder-xnnspgdv",
    paired_at: 1,
    status: "approved",
    connected: true,
    connecting: false,
    last_connect_error: "",
    esphome_version: "2026.6.5",
    enabled: true,
    auto_provision_supported: false,
    friendly_name: "",
    ha_addon: false,
    reset_build_env_supported: false,
    receiver_label_auto: false,
    ...overrides,
  };
}

function peer(overrides: Partial<PeerSummary> = {}): PeerSummary {
  return {
    dashboard_id: "abcdef0123456789",
    pin_sha256: "b".repeat(64),
    label: "localhost",
    paired_at: 1,
    status: "approved",
    peer_ip: "192.168.1.10",
    connected: true,
    friendly_name: "",
    ha_addon: false,
    label_auto: false,
    ...overrides,
  };
}

describe("pairingDisplayName", () => {
  it("replaces an auto-prefilled label with the friendly name", () => {
    expect(
      pairingDisplayName(
        pairing({ receiver_label_auto: true, friendly_name: "Nicks-Mac-Studio" })
      )
    ).toBe("Nicks-Mac-Studio");
  });

  it("keeps a custom label even when a friendly name is known", () => {
    expect(
      pairingDisplayName(
        pairing({ label: "Office Server", friendly_name: "Nicks-Mac-Studio" })
      )
    ).toBe("Office Server");
  });

  it("falls back to the label when no friendly name was captured", () => {
    expect(pairingDisplayName(pairing({ receiver_label_auto: true }))).toBe(
      "esphome-builder-xnnspgdv"
    );
  });

  it("maps the HA add-on container hostname to a human label", () => {
    expect(
      pairingDisplayName(
        pairing({
          receiver_label_auto: true,
          friendly_name: "0123abcd-esphome",
          ha_addon: true,
        })
      )
    ).toBe("Home Assistant App");
  });
});

describe("pairingDisplayNameForPin", () => {
  it("prefers the live pairing's display name over the snapshot", () => {
    const p = pairing({ receiver_label_auto: true, friendly_name: "Nicks-Mac-Studio" });
    const map = new Map([[p.pin_sha256, p]]);
    expect(pairingDisplayNameForPin(map, p.pin_sha256, "esphome-builder-xnnspgdv")).toBe(
      "Nicks-Mac-Studio"
    );
  });

  it("falls back to the snapshot label for an unknown or missing pin", () => {
    expect(pairingDisplayNameForPin(new Map(), "c".repeat(64), "snapshot")).toBe(
      "snapshot"
    );
    expect(pairingDisplayNameForPin(null, undefined, "snapshot")).toBe("snapshot");
  });
});

describe("peerDisplayName", () => {
  it("replaces an auto-prefilled label with the friendly name", () => {
    expect(peerDisplayName(peer({ label_auto: true, friendly_name: "Office-PC" }))).toBe(
      "Office-PC"
    );
  });

  it("keeps the label when label_auto is false (old offloader or custom)", () => {
    expect(peerDisplayName(peer({ friendly_name: "Office-PC" }))).toBe("localhost");
  });

  it("keeps the label when no friendly name arrived", () => {
    expect(peerDisplayName(peer({ label_auto: true }))).toBe("localhost");
  });
});

describe("jobPeerDisplayName", () => {
  it("prefers the live peer's display name over the job snapshot", () => {
    const p = peer({ label_auto: true, friendly_name: "Office-PC" });
    expect(
      jobPeerDisplayName([p], {
        remote_peer: p.dashboard_id,
        remote_peer_label: "localhost",
      })
    ).toBe("Office-PC");
  });

  it("falls back to the job's snapshot label, then the dashboard id", () => {
    expect(
      jobPeerDisplayName([], { remote_peer: "zz", remote_peer_label: "snapshot" })
    ).toBe("snapshot");
    expect(jobPeerDisplayName(null, { remote_peer: "zz", remote_peer_label: "" })).toBe(
      "zz"
    );
  });
});
