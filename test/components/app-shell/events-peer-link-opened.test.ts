import { describe, expect, it } from "vitest";
import { DeviceEventType } from "../../../src/api/types/event-subscription.js";
import type { OffloaderPeerLinkOpenedEventData } from "../../../src/api/types/remote-build-events.js";
import type { PairingSummary } from "../../../src/api/types/remote-build.js";
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
  };
}

function opened(pin: string, esphome_version: string): OffloaderPeerLinkOpenedEventData {
  return {
    receiver_hostname: "192.168.1.50",
    receiver_port: 6052,
    pin_sha256: pin,
    esphome_version,
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
});
