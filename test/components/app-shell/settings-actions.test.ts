import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VersionMatchPolicy } from "../../../src/api/types/event-subscription.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { onSetOffloaderVersionMatchPolicy } from "../../../src/components/app-shell/settings-actions.js";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner-js", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

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
