import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VersionMatchPolicy } from "../../../src/api/types/event-subscription.js";
import { ExperienceLevel } from "../../../src/api/types/system.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import {
  onSetExpertMode,
  onSetOffloaderIncludeLocal,
  onSetOffloaderVersionMatchPolicy,
  onSetRemoteBuildEnabled,
  onSetRemoteComputeOnly,
  onSetTheme,
} from "../../../src/components/app-shell/settings-actions.js";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner-js", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

/** Let pending .catch()/.finally() microtasks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

type PrefsHost = Pick<
  ESPHomeApp,
  "_experienceLevel" | "_remoteComputeOnly" | "_localize" | "_prefsWritesInFlight"
> & { _api: { updatePreferences: (p: Record<string, unknown>) => Promise<unknown> } };

function makePrefsHost(
  updatePreferences: PrefsHost["_api"]["updatePreferences"]
): PrefsHost {
  return {
    _experienceLevel: null,
    _remoteComputeOnly: false,
    _localize: ((key: string) => key) as ESPHomeApp["_localize"],
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
    _localize: ((key: string) => key) as ESPHomeApp["_localize"],
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
    _localize: ((key: string) => key) as ESPHomeApp["_localize"],
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
