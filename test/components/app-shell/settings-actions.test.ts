import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onSetOffloaderAllowMajorVersionMismatch } from "../../../src/components/app-shell/settings-actions.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner-js", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

type StubHost = Pick<
  ESPHomeApp,
  "_offloaderAllowMajorVersionMismatch" | "_offloaderRemoteBuildsEnabled" | "_localize"
> & {
  _api: {
    setOffloaderRemoteBuildSettings: (args: Record<string, boolean>) => Promise<unknown>;
  };
};

function makeHost(api: StubHost["_api"]): StubHost {
  return {
    _offloaderAllowMajorVersionMismatch: true,
    _offloaderRemoteBuildsEnabled: true,
    _localize: ((key: string) => key) as ESPHomeApp["_localize"],
    _api: api,
  };
}

describe("onSetOffloaderAllowMajorVersionMismatch", () => {
  beforeEach(() => {
    toastError.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("optimistically flips the field and sends the API call", async () => {
    const setApi = vi.fn(async () => ({}));
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderAllowMajorVersionMismatch(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );

    expect(setApi).toHaveBeenCalledWith({ allow_major_version_mismatch: false });
    expect(host._offloaderAllowMajorVersionMismatch).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reverts to the previous value and toasts on backend rejection", async () => {
    const setApi = vi.fn(async () => {
      throw new Error("backend said no");
    });
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderAllowMajorVersionMismatch(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );

    expect(host._offloaderAllowMajorVersionMismatch).toBe(true);
    expect(toastError).toHaveBeenCalledOnce();
  });
});
