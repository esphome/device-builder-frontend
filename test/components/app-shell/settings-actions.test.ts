import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VersionMatchPolicy } from "../../../src/api/types/event-subscription.js";
import { ExperienceLevel } from "../../../src/api/types/system.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import {
  onSetExperienceLevel,
  onSetOffloaderVersionMatchPolicy,
  onSetRemoteComputeOnly,
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
  | "_experienceLevel"
  | "_yamlDiffButton"
  | "_remoteComputeOnly"
  | "_localize"
  | "_prefsWritesInFlight"
> & { _api: { updatePreferences: (p: Record<string, unknown>) => Promise<unknown> } };

function makePrefsHost(
  updatePreferences: PrefsHost["_api"]["updatePreferences"]
): PrefsHost {
  return {
    _experienceLevel: null,
    _yamlDiffButton: false,
    _remoteComputeOnly: false,
    _localize: ((key: string) => key) as ESPHomeApp["_localize"],
    _prefsWritesInFlight: 0,
    _api: { updatePreferences },
  };
}

type StubHost = Pick<
  ESPHomeApp,
  "_offloaderVersionMatchPolicy" | "_offloaderRemoteBuildsEnabled" | "_localize"
> & {
  _api: {
    setOffloaderRemoteBuildSettings: (args: Record<string, unknown>) => Promise<unknown>;
  };
};

function makeHost(api: StubHost["_api"]): StubHost {
  return {
    _offloaderVersionMatchPolicy: "any" as VersionMatchPolicy,
    _offloaderRemoteBuildsEnabled: true,
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

describe("onSetExperienceLevel", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("sets the level, seeds the yaml diff button on, and persists both", async () => {
    const update = vi.fn(async () => ({}));
    const host = makePrefsHost(update);
    onSetExperienceLevel(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: ExperienceLevel.YAML })
    );
    expect(host._experienceLevel).toBe(ExperienceLevel.YAML);
    expect(host._yamlDiffButton).toBe(true);
    await flush();
    expect(update).toHaveBeenCalledWith({
      experience_level: ExperienceLevel.YAML,
      yaml_diff_button: true,
    });
    expect(host._prefsWritesInFlight).toBe(0);
  });

  it("clears the yaml diff button for the beginner level", async () => {
    const host = makePrefsHost(vi.fn(async () => ({})));
    host._yamlDiffButton = true;
    onSetExperienceLevel(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: ExperienceLevel.BEGINNER })
    );
    expect(host._yamlDiffButton).toBe(false);
    await flush();
  });

  it("reverts level + diff button and toasts on backend rejection", async () => {
    const host = makePrefsHost(
      vi.fn(async () => {
        throw new Error("no");
      })
    );
    host._experienceLevel = ExperienceLevel.BEGINNER;
    onSetExperienceLevel(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: ExperienceLevel.YAML })
    );
    await flush();
    expect(host._experienceLevel).toBe(ExperienceLevel.BEGINNER);
    expect(host._yamlDiffButton).toBe(false);
    expect(toastError).toHaveBeenCalledOnce();
    expect(host._prefsWritesInFlight).toBe(0);
  });
});

describe("onSetRemoteComputeOnly", () => {
  beforeEach(() => toastError.mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("reverts and toasts on backend rejection", async () => {
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
  });
});

describe("prefs-write in-flight counter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays > 0 until every overlapping write settles", async () => {
    const resolvers: Array<(v?: unknown) => void> = [];
    const update = vi.fn(() => new Promise((r) => resolvers.push(r)));
    const host = makePrefsHost(update);

    onSetExperienceLevel(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: ExperienceLevel.UI })
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
