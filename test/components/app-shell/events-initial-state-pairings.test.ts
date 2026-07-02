import { describe, expect, it } from "vitest";
import {
  DeviceEventType,
  type InitialStateEventData,
} from "../../../src/api/types/event-subscription.js";
import type { PairingSummary } from "../../../src/api/types/remote-build.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";

function makeSummary(pin: string, enabled: boolean): PairingSummary {
  return {
    receiver_hostname: "192.168.1.50",
    receiver_port: 6052,
    pin_sha256: pin,
    label: "lab-receiver",
    paired_at: 1,
    status: "approved",
    connected: true,
    connecting: false,
    last_connect_error: "",
    esphome_version: "",
    enabled,
  };
}

type Host = Pick<ESPHomeApp, "_buildOffloadPairings" | "_offloaderWritesInFlight"> & {
  [key: string]: unknown;
};

function makeHost(): Host {
  return {
    _buildOffloadPairings: null,
    _offloaderWritesInFlight: 0,
    // Other fields the INITIAL_STATE handler writes unconditionally.
    _prefsLoaded: false,
    _prefsWritesInFlight: 0,
    _devices: [],
    _importableDevices: [],
    _devicesLoaded: false,
    _buildServerPeers: null,
    _buildOffloadDiscoveredHosts: null,
    _buildOffloadAlerts: null,
    _offloaderRemoteBuildsEnabled: null,
    _offloaderVersionMatchPolicy: null,
    _offloaderIncludeLocalInPool: null,
  };
}

function snapshot(pairings: PairingSummary[]): InitialStateEventData {
  return { devices: [], importable: [], pairings } as unknown as InitialStateEventData;
}

function dispatch(host: Host, data: InitialStateEventData): void {
  handleEvent(host as unknown as ESPHomeApp, DeviceEventType.INITIAL_STATE, data);
}

const PIN = "a".repeat(64);

describe("handleEvent INITIAL_STATE pairings reseed guard", () => {
  it("seeds pairings from the snapshot when no write is in flight", () => {
    const host = makeHost();

    dispatch(host, snapshot([makeSummary(PIN, false)]));

    expect(host._buildOffloadPairings?.get(PIN)?.enabled).toBe(false);
  });

  it("keeps the optimistic pairing enabled value while a write is in flight", () => {
    const host = makeHost();
    // A user just toggled this pairing off; the optimistic patch is in the map
    // and the setter has raised the in-flight counter.
    host._buildOffloadPairings = new Map([[PIN, makeSummary(PIN, false)]]);
    host._offloaderWritesInFlight = 1;

    // A reconnect snapshot arrives mid-write still carrying the stale enabled=true.
    dispatch(host, snapshot([makeSummary(PIN, true)]));

    // The security-sensitive optimistic value must survive the reconnect.
    expect(host._buildOffloadPairings?.get(PIN)?.enabled).toBe(false);
  });

  it("still seeds the first snapshot even while a write is in flight", () => {
    const host = makeHost();
    // Never seeded yet (null) but the counter is somehow non-zero: the UI must
    // still get its first paint rather than staying blank forever.
    host._offloaderWritesInFlight = 1;

    dispatch(host, snapshot([makeSummary(PIN, true)]));

    expect(host._buildOffloadPairings?.get(PIN)?.enabled).toBe(true);
  });
});
