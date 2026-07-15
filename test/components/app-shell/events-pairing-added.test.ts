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
    auto_provision_supported: false,
    friendly_name: "",
    ha_addon: false,
    reset_build_env_supported: false,
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

  it("preserves existing pairings when a new row is inserted", () => {
    const existing = makeSummary("0".repeat(64));
    const host: Host = {
      _buildOffloadPairings: new Map([[existing.pin_sha256, existing]]),
    };
    const added = makeSummary("a".repeat(64));

    dispatch(host, added);

    expect(host._buildOffloadPairings?.size).toBe(2);
    expect(host._buildOffloadPairings?.get("0".repeat(64))).toEqual(existing);
    expect(host._buildOffloadPairings?.get("a".repeat(64))).toEqual(added);
  });

  it("is idempotent when the row already exists (issuing tab)", () => {
    const summary = makeSummary("a".repeat(64));
    const host: Host = {
      _buildOffloadPairings: new Map([[summary.pin_sha256, summary]]),
    };

    dispatch(host, summary);

    expect(host._buildOffloadPairings?.size).toBe(1);
    expect(host._buildOffloadPairings?.get("a".repeat(64))).toEqual(summary);
  });
});
