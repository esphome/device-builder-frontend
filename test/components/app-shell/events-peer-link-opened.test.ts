import { describe, expect, it } from "vitest";
import { DeviceEventType } from "../../../src/api/types/event-subscription.js";
import type {
  OffloaderPeerLinkOpenedEventData,
  ReceiverPeerLinkSessionOpenedEventData,
} from "../../../src/api/types/remote-build-events.js";
import type { PairingSummary, PeerSummary } from "../../../src/api/types/remote-build.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";

function makeSummary(pin: string, esphome_version: string): PairingSummary {
  return {
    receiver_hostname: "192.168.1.50",
    receiver_port: 6052,
    pin_sha256: pin,
    label: "lab-receiver",
    paired_at: 1,
    status: "approved",
    connected: false,
    connecting: true,
    last_connect_error: "boom",
    esphome_version,
    enabled: true,
    auto_provision_supported: false,
    friendly_name: "",
    ha_addon: false,
    reset_build_env_supported: false,
    receiver_label_auto: false,
  };
}

function opened(
  pin: string,
  esphome_version: string,
  extra?: Partial<OffloaderPeerLinkOpenedEventData>
): OffloaderPeerLinkOpenedEventData {
  return {
    receiver_hostname: "192.168.1.50",
    receiver_port: 6052,
    pin_sha256: pin,
    esphome_version,
    auto_provision_supported: false,
    friendly_name: "",
    ha_addon: false,
    reset_build_env_supported: false,
    ...extra,
  };
}

type Host = Pick<ESPHomeApp, "_buildOffloadPairings">;

function dispatch(host: Host, evt: OffloaderPeerLinkOpenedEventData): void {
  handleEvent(host as ESPHomeApp, DeviceEventType.OFFLOADER_PEER_LINK_OPENED, evt);
}

describe("handleEvent OFFLOADER_PEER_LINK_OPENED", () => {
  it("merges the freshly-handshaked esphome_version into the row", () => {
    const pin = "a".repeat(64);
    const host: Host = {
      _buildOffloadPairings: new Map([[pin, makeSummary(pin, "2026.5.0")]]),
    };

    dispatch(host, opened(pin, "2026.6.0"));

    const row = host._buildOffloadPairings?.get(pin);
    expect(row?.esphome_version).toBe("2026.6.0");
    expect(row?.connected).toBe(true);
    expect(row?.connecting).toBe(false);
    expect(row?.last_connect_error).toBe("");
  });

  it("no-ops when the row is not in the map", () => {
    const host: Host = { _buildOffloadPairings: new Map() };

    dispatch(host, opened("b".repeat(64), "2026.6.0"));

    expect(host._buildOffloadPairings?.size).toBe(0);
  });

  it("patches capability and display identity; a non-empty name refreshes", () => {
    const pin = "a".repeat(64);
    const host: Host = {
      _buildOffloadPairings: new Map([[pin, makeSummary(pin, "2026.5.0")]]),
    };

    dispatch(
      host,
      opened(pin, "2026.6.0", {
        auto_provision_supported: true,
        friendly_name: "Nicks-Mac-Studio",
        ha_addon: true,
      })
    );

    const row = host._buildOffloadPairings?.get(pin);
    expect(row?.auto_provision_supported).toBe(true);
    expect(row?.friendly_name).toBe("Nicks-Mac-Studio");
    expect(row?.ha_addon).toBe(true);
  });

  it("keeps a captured friendly_name when an OPENED carries an empty one", () => {
    const pin = "a".repeat(64);
    const seeded = { ...makeSummary(pin, "2026.5.0"), friendly_name: "Nicks-Mac-Studio" };
    const host: Host = { _buildOffloadPairings: new Map([[pin, seeded]]) };

    dispatch(host, opened(pin, "2026.6.0", { friendly_name: "" }));

    expect(host._buildOffloadPairings?.get(pin)?.friendly_name).toBe("Nicks-Mac-Studio");
  });
});

function makePeer(overrides: Partial<PeerSummary> = {}): PeerSummary {
  return {
    dashboard_id: "dash-1",
    pin_sha256: "b".repeat(64),
    label: "office-node",
    paired_at: 1,
    status: "approved",
    peer_ip: "192.168.1.42",
    connected: false,
    friendly_name: "",
    ha_addon: false,
    label_auto: false,
    ...overrides,
  };
}

function receiverOpened(
  dashboard_id: string,
  extra?: Partial<ReceiverPeerLinkSessionOpenedEventData>
): ReceiverPeerLinkSessionOpenedEventData {
  return { dashboard_id, friendly_name: "", ha_addon: false, ...extra };
}

type ReceiverHost = Pick<ESPHomeApp, "_buildServerPeers">;

function dispatchReceiver(
  host: ReceiverHost,
  event: string,
  evt: ReceiverPeerLinkSessionOpenedEventData
): void {
  handleEvent(host as ESPHomeApp, event, evt);
}

describe("handleEvent RECEIVER_PEER_LINK_SESSION_OPENED", () => {
  it("flips connected true, patches ha_addon, and refreshes a non-empty friendly_name", () => {
    const host: ReceiverHost = { _buildServerPeers: [makePeer()] };

    dispatchReceiver(
      host,
      DeviceEventType.RECEIVER_PEER_LINK_SESSION_OPENED,
      receiverOpened("dash-1", { friendly_name: "Office-PC", ha_addon: true })
    );

    const peer = host._buildServerPeers?.[0];
    expect(peer?.connected).toBe(true);
    expect(peer?.friendly_name).toBe("Office-PC");
    expect(peer?.ha_addon).toBe(true);
  });

  it("keeps a captured friendly_name on an empty OPENED but still flips connected", () => {
    const host: ReceiverHost = {
      _buildServerPeers: [makePeer({ friendly_name: "Office-PC" })],
    };

    dispatchReceiver(
      host,
      DeviceEventType.RECEIVER_PEER_LINK_SESSION_OPENED,
      receiverOpened("dash-1", { friendly_name: "" })
    );

    const peer = host._buildServerPeers?.[0];
    expect(peer?.connected).toBe(true);
    expect(peer?.friendly_name).toBe("Office-PC");
  });

  it("CLOSED flips connected false without touching identity", () => {
    const host: ReceiverHost = {
      _buildServerPeers: [makePeer({ connected: true, friendly_name: "Office-PC" })],
    };

    dispatchReceiver(
      host,
      DeviceEventType.RECEIVER_PEER_LINK_SESSION_CLOSED,
      receiverOpened("dash-1")
    );

    const peer = host._buildServerPeers?.[0];
    expect(peer?.connected).toBe(false);
    expect(peer?.friendly_name).toBe("Office-PC");
  });

  it("no-ops when the peers list is not yet seeded", () => {
    const host: ReceiverHost = { _buildServerPeers: null };

    dispatchReceiver(
      host,
      DeviceEventType.RECEIVER_PEER_LINK_SESSION_OPENED,
      receiverOpened("dash-1", { friendly_name: "Office-PC" })
    );

    expect(host._buildServerPeers).toBeNull();
  });
});
