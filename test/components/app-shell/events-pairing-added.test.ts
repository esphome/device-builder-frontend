import { describe, expect, it } from "vitest";
import { DeviceEventType } from "../../../src/api/types/event-subscription.js";
import type { PairingSummary } from "../../../src/api/types/remote-build.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";

function makeSummary(pin: string): PairingSummary {
  return {
    receiver_hostname: "192.168.1.50",
    receiver_port: 6052,
    pin_sha256: pin,
    label: "lab-receiver",
    paired_at: 1,
    status: "pending",
    connected: false,
    connecting: false,
    last_connect_error: "",
    esphome_version: "",
    enabled: true,
  };
}

type Host = Pick<ESPHomeApp, "_buildOffloadPairings">;

function dispatch(host: Host, summary: PairingSummary): void {
  handleEvent(host as ESPHomeApp, DeviceEventType.OFFLOADER_PAIRING_ADDED, summary);
}

describe("handleEvent OFFLOADER_PAIRING_ADDED", () => {
  it("builds the new row in a tab that didn't issue request_pair", () => {
    const host: Host = { _buildOffloadPairings: new Map() };
    const summary = makeSummary("a".repeat(64));

    dispatch(host, summary);

    expect(host._buildOffloadPairings?.get("a".repeat(64))).toEqual(summary);
  });

  it("no-ops when the pairings snapshot has not been seeded", () => {
    const host: Host = { _buildOffloadPairings: null };

    dispatch(host, makeSummary("b".repeat(64)));

    expect(host._buildOffloadPairings).toBeNull();
  });
});
