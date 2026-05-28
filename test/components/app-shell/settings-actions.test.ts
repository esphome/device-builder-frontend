import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onSetOffloaderAllowMajorVersionMismatch,
  onSetOffloaderRemoteBuildsEnabled,
} from "../../../src/components/app-shell/settings-actions.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";

const toastError = vi.fn();
vi.mock("sonner-js", () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

type StubHost = Pick<
  ESPHomeApp,
  | "_offloaderAllowMajorVersionMismatch"
  | "_offloaderRemoteBuildsEnabled"
  | "_offloaderSettingsSetInFlight"
  | "_localize"
> & {
  _api: {
    setOffloaderRemoteBuildSettings: (args: Record<string, boolean>) => Promise<unknown>;
  };
};

function makeHost(api: StubHost["_api"]): StubHost {
  return {
    _offloaderAllowMajorVersionMismatch: true,
    _offloaderRemoteBuildsEnabled: true,
    _offloaderSettingsSetInFlight: false,
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

  it("optimistically flips, sends the API call, clears the in-flight flag", async () => {
    let inFlightDuringCall = false;
    const setApi = vi.fn(async (_args: Record<string, boolean>) => {
      inFlightDuringCall = host._offloaderSettingsSetInFlight;
      return {};
    });
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderAllowMajorVersionMismatch(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );

    expect(setApi).toHaveBeenCalledWith({ allow_major_version_mismatch: false });
    expect(host._offloaderAllowMajorVersionMismatch).toBe(false);
    expect(inFlightDuringCall).toBe(true);
    expect(host._offloaderSettingsSetInFlight).toBe(false);
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
    expect(host._offloaderSettingsSetInFlight).toBe(false);
  });
});

describe("onSetOffloaderRemoteBuildsEnabled in-flight guard", () => {
  beforeEach(() => {
    toastError.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets the offloader-settings in-flight flag for the duration of the API call", async () => {
    let inFlightDuringCall = false;
    const setApi = vi.fn(async () => {
      inFlightDuringCall = host._offloaderSettingsSetInFlight;
      return {};
    });
    const host = makeHost({ setOffloaderRemoteBuildSettings: setApi });

    await onSetOffloaderRemoteBuildsEnabled(
      host as unknown as ESPHomeApp,
      new CustomEvent("x", { detail: false })
    );

    expect(inFlightDuringCall).toBe(true);
    expect(host._offloaderSettingsSetInFlight).toBe(false);
  });
});
