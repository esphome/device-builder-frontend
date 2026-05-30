import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InitialStateEventData,
  PairingSummary,
  VersionMatchPolicy,
} from "../../../src/api/types.js";
import { DeviceEventType } from "../../../src/api/types.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";
import {
  onSetOffloaderPairingEnabled,
  onSetOffloaderRemoteBuildsEnabled,
  onSetOffloaderVersionMatchPolicy,
} from "../../../src/components/app-shell/settings-actions.js";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner-js", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

// A stub carrying every field the offloader handlers and the INITIAL_STATE
// branch of handleEvent touch. Cast to ESPHomeApp at the call boundary.
interface StubHost {
  _offloaderRemoteBuildsEnabled: boolean | null;
  _offloaderVersionMatchPolicy: VersionMatchPolicy | null;
  _offloaderSetInFlight: boolean;
  _buildOffloadPairings: Map<string, PairingSummary> | null;
  _buildOffloadDiscoveredHosts: unknown;
  _buildOffloadAlerts: unknown;
  _buildOffloadJobs: Map<string, unknown>;
  _buildServerPeers: unknown;
  _devices: unknown;
  _importableDevices: unknown;
  _devicesLoaded: boolean;
  _localize: ESPHomeApp["_localize"];
  _api: {
    setOffloaderRemoteBuildSettings: (args: Record<string, unknown>) => Promise<unknown>;
    setOffloaderPairingEnabled: (args: Record<string, unknown>) => Promise<unknown>;
  };
}

function makeHost(api: StubHost["_api"]): StubHost {
  return {
    _offloaderRemoteBuildsEnabled: false,
    _offloaderVersionMatchPolicy: "any",
    _offloaderSetInFlight: false,
    _buildOffloadPairings: null,
    _buildOffloadDiscoveredHosts: null,
    _buildOffloadAlerts: null,
    _buildOffloadJobs: new Map(),
    _buildServerPeers: null,
    _devices: [],
    _importableDevices: [],
    _devicesLoaded: false,
    _localize: ((key: string) => key) as ESPHomeApp["_localize"],
    _api: api,
  };
}

function makePairing(pin: string, enabled: boolean): PairingSummary {
  return {
    receiver_hostname: "host",
    receiver_port: 6052,
    pin_sha256: pin,
    label: "rx",
    paired_at: 0,
    status: "approved",
    connected: true,
    connecting: false,
    last_connect_error: "",
    esphome_version: "2024.1.0",
    enabled,
  };
}

function initialState(over: Partial<InitialStateEventData>): InitialStateEventData {
  return { devices: [], importable: [], ...over };
}

// A controllable promise so the test can hold a write "in flight" while a
// reconnect's INITIAL_STATE event races it.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function reconnect(host: StubHost, over: Partial<InitialStateEventData>): void {
  handleEvent(
    host as unknown as ESPHomeApp,
    DeviceEventType.INITIAL_STATE,
    initialState(over)
  );
}

describe("offloader settings in-flight gate", () => {
  beforeEach(() => {
    toastError.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the in-flight gate set across a remote-builds write", async () => {
    const d = deferred();
    const setApi = vi.fn(() => d.promise);
    const host = makeHost({
      setOffloaderRemoteBuildSettings: setApi,
      setOffloaderPairingEnabled: vi.fn(),
    });

    const write = onSetOffloaderRemoteBuildsEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );

    expect(host._offloaderRemoteBuildsEnabled).toBe(true);
    expect(host._offloaderSetInFlight).toBe(true);

    d.resolve();
    await write;
    expect(host._offloaderSetInFlight).toBe(false);
  });

  it("does not clobber an in-flight remote-builds flip on reconnect", async () => {
    const d = deferred();
    const setApi = vi.fn(() => d.promise);
    const host = makeHost({
      setOffloaderRemoteBuildSettings: setApi,
      setOffloaderPairingEnabled: vi.fn(),
    });

    const write = onSetOffloaderRemoteBuildsEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );

    // Reconnect mid-write carries the pre-write server value (false).
    reconnect(host, { remote_builds_enabled: false });

    expect(host._offloaderRemoteBuildsEnabled).toBe(true);

    d.resolve();
    await write;
  });

  it("does not clobber an in-flight version-policy flip on reconnect", async () => {
    const d = deferred();
    const setApi = vi.fn(() => d.promise);
    const host = makeHost({
      setOffloaderRemoteBuildSettings: setApi,
      setOffloaderPairingEnabled: vi.fn(),
    });

    const write = onSetOffloaderVersionMatchPolicy(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: "exact_required" as VersionMatchPolicy })
    );

    reconnect(host, { version_match_policy: "any" });

    expect(host._offloaderVersionMatchPolicy).toBe("exact_required");

    d.resolve();
    await write;
  });

  it("does not clobber an in-flight pairing-enabled flip on reconnect", async () => {
    const pin = "abc";
    const d = deferred();
    const host = makeHost({
      setOffloaderRemoteBuildSettings: vi.fn(),
      setOffloaderPairingEnabled: vi.fn(() => d.promise),
    });
    host._buildOffloadPairings = new Map([[pin, makePairing(pin, false)]]);

    const write = onSetOffloaderPairingEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: { pin_sha256: pin, enabled: true } })
    );

    // Reconnect snapshot still shows the pairing disabled.
    reconnect(host, { pairings: [makePairing(pin, false)] });

    expect(host._buildOffloadPairings?.get(pin)?.enabled).toBe(true);

    d.resolve();
    await write;
  });

  it("applies the server snapshot when no offloader write is in flight", () => {
    const host = makeHost({
      setOffloaderRemoteBuildSettings: vi.fn(),
      setOffloaderPairingEnabled: vi.fn(),
    });
    host._offloaderRemoteBuildsEnabled = true;
    host._offloaderVersionMatchPolicy = "exact_required";

    reconnect(host, {
      remote_builds_enabled: false,
      version_match_policy: "any",
    });

    expect(host._offloaderRemoteBuildsEnabled).toBe(false);
    expect(host._offloaderVersionMatchPolicy).toBe("any");
  });
});
