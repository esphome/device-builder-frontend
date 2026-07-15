import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VersionMatchPolicy } from "../../../src/api/types/event-subscription.js";
import type { PairingSummary } from "../../../src/api/types/remote-build.js";
import { ExperienceLevel } from "../../../src/api/types/system.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import {
  onSetExpertMode,
  onSetOffloaderIncludeLocal,
  onSetOffloaderPairingEnabled,
  onSetOffloaderVersionMatchPolicy,
  onSetRemoteBuildEnabled,
  onSetHideDeviceBuilder,
  onSetRemoteComputeOnly,
  onSetTheme,
  onSetVersionHistoryEnabled,
} from "../../../src/components/app-shell/settings-actions.js";
import { flush, identityLocalize } from "../../_dom.js";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner-js", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

type PrefsHost = Pick<
  ESPHomeApp,
  | "_experienceLevel"
  | "_remoteComputeOnly"
  | "_hideDeviceBuilder"
  | "_versionHistoryEnabled"
  | "_localize"
  | "_prefsWritesInFlight"
> & { _api: { updatePreferences: (p: Record<string, unknown>) => Promise<unknown> } };

function makePrefsHost(
  updatePreferences: PrefsHost["_api"]["updatePreferences"]
): PrefsHost {
  return {
    _experienceLevel: null,
    _remoteComputeOnly: false,
    _hideDeviceBuilder: false,
    _versionHistoryEnabled: true,
    _localize: identityLocalize as ESPHomeApp["_localize"],
    _prefsWritesInFlight: 0,
    _api: { updatePreferences },
  };
}

type StubHost = Pick<
  ESPHomeApp,
  | "_offloaderVersionMatchPolicy"
  | "_offloaderRemoteBuildsEnabled"
  | "_offloaderIncludeLocalInPool"
  | "_offloaderWritesInFlight"
  | "_localize"
> & {
  _api: {
    setOffloaderRemoteBuildSettings: (args: Record<string, unknown>) => Promise<unknown>;
  };
};

function makeHost(api: StubHost["_api"]): StubHost {
  return {
    _offloaderVersionMatchPolicy: "any" as VersionMatchPolicy,
    _offloaderRemoteBuildsEnabled: true,
    _offloaderIncludeLocalInPool: false,
    _offloaderWritesInFlight: 0,
    _localize: identityLocalize as ESPHomeApp["_localize"],
    _api: api,
  };
}

describe("onSetOffloaderVersionMatchPolicy", () => {
  beforeEach(() => {
    toastError.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("optimistically flips the field and sends the API call", async () => {
    const setApi = vi.fn(async () => ({}));
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderVersionMatchPolicy(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: "exact_required" as VersionMatchPolicy })
    );

    expect(setApi).toHaveBeenCalledWith({ version_match_policy: "exact_required" });
    expect(host._offloaderVersionMatchPolicy).toBe("exact_required");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reverts to the previous value and toasts on backend rejection", async () => {
    const setApi = vi.fn(async () => {
      throw new Error("backend said no");
    });
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderVersionMatchPolicy(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: "exact_required" as VersionMatchPolicy })
    );

    expect(host._offloaderVersionMatchPolicy).toBe("any");
    expect(toastError).toHaveBeenCalledOnce();
  });
});

describe("onSetOffloaderIncludeLocal", () => {
  beforeEach(() => {
    toastError.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("optimistically flips the field and sends the API call", async () => {
    const setApi = vi.fn(async () => ({}));
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderIncludeLocal(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );

    expect(setApi).toHaveBeenCalledWith({ include_local_in_pool: true });
    expect(host._offloaderIncludeLocalInPool).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reverts to the previous value and toasts on backend rejection", async () => {
    const setApi = vi.fn(async () => {
      throw new Error("backend said no");
    });
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderIncludeLocal(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );

    expect(host._offloaderIncludeLocalInPool).toBe(false);
    expect(toastError).toHaveBeenCalledOnce();
  });
});

describe("offloader-write in-flight counter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays > 0 until every overlapping offloader write settles", async () => {
    const resolvers: Array<(v?: unknown) => void> = [];
    const setApi = vi.fn(() => new Promise((r) => resolvers.push(r)));
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    void onSetOffloaderIncludeLocal(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );
    expect(host._offloaderWritesInFlight).toBe(1);
    void onSetOffloaderVersionMatchPolicy(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: "exact" as VersionMatchPolicy })
    );
    expect(host._offloaderWritesInFlight).toBe(2);

    resolvers[0]();
    await flush();
    // first write settled, but the gate stays closed for the second
    expect(host._offloaderWritesInFlight).toBe(1);

    resolvers[1]();
    await flush();
    expect(host._offloaderWritesInFlight).toBe(0);
  });
});

type PairingHost = Pick<
  ESPHomeApp,
  "_buildOffloadPairings" | "_offloaderWritesInFlight" | "_localize"
> & {
  _api: {
    setOffloaderPairingEnabled: (args: {
      pin_sha256: string;
      enabled: boolean;
    }) => Promise<unknown>;
  };
};

const PAIRING_PIN = "a".repeat(64);

function makePairing(enabled: boolean): PairingSummary {
  return {
    receiver_hostname: "192.168.1.50",
    receiver_port: 6052,
    pin_sha256: PAIRING_PIN,
    label: "lab-receiver",
    paired_at: 1,
    status: "approved",
    connected: true,
    connecting: false,
    last_connect_error: "",
    esphome_version: "",
    enabled,
    auto_provision_supported: false,
    friendly_name: "",
    ha_addon: false,
  };
}

function makePairingHost(
  api: PairingHost["_api"]
): PairingHost & { _buildOffloadPairings: Map<string, PairingSummary> } {
  return {
    _buildOffloadPairings: new Map([[PAIRING_PIN, makePairing(true)]]),
    _offloaderWritesInFlight: 0,
    _localize: identityLocalize as ESPHomeApp["_localize"],
    _api: api,
  };
}

describe("onSetOffloaderPairingEnabled", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("optimistically flips the row and sends the API call", async () => {
    const setApi = vi.fn(async () => ({}));
    const host = makePairingHost({ setOffloaderPairingEnabled: setApi });

    await onSetOffloaderPairingEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: { pin_sha256: PAIRING_PIN, enabled: false } })
    );

    expect(setApi).toHaveBeenCalledWith({ pin_sha256: PAIRING_PIN, enabled: false });
    expect(host._buildOffloadPairings.get(PAIRING_PIN)?.enabled).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reverts the row and toasts on backend rejection", async () => {
    const setApi = vi.fn(async () => {
      throw new Error("backend said no");
    });
    const host = makePairingHost({ setOffloaderPairingEnabled: setApi });

    await onSetOffloaderPairingEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: { pin_sha256: PAIRING_PIN, enabled: false } })
    );

    expect(host._buildOffloadPairings.get(PAIRING_PIN)?.enabled).toBe(true);
    expect(toastError).toHaveBeenCalledOnce();
  });

  it("holds the in-flight guard until the write settles", async () => {
    let resolve: (v?: unknown) => void = () => {};
    const setApi = vi.fn(() => new Promise((r) => (resolve = r)));
    const host = makePairingHost({ setOffloaderPairingEnabled: setApi });

    const done = onSetOffloaderPairingEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: { pin_sha256: PAIRING_PIN, enabled: false } })
    );
    // The gate is closed for the whole reconnect-race window, not just before
    // the first await, so a mid-write snapshot reseed is skipped.
    expect(host._offloaderWritesInFlight).toBe(1);

    resolve();
    await done;
    expect(host._offloaderWritesInFlight).toBe(0);
  });
});

describe("onSetExpertMode", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("maps the toggle to experience_level (EXPERT on, BEGINNER off)", async () => {
    const update = vi.fn(async () => ({}));
    const host = makePrefsHost(update);

    onSetExpertMode(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );
    expect(host._experienceLevel).toBe(ExperienceLevel.EXPERT);
    await flush();
    expect(update).toHaveBeenCalledWith({ experience_level: ExperienceLevel.EXPERT });

    onSetExpertMode(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );
    expect(host._experienceLevel).toBe(ExperienceLevel.BEGINNER);
  });

  it("reverts the level, logs, and toasts on backend rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = makePrefsHost(
      vi.fn(async () => {
        throw new Error("no");
      })
    );
    host._experienceLevel = ExperienceLevel.BEGINNER;
    onSetExpertMode(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );
    await flush();
    expect(host._experienceLevel).toBe(ExperienceLevel.BEGINNER);
    expect(toastError).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    expect(host._prefsWritesInFlight).toBe(0);
  });
});

describe("onSetRemoteComputeOnly", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("reverts, logs, and toasts on backend rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = makePrefsHost(
      vi.fn(async () => {
        throw new Error("no");
      })
    );
    onSetRemoteComputeOnly(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );
    expect(host._remoteComputeOnly).toBe(true);
    await flush();
    expect(host._remoteComputeOnly).toBe(false);
    expect(toastError).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
  });

  it("turning off also clears the hide sub-toggle in the same write", async () => {
    const update = vi.fn(async () => ({}));
    const host = makePrefsHost(update);
    host._remoteComputeOnly = true;
    host._hideDeviceBuilder = true;
    onSetRemoteComputeOnly(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );
    expect(host._remoteComputeOnly).toBe(false);
    expect(host._hideDeviceBuilder).toBe(false);
    await flush();
    expect(update).toHaveBeenCalledWith({
      remote_compute_only: false,
      hide_device_builder: false,
    });
  });

  it("a failed cascade write reverts both fields together", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = makePrefsHost(
      vi.fn(async () => {
        throw new Error("no");
      })
    );
    host._remoteComputeOnly = true;
    host._hideDeviceBuilder = true;
    onSetRemoteComputeOnly(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );
    await flush();
    expect(host._remoteComputeOnly).toBe(true);
    expect(host._hideDeviceBuilder).toBe(true);
  });

  it("turning on leaves the hide sub-toggle alone", async () => {
    const update = vi.fn(async () => ({}));
    const host = makePrefsHost(update);
    onSetRemoteComputeOnly(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );
    await flush();
    expect(update).toHaveBeenCalledWith({ remote_compute_only: true });
    expect(host._hideDeviceBuilder).toBe(false);
  });
});

describe("onSetHideDeviceBuilder", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("optimistically flips and persists the preference on success", async () => {
    const update = vi.fn(async () => ({}));
    const host = makePrefsHost(update);
    onSetHideDeviceBuilder(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );
    expect(host._hideDeviceBuilder).toBe(true);
    await flush();
    expect(host._hideDeviceBuilder).toBe(true);
    expect(update).toHaveBeenCalledWith({ hide_device_builder: true });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reverts, logs, and toasts on backend rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = makePrefsHost(
      vi.fn(async () => {
        throw new Error("no");
      })
    );
    onSetHideDeviceBuilder(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );
    expect(host._hideDeviceBuilder).toBe(true);
    await flush();
    expect(host._hideDeviceBuilder).toBe(false);
    expect(toastError).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
  });
});

describe("onSetVersionHistoryEnabled", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("optimistically flips and persists the preference on success", async () => {
    const update = vi.fn(async () => ({}));
    const host = makePrefsHost(update);
    onSetVersionHistoryEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );
    expect(host._versionHistoryEnabled).toBe(false);
    await flush();
    expect(host._versionHistoryEnabled).toBe(false);
    expect(update).toHaveBeenCalledWith({ version_history_enabled: false });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reverts, logs, and toasts on backend rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = makePrefsHost(
      vi.fn(async () => {
        throw new Error("no");
      })
    );
    onSetVersionHistoryEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );
    expect(host._versionHistoryEnabled).toBe(false);
    await flush();
    expect(host._versionHistoryEnabled).toBe(true);
    expect(toastError).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
  });
});

describe("onSetTheme", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("counts the write in flight and logs (not toasts) on failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = {
      ...makePrefsHost(
        vi.fn(async () => {
          throw new Error("no");
        })
      ),
      applyTheme: vi.fn(),
    };
    onSetTheme(host as unknown as ESPHomeApp, new CustomEvent("x", { detail: "dark" }));
    expect(host.applyTheme).toHaveBeenCalledWith("dark");
    expect(host._prefsWritesInFlight).toBe(1);
    await flush();
    expect(host._prefsWritesInFlight).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});

type RemoteBuildHost = Pick<
  ESPHomeApp,
  | "_remoteBuildEnabled"
  | "_remoteBuildSetInFlight"
  | "_buildServerIdentityRotationCounter"
  | "_localize"
> & {
  _api: { setRemoteBuildSettings: (args: Record<string, unknown>) => Promise<unknown> };
};

function makeRemoteBuildHost(
  setRemoteBuildSettings: RemoteBuildHost["_api"]["setRemoteBuildSettings"]
): RemoteBuildHost {
  return {
    _remoteBuildEnabled: false,
    _remoteBuildSetInFlight: false,
    _buildServerIdentityRotationCounter: 0,
    _localize: identityLocalize as ESPHomeApp["_localize"],
    _api: { setRemoteBuildSettings },
  };
}

describe("onSetRemoteBuildEnabled", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("flips optimistically, gates the write, and rotates identity on success", async () => {
    const setApi = vi.fn(async () => ({}));
    const host = makeRemoteBuildHost(setApi);

    const pending = onSetRemoteBuildEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );
    // Optimistic value + in-flight gate apply synchronously, before the await.
    expect(host._remoteBuildEnabled).toBe(true);
    expect(host._remoteBuildSetInFlight).toBe(true);

    await pending;
    expect(setApi).toHaveBeenCalledWith({ enabled: true });
    expect(host._buildServerIdentityRotationCounter).toBe(1);
    expect(host._remoteBuildSetInFlight).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reverts and toasts on rejection without rotating identity", async () => {
    const host = makeRemoteBuildHost(
      vi.fn(async () => {
        throw new Error("no");
      })
    );

    await onSetRemoteBuildEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );

    expect(host._remoteBuildEnabled).toBe(false);
    expect(host._buildServerIdentityRotationCounter).toBe(0);
    expect(host._remoteBuildSetInFlight).toBe(false);
    expect(toastError).toHaveBeenCalledOnce();
  });
});

describe("prefs-write in-flight counter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays > 0 until every overlapping write settles", async () => {
    const resolvers: Array<(v?: unknown) => void> = [];
    const update = vi.fn(() => new Promise((r) => resolvers.push(r)));
    const host = makePrefsHost(update);

    onSetExpertMode(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );
    expect(host._prefsWritesInFlight).toBe(1);
    onSetRemoteComputeOnly(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: true })
    );
    expect(host._prefsWritesInFlight).toBe(2);

    resolvers[0]();
    await flush();
    // first write settled, but the gate must stay closed for the second
    expect(host._prefsWritesInFlight).toBe(1);

    resolvers[1]();
    await flush();
    expect(host._prefsWritesInFlight).toBe(0);
  });
});
